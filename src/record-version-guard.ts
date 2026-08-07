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

/** The single refusal line every guarded entry point reports. */
export function unsupportedVersionLine(declared: string): string {
  return (
    `${UNSUPPORTED_VERSION_CLAIM}: ✗ REFUSED — this record declares version ${declared}, which this ` +
    `release cannot read. It is NOT evaluated as a legacy record, because verifying a record this ` +
    `CLI does not understand would produce a confident answer about the wrong thing. Upgrade to a ` +
    `Reelier release with authority-aware verification.`
  );
}
