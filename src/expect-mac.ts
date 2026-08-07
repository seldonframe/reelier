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

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "./canonical-json.js";

/** Spec §3.3: 32 random bytes, minted per approval. */
export const EXPECT_KEY_BYTES = 32;

/**
 * The ONE projection spelling that addresses the HTTP status (W3-S5, I-19).
 * Exported so both projection twins and the approve-time lint agree by
 * construction rather than by two copies of a string literal.
 */
export const STATUS_CODE_ENTRY = "status.code";

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
export function assertUsableKey(key: Uint8Array, who = "expectMac"): void {
  if (key.length !== EXPECT_KEY_BYTES) {
    throw new Error(
      `${who}: key must be exactly ${EXPECT_KEY_BYTES} bytes, got ${key.length} — never compute a commitment under a truncated or empty key (I-6)`
    );
  }
  if (key.every((b) => b === 0)) {
    throw new Error(`${who}: refusing an all-zero (placeholder) key — never compute a commitment under a default key (I-6)`);
  }
}

/**
 * Type-tag a projected scalar (amendment A6): `1`, `"1"`, and `true` MUST
 * produce distinct MAC inputs — a `String(v)` collapse would create a
 * false-MATCH class, the one direction the scheme must never produce. The
 * tag prefix also can't be forged from inside a string value: a string
 * `"n:1"` tags to `"s:n:1"`, never colliding with number `1`'s `"n:1"`.
 *
 * Exported so src/provenance.ts commits argument values under the SAME tagging
 * as every other commitment in this package (argument-provenance-v1 §7.4). A
 * second copy is how the false-MATCH rule drifts apart from the one place that
 * states it — the `shapeOf`/`deriveFootprint` lesson, run-shape-priors §2.3.
 */
