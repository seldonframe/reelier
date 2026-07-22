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
//
// Rejection policy (400/413 vs 401/network — SPEC.md §8.3a): a 400/413 is a
// PERMANENT verdict on that exact record — the cloud looked at it and said
// no, and retrying the identical bytes will get the identical no. Retrying
// forever would wedge every later record behind it, so these WARN loudly,
// record an audit entry, advance the cursor past the record, and continue
// the batch. A 401 or a network error is TRANSIENT/retryable (bad key this
// second, cloud unreachable this second) — those still stop the batch with
// the cursor left at the last success, exactly as before.

import { readFile, mkdir, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseSkill } from "./skill.js";
import { readRunRecords, type RunRecord } from "./runner.js";
import { writeFileAtomic } from "./writeback.js";
import { costRun, loadPriceTable, type PriceTable } from "./cost.js";

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

export interface RejectedEntry {
  /** Absolute index of the record within the skill's run-record file (0-based). */
  index: number;
  /** Human-readable reason — the fieldErrors payload (400) or the size-limit message (413). */
  reason: string;
  /** ISO timestamp of when this rejection was recorded. */
  at: string;
}

export interface PushStateEntry {
  /** Count of records from the start of the run-record file the cursor has advanced past — pushed OR permanently rejected (§8.3a). */
  pushed: number;
  /** Whether the skill file itself has ever been uploaded (first-push-only, unless --with-skill). */
  skillUploaded: boolean;
  /** Cumulative audit log of every 400/413 rejection ever recorded for this skill, oldest first. Never pruned automatically. */
  rejected?: RejectedEntry[];
}

export type PushState = Record<string, PushStateEntry>;

function pushStatePath(cwd: string): string {
  return path.join(cwd, ".reelier", "push-state.json");
}

/**
 * Read `.reelier/push-state.json`. A missing file is a fresh, empty state
 * (no warning — this is the normal first-run case). A file that exists but
 * fails to parse as JSON is treated as CORRUPT, not fatal: it's renamed
 * aside to `push-state.json.corrupt-<epoch-ms>` (best-effort — a rename
 * failure is swallowed, the corrupt content is simply left in place under
 * its original name and overwritten on the next successful write), a loud
 * warning is printed, and a fresh empty state is returned. A torn/corrupt
 * cursor file must never permanently wedge pushing.
 */
export async function readPushState(cwd: string): Promise<PushState> {
  const filePath = pushStatePath(cwd);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  try {
    return JSON.parse(raw) as PushState;
  } catch (err) {
    const corruptPath = `${filePath}.corrupt-${Date.now()}`;
    console.error(
      `WARNING: ${filePath} is corrupt and could not be parsed as JSON (${
        (err as Error).message
      }) — starting from a fresh push state (renaming the corrupt file to ${corruptPath}). Any cursor ` +
        `positions previously recorded here are lost; if you're unsure what's already been pushed, ` +
        `re-run with --all.`
    );
    try {
      await rename(filePath, corruptPath);
    } catch {
      // Best effort — even if we can't move it aside, we still proceed with
      // a fresh in-memory state rather than throwing. The next successful
      // writePushState overwrites the corrupt content at the original path.
    }
    return {};
  }
}

async function writePushState(cwd: string, state: PushState): Promise<void> {
  const filePath = pushStatePath(cwd);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFileAtomic(filePath, JSON.stringify(state, null, 2) + "\n");
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
  /** Only set when the push was made with `--share` and the cloud minted/reused a public receipt token. */
  shareUrl?: string;
  /** Only set alongside shareUrl — the badge SVG URL for the same token. */
  badgeUrl?: string;
}

export interface PushResult {
  skillName: string;
  /** True iff the skill file was actually uploaded this run (dry-run reports what WOULD happen and this stays false). */
  skillUploaded: boolean;
  /** Set iff `--public` was passed AND the skill was (re-)uploaded this run AND the cloud returned registry-submission details. Absent on a plain push, on dry-run, or against an older cloud that doesn't understand `public: true` yet. */
  publicSubmission?: PublicSubmissionResult;
  totalRecords: number;
  cursorBefore: number;
  /** Records at/after cursorBefore that this run considered pushing. */
  candidateCount: number;
  results: PushRecordResult[];
  pushedCount: number;
  /** Count of records permanently rejected (400/413) THIS run — cursor still advances past these. */
  rejectedCount: number;
  cursorAfter: number;
  /** True iff the batch stopped early on a TRANSIENT outcome (auth failure or a network/other error) — never true for a permanent rejection, since those advance the cursor and continue. */
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
  /**
   * Opt each pushed record into a PUBLIC receipt (mint-or-reuse a share
   * token cloud-side). Privacy first: omitted/false means every push stays
   * private by default — see cli.ts's `--share` flag, the only place that
   * sets this.
   */
  share?: boolean;
  /**
   * Submit the skill to the public registry (skill-registry-v0 spec §2):
   * adds `public: true` to the skills upload POST body. Composes with
   * `--share` — both flags can be set on the same push. Because submission
   * is itself an upload (the cloud needs the latest bytes to grade/list),
   * `--public` forces the skill-upload leg to run even if it was already
   * uploaded before (equivalent to implying `withSkill` for this push only).
   */
  public?: boolean;
  onRecordResult?: (result: PushRecordResult) => void;
}

