/**
 * The guard-only N-1 release's record-version classifier.
 *
 * This release does not understand authority-aware records. Its entire job is to REFUSE them
 * before any legacy parsing or signature verification, rather than let them fall through and be
 * evaluated as legacy records — because an old CLI rendering a confident answer about a receipt it
 * cannot actually read is the one failure this guard exists to prevent. It is the negative control
 * that makes "authority-aware verification" a meaningful claim in the release that follows.
 *
 * The rule is deliberately crude and closed:
 *
 *   - a record with NO own top-level `v`  -> legacy, evaluated exactly as before, byte for byte;
 *   - a record with ANY own top-level `v` -> unsupported-version failure.
 *
 * There is no allow-list of known versions and no parsing of the declared value. A guard that
 * understood `reelier.authority-receipt/v1` well enough to allow-list it would be an authority-aware
 * parser, which is exactly what this release must not contain. Refusing every version — including
 * ones that do not exist yet — is what makes it forward-safe.
 *
 * Two boundaries the brief names explicitly, both pinned by tests:
 *
 *   - An INHERITED `v` is not an own record version. Classification uses an own-property check, so
 *     a record whose prototype happens to carry `v` stays legacy.
 *   - A valid-looking signature or timestamp sibling cannot rescue a versioned record into legacy
 *     crypto. The guard runs first and the legacy claim evaluators never see it.
 *
 * Malformed payloads remain the existing parser boundary's problem: a non-object record is not a
 * version declaration, so it classifies as legacy and fails downstream exactly where it always did.
 */

/** The claim name this guard reports under. Deliberately not one of the legacy claim names. */
export const UNSUPPORTED_VERSION_CLAIM = "unsupported-record-version" as const;

export type RecordVersionClassification =
  | { kind: "legacy" }
  | { kind: "unsupported-version"; declared: string };

const LEGACY: RecordVersionClassification = { kind: "legacy" };

/** Render a declared version for humans without trusting or parsing it. */
function describeDeclared(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "(present but undefined)";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * Classify a record for this guard-only release. Runs before all legacy claim evaluation.
 * Non-objects are legacy by definition — they declare nothing, and the existing parser boundary
 * already owns them.
 */
export function classifyRecordVersion(record: unknown): RecordVersionClassification {
  if (typeof record !== "object" || record === null) return LEGACY;
  if (!Object.prototype.hasOwnProperty.call(record, "v")) return LEGACY;
  return { kind: "unsupported-version", declared: describeDeclared((record as Record<string, unknown>).v) };
}

/**
 * Render a declared version safely for terminal output.
 *
 * The declared value is attacker-controlled bytes from the record under inspection, and it is
 * spliced into a verdict line. Interpolating it raw let a `v` containing newlines print forged
 * claim rows and the literal string "No present claim failed verification." beneath the refusal —
 * measured, in a real subprocess, during review. The exit code stayed 1, but a human reading the
 * terminal, or CI grepping stdout, was shown a pass. That is this release's own failure mode
 * relocated from "silently evaluated as legacy" to "the record author writes the verdict", and it
 * brushes the never-render-absent-as-a-pass invariant.
 *
 * Escaping control characters alone is NOT enough, and the first cut of this fix proved it: with
 * only `JSON.stringify`, the newlines were escaped but the forged sentence still read intact,
 * because spaces survived, so a CI step grepping stdout would still have matched it. The rule here
 * is therefore an ALLOW-charset, not a blocklist of dangerous phrases -- a blocklist would be one
 * paraphrase away from useless. Everything outside the characters a real version identifier is
 * built from (`reelier.authority-receipt/v1` is exactly [A-Za-z0-9._/:+-]) is hex-escaped, spaces
 * included, so no attacker-supplied prose survives as readable prose. The result is quoted to
 * delimit the untrusted span and length-capped so a multi-kilobyte `v` cannot bury the message.
 */
const VERSION_SAFE = /^[A-Za-z0-9._/:+-]$/;

function renderDeclared(declared: string): string {
  let out = "";
  for (const ch of declared) {
    if (VERSION_SAFE.test(ch)) {
      out += ch;
    } else {
      const code = ch.codePointAt(0)!;
      out += code <= 0xff ? `\\x${code.toString(16).padStart(2, "0")}` : `\\u{${code.toString(16)}}`;
    }
    if (out.length > 120) return `"${out.slice(0, 120)}"… (truncated)`;
  }
  return `"${out}"`;
}

/**
 * The single refusal line every guarded entry point reports. `declared` stays the raw datum on the
 * classification result; only this rendering step sanitizes, so callers that want the true value
 * still have it.
 */
export function unsupportedVersionLine(declared: string): string {
  return (
    `${UNSUPPORTED_VERSION_CLAIM}: ✗ REFUSED — this record declares version ${renderDeclared(declared)}, which this ` +
    `release cannot read. It is NOT evaluated as a legacy record, because verifying a record this ` +
    `CLI does not understand would produce a confident answer about the wrong thing. Upgrade to a ` +
    `Reelier release with authority-aware verification.`
  );
}
