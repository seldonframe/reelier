import type { ValidateFunction } from "ajv";
import canonicalize from "canonicalize";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AuthorityKind, AuthorityWire, AuthorityWireByKind, DecisionArtifactPresence, DecisionContext, DecisionContextPresence } from "./types.js";

// Keep the schema lookup filesystem-based rather than passing directory URLs to
// bundlers. Node resolves both forms, but Turbopack treats a directory-shaped
// `new URL("./schemas/", import.meta.url)` as an import and fails the build.
const authorityDirectory = dirname(fileURLToPath(import.meta.url));
const packagedSchemaDirectory = join(authorityDirectory, "schemas");
const schemaDirectory = existsSync(packagedSchemaDirectory)
  ? packagedSchemaDirectory
  : join(authorityDirectory, "../../../contract/authority/v1");
const schemas = new Map<AuthorityKind, ValidateFunction>();
const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/2020").default as new (options: object) => {
  compile(schema: object): ValidateFunction;
  errorsText(errors: unknown, options: { separator: string }): string;
};
const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
const addFormats = require("ajv-formats").default as (instance: object) => void;
addFormats(ajv);

function validator(kind: AuthorityKind): ValidateFunction {
  const cached = schemas.get(kind);
  if (cached) return cached;
  const schema = JSON.parse(readFileSync(join(schemaDirectory, `${kind}.schema.json`), "utf8")) as object;
  const compiled = ajv.compile(schema);
  schemas.set(kind, compiled);
  return compiled;
}

function errorMessage(validate: ValidateFunction): string {
  return ajv.errorsText(validate.errors, { separator: "; " });
}

/** RFC 8785/JCS bytes for new authority objects only; legacy canonical-json stays untouched. */
export function authorityCanonicalBytes(value: unknown): Buffer {
  const canonical = canonicalize(value);
  if (canonical === undefined) throw new TypeError("authority wire value is not JSON-canonicalizable");
  return Buffer.from(canonical, "utf8");
}

