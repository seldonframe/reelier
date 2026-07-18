// `reelier push`: sync local run records (and, on first push, the skill
// file itself) to a Reelier Cloud instance, so an OSS user's receipts
// accrue in a hosted ledger. Zero new dependencies — Node's native `fetch`,
// used the same way src/llm.ts uses it (call the global directly; tests
// monkeypatch `globalThis.fetch` for the duration of a test, exactly like
// test/llm.test.ts does for the LLM transport).
//
// Cloud API contract (consumer-side only — the cloud's own server behavior
// is its own product, this only documents what the CLI relies on; see
// SPEC.md "Cloud sync API"):
//   POST {base}/api/v1/runs   Authorization: Bearer <key>
//     body {skillName, record} -> 202 {id}
//   POST {base}/api/v1/skills Authorization: Bearer <key>
//     body {name, skillMd}     -> 2xx
//   Errors: 400 {fieldErrors}, 401 (bad/missing key), 413 (payload too large)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseSkill } from "./skill.js";
import { readRunRecords, type RunRecord } from "./runner.js";

export interface PushConfig {
  baseUrl: string;
  apiKey: string;
}

/**
 * Resolve cloud sync config from env. Never logs or embeds the key
 * anywhere in a thrown message — only names the missing var(s).
 */
export function resolvePushConfig(env: NodeJS.ProcessEnv = process.env): PushConfig {
  const baseUrl = env.REELIER_CLOUD_URL;
  const apiKey = env.REELIER_CLOUD_KEY;
  const missing: string[] = [];
  if (!baseUrl) missing.push("REELIER_CLOUD_URL");
  if (!apiKey) missing.push("REELIER_CLOUD_KEY");
  if (missing.length > 0) {
    throw new Error(
      `'reelier push' requires ${missing.join(" and ")} to be set — point REELIER_CLOUD_URL at your Reelier ` +
        `Cloud instance and REELIER_CLOUD_KEY at your API key. Pushing is opt-in; nothing is synced without both.`
    );
  }
  return { baseUrl: baseUrl!, apiKey: apiKey! };
}

// ---------------------------------------------------------------------------
// Cursor state: .reelier/push-state.json, {[skillName]: {pushed, skillUploaded}}
// ---------------------------------------------------------------------------

export interface PushStateEntry {
  /** Count of records from the start of the run-record file already pushed successfully. */
  pushed: number;
  /** Whether the skill file itself has ever been uploaded (first-push-only, unless --with-skill). */
  skillUploaded: boolean;
}

export type PushState = Record<string, PushStateEntry>;

function pushStatePath(cwd: string): string {
  return path.join(cwd, ".reelier", "push-state.json");
}

