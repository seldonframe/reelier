// `reelier verify <permalink|file> [--key <pub.pem>]` — trust-ladder spec
// §1's offline verification half. Fetches a receipt's JSON (a full
// permalink URL, a bare registry token resolved against REELIER_CLOUD_URL —
// reusing get.ts's `resolveGetConfig`, an anonymous read exactly like
// `reelier get` — or a local file), recomputes the canonical digest, and
// evaluates each claim independently. Never a bare OK: a receipt with no
// signature renders as honestly unsigned (never shamed — never-lies rule);
// a receipt whose signature FAILS to verify against the digest recomputed
// here is the one thing that fails the command's exit code. A signature
// present but nothing given to check it against ("no key provided") is
// neither pass nor fail — it's unchecked, and says so.
//
// Timestamp verification (imprint-match, full RFC-3161 chain) is
// trust-ladder Slice B's job (src/tsa.ts) — not built yet. This module
// renders the timestamp row honestly (absent, or present-but-not-yet-
// verified-by-this-CLI-version) rather than fabricating a check it can't
// perform.

import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { verifyRecordSignature } from "./signing.js";
import { digestSha256 } from "./canonical-json.js";
import { resolveGetConfig } from "./get.js";
import { readCliConfig, type CliConfig } from "./cloud-config.js";
import { imprintMatches } from "./tsa.js";
import type { RunRecord } from "./runner.js";

export interface VerifyPayload {
  record: RunRecord;
  signature?: { alg: string; keyId: string; sig: string };
  timestamp?: { tsa: string; token: string };
  /**
   * The tenant's registered public key, additively returned by
   * `/r/<token>/json` when the receipt is signed (cloud Slice C's key
   * registry). Only consulted by `evaluateUnalteredSincePushClaim` when
   * the caller did NOT pass `--key` — an explicit `--key` always wins, so
   * a permalink is never trusted blindly by default; this just spares a
   * caller who has no independent copy of the key from an "unchecked"
   * line when the cloud already knows which key signed it.
   */
  signingKey?: { keyId: string; publicKeyPem: string; verified?: boolean; revoked?: boolean };
}

export function isHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

/** `https://host/r/<token>[/]` -> `https://host/r/<token>/json`. Already-`/json` URLs pass through unchanged. */
export function permalinkJsonUrl(permalink: string): string {
  const trimmed = permalink.replace(/\/+$/, "");
  return trimmed.endsWith("/json") ? trimmed : `${trimmed}/json`;
}

function isVerifyPayloadShape(value: unknown): value is VerifyPayload {
  return typeof value === "object" && value !== null && "record" in (value as Record<string, unknown>);
}

/**
 * Parse fetched/read JSON text into a `VerifyPayload`. Accepts either the
 * full `{record, signature?, timestamp?}` envelope (what `/r/<token>/json`
 * returns) or a bare `RunRecord` (e.g. a raw local run-record JSON file with
 * no trust siblings) — the latter is wrapped as `{record: parsed}` with
 * nothing fabricated; it simply has no signature/timestamp to evaluate.
 */
export function parseVerifyPayload(raw: string): VerifyPayload {
  const parsed: unknown = JSON.parse(raw);
  if (isVerifyPayloadShape(parsed)) return parsed;
  return { record: parsed as RunRecord };
}

export type FetchVerifyOutcome = { ok: true; payload: VerifyPayload } | { ok: false; message: string };

async function fetchVerifyPayloadFromUrl(url: string, fetchImpl: typeof fetch): Promise<FetchVerifyOutcome> {
  let res: Response;
  try {
    res = await fetchImpl(url);
  } catch (err) {
    return { ok: false, message: `Network error: ${(err as Error).message}` };
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    return { ok: false, message: `HTTP ${res.status}: ${bodyText.slice(0, 500)}` };
  }
  let raw: string;
  try {
    raw = await res.text();
  } catch (err) {
    return { ok: false, message: `Could not read response body: ${(err as Error).message}` };
  }
  try {
    return { ok: true, payload: parseVerifyPayload(raw) };
  } catch (err) {
    return { ok: false, message: `Malformed JSON response: ${(err as Error).message}` };
  }
}

