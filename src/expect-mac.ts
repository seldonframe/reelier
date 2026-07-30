// The expect commitment module (state-conditioned approval P1, wave2 spec
// §3.3–§3.4): per-approval keys, keyId derivation, and the keyed commitment
// (`expect.pre`) that binds an approval to the world it was granted against.
//
// The scheme, in one breath: at approve time, `reelier approve --probe`
// observes the world through the step's declared probe, commits to the
// projected observation under a fresh 32-byte key (HMAC-SHA256), stamps the
// commitment into SKILL.md (`expect:`), and keeps the key in a local
// keystore that NEVER enters the repo or any record. At execute time the
// runner re-observes through the same probe, recomputes under the same key
// (looked up by `keyId`), and compares. The salt philosophy extended: a salt
// is a per-use key we burn; this one we keep in a drawer because
// comparability requires it later.
//
// Custody rules (spec §3.4): one JSON file, default
// `~/.reelier/expect-keys.json` (precedent: signing keys live under
// `~/.reelier/signing/` — "never inside a repo, never uploaded"), mode 0600
// on POSIX (on Windows mode bits do not apply; the expectation is the user
// profile's default ACL). `REELIER_EXPECT_KEYS=<path>` points the runner at
// a provisioned file (CI: one secret regardless of how many approvals).
// Rotation = re-approval (superseded entries are NOT auto-deleted — parallel
// checkouts may still carry the old `expect`, and git-reverting SKILL.md
// restores a fully working older (approve, expect) pair as long as its entry
// survives). Revocation = deletion, and it is loud: a check bound under a
// deleted key degrades to `unevaluated`, never a silent pass.

import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "./canonical-json.js";

/** Spec §3.3: 32 random bytes, minted per approval. */
export const EXPECT_KEY_BYTES = 32;

const KEY_ID_DOMAIN = "reelier expect key v1\n";
const MAC_PREFIX = "hmac-sha256:";

/** First 16 hex of sha256(domain ‖ key) — the signing keyId length convention (spec §3.3). */
export function deriveExpectKeyId(key: Uint8Array): string {
  return createHash("sha256")
    .update(Buffer.concat([Buffer.from(KEY_ID_DOMAIN, "utf8"), Buffer.from(key)]))
    .digest("hex")
    .slice(0, 16);
}

/** Mint a fresh per-approval key. The caller owns getting it into the keystore BEFORE stamping any file (spec §4.2 mint order). */
export function mintExpectKey(): { key: Buffer; keyId: string } {
  const key = randomBytes(EXPECT_KEY_BYTES);
  return { key, keyId: deriveExpectKeyId(key) };
}

/**
 * Invariant I-6: never HMAC with an empty, wrong-length, or placeholder key.
 * A missing key must surface as `unevaluated` at the call site — reaching
 * this function with a bad key is a programmer error, refused loudly.
 */
function assertUsableKey(key: Uint8Array): void {
  if (key.length !== EXPECT_KEY_BYTES) {
    throw new Error(
      `expectMac: key must be exactly ${EXPECT_KEY_BYTES} bytes, got ${key.length} — never compute a commitment under a truncated or empty key (I-6)`
    );
  }
  if (key.every((b) => b === 0)) {
    throw new Error("expectMac: refusing an all-zero (placeholder) key — never compute a commitment under a default key (I-6)");
  }
}

/**
 * Type-tag a projected scalar (amendment A6): `1`, `"1"`, and `true` MUST
 * produce distinct MAC inputs — a `String(v)` collapse would create a
 * false-MATCH class, the one direction the scheme must never produce. The
 * tag prefix also can't be forged from inside a string value: a string
 * `"n:1"` tags to `"s:n:1"`, never colliding with number `1`'s `"n:1"`.
 */
function tagScalar(v: string | number | boolean): string {
  if (typeof v === "string") return `s:${v}`;
  if (typeof v === "number") return `n:${String(v)}`;
  return `b:${String(v)}`;
}

/**
 * The keyed commitment of spec §3.3 (as amended by A5 + A6):
 *
 *   mac = "hmac-sha256:" + hex(HMAC-SHA256(key, canonicalJson({
 *           probe: <probe tool name>,
 *           projection: <type-tagged projected map>,
 *           v: 1
 *         })))
 *
 * Context binding is `probe` + `v` ONLY (A5 dropped skill/step: sequential
 * step renumbering on a refactor would have broken every subsequent expect
 * with a false "world moved" diagnosis; the per-approval key already makes
 * commitments non-transplantable).
 */