export async function readPushState(cwd: string): Promise<PushState> {
  try {
    const raw = await readFile(pushStatePath(cwd), "utf8");
    return JSON.parse(raw) as PushState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function writePushState(cwd: string, state: PushState): Promise<void> {
  const filePath = pushStatePath(cwd);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function runRecordPath(cwd: string, skillName: string): string {
  return path.join(cwd, ".reelier", "runs", `${skillName}.jsonl`);
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

export type PushRecordOutcome = "pushed" | "rejected" | "auth-failed" | "too-large" | "error";

export interface PushRecordResult {
  /** Absolute index of this record within the skill's full run-record file (0-based). */
  index: number;
  outcome: PushRecordOutcome;
  id?: string;
  fieldErrors?: unknown;
  message?: string;
}

export interface PushResult {
  skillName: string;
  /** True iff the skill file was actually uploaded this run (dry-run reports what WOULD happen and this stays false). */
  skillUploaded: boolean;
  totalRecords: number;
  cursorBefore: number;
  /** Records at/after cursorBefore that this run considered pushing. */
  candidateCount: number;
  results: PushRecordResult[];
  pushedCount: number;
  cursorAfter: number;
  /** True iff the batch stopped early (rejection, auth failure, or any other non-success). */
  aborted: boolean;
  dryRun: boolean;
}

export interface PushOptions {
  cwd?: string;
  /** Ignore/reset the cursor — reconsider every record in the file from the start. */
  all?: boolean;
  /** Report what would push; touch no state and make no network calls. */
  dryRun?: boolean;
  /** Upload the skill file even if it was already uploaded before. */
  withSkill?: boolean;
  onRecordResult?: (result: PushRecordResult) => void;
}

async function uploadSkill(config: PushConfig, skillName: string, skillMd: string): Promise<void> {
  const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/v1/skills`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ name: skillName, skillMd }),
  });
  if (res.status === 401) {
    throw new Error("Skill upload failed: HTTP 401 — the configured REELIER_CLOUD_KEY was rejected.");
  }
  if (res.ok) return;
  const bodyText = await res.text().catch(() => "");
  throw new Error(`Skill upload failed: HTTP ${res.status}: ${bodyText.slice(0, 500)}`);
}

async function pushOneRecord(
  config: PushConfig,
  skillName: string,
  record: RunRecord,
  index: number
): Promise<PushRecordResult> {
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/v1/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ skillName, record }),
    });
  } catch (err) {
    return { index, outcome: "error", message: `Network error: ${(err as Error).message}` };
  }

  if (res.status === 202) {
    let body: { id?: string } = {};
    try {
      body = JSON.parse(await res.text());
    } catch {
      // A 202 with an unparseable body is still a successful push as far as
      // the ledger is concerned — the id just won't be reported.
    }
    return { index, outcome: "pushed", id: body.id };
  }
  if (res.status === 401) {
    return { index, outcome: "auth-failed", message: "the configured REELIER_CLOUD_KEY was rejected" };
  }
  if (res.status === 400) {
    let fieldErrors: unknown;
    try {
      fieldErrors = JSON.parse(await res.text()).fieldErrors;
    } catch {
      fieldErrors = undefined;
    }
    return { index, outcome: "rejected", fieldErrors };
  }
  if (res.status === 413) {
    return { index, outcome: "too-large", message: "record payload exceeded the cloud's size limit" };
  }
  const bodyText = await res.text().catch(() => "");
  return { index, outcome: "error", message: `HTTP ${res.status}: ${bodyText.slice(0, 500)}` };
}

/**
 * Push new run records (and, on first push, the skill file) for one skill
 * to a Reelier Cloud instance. Cursor advances only past records pushed
 * successfully in strict order — the first non-"pushed" outcome stops the
 * batch, leaving the cursor at the last success (never skips ahead over a
 * failure). `--dry-run` (options.dryRun) touches no state and makes no
 * network calls at all.
 */
export async function pushSkill(skillPath: string, options: PushOptions = {}): Promise<PushResult> {
  const cwd = options.cwd ?? process.cwd();

  const source = await readFile(skillPath, "utf8");
  const skill = parseSkill(source);

  const recordFile = runRecordPath(cwd, skill.name);
  let allRecords: RunRecord[];
  try {
    allRecords = await readRunRecords(recordFile);
  } catch (err) {
    throw new Error(
      `No run records found at ${recordFile}: ${(err as Error).message}. Run 'reelier run ${skillPath}' at ` +
        `least once before pushing.`
    );
  }

  const state = await readPushState(cwd);
  const existing = state[skill.name];
  const cursorBefore = options.all ? 0 : existing?.pushed ?? 0;
  const candidates = allRecords.slice(cursorBefore);
  const needsSkillUpload = options.withSkill || !existing?.skillUploaded;

  if (options.dryRun) {
    const results: PushRecordResult[] = candidates.map((_, i) => ({
      index: cursorBefore + i,
      outcome: "pushed", // hypothetical — dry-run never calls the network
    }));
    for (const r of results) options.onRecordResult?.(r);
    return {
      skillName: skill.name,
      skillUploaded: false,
      totalRecords: allRecords.length,
      cursorBefore,
      candidateCount: candidates.length,
      results,
      pushedCount: 0,
      cursorAfter: cursorBefore,
      aborted: false,
      dryRun: true,
    };
  }

  const config = resolvePushConfig();

  let skillUploaded = false;
  if (needsSkillUpload) {
    await uploadSkill(config, skill.name, source);
    skillUploaded = true;
  }

  const results: PushRecordResult[] = [];
  let pushedCount = 0;
  let aborted = false;

  for (let i = 0; i < candidates.length; i++) {
    const result = await pushOneRecord(config, skill.name, candidates[i], cursorBefore + i);
    results.push(result);
    options.onRecordResult?.(result);
    if (result.outcome === "pushed") {
      pushedCount++;
    } else {
      aborted = true;
      break;
    }
  }

  const cursorAfter = cursorBefore + pushedCount;
  const newState: PushState = {
    ...state,
    [skill.name]: {
      pushed: cursorAfter,
      skillUploaded: skillUploaded || existing?.skillUploaded || false,
    },
  };
  await writePushState(cwd, newState);

  return {
    skillName: skill.name,
    skillUploaded,
    totalRecords: allRecords.length,
    cursorBefore,
    candidateCount: candidates.length,
    results,
    pushedCount,
    cursorAfter,
    aborted,
    dryRun: false,
  };
}
