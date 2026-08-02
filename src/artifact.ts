// Pre-dispatch artifact attestation (docs/specs/artifact-attestation-v1.md).
//
// The problem, in one breath: `attest:` proves a write by reading the world
// back through a declared probe, and an entire class of write has no
// post-state to read — there is no "get the email you just sent". For an
// irreversible external effect the attestable object is not the world's
// post-state, it is THE ARTIFACT THAT LEFT. This module commits to that
// artifact: it projects declared fields out of the FILLED action args, hashes
// them, and the runner records the result before dispatch. No probe tool is
// involved at any point.
//
// Why this is needed at all, given `approve:` exists: the approval hash binds
// the args TEMPLATE with `{{placeholders}}` intact (src/approval.ts). For a
// fully-static send the template IS the exact args and the artifact is already
// bound — nothing here applies. For a TEMPLATED send the run-time fill
// supplies the bytes, and what leaves was never covered by anything. That is
// precisely the gap `probeArgs` (src/expect-mac.ts) closes one level over, for
// probe args, with the same construction: commit over the FILLED values.
//
// Two commitments, deliberately distinct (spec §5), mirroring the house
// pattern flight-recorder-v2 §2 set for approval-hash vs idempotency-key:
//   - `artifactDigest` — UNSALTED sha256, third-party recomputable, the join
//     key of an emission↔authorization pair. It belongs to the `write` block's
//     unsalted join-key class, NOT `attest`'s salted change-detection class.
//     The opt-in is argued in §5.1 and rests on one fact: `idempotencyKey`, in
//     the same block on the same steps, is already an unsalted hash over ALL
//     the filled args, so a digest over a SUBSET is strictly less revealing.
//     That argument does not generalize — it holds because that field is there.
//   - `artifactFieldMac` — KEYED, under the step's existing per-approval key.
//     Diagnosis only (which field differs, names never values). Per-field must
//     never be unsalted: a bare digest over `args.to` alone is a dictionary
//     attack on a recipient address, and §5.1's composite argument does not
//     extend to the parts.

import { createHmac } from "node:crypto";
import { canonicalJson, digestSha256 } from "./canonical-json.js";
import {
  ABSENT_FIELDS_MAX,
  ABSENT_FIELD_NAME_MAX,
  assertNoProtoKeyDeep,
  assertUsableKey,
  tagScalar,
} from "./expect-mac.js";

/**
 * The ONE namespace an `emit:` projection entry may use (spec §4, Normative).
 * P1.5's namespaces (`header.`, `body.`, `status.code`, bare) all address the
 * RESPONSE; an artifact lives in the REQUEST. There is deliberately no bare
 * form: P1.5 did not ship a bare `status` namespace because re-pointing an
 * existing spelling would change what an existing approval binds, and a bare
 * form here would invite the same confusion against `body.` for no gain in an
 * entry that is always request-side.
 */
export const ARTIFACT_NAMESPACE = "args.";

const MAC_PREFIX = "hmac-sha256:";

/**
 * Validate a projection entry and return the top-level args key it addresses.
 * Reaching this with a malformed entry is a caller bug — `parseSkill` rejects
 * both shapes at parse time — so it is refused loudly rather than skipped,
 * following `expectMac`'s I-6 discipline.
 */
function artifactArgsKey(entry: string): string {
  if (typeof entry !== "string" || !entry.startsWith(ARTIFACT_NAMESPACE)) {
    throw new Error(
      `projectArtifact: projection entry ${JSON.stringify(entry)} must carry the '${ARTIFACT_NAMESPACE}' prefix — there is no bare form (spec §4)`
    );
  }
  const key = entry.slice(ARTIFACT_NAMESPACE.length);
  if (key === "") {
    throw new Error(`projectArtifact: projection entry ${JSON.stringify(entry)} addresses no field`);
  }
  // An args key literally named "__proto__" cannot be read faithfully: a
  // plain member read returns the prototype, and JSON.parse CAN produce an own
  // "__proto__" key, so the two are indistinguishable downstream. Dropping it
  // silently would make two different artifacts commit alike — the false-MATCH
  // class A6 exists to close.
  if (key === "__proto__") {
    throw new Error(
      "projectArtifact: args field '__proto__' cannot be committed faithfully — refusing to drop it silently (A6)"
    );
  }
  return key;
}

/** One validation belt for parser and runtime callers, sharing expect's field-list caps. */
export function assertArtifactProjection(projection: unknown): asserts projection is string[] {
  if (!Array.isArray(projection) || projection.length === 0) {
    throw new Error("emit.projection must be a non-empty array of non-empty strings");
  }
  if (projection.length > ABSENT_FIELDS_MAX) {
    throw new Error(`emit.projection may name at most ${ABSENT_FIELDS_MAX} fields`);
  }
  const seen = new Set<string>();
  for (const entry of projection) {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new Error("emit.projection must be a non-empty array of non-empty strings");
    }
    if (entry.length > ABSENT_FIELD_NAME_MAX) {
      throw new Error(`emit.projection field names may be at most ${ABSENT_FIELD_NAME_MAX} characters`);
    }
    artifactArgsKey(entry);
    if (seen.has(entry)) {
      throw new Error(`duplicate emit.projection entry ${JSON.stringify(entry)}`);
    }
    seen.add(entry);
  }
}

/** Filled action args are only projectable when they are a JSON object; a string, array or null establishes nothing. */
function argsRecord(filledArgs: unknown): Record<string, unknown> | undefined {
  return filledArgs !== null && typeof filledArgs === "object" && !Array.isArray(filledArgs)
    ? (filledArgs as Record<string, unknown>)
    : undefined;
}