/** Result of a `--public` submission — parsed from the skills-upload response body when `public: true` was sent and the cloud understood it. */
export interface PublicSubmissionResult {
  status: "listed" | "pending";
  pageUrl: string;
  /** The `reelier get ...` copy-paste command for this listing. Empty string if the cloud omitted it. */
  getCommand: string;
  version?: number;
  /** True when the submitted bytes are identical to the currently-listed version — nothing changed. */
  noop: boolean;
}

/** Thrown when the cloud's skills-upload response signals a registry-submission-specific failure (missing license, unlinked namespace, reserved name) — carries the server's own message verbatim, and `linkUrl` when the cloud provided one (e.g. the tenant->GitHub linking page for a 403). */
export class PublicSubmissionError extends Error {
  linkUrl?: string;
  constructor(message: string, linkUrl?: string) {
    super(message);
    this.name = "PublicSubmissionError";
    this.linkUrl = linkUrl;
  }
}

function formatFieldErrors(fieldErrors: unknown): string {
  if (fieldErrors === undefined) return "(no field errors returned)";
  try {
    return JSON.stringify(fieldErrors);
  } catch {
    return String(fieldErrors);
  }
}

/**
 * Upload the skill file. When `makePublic` is true, adds `public: true` to
 * the POST body (skill-registry-v0 spec §2) — the cloud enters the skill
 * into the moderation/listing pipeline and, on success, responds with
 * `{pageUrl, getCommand, status, version, noop}` in addition to the plain
 * upload's usual 2xx. Returns that parsed submission on a public upload,
 * `undefined` on a plain (non-public) upload.
 *
 * Two failure modes are registry-submission-specific and get their own
 * handling so the CLI can surface the cloud's own words verbatim rather than
 * a generic "upload failed" (spec §2 / task brief):
 *  - 400: a triage/validation rejection (most commonly: missing `license:`
 *    frontmatter). Surfaces the field errors exactly as the cloud sent them.
 *  - 403: a linking/namespace rejection (unlinked tenant->GitHub, or a
 *    reserved owner slug). Surfaces the cloud's message plus `linkUrl` when
 *    present so the CLI can print the exact URL to fix it at.
 * Both throw `PublicSubmissionError` — never silently swallowed.
 */
async function uploadSkill(
  config: PushConfig,
  skillName: string,
  skillMd: string,
  makePublic?: boolean
): Promise<PublicSubmissionResult | undefined> {
  const res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/v1/skills`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ name: skillName, skillMd, ...(makePublic ? { public: true } : {}) }),
  });
  if (res.status === 401) {
    throw new Error("Skill upload failed: HTTP 401 — the configured REELIER_CLOUD_KEY was rejected.");
  }
  if (res.status === 400) {
    const bodyText = await res.text().catch(() => "");
    let message = `Skill upload rejected (400)${bodyText ? `: ${bodyText.slice(0, 500)}` : ""}`;
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed && parsed.fieldErrors !== undefined) {
        message = `Skill upload rejected: ${formatFieldErrors(parsed.fieldErrors)}`;
      } else if (parsed && typeof parsed.error === "string") {
        message = `Skill upload rejected: ${parsed.error}`;
      }
    } catch {
      // Non-JSON body — fall back to the raw text already captured above.
    }
    throw new PublicSubmissionError(message);
  }
  if (res.status === 403) {
    const bodyText = await res.text().catch(() => "");
    let message = `Skill upload forbidden (403)${bodyText ? `: ${bodyText.slice(0, 500)}` : ""}`;
    let linkUrl: string | undefined;
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed && typeof parsed.error === "string") message = parsed.error;
      if (parsed && typeof parsed.linkUrl === "string") linkUrl = parsed.linkUrl;
    } catch {
      // Non-JSON body — fall back to the raw text already captured above.
    }
    throw new PublicSubmissionError(message, linkUrl);
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Skill upload failed: HTTP ${res.status}: ${bodyText.slice(0, 500)}`);
  }
  if (!makePublic) return undefined;

  let body: Partial<PublicSubmissionResult> = {};
  try {
    body = JSON.parse(await res.text());
  } catch {
    // The upload itself succeeded (2xx) — a malformed/absent submission body
    // just means we can't report listing details, not that the push failed.
  }
  if (
    (body.status !== "listed" && body.status !== "pending") ||
    typeof body.pageUrl !== "string"
  ) {
    // Older cloud that accepted `public: true` but doesn't understand the
    // registry pipeline yet — the upload succeeded, there's just nothing to
    // report. Never fabricate a pageUrl/status that wasn't actually returned.
    return undefined;
  }
  return {
    status: body.status,
    pageUrl: body.pageUrl,
    getCommand: typeof body.getCommand === "string" ? body.getCommand : "",
    version: typeof body.version === "number" ? body.version : undefined,
    noop: body.noop === true,
  };
}

