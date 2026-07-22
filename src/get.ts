// `reelier get <owner>/<skill>[@<N> | @sha256:<hex>]`: fetch a skill from the
// Reelier Cloud public registry, verify its integrity client-side, and land
// it at ./skills/<skill>.skill.md. This is the CONSUME half of the registry
// (skill-registry-v0 spec §1) — the PUBLISH half is push.ts's `--public`
// flag. `get` NEVER executes the skill; running it is always a separate,
// explicit `reelier run` step (and the runner's existing --allow-writes gate
// is unaffected by anything here).
//
// Cloud API contract (consumer-side only, mirrors push.ts's header comment):
//   GET {base}/api/v1/registry/<owner>/<skill>[?version=<N> | ?sha256=<hex>]
//     -> 200 {skillMd, version, contentSha256, effectGrade, license, endpoints}
//     -> 410 {reason} (removed/tombstoned)
//     -> 404 (no such listing)
//   Anonymous — no Authorization header. Public reads never require a key.
//
// REQUEST-SHAPE DECISION (flagging for cloud-side reconciliation, per the
// task brief — the spec's task 5 line only says "@N/@sha256: resolution"
// without pinning the exact wire shape): pins are carried as QUERY params on
// the same two-segment path (`?version=<N>` or `?sha256=<hex>`), not extra
// path segments. Reasoning: `@sha256:<hex>` contains a `:` that would need
// escaping as a path segment, `owner`/`skill` are themselves free-form
// strings (not obviously safe to graft a third path segment onto without
// ambiguity), and query params keep `/api/v1/registry/<owner>/<skill>` as
// the single canonical resource URL for a listing regardless of which
// version is being requested. If the cloud implementer picks a different
// shape (e.g. `/api/v1/registry/<owner>/<skill>/<N>`), this is the one file
// to change — see fetchRegistrySkill below.

import { readFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseSkill } from "./skill.js";
import { writeFileAtomic } from "./writeback.js";

export interface GetConfig {
  baseUrl: string;
}

/**
 * Resolve the registry base URL from env. Reuses the same REELIER_CLOUD_URL
 * push.ts already relies on — `get` is anonymous, so REELIER_CLOUD_KEY is
 * never read or required here (spec §1: "the API key stays a publish-side
 * concept").
 */
export function resolveGetConfig(env: NodeJS.ProcessEnv = process.env): GetConfig {
  const baseUrl = env.REELIER_CLOUD_URL;
  if (!baseUrl) {
    throw new Error(
      "'reelier get' requires REELIER_CLOUD_URL to be set — point it at your Reelier Cloud instance. " +
        "No API key is needed; registry fetches are anonymous."
    );
  }
  return { baseUrl };
}

export interface SkillRef {
  owner: string;
  skill: string;
  /** From `@<N>` — a server-assigned version integer. Mutually exclusive with shaPin. */
  versionPin?: number;
  /** From `@sha256:<hex>` — lowercase 64-hex-char content hash pin. Mutually exclusive with versionPin. */
  shaPin?: string;
}

const SHA256_PIN_RE = /^[0-9a-f]{64}$/;