export function tagScalar(v: string | number | boolean): string {
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
 * Constant-time equality for two MAC strings — the ONLY sanctioned way to compare a value
 * produced by `expectMac`/`expectFieldMac`. `test/expect-mac-timing.test.ts` lints for a raw
 * `===`/`!==` on either, because the per-field diagnosis site was missed the first time this
 * was fixed by hand.
 *
 * These are HMACs under the per-approval keystore secret, so a short-circuiting `===` leaks a
 * timing signal about a keyed value. Severity is low — forging `expect.pre` needs write access
 * to the skill file, and the approval hash already covers `expect:` at a boundary no flag
 * overrides — but this is defense in depth on a secret-keyed comparison and costs nothing.
 * `AUDIT-COMPLIANCE-1.0` §4.4 specs timing-safe comparison as a MUST for the same class of check.
 *
 * Length is deliberately NOT protected: a MAC is a fixed-width `hmac-sha256:<64 hex>` string, so
 * an early return on a length mismatch reveals nothing the format does not already publish.
 * `crypto.timingSafeEqual` THROWS on unequal lengths, and a throw here would convert an honest
 * mismatch verdict into a crashed run — so the length check must come first, and it must return
 * `false`, never propagate.
 */
export function macEquals(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

/**
 * The typed twin of `projectObservation`'s explicit-projection branch
 * (src/runner.ts): same selection semantics — including the P1.5 projection
 * namespaces (`header.<name>` from response headers, `body.<key>`/bare
 * `<key>` from top-level body keys), scalars only, absent/non-scalar
 * silently dropped, non-JSON or non-object bodies contribute no body
 * fields — but values keep their JSON type so the MAC input can be
 * type-tagged (A6; headers are always strings). The attest pipeline's own
 * stringifying projection is deliberately untouched (I-4: keyed and salted
 * commitments never mix; fork the encoding, not the attest path). The
 * selection rules are pinned to projectObservation by drift tests — the
 * fork was sanctioned for the ENCODING, never the SELECTION.
 */
export function projectObservationTyped(
  // W3-S5 widened this to carry `status`: `status.code` projects it. Every
  // existing call site already passes the full Observation, so nothing else
  // moved.
  obs: { body: string; headers: Record<string, string>; status: number },
  projection: string[]
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  const rec = parseBodyRecord(obs.body);
  for (const key of projection) {
    // W3-S5 / I-19: `status.code` — and ONLY that spelling — addresses the
    // HTTP status, as a NUMBER (a string here would collide with the body
    // form under A6's false-MATCH rule). A bare `status` stays the top-level
    // body key permanently, and a body key literally named "status.code" is
    // still reachable as `body.status.code`. Checked before the body branch,
    // which would otherwise swallow it as an unprefixed key.
    if (key === STATUS_CODE_ENTRY) {
      out[key] = obs.status;
      continue;
    }
    if (key.startsWith("header.")) {
      const name = key.slice("header.".length);
      const v = lookupHeader(obs.headers, name);
      if (typeof v === "string" && v.length > 0) out[typedKeyFor(key)] = v;
      continue;
    }
    if (!rec) continue;
    const v = rec[key.startsWith("body.") ? key.slice("body.".length) : key];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[typedKeyFor(key)] = v;
  }
  return out;
}

/**
 * Field-list render caps, shared by every surface that names projected
 * fields — the runner's record diagnosis and the approve-time transcript.
 * One definition so the two cannot disagree about what a wide projection
 * looks like ("one claim, one label, wherever an operator meets it").
 */
export const ABSENT_FIELDS_MAX = 32;
export const ABSENT_FIELD_NAME_MAX = 120;

/**
 * The output-form key a projection entry produces — bare entries and `body.`
 * entries both normalize to `body.<key>`, `header.` entries keep their
 * spelling. Exported and used BY the projection itself so that any consumer
 * reasoning about the key space cannot drift from the map that built it: a
 * name-mapping added in one place is exactly how this lineage once fabricated
 * an absent field.
 */
export function typedKeyFor(entry: string): string {
  // W3-S5: `status.code` keeps its own spelling as the output key. Without
  // this arm it would normalize to `body.status.code` and a consumer holding
  // the key space would conclude the projection never addresses the field it
  // just projected — the twin-drift this function exists to prevent, caught
  // by the W3-S5 absence-loop test the moment the two slices met.
  if (entry === STATUS_CODE_ENTRY) return entry;
  if (entry.startsWith("header.")) return entry;
  return `body.${entry.startsWith("body.") ? entry.slice("body.".length) : entry}`;
}

function parseBodyRecord(body: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
}

/**
 * Why a declared projection entry yielded no value — the distinction between
 * "the observation shows it is gone" and "the observation establishes nothing
 * about it". `projectObservationTyped` drops both cases identically, so a
 * consumer that infers absence from a missing key asserts a fact the raw
 * observation can disprove (a `null`/object value, an empty header, or a body
 * that did not parse at all). Absence is only earned in the first set.
 *
 * `absent` — the observation was usable for that namespace and the field is
 * genuinely not in it. `unprojectable` — the field is present but not a
 * scalar, the header is present but empty, or the body did not parse, so
 * nothing was established about it either way.
 */
export function projectionMisses(
  obs: { body: string; headers: Record<string, string> },
  projection: string[]
): { absent: Set<string>; unprojectable: Set<string> } {
  const absent = new Set<string>();
  const unprojectable = new Set<string>();
  const rec = parseBodyRecord(obs.body);
  for (const key of projection) {
    const outKey = typedKeyFor(key);
    // Every observation carries a status, so `status.code` always projects —
    // it can never be absent and never be unprojectable.
    if (key === STATUS_CODE_ENTRY) continue;
    if (key.startsWith("header.")) {
      const v = lookupHeader(obs.headers, key.slice("header.".length));
      if (typeof v === "string" && v.length > 0) continue; // projected
      (v === undefined ? absent : unprojectable).add(outKey);
      continue;
    }
    // A body that did not parse establishes nothing about ANY body field.
    if (!rec) {
      unprojectable.add(outKey);
      continue;
    }
    const bodyKey = key.startsWith("body.") ? key.slice("body.".length) : key;
    const v = rec[bodyKey];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") continue; // projected
    // Own-property test, for the same reason the field loops use one: a
    // projection entry named "constructor"/"toString" resolves through
    // Object.prototype and would otherwise read as present-but-unprojectable.
    (Object.prototype.hasOwnProperty.call(rec, bodyKey) ? unprojectable : absent).add(outKey);
  }
  return { absent, unprojectable };
}

/**
 * Case-insensitive header lookup, exact match first — HTTP header names are
 * case-insensitive and fetch lowercases them, but --replay fixtures and
 * hand-authored tool registries pass header records through untouched, so an
 * exact-only lookup would land `header.ETag` in absentFields forever (review
 * finding). Shared by BOTH projection twins (projectObservationTyped here,
 * projectObservation's explicit branch in src/runner.ts) so the selection
 * rule cannot drift between them. Own keys only; the caller's
 * typeof === "string" check screens anything a prototype could leak.
 */
export function lookupHeader(headers: Record<string, string>, name: string): string | undefined {
  const exact = headers[name];
  if (typeof exact === "string") return exact;
  const lower = name.toLowerCase();
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower) return headers[k];
  }
  return undefined;
}