export function expectMac(key: Uint8Array, probeTool: string, projected: Record<string, string | number | boolean>): string {
  assertUsableKey(key);
  if (typeof probeTool !== "string" || probeTool.trim() === "") {
    throw new Error("expectMac: probe tool name must be a non-empty string");
  }
  const tagged: Record<string, string> = {};
  for (const [field, value] of Object.entries(projected)) {
    // A field literally named "__proto__" would hit the prototype setter
    // here (and again inside canonicalJson's rebuild), silently vanishing
    // from the commitment — MAC({__proto__:"a"}) === MAC({}) is a false
    // MATCH, the one direction the scheme must never produce (A6). The
    // shipped projection pipeline can't emit it (every field is
    // "body."-prefixed), so reaching this is a caller bug: refuse loudly.
    if (field === "__proto__") {
      throw new Error("expectMac: projected field name '__proto__' cannot be committed faithfully — refusing to drop it silently (A6)");
    }
    tagged[field] = tagScalar(value);
  }
  const input = canonicalJson({ probe: probeTool, projection: tagged, v: 1 });
  return MAC_PREFIX + createHmac("sha256", Buffer.from(key)).update(input, "utf8").digest("hex");
}

/**
 * The typed twin of `projectObservation`'s explicit-projection branch
 * (src/runner.ts): same selection semantics — declared top-level body keys,
 * scalars only, `body.` prefix, absent/non-scalar silently dropped, non-JSON
 * or non-object bodies project to {} — but values keep their JSON type so
 * the MAC input can be type-tagged (A6). The attest pipeline's own
 * stringifying projection is deliberately untouched (I-4: keyed and salted
 * commitments never mix; fork the encoding, not the attest path).
 */