export interface ResolveVerifyPayloadOptions {
  cwd?: string;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  /** Injectable for tests — defaults to `readCliConfig()` (the real `~/.reelier/config.json`). */
  fileConfig?: CliConfig;
}

/**
 * Resolve `target` — a full http(s) permalink, a bare registry token, or a
 * local file path — to its `VerifyPayload`. Order: absolute URL -> fetch
 * directly; otherwise try it as a local file relative to `cwd`; only if
 * that file doesn't exist is it treated as a bare token, resolved against
 * `REELIER_CLOUD_URL` -> the config file's `cloudUrl` -> `DEFAULT_CLOUD_URL`
 * (mirrors `reelier get`'s anonymous-fetch config resolution exactly, via
 * `resolveGetConfig` — a self-hoster who logged in with a custom cloudUrl
 * gets the same URL from `verify` as from `get`).
 */
export async function resolveVerifyPayload(
  target: string,
  options: ResolveVerifyPayloadOptions = {}
): Promise<FetchVerifyOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;

  if (isHttpUrl(target)) {
    return fetchVerifyPayloadFromUrl(permalinkJsonUrl(target), fetchImpl);
  }

  const cwd = options.cwd ?? process.cwd();
  const resolvedPath = path.resolve(cwd, target);
  try {
    await access(resolvedPath);
    const raw = await readFile(resolvedPath, "utf8");
    return { ok: true, payload: parseVerifyPayload(raw) };
  } catch (err) {
    if (err instanceof SyntaxError) {
      return { ok: false, message: `${resolvedPath} is not valid JSON: ${err.message}` };
    }
    // Not a readable local file — fall through to the bare-token path.
  }

  const fileConfig = options.fileConfig ?? (await readCliConfig());
  const baseUrl = resolveGetConfig(options.env, fileConfig).baseUrl;
  const url = `${baseUrl.replace(/\/$/, "")}/r/${encodeURIComponent(target)}/json`;
  return fetchVerifyPayloadFromUrl(url, fetchImpl);
}

export type ClaimStatus = "verified" | "failed" | "unchecked" | "absent";

export interface ClaimLine {
  claim: "unaltered-since-push" | "timestamped";
  status: ClaimStatus;
  line: string;
}

/**
 * The signature claim — spec §1's exact framing: "produced by the holder of
 * this key and has not been altered since push". Verifies against
 * `digestSha256(payload.record)` recomputed HERE, over whatever record was
 * actually fetched/read — never trusts a client-declared digest.
 *
 * Key resolution order (B5 — spec §1's "given via --key <pem> or fetched
 * from the tenant's published key page"):
 *  1. An explicit `--key <pub.pem>` (the `publicPem` argument) ALWAYS wins
 *     — a permalink is never trusted blindly by default just because it
 *     came bundled with its own claimed key.
 *  2. Otherwise, `payload.signingKey` (additively returned by
 *     `/r/<token>/json` when the receipt is signed) is used IF its keyId
 *     matches the signature's own keyId — verified against that PEM, with
 *     an honest attribution caveat on the same line (the key came from
 *     reelier.com, not from something the caller independently holds).
 *     A keyId MISMATCH between the signature and the payload's signingKey
 *     is a real problem worth failing loudly, naming both ids.
 *  3. Neither present -> today's "unchecked" line, unchanged.
 */
export function evaluateUnalteredSincePushClaim(payload: VerifyPayload, publicPem?: string): ClaimLine {
  const sig = payload.signature;
  if (!sig) {
    return {
      claim: "unaltered-since-push",
      status: "absent",
      line: "unaltered-since-push: — unsigned (sign your pushes: reelier init --signing)",
    };
  }

  if (publicPem) {
    return verifySignatureAgainstKey(payload.record, sig, publicPem, "");
  }

  const signingKey = payload.signingKey;
  if (signingKey) {
    if (signingKey.keyId !== sig.keyId) {
      return {
        claim: "unaltered-since-push",
        status: "failed",
        line:
          `unaltered-since-push: ✗ KEY MISMATCH (signature claims key ${sig.keyId}, but reelier.com's published ` +
          `signing key for this receipt is ${signingKey.keyId} — these must match; the payload may be tampered ` +
          `with, or reelier.com is showing the wrong key)`,
      };
    }
    return verifySignatureAgainstKey(
      payload.record,
      sig,
      signingKey.publicKeyPem,
      " — key supplied by reelier.com; for independent verification pass --key"
    );
  }

  return {
    claim: "unaltered-since-push",
    status: "unchecked",
    line: `unaltered-since-push: — signed by key ${sig.keyId}, but no public key was given to check it against (pass --key <pub.pem>)`,
  };
}