/**
 * Per-field commitment (P1.5, wave2 §3.5): one MAC per projected field,
 * under the SAME per-approval key, so a mismatch can be diagnosed to the
 * field NAMES that moved — never values. Domain-separated from the
 * whole-projection MAC by input shape (`field`/`value` keys vs
 * `projection`); the whole-projection MAC stays the authoritative
 * match/mismatch verdict — field MACs only ever explain a mismatch the
 * whole MAC already declared. The §3.5 trade is accepted knowingly: each
 * exposed commitment is one more dictionary surface for that field under a
 * leaked key, bounded per-approval like everything else in the scheme.
 */
export function expectFieldMac(key: Uint8Array, probeTool: string, fieldName: string, value: string | number | boolean): string {
  assertUsableKey(key);
  if (typeof probeTool !== "string" || probeTool.trim() === "") {
    throw new Error("expectFieldMac: probe tool name must be a non-empty string");
  }
  if (typeof fieldName !== "string" || fieldName.trim() === "" || fieldName === "__proto__") {
    throw new Error(`expectFieldMac: invalid field name ${JSON.stringify(fieldName)}`);
  }
  const input = canonicalJson({ field: fieldName, probe: probeTool, v: 1, value: tagScalar(value) });
  return MAC_PREFIX + createHmac("sha256", Buffer.from(key)).update(input, "utf8").digest("hex");
}

/**
 * The FILLED probe-args commitment (W3-S4; wave2 conflict C4, deferred with
 * probe-arg parameterization and landed with it). P1 forced literal probe
 * args because a `{{var}}` hole in a probe-args template is an exfiltration
 * channel: whatever fills it rides out through the probe URL. The approval
 * hash cannot close that — it covers the file's TEMPLATE text, which a
 * run-time fill leaves untouched. This commitment can: the runner recomputes
 * it over the args it is ABOUT to send and compares BEFORE dispatching
 * anything (I-18 — the dispatch ban is the load-bearing half; a build that
 * exfiltrates first and then honestly reports `unevaluated` would satisfy a
 * comparison-only rule and still be wrong).
 *
 * Domain-separated from the other two MACs by canonical-JSON input SHAPE:
 * `{args, probe, v}` here, `{probe, projection, v}` for the whole-projection
 * commitment, `{field, probe, v, value}` per field. No constructible
 * collision — `args` is an arbitrary JSON value and `projection` a
 * type-tagged string map, and the key sets differ regardless.
 *
 * Values are canonicalized, never stringified: `{"n":1}` and `{"n":"1"}` are
 * different args and MUST commit differently (A6's false-MATCH class applies
 * here for the same reason it applies to projections).
 */
/**
 * Recursively refuse an own `__proto__` key anywhere in `value` (mirrors
 * expectMac's/expectFieldMac's __proto__ guard, A6's false-MATCH class) — but
 * RECURSIVE, unlike its siblings' flat scalar projection: `filledArgs` is
 * arbitrary nested JSON, and canonicalJson's rebuild (src/canonical-json.ts,
 * bracket-assignment onto a fresh `{}` at every level) silently drops an own
 * `__proto__` key at ANY depth, which would make
 * probeArgsMac(key, tool, {a:{__proto__:{x:1}}}) === probeArgsMac(key, tool, {a:{}})
 * — two different arg sets committing alike, exactly the false-MATCH class
 * the siblings' flat guard exists to close one level down.
 *
 * `who` names the caller in the message and defaults to `probeArgsMac`, so every
 * pre-existing message is byte-identical; src/provenance.ts passes its own label
 * rather than carrying a second copy of the walk (argument-provenance-v1 §7.4).
 */
 export function assertNoProtoKeyDeep(value: unknown, at = "(root)", who = "probeArgsMac"): void {
   if (Array.isArray(value)) {
     value.forEach((v, i) => assertNoProtoKeyDeep(v, `${at}[${i}]`, who));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (key === "__proto__") {
        throw new Error(
          `${who}: arg key '__proto__' at ${at} cannot be committed faithfully — refusing to drop it silently (A6)`
        );
      }
      assertNoProtoKeyDeep((value as Record<string, unknown>)[key], `${at}.${key}`, who);
    }
  }
}