export function projectObservationTyped(body: string, projection: string[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return out;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return out;
  const rec = parsed as Record<string, unknown>;
  for (const key of projection) {
    const v = rec[key];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[`body.${key}`] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Keystore
// ---------------------------------------------------------------------------

export interface ExpectKeystoreEntry {
  /** The 32-byte key, base64. */
  key: string;
  createdAt: string;
  /** Operator bookkeeping for pruning — never consulted by the MAC (A5: context binding is probe + v). */
  skill?: string;
  step?: number;
}

export interface ExpectKeystore {
  v: 1;
  keys: Record<string, ExpectKeystoreEntry>;
}

/** `REELIER_EXPECT_KEYS=<path>` wins (CI provisioning: one secret, one file); default `~/.reelier/expect-keys.json`. */
export function resolveKeystorePath(env: Record<string, string | undefined>, homedir: string): string {
  const fromEnv = env.REELIER_EXPECT_KEYS;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return fromEnv;
  return path.join(homedir, ".reelier", "expect-keys.json");
}

/**
 * Read + shape-validate the keystore. A missing file is a fresh empty store
 * (normal first run). A malformed file is a LOUD failure — a keystore that
 * exists but can't be trusted must never silently degrade to "no keys"
 * (that would flip every bound check to `unevaluated` with no explanation).
 */
export async function readKeystore(filePath: string): Promise<ExpectKeystore> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { v: 1, keys: {} };
    throw new Error(`expect keystore at ${filePath} could not be read: ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`expect keystore at ${filePath} is not valid JSON: ${(err as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`expect keystore at ${filePath} is malformed (expected an object)`);
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.v !== 1) {
    throw new Error(`expect keystore at ${filePath} has unsupported version ${JSON.stringify(obj.v)} (expected 1)`);
  }
  if (obj.keys === null || typeof obj.keys !== "object" || Array.isArray(obj.keys)) {
    throw new Error(`expect keystore at ${filePath} is malformed ('keys' must be an object)`);
  }
  const keys: Record<string, ExpectKeystoreEntry> = {};
  for (const [keyId, entryRaw] of Object.entries(obj.keys as Record<string, unknown>)) {
    // Also closes the prototype-setter hazard: a crafted "__proto__" keyId
    // would otherwise silently vanish from the parsed store (unevaluated
    // with no explanation) — corrupt keyIds must be LOUD like every other
    // malformation here.
    if (!/^[0-9a-f]{16}$/.test(keyId)) {
      throw new Error(`expect keystore at ${filePath} is malformed (keyId '${keyId}' is not 16 lowercase hex chars)`);
    }
    if (entryRaw === null || typeof entryRaw !== "object" || Array.isArray(entryRaw)) {
      throw new Error(`expect keystore at ${filePath} is malformed (entry '${keyId}' must be an object)`);
    }
    const entry = entryRaw as Record<string, unknown>;
    if (typeof entry.key !== "string" || Buffer.from(entry.key, "base64").length !== EXPECT_KEY_BYTES) {
      throw new Error(
        `expect keystore at ${filePath} is malformed (entry '${keyId}' needs a base64 'key' decoding to ${EXPECT_KEY_BYTES} bytes)`
      );
    }
    // A stored all-zero key would pass here and only detonate later as the
    // I-6 throw inside expectMac — mid-run, the wrong layer. The store-read
    // boundary guarantees every key it returns is MAC-usable, so expectMac's
    // I-6 throw stays strictly a programmer-error signal.
    if (Buffer.from(entry.key, "base64").every((b) => b === 0)) {
      throw new Error(`expect keystore at ${filePath} is malformed (entry '${keyId}' holds an all-zero placeholder key)`);
    }
    if (typeof entry.createdAt !== "string" || entry.createdAt === "") {
      throw new Error(`expect keystore at ${filePath} is malformed (entry '${keyId}' needs a string 'createdAt')`);
    }
    if (entry.skill !== undefined && typeof entry.skill !== "string") {
      throw new Error(`expect keystore at ${filePath} is malformed (entry '${keyId}' has a non-string 'skill')`);
    }
    if (entry.step !== undefined && typeof entry.step !== "number") {
      throw new Error(`expect keystore at ${filePath} is malformed (entry '${keyId}' has a non-number 'step')`);
    }
    keys[keyId] = {
      key: entry.key,
      createdAt: entry.createdAt,
      ...(typeof entry.skill === "string" ? { skill: entry.skill } : {}),
      ...(typeof entry.step === "number" ? { step: entry.step } : {}),
    };
  }
  return { v: 1, keys };
}

/** Decode a key from the store by keyId. `undefined` = revoked-or-never-present (indistinguishable by construction, spec C7). */
export function loadExpectKey(store: ExpectKeystore, keyId: string): Buffer | undefined {
  const entry = store.keys[keyId];
  if (!entry) return undefined;
  return Buffer.from(entry.key, "base64");
}

export interface KeystoreWriteOptions {
  lockRetries?: number;
  lockRetryDelayMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Add (or overwrite) one entry, durable-by-construction (A10): a `.lock`
 * sibling taken with an exclusive create guards the read-modify-write
 * against concurrent approvers (retry with backoff, then a LOUD failure —
 * never a silent skip), and the store itself is written temp-file + rename
 * so a torn keystore is unrepresentable. Existing entries are never pruned
 * here — superseded keys stay valid for parallel checkouts (spec §3.4).
 */
export async function writeKeystoreEntry(
  filePath: string,
  keyId: string,
  entry: ExpectKeystoreEntry,
  opts: KeystoreWriteOptions = {}
): Promise<void> {
  const lockPath = `${filePath}.lock`;
  const retries = opts.lockRetries ?? 50;
  const retryDelayMs = opts.lockRetryDelayMs ?? 100;

  await mkdir(path.dirname(filePath), { recursive: true });

  let haveLock = false;
  for (let attempt = 0; ; attempt++) {
    try {
      await writeFile(lockPath, String(process.pid), { flag: "wx" });
      haveLock = true;
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      if (attempt >= retries) {
        throw new Error(
          `expect keystore at ${filePath} is locked (${lockPath} exists after ${retries} retries) — another approve may be running; remove the stale lock if not`
        );
      }
      await delay(retryDelayMs);
    }
  }

  try {
    const store = await readKeystore(filePath);
    store.keys[keyId] = entry;
    const tempPath = `${filePath}.tmp-${randomBytes(6).toString("hex")}`;
    let replaced = false;
    try {
      await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      try {
        await rename(tempPath, filePath);
        replaced = true;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        // Rename-over-existing can EEXIST/EPERM on some platforms (the
        // writeFileAtomic precedent, src/writeback.ts) — but unlike SKILL.md,
        // keys are random and unrecoverable, so this fallback must never
        // open a zero-copies window: park the old store as a .bak FIRST,
        // and on total failure leave the temp file standing and name it.
        if (code === "EEXIST" || code === "EPERM") {
          const bakPath = `${filePath}.bak-${randomBytes(4).toString("hex")}`;
          const parked = await rename(filePath, bakPath).then(() => true).catch(() => false);
          try {
            await rename(tempPath, filePath);
            replaced = true;
          } catch (err2) {
            throw new Error(
              `expect keystore write to ${filePath} failed after retry (${(err2 as Error).message}) — your keys are intact in ${tempPath}${parked ? ` and ${bakPath}` : ""}; recover by renaming one over ${filePath}`
            );
          }
          if (parked) await unlink(bakPath).catch(() => {});
        } else {
          throw err;
        }
      }
    } finally {
      // Never delete the temp copy unless the store was actually replaced —
      // on the failure path it may be the only surviving full copy.
      if (replaced) await unlink(tempPath).catch(() => {});
    }
  } finally {
    // Only release a lock WE took — a held foreign lock must survive our failure.
    if (haveLock) await unlink(lockPath).catch(() => {});
  }
}