export function authorityDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(authorityCanonicalBytes(value)).digest("hex")}`;
}

/** Validates a closed authority object and returns a detached, immutable-typed copy. */
export function parseAuthorityWire<K extends AuthorityKind>(kind: K, value: unknown): AuthorityWireByKind[K] {
  const validate = validator(kind);
  if (!validate(value)) throw new TypeError(`invalid ${kind}: ${errorMessage(validate)}`);
  const parsed = JSON.parse(authorityCanonicalBytes(value).toString("utf8")) as AuthorityWireByKind[K];
  if (kind === "outcome-request") {
    const choices = (parsed as AuthorityWireByKind["outcome-request"]).choices;
    if (Object.keys(choices).some((key) => ["tenant", "provideraccount", "account", "connector", "pack", "endpoint", "recipient", "template", "body", "url", "providerargs", "providerarguments", "credentials"].includes(key.toLowerCase()))) {
      throw new TypeError("invalid outcome-request: forbidden choice property name");
    }
  }
  if (kind === "outcome-contract") {
    const commitment = (parsed as AuthorityWireByKind["outcome-contract"]).policyCommitment;
    const bytes = Buffer.from(commitment.jcsBase64, "base64");
    if (bytes.toString("base64") !== commitment.jcsBase64) throw new TypeError("invalid outcome-contract: policy commitment base64 is not canonical");
    let policy: unknown;
    try { policy = JSON.parse(bytes.toString("utf8")); }
    catch { throw new TypeError("invalid outcome-contract: policy commitment is not valid JSON"); }
    if (authorityCanonicalBytes(policy).compare(bytes) !== 0) throw new TypeError("invalid outcome-contract: policy commitment bytes are not RFC 8785/JCS canonical");
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (digest !== commitment.digest) throw new TypeError("invalid outcome-contract: policy commitment digest mismatch");
  }
  if (kind === "source-bundle") {
    const source = parsed as AuthorityWireByKind["source-bundle"];
    const observations = source.provenance.observations;
    if (observations.some((item, index) => item.index !== index) || new Set(observations.map(item => item.planDigest)).size !== observations.length) {
      throw new TypeError("invalid source-bundle: provenance observations must be uniquely indexed in order");
    }
    const expectedReadSet = authorityDigest({ v: "reelier.source-read-set/internal-v1", sourceRefsDigest: source.sourceRefsDigest, observations });
    if (expectedReadSet !== source.readSetDigest) throw new TypeError("invalid source-bundle: read set digest mismatch");
    const claimIds = new Set<string>();
    const pointers = new Set<string>();
    for (const [claimClass, claims] of Object.entries(source.claims)) {
      for (const claim of claims) {
        if (claimIds.has(claim.claimId)) throw new TypeError("invalid source-bundle: claim id must be globally unique");
        claimIds.add(claim.claimId);
        if (pointers.has(claim.projectionPointer)) throw new TypeError("invalid source-bundle: projection pointer appears in more than one class");
        pointers.add(claim.projectionPointer);
        if (claimClass === "grounded" && !hasOwnJsonPointer(source.projection, claim.projectionPointer)) {
          throw new TypeError("invalid source-bundle: grounded projection pointer does not resolve to an own path");
        }
      }
    }
    const leaves = projectionLeafPointers(source.projection).sort();
    if ([...pointers].sort().join("\0") !== leaves.join("\0")) throw new TypeError("invalid source-bundle: claims must cover projection leaves exactly");
  }
  if (kind === "compiled-capability") {
    const capability = parsed as AuthorityWireByKind["compiled-capability"];
    const expected = authorityDigest({ v: "reelier.capability-limits/internal-v1", contractDigest: capability.contractDigest, limits: capability.limits });
    if (expected !== capability.limitsDigest) throw new TypeError("invalid compiled-capability: limits digest mismatch");
  }
  if (kind === "decision-context") {
    assertIntrinsicDecisionContext(parsed as AuthorityWireByKind["decision-context"]);
  }
  if (kind === "authority-receipt") {
    const receipt = parsed as AuthorityWireByKind["authority-receipt"];
    const context = parseAuthorityWire("decision-context", receipt.decisionContext);
    if (authorityDigest(context) !== receipt.decisionContextDigest) {
      throw new TypeError("invalid authority-receipt: decision context digest mismatch");
    }
    if (receipt.claims.completeness === "verified") throw new TypeError("invalid authority-receipt: completeness cannot be verified");
  }
  if (kind === "authority-evidence") {
    const evidence = parsed as AuthorityWireByKind["authority-evidence"];
    let previous = -Infinity;
    const eventDigests = new Set<string>();
    let state: "issued"|"reserved"|"dispatched"|"acknowledged"|"definitive-failure"|"ambiguous"|"reconciled"|"cancelled" = "issued";
    const next: Record<string, readonly string[]> = {
      issued: ["reserved"], reserved: ["dispatched", "cancelled"], dispatched: ["acknowledged", "definitive-failure", "ambiguous"], acknowledged: ["reconciled"], "definitive-failure": ["reconciled"], ambiguous: ["reconciled"], reconciled: [], cancelled: [],
    };
    for (const entry of evidence.timeline) {
      const at = Date.parse(entry.at);
      if (!Number.isFinite(at) || at < previous) throw new TypeError("invalid authority-evidence: timeline is not chronological");
      previous = at;
      if (eventDigests.has(entry.eventDigest)) throw new TypeError("invalid authority-evidence: duplicate timeline event digest");
      eventDigests.add(entry.eventDigest);
      if (!next[state].includes(entry.state)) throw new TypeError(`invalid authority-evidence: illegal transition ${state}->${entry.state}`);
      state = entry.state;
    }
    if (evidence.timeline.length === 0 || evidence.timeline[0].state !== "reserved") throw new TypeError("invalid authority-evidence: timeline must begin reserved");
    const dispatched = evidence.timeline.some(entry => entry.state === "dispatched");
    if (dispatched !== (evidence.dispatchedRequestDigest !== null)) throw new TypeError("invalid authority-evidence: dispatch digest does not match timeline");
    if (evidence.reconciliation.verdict === "matched" && evidence.reconciliation.normalizedProjectionDigest === null) throw new TypeError("invalid authority-evidence: matched reconciliation requires normalized projection digest");
  }
  if (kind === "transport-effect") {
    const effect = parsed as AuthorityWireByKind["transport-effect"];
    if (Object.keys(effect.headers).some((key) => ["authorization", "cookie", "host"].includes(key.toLowerCase()))) throw new TypeError("invalid transport-effect: forbidden header property name");
    if (Buffer.from(effect.bodyBase64, "base64").toString("base64") !== effect.bodyBase64) throw new TypeError("invalid transport-effect: noncanonical base64");
    if (effect.query) {
      const pairs = effect.query.split("&");
      let previous = "";
      const keys = new Set<string>();
      for (const pair of pairs) {
        const split = pair.indexOf("=");
        if (split <= 0 || split !== pair.lastIndexOf("=")) throw new TypeError("invalid transport-effect: query is not canonically encoded");
        const key = pair.slice(0, split);
        const value = pair.slice(split + 1);
        try {
          for (const encoded of [...key.matchAll(/%[0-9A-F]{2}/g), ...value.matchAll(/%[0-9A-F]{2}/g)]) {
            const byte = Number.parseInt(encoded[0].slice(1), 16);
            if ((byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x30 && byte <= 0x39) || "._~-".includes(String.fromCharCode(byte))) throw new TypeError("unreserved escape");
          }
          decodeURIComponent(key); decodeURIComponent(value);
        } catch { throw new TypeError("invalid transport-effect: query is not canonically encoded"); }
        if (keys.has(key) || (previous && previous >= key)) throw new TypeError("invalid transport-effect: query is not canonically encoded");
        keys.add(key); previous = key;
      }
    }
  }
  return parsed;
}

function assertIntrinsicDecisionContext(context: DecisionContext): void {
  if ((context.capabilityId === null) !== (context.capabilityDigest === null)) {
    throw new TypeError("invalid decision-context: capability id and digest must have paired nullability");
  }
  if ((context.outcomeKey === null) !== (context.effectDigest === null)) {
    throw new TypeError("invalid decision-context: artifact dependency requires outcome and effect paired nullability");
  }
  if (context.outcomeKey !== null && context.contractDigest === null) {
    throw new TypeError("invalid decision-context: artifact dependency requires contract before outcome");
  }
  if (context.effectDigest !== null && (context.contractDigest === null || context.outcomeKey === null || context.snapshots.sourceBundleDigest === null || context.snapshots.authorityStateDigest === null)) {
    throw new TypeError("invalid decision-context: artifact dependency requires contract, outcome, and snapshots before effect");
  }
  if (context.capabilityId !== null && (context.contractDigest === null || context.outcomeKey === null || context.effectDigest === null || context.snapshots.sourceBundleDigest === null || context.snapshots.authorityStateDigest === null)) {
    throw new TypeError("invalid decision-context: artifact dependency requires compiled artifacts and snapshots before capability");
  }
}

/** Requires the complete context needed by an accepted dispatch decision. */
export function assertAcceptedDecisionContext(value: unknown): DecisionContext {
  const context = parseAuthorityWire("decision-context", value);
  if (
    context.contractDigest === null || context.capabilityId === null || context.capabilityDigest === null ||
    context.outcomeKey === null || context.effectDigest === null || context.snapshots.sourceBundleDigest === null ||
    context.snapshots.authorityStateDigest === null
  ) {
    throw new TypeError("accepted decision context requires every nullable artifact and snapshot to be non-null");
  }
  return context;
}

/** Reports only presence. Task 3 assigns evidence claim semantics. */
export function decisionContextPresence(value: unknown): DecisionContextPresence {
  const context = parseAuthorityWire("decision-context", value);
  const presence = (artifact: string | null): DecisionArtifactPresence => artifact === null ? "absent" : "unchecked";
  return {
    contract: presence(context.contractDigest),
    capability: presence(context.capabilityId),
    outcome: presence(context.outcomeKey),
    effect: presence(context.effectDigest),
    sourceBundleSnapshot: presence(context.snapshots.sourceBundleDigest),
    authorityStateSnapshot: presence(context.snapshots.authorityStateDigest),
  };
}

/** Parses a portable evidence bundle and refuses any broken decision or event digest edge. */
export function parsePortableAuthorityEvidence(gateEventValue: unknown, receiptValue: unknown): Readonly<{
  gateEvent: AuthorityWireByKind["gate-event"];
  receipt: AuthorityWireByKind["authority-receipt"];
}> {
  const gateEvent = parseAuthorityWire("gate-event", gateEventValue);
  const receipt = parseAuthorityWire("authority-receipt", receiptValue);
  if (receipt.decisionContextDigest !== gateEvent.decisionContextDigest) {
    throw new TypeError("invalid portable authority evidence: decision context digest does not match GateEvent");
  }
  if (receipt.gateEventDigest !== authorityDigest(gateEvent)) {
    throw new TypeError("invalid portable authority evidence: GateEvent digest mismatch");
  }
  return { gateEvent, receipt };
}

function hasOwnJsonPointer(root: Record<string, unknown>, pointer: string): boolean {
  let current: unknown = root;
  for (const encoded of pointer.slice(1).split("/")) {
    const segment = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    if ((typeof current !== "object" || current === null) || !Object.prototype.hasOwnProperty.call(current, segment)) return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
}

function projectionLeafPointers(value: unknown, prefix = ""): string[] {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 0) return entries.flatMap(([key, child]) => projectionLeafPointers(child, `${prefix}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`));
  }
  return [prefix];
}

/** Refuses JSON whose original bytes are not its RFC 8785/JCS representation. */
export function parseCanonicalAuthorityJson<K extends AuthorityKind>(kind: K, json: string): AuthorityWireByKind[K] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new TypeError(`invalid ${kind}: invalid JSON`);
  }
  if (authorityCanonicalBytes(value).toString("utf8") !== json) {
    throw new TypeError(`invalid ${kind}: JSON is not RFC 8785/JCS canonical`);
  }
  return parseAuthorityWire(kind, value);
}