/**
 * Compute the optional `costUsd`/`priceTableDate` pair a pushed record
 * carries (flight-recorder-v1 spec §2) — top-level-safe additions a
 * pre-existing cloud simply ignores. Present ONLY when every step's tokens
 * (including zero, the common deterministic-replay case) priced cleanly
 * against `priceTable`; a record with ANY unpriceable-model tokens omits
 * both fields rather than send a partial/wrong number — never guess a
 * price on the wire either.
 */
function computePushCost(record: RunRecord, priceTable: PriceTable | undefined): { costUsd: number; priceTableDate: string } | undefined {
  if (!priceTable) return undefined;
  const cost = costRun(record, priceTable);
  if (cost.unpriceableModels.length > 0) return undefined;
  return { costUsd: cost.pricedUsd, priceTableDate: priceTable.bundledRetrievedAt };
}

async function pushOneRecord(
  config: PushConfig,
  skillName: string,
  record: RunRecord,
  index: number,
  share?: boolean,
  priceTable?: PriceTable
): Promise<PushRecordResult> {
  const cost = computePushCost(record, priceTable);
  let res: Response;
  try {
    res = await fetch(`${config.baseUrl.replace(/\/$/, "")}/api/v1/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      // `skillContentSha256` (and, now, `costUsd`/`priceTableDate`) ride at
      // the TOP LEVEL of the POST body (sibling of `record`), matching the
      // cloud ingest contract (route.ts reads them there, not from inside
      // `record`). An older cloud that doesn't know these fields yet simply
      // ignores them — same optional-field discipline as skillContentSha256.
      // NOTE for the cloud side (follow-up, not this change): displaying
      // costUsd/priceTableDate on the receipt page is a separate piece of
      // work this push-time addition does not include.
      body: JSON.stringify({
        skillName,
        record,
        ...(record.skillContentSha256 ? { skillContentSha256: record.skillContentSha256 } : {}),
        ...(share ? { share: true } : {}),
        ...(cost ? { costUsd: cost.costUsd, priceTableDate: cost.priceTableDate } : {}),
      }),
    });
  } catch (err) {
    return { index, outcome: "error", message: `Network error: ${(err as Error).message}` };
  }

  if (res.status === 202) {
    let body: { id?: string; shareUrl?: string; badgeUrl?: string } = {};
    try {
      body = JSON.parse(await res.text());
    } catch {
      // A 202 with an unparseable body is still a successful push as far as
      // the ledger is concerned — the id just won't be reported.
    }
    return { index, outcome: "pushed", id: body.id, shareUrl: body.shareUrl, badgeUrl: body.badgeUrl };
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
 * to a Reelier Cloud instance, strictly in order. Two different outcomes
 * mean two different things (§8.3a in SPEC.md):
 *  - A 400/413 is a PERMANENT rejection of that exact record — logged as a
 *    loud warning + an audit entry in push-state.json's "rejected" list,
 *    the cursor advances past it, and the batch continues.
 *  - A 401 or a network/other error is TRANSIENT — the batch stops
 *    immediately and the cursor is left at the last successfully-pushed
 *    (or permanently-rejected) record, so the next push retries from there.
 * `--dry-run` (options.dryRun) touches no state and makes no network calls
 * at all.
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
  // `--public` always re-runs the upload leg, even if the skill was already
  // uploaded privately before: submitting to the registry needs the current
  // bytes graded/listed, and a resubmission of unchanged bytes is itself a
  // meaningful (no-op) outcome the cloud reports back.
  const needsSkillUpload = options.withSkill || options.public || !existing?.skillUploaded;

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
      rejectedCount: 0,
      cursorAfter: cursorBefore,
      aborted: false,
      dryRun: true,
    };
  }

  const config = resolvePushConfig();

  // Best-effort: a missing price file is normal (bundled-only), but a
  // PRESENT-and-corrupt ~/.reelier/prices.yml must never break a push (the
  // recorder's prime directive — pushing is plumbing, cost is a bonus on
  // top of it). Warn loudly and push without costUsd/priceTableDate rather
  // than aborting the whole batch over an unrelated malformed file.
  let priceTable: PriceTable | undefined;
  try {
    priceTable = await loadPriceTable();
  } catch (err) {
    console.error(
      `WARNING: could not load the $ meter's price table (${(err as Error).message}) — pushing without ` +
        `costUsd/priceTableDate this run. Fix or remove the offending ~/.reelier/prices.yml to restore it.`
    );
  }

  let skillUploaded = false;
  let publicSubmission: PublicSubmissionResult | undefined;
  if (needsSkillUpload) {
    publicSubmission = await uploadSkill(config, skill.name, source, options.public);
    skillUploaded = true;
  }

  const results: PushRecordResult[] = [];
  const newlyRejected: RejectedEntry[] = [];
  let pushedCount = 0;
  let consumedCount = 0; // pushed + permanently-rejected — what the cursor advances past
  let aborted = false;

  // Push-time fallback hash: records written by a `reelier run` that predates
  // `RunRecord.skillContentSha256` (or by any future caller with no file
  // access of its own) arrive here with the field absent. Rather than push
  // them with no hash at all, stamp the CURRENT skill file's bytes at the
  // moment of push — better than nothing, but note the staleness caveat: if
  // the file was edited between when the run actually happened and this
  // push, this hash reflects the edited bytes, not the ones that produced
  // the run. Run-time stamping (see cli.ts/serve.ts) is always preferred and
  // takes priority whenever a record already carries its own hash.
  const pushTimeFallbackSha256 = createHash("sha256").update(source, "utf8").digest("hex");

  for (let i = 0; i < candidates.length; i++) {
    const record = candidates[i].skillContentSha256
      ? candidates[i]
      : { ...candidates[i], skillContentSha256: pushTimeFallbackSha256 };
    const result = await pushOneRecord(config, skill.name, record, cursorBefore + i, options.share, priceTable);
    results.push(result);
    options.onRecordResult?.(result);

    if (result.outcome === "pushed") {
      pushedCount++;
      consumedCount++;
      continue;
    }

    if (result.outcome === "rejected" || result.outcome === "too-large") {
      // Permanent verdict from the cloud on this exact record — warn loudly,
      // record it for audit, advance the cursor past it, and keep going.
      // Never wedge the whole skill's history behind one bad record.
      const reason =
        result.outcome === "rejected" ? formatFieldErrors(result.fieldErrors) : (result.message ?? "413");
      console.error(
        `WARNING: record ${result.index} of skill '${skill.name}' was permanently rejected by the cloud ` +
          `(${result.outcome === "rejected" ? "400" : "413"}): ${reason} — cursor advanced past it; see ` +
          `.reelier/push-state.json's "rejected" list for this skill.`
      );
      newlyRejected.push({ index: result.index, reason, at: new Date().toISOString() });
      consumedCount++;
      continue;
    }

    // "auth-failed" or "error" — transient/retryable. Stop here; the cursor
    // does NOT advance past this record, so the next push retries it.
    aborted = true;
    break;
  }

  const cursorAfter = cursorBefore + consumedCount;
  const newState: PushState = {
    ...state,
    [skill.name]: {
      pushed: cursorAfter,
      skillUploaded: skillUploaded || existing?.skillUploaded || false,
      rejected: [...(existing?.rejected ?? []), ...newlyRejected],
    },
  };
  await writePushState(cwd, newState);

  return {
    skillName: skill.name,
    skillUploaded,
    publicSubmission,
    totalRecords: allRecords.length,
    cursorBefore,
    candidateCount: candidates.length,
    results,
    pushedCount,
    rejectedCount: newlyRejected.length,
    cursorAfter,
    aborted,
    dryRun: false,
  };
}