/**
 * Project the declared artifact fields out of the FILLED action args.
 *
 * Selection semantics are inherited verbatim from `projectObservationTyped`
 * (src/expect-mac.ts) rather than forked: top-level scalars only, absent and
 * non-scalar values dropped, own properties only. That module's own comment
 * records why — the fork there was sanctioned for the ENCODING, never the
 * SELECTION — and a third set of selection rules is exactly what this reuse
 * avoids. Values keep their JSON type so the digest input can be type-tagged.
 */
export function projectArtifact(
  filledArgs: unknown,
  projection: string[]
): Record<string, string | number | boolean> {
  assertArtifactProjection(projection);
  assertNoProtoKeyDeep(filledArgs, "(root)", "projectArtifact");
  const out: Record<string, string | number | boolean> = {};
  const rec = argsRecord(filledArgs);
  for (const entry of projection) {
    // Validated first, and unconditionally: a malformed entry is a caller bug
    // whether or not this run's args happen to carry the field.
    const key = artifactArgsKey(entry);
    if (rec === undefined) continue;
    // Own-property test for the same reason the expect field loops use one: a
    // projection entry naming "constructor"/"toString" resolves through
    // Object.prototype and would otherwise read as present.
    if (!Object.prototype.hasOwnProperty.call(rec, key)) continue;
    const v = rec[key];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[entry] = v;
  }
  return out;
}

/**
 * Split a declared projection into what the filled args actually carried and
 * what they did not (spec §5.3). The unresolved half is the whole point: a
 * declared entry that did not resolve is REPORTED, never dropped in silence,
 * because silence would publish a digest covering less than the operator
 * believes — RFC 9421 §7.2.1's "Insufficient Coverage", which §11.1 credits.
 *
 * This is what keeps §3.1's three blind shapes visible: a `template_id`-driven
 * send that renders server-side reports `args.body` unresolved forever rather
 * than quietly attesting the fields it did happen to hold.
 *
 * Declared order is preserved in both halves, and the two always partition the
 * input exactly — a consumer may rely on `resolved ⊎ unresolved === projection`.
 */
export function partitionArtifact(
  filledArgs: unknown,
  projection: string[]
): { resolved: string[]; unresolved: string[] } {
  const projected = projectArtifact(filledArgs, projection);
  const resolved: string[] = [];
  const unresolved: string[] = [];
  for (const entry of projection) {
    (Object.prototype.hasOwnProperty.call(projected, entry) ? resolved : unresolved).push(entry);
  }
  return { resolved, unresolved };
}

/**
 * The unsalted whole-artifact commitment (spec §5.1):
 *
 *   sha256(canonicalJson({ artifact: <type-tagged projected map>, tool, v: 1 }))
 *
 * `digestSha256` is the existing shared primitive (src/canonical-json.ts) —
 * nothing new is invented, so the value is checkable with existing tooling.
 *
 * Domain-separated from every other `digestSha256` input in this package by
 * key set: `{artifact,tool,v}` here, `{args,tool}` / `{args,attest,tool}` /
 * `{args,attest,expect,tool}` for approval hashes, `{args,server,tool}` for
 * the idempotency key. No constructible collision.
 *
 * The tool name is bound for the same reason the MACs bind `probe`: the same
 * bytes sent through a different tool are a different emission.
 */
export function artifactDigest(actionTool: string, projected: Record<string, string | number | boolean>): string {
  if (typeof actionTool !== "string" || actionTool.trim() === "") {
    throw new Error("artifactDigest: action tool name must be a non-empty string");
  }
  assertNoProtoKeyDeep(projected, "(root)", "artifactDigest");
  const tagged: Record<string, string> = {};
  for (const [field, value] of Object.entries(projected)) {
    tagged[field] = tagScalar(value);
  }
  return digestSha256({ artifact: tagged, tool: actionTool, v: 1 });
}

/**
 * Per-field artifact commitment (spec §5.2) — one MAC per projected field
 * under the step's existing per-approval key, so a report can name WHICH
 * field of an artifact differs without ever carrying its value.
 *
 * Domain-separated from the three existing MACs by canonical-JSON input
 * shape: `{artifact,field,tool,v,value}` here versus `{field,probe,v,value}` per expect
 * field, `{probe,projection,v}` whole-projection, `{args,probe,v}` probe-args.
 * The key sets differ regardless of the values, so no collision is
 * constructible.
 *
 * Keyed, never bare — see this module's header. The whole-artifact digest
 * stays the only identity; these only ever explain a difference.
 */
export function artifactFieldMac(
  key: Uint8Array,
  actionTool: string,
  fieldName: string,
  value: string | number | boolean
): string {
  assertUsableKey(key, "artifactFieldMac");
  if (typeof actionTool !== "string" || actionTool.trim() === "") {
    throw new Error("artifactFieldMac: action tool name must be a non-empty string");
  }
  if (typeof fieldName !== "string" || fieldName.trim() === "" || fieldName === "__proto__") {
    throw new Error(`artifactFieldMac: invalid field name ${JSON.stringify(fieldName)}`);
  }
  const input = canonicalJson({ artifact: true, field: fieldName, tool: actionTool, v: 1, value: tagScalar(value) });
  return MAC_PREFIX + createHmac("sha256", Buffer.from(key)).update(input, "utf8").digest("hex");
}