/** Parse `<owner>/<skill>[@<N> | @sha256:<hex>]`. Throws with a usage-shaped message on anything malformed. */
export function parseSkillRef(ref: string): SkillRef {
  const slashIdx = ref.indexOf("/");
  if (slashIdx === -1 || slashIdx === 0 || slashIdx === ref.length - 1) {
    throw new Error(
      `Expected '<owner>/<skill>[@<N> | @sha256:<hex>]', got: ${JSON.stringify(ref)}`
    );
  }
  const owner = ref.slice(0, slashIdx);
  const rest = ref.slice(slashIdx + 1);

  const atIdx = rest.indexOf("@");
  const skill = atIdx === -1 ? rest : rest.slice(0, atIdx);
  if (!skill) {
    throw new Error(`Expected '<owner>/<skill>[@<N> | @sha256:<hex>]', got: ${JSON.stringify(ref)}`);
  }

  if (atIdx === -1) {
    return { owner, skill };
  }

  const pin = rest.slice(atIdx + 1);
  if (pin.startsWith("sha256:")) {
    const hex = pin.slice("sha256:".length).toLowerCase();
    if (!SHA256_PIN_RE.test(hex)) {
      throw new Error(`Invalid @sha256: pin — expected 64 hex characters, got: ${JSON.stringify(pin)}`);
    }
    return { owner, skill, shaPin: hex };
  }

  const n = Number(pin);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Invalid @<N> version pin — expected a positive integer, got: ${JSON.stringify(pin)}`);
  }
  return { owner, skill, versionPin: n };
}

export interface RegistryFetchResult {
  skillMd: string;
  version: number;
  contentSha256: string;
  effectGrade: "read_only" | "writes";
  license: string;
  endpoints: string[];
}

type FetchOutcome =
  | { ok: true; data: RegistryFetchResult }
  | { ok: false; status: number; reason: string };

async function fetchRegistrySkill(config: GetConfig, ref: SkillRef): Promise<FetchOutcome> {
  const base = config.baseUrl.replace(/\/$/, "");
  const params = new URLSearchParams();
  if (ref.versionPin !== undefined) params.set("version", String(ref.versionPin));
  else if (ref.shaPin !== undefined) params.set("sha256", ref.shaPin);
  const qs = params.toString();
  const url = `${base}/api/v1/registry/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.skill)}${
    qs ? `?${qs}` : ""
  }`;

  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    return { ok: false, status: 0, reason: `Network error: ${(err as Error).message}` };
  }

  if (res.status === 410) {
    let reason = "This skill has been removed from the registry.";
    try {
      const body = JSON.parse(await res.text());
      if (typeof body.reason === "string") reason = body.reason;
    } catch {
      // No parseable reason — fall back to the generic tombstone message
      // rather than surfacing a raw parse error for a 410.
    }
    return { ok: false, status: 410, reason };
  }
  if (res.status === 404) {
    return { ok: false, status: 404, reason: `No registry listing found for '${ref.owner}/${ref.skill}'.` };
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    return { ok: false, status: res.status, reason: `HTTP ${res.status}: ${bodyText.slice(0, 500)}` };
  }

  let body: Partial<RegistryFetchResult>;
  try {
    body = JSON.parse(await res.text());
  } catch (err) {
    return {
      ok: false,
      status: res.status,
      reason: `Malformed JSON response from the registry: ${(err as Error).message}`,
    };
  }
  if (
    typeof body.skillMd !== "string" ||
    typeof body.version !== "number" ||
    typeof body.contentSha256 !== "string" ||
    (body.effectGrade !== "read_only" && body.effectGrade !== "writes") ||
    typeof body.license !== "string" ||
    !Array.isArray(body.endpoints)
  ) {
    return {
      ok: false,
      status: res.status,
      reason:
        "Registry response is missing required fields (skillMd/version/contentSha256/effectGrade/license/endpoints).",
    };
  }

  return {
    ok: true,
    data: {
      skillMd: body.skillMd,
      version: body.version,
      contentSha256: body.contentSha256,
      effectGrade: body.effectGrade,
      license: body.license,
      endpoints: body.endpoints as string[],
    },
  };
}

export interface GetOptions {
  cwd?: string;
  /** Overrides the default `./skills` landing directory. */
  dir?: string;
  /** Overwrite an existing file whose content hash differs from the fetched bytes. */
  force?: boolean;
}

export interface GetStepEffect {
  n: number;
  title: string;
  effect: string;
}

export type GetOutcome =
  | { kind: "written"; path: string; skillName: string; result: RegistryFetchResult; steps: GetStepEffect[] }
  | { kind: "up-to-date"; path: string; skillName: string; version: number }
  | { kind: "hash-mismatch"; path: string; existingSha: string; incomingSha: string }
  | { kind: "tamper"; expectedSha: string; actualSha: string; source: "server" | "pin" }
  | { kind: "removed"; reason: string }
  | { kind: "error"; message: string };

/**
 * Fetch a skill from the registry, verify its integrity, and land it at
 * `<dir>/<skill>.skill.md` (default dir: `./skills`). Never executes
 * anything — this only ever reads the network and writes one file.
 *
 * Order of operations matters for the "write nothing on tamper" guarantee
 * (spec §1/§4): the sha256 check happens BEFORE any collision/write logic
 * runs, so a mismatched body can never reach the filesystem regardless of
 * whether a same-named file already exists.
 */
export async function getSkill(ref: string, options: GetOptions = {}): Promise<GetOutcome> {
  const cwd = options.cwd ?? process.cwd();

  let parsedRef: SkillRef;
  try {
    parsedRef = parseSkillRef(ref);
  } catch (err) {
    return { kind: "error", message: (err as Error).message };
  }

  let config: GetConfig;
  try {
    config = resolveGetConfig();
  } catch (err) {
    return { kind: "error", message: (err as Error).message };
  }

  const fetchResult = await fetchRegistrySkill(config, parsedRef);
  if (!fetchResult.ok) {
    if (fetchResult.status === 410) {
      return { kind: "removed", reason: fetchResult.reason };
    }
    return { kind: "error", message: fetchResult.reason };
  }
  const data = fetchResult.data;

  // Integrity, before anything touches disk: the body's own sha256 must
  // match the server-declared contentSha256, and — if the caller pinned an
  // exact hash — must also match that pin.
  const actualSha = createHash("sha256").update(data.skillMd, "utf8").digest("hex");
  if (actualSha !== data.contentSha256) {
    return { kind: "tamper", expectedSha: data.contentSha256, actualSha, source: "server" };
  }
  if (parsedRef.shaPin !== undefined && actualSha !== parsedRef.shaPin) {
    return { kind: "tamper", expectedSha: parsedRef.shaPin, actualSha, source: "pin" };
  }

  const dir = options.dir !== undefined ? path.resolve(cwd, options.dir) : path.join(cwd, "skills");
  const outPath = path.join(dir, `${parsedRef.skill}.skill.md`);

  let existing: string | undefined;
  try {
    existing = await readFile(outPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      return { kind: "error", message: `Could not read existing ${outPath}: ${(err as Error).message}` };
    }
  }

  if (existing !== undefined) {
    const existingSha = createHash("sha256").update(existing, "utf8").digest("hex");
    if (existingSha === actualSha) {
      return { kind: "up-to-date", path: outPath, skillName: parsedRef.skill, version: data.version };
    }
    if (!options.force) {
      return { kind: "hash-mismatch", path: outPath, existingSha, incomingSha: actualSha };
    }
    // --force + a real hash mismatch: fall through and overwrite below.
  }

  await mkdir(dir, { recursive: true });
  await writeFileAtomic(outPath, data.skillMd);

  let steps: GetStepEffect[] = [];
  try {
    steps = parseSkill(data.skillMd).steps.map((s) => ({ n: s.n, title: s.title, effect: s.effect }));
  } catch {
    // Best-effort only — the cloud already validated this skill at submit,
    // so a local parse failure shouldn't happen, but it must never block
    // the write (which already passed integrity verification) or crash the
    // command. The trust block just prints without per-step detail.
  }

  return { kind: "written", path: outPath, skillName: parsedRef.skill, result: data, steps };
}