/** Shared verify-and-render step for both the --key and signingKey-attribution paths — `attributionSuffix` is appended inside the parens on a successful verify only (a failure names the key plainly, no attribution noise). */
function verifySignatureAgainstKey(
  record: RunRecord,
  sig: NonNullable<VerifyPayload["signature"]>,
  publicPem: string,
  attributionSuffix: string
): ClaimLine {
  const digest = digestSha256(record);
  const verified = verifyRecordSignature(publicPem, digest, sig.sig);
  if (verified) {
    return {
      claim: "unaltered-since-push",
      status: "verified",
      line: `unaltered-since-push: ✓ (key ${sig.keyId}${attributionSuffix})`,
    };
  }
  return {
    claim: "unaltered-since-push",
    status: "failed",
    line: `unaltered-since-push: ✗ SIGNATURE INVALID (key ${sig.keyId} does not verify against this record's digest — either the record changed after signing, or this isn't the right public key)`,
  };
}

/**
 * The timestamp claim (trust-ladder spec §2's "verification honesty (v1
 * scope)"). This checks the ONE thing the CLI can cheaply verify offline —
 * that the TSA token's messageImprint actually matches this record's own
 * digest (`imprintMatches`'s documented OID+OCTET-STRING shortcut; see
 * src/tsa.ts) — and prints the standard `openssl ts -verify` command for
 * the OTHER half (full RFC-3161 certificate-chain verification), which
 * this CLI does not attempt. A genuine imprint MISMATCH is a real, checked
 * failure (the token doesn't attest to THIS record) and fails the exit
 * code, same as a bad signature. A MATCHING imprint stays graded
 * "unchecked" rather than "verified" — it proves the digest was submitted
 * to the named TSA, not that the TSA (or its certificate chain) is
 * trustworthy, so it never overclaims past what was actually checked.
 */
export function evaluateTimestampClaim(payload: VerifyPayload): ClaimLine {
  if (!payload.timestamp) {
    return { claim: "timestamped", status: "absent", line: "timestamped: — none" };
  }
  const digestHex = digestSha256(payload.record).replace(/^sha256:/, "");
  const opensslHint = `openssl ts -verify -in <token file, base64-decoded> -digest ${digestHex}`;
  if (!imprintMatches(payload.timestamp.token, digestHex)) {
    return {
      claim: "timestamped",
      status: "failed",
      line:
        `timestamped: ✗ IMPRINT MISMATCH (tsa ${payload.timestamp.tsa}) — the token's message imprint does not ` +
        `match this record's digest; the record may have changed after it was timestamped, or this token belongs ` +
        `to a different record.`,
    };
  }
  return {
    claim: "timestamped",
    status: "unchecked",
    line:
      `timestamped: imprint ✓ (tsa ${payload.timestamp.tsa}) — proves this digest was submitted to the named TSA; ` +
      `full certificate-chain verification is not performed by this CLI — verify manually: ${opensslHint}`,
  };
}

export interface VerifyResult {
  claims: ClaimLine[];
  /** 0 unless a PRESENT claim FAILED verification — absent/unchecked claims never fail the exit code (never-lies rule). */
  exitCode: 0 | 1;
}

export function evaluateVerifyClaims(payload: VerifyPayload, publicPem?: string): VerifyResult {
  if ((payload.record as unknown as { v?: unknown }).v === "reelier.authority-receipt/v1") {
    return {
      claims: [{ claim: "unaltered-since-push", status: "failed", line: "unsupported authority receipt: upgrade to an authority-aware verifier" }],
      exitCode: 1,
    };
  }
  const claims = [evaluateUnalteredSincePushClaim(payload, publicPem), evaluateTimestampClaim(payload)];
  const exitCode = claims.some((c) => c.status === "failed") ? 1 : 0;
  return { claims, exitCode };
}