export function probeArgsMac(key: Uint8Array, probeTool: string, filledArgs: unknown): string {
  assertUsableKey(key);
  if (typeof probeTool !== "string" || probeTool.trim() === "") {
    throw new Error("probeArgsMac: probe tool name must be a non-empty string");
  }
  assertNoProtoKeyDeep(filledArgs);
  const input = canonicalJson({ args: filledArgs, probe: probeTool, v: 1 });
  return MAC_PREFIX + createHmac("sha256", Buffer.from(key)).update(input, "utf8").digest("hex");
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
  /**
   * Injection seams for tests only — production callers omit both (house
   * default-parameter pattern, as in login.ts's `sleepImpl` and writeback.ts's
   * `AtomicWriteFsOps`). `sleepImpl` lets a test drive the retry loop by its
   * own ledger instead of by the wall clock, which is the only way to assert
   * "the lock freed and the write proceeded" without racing a timer;
   * `lockCreateImpl` lets a test force the non-EEXIST contention branch
   * below, which is reachable in production only inside a microsecond-wide
   * window on win32.
   */
  sleepImpl?: (ms: number) => Promise<void>;
  lockCreateImpl?: (lockPath: string, contents: string) => Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultLockCreate(lockPath: string, contents: string): Promise<void> {
  return writeFile(lockPath, contents, { flag: "wx" });
}

/**
 * How many times a lock create may fail with something OTHER than EEXIST
 * before we stop calling it contention and surface the real errno.
 *
 * Taking the lock can fail transiently rather than merely find it taken: on
 * win32 an unlink puts the file in a delete-pending state, and an O_EXCL
 * create landing in that window returns EPERM, not EEXIST (measured on
 * win32, no load: 29 EPERM in 3000 create-vs-unlink races). That is a
 * concurrent approver RELEASING the lock — precisely the case the retry loop
 * exists to survive — so it must be retried. The rename path further down
 * `updateKeystore` already treats EPERM as the Windows artifact it is.
 *
 * The budget is small on purpose: an unwritable directory returns the same
 * code forever, and spending the full lock budget on it would bury a real
 * permission failure under a "locked" message that names the wrong cause.
 */
export const TRANSIENT_LOCK_CREATE_RETRIES = 3;

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
  return updateKeystore(filePath, (store) => {
    store.keys[keyId] = entry;
  }, opts);
}

/**
 * Remove entries by keyId — `reelier approve --prune-keys`'s write half
 * (P1.5, wave2 §3.4's named follow-up). Same lock + temp-file + rename
 * discipline as every keystore write; removing an absent keyId is a no-op,
 * never an error (the prune scan and the store may race a concurrent
 * approve). `mintedBefore` closes the other half of that race under the
 * lock (review finding): an entry minted at or after the caller's scan
 * began cannot have been judged orphaned by that scan, so it is spared —
 * keys are random and unrecoverable, deletion errs toward sparing.
 */
export async function removeKeystoreEntries(
  filePath: string,
  keyIds: string[],
  opts: KeystoreWriteOptions & { mintedBefore?: string } = {}
): Promise<void> {
  return updateKeystore(filePath, (store) => {
    for (const keyId of keyIds) {
      const entry = store.keys[keyId];
      if (entry === undefined) continue;
      if (opts.mintedBefore !== undefined && entry.createdAt >= opts.mintedBefore) continue;
      delete store.keys[keyId];
    }
  }, opts);
}

/** The shared locked read-modify-write every keystore mutation goes through (A10 durability discipline). */
async function updateKeystore(
  filePath: string,
  mutate: (store: ExpectKeystore) => void,
  opts: KeystoreWriteOptions = {}
): Promise<void> {
  const lockPath = `${filePath}.lock`;
  const retries = opts.lockRetries ?? 50;
  const retryDelayMs = opts.lockRetryDelayMs ?? 100;
  const sleepImpl = opts.sleepImpl ?? delay;
  const lockCreateImpl = opts.lockCreateImpl ?? defaultLockCreate;

  await mkdir(path.dirname(filePath), { recursive: true });

  let haveLock = false;
  let transientCreateFailures = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      await lockCreateImpl(lockPath, String(process.pid));
      haveLock = true;
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") {
        if (attempt >= retries) {
          throw new Error(
            `expect keystore at ${filePath} is locked (${lockPath} exists after ${retries} retries) — another approve may be running; remove the stale lock if not`
          );
        }
      } else if (attempt >= retries || ++transientCreateFailures > TRANSIENT_LOCK_CREATE_RETRIES) {
        // Out of budget, or the same non-EEXIST failure keeps coming back:
        // surface the real errno untouched. Wrapping it in the "locked"
        // message above would send an operator to delete a lock file that was
        // never the problem. `attempt >= retries` is checked first so
        // lockRetries: 0 still means zero sleeping, whatever the errno.
        throw err;
      }
      await sleepImpl(retryDelayMs);
    }
  }

  try {
    const store = await readKeystore(filePath);
    mutate(store);
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
