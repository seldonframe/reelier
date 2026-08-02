import canonicalize from "canonicalize";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

const digest = "sha256:" + "9".repeat(64);
const at = "2026-01-01T00:00:00.000Z";
const limits = { maxEffectsPerWindow: 10, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 };
const policyJcs = canonicalize({ channel: "sms", template: "Appointment {{time}}" });
const policyDigest = "sha256:" + createHash("sha256").update(policyJcs, "utf8").digest("hex");
const constraints = {
  definitionAliases: ["definition_1"], audiences: ["requester_1"],
  connectorAccounts: [{ connectorId: "highlevel", accountId: "location_1" }],
  projectionPointers: ["/appointment/startTime", "/contact/phone"], riskClasses: ["message"], limits,
};
const vectorPrivateKey = createPrivateKey(`-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIO2e0HCVJ9AnRKWoiI+A2JXFNQeKOiEQDB7P8clr8OyJ
-----END PRIVATE KEY-----`);
const acceptedDecisionContext = {
  v: "reelier.decision-context/v1", tenant: "tenant_1", requester: "requester_1", definitionAlias: "definition_1", requestId: "request_1",
  requestDigest: "sha256:" + "1".repeat(64), requestKey: "sha256:" + "2".repeat(64), contractDigest: "sha256:" + "3".repeat(64),
  capabilityId: "capability_1", capabilityDigest: "sha256:" + "4".repeat(64), outcomeKey: "sha256:" + "5".repeat(64), effectDigest: "sha256:" + "6".repeat(64),
  snapshots: { sourceBundleDigest: "sha256:" + "7".repeat(64), authorityStateDigest: "sha256:" + "8".repeat(64) },
};
const refusedDecisionContext = {
  ...acceptedDecisionContext, contractDigest: null, capabilityId: null, capabilityDigest: null, outcomeKey: null, effectDigest: null,
  snapshots: { sourceBundleDigest: null, authorityStateDigest: null },
};
const decisionContextDigest = "sha256:" + createHash("sha256").update(canonicalize(acceptedDecisionContext), "utf8").digest("hex");
const gateEvent = { v: "reelier.gate-event/v1", eventId: "event_1", at, verdict: "accepted", reasonCode: "accepted", decisionContextDigest };
const gateEventDigest = "sha256:" + createHash("sha256").update(canonicalize(gateEvent), "utf8").digest("hex");
const vectorSourceRefsDigest = "sha256:" + createHash("sha256").update(canonicalize({ v: "reelier.source-refs/internal-v1", sourceRefs: { appointment: "ref_1" } }), "utf8").digest("hex");
const vectorObservations = [{ index: 0, planDigest: "sha256:" + "a".repeat(64), endpointId: "appointments.get", rawDigest: "sha256:" + "b".repeat(64) }];
const vectorReadSetDigest = "sha256:" + createHash("sha256").update(canonicalize({ v: "reelier.source-read-set/internal-v1", sourceRefsDigest: vectorSourceRefsDigest, observations: vectorObservations }), "utf8").digest("hex");
const vectorLimitsDigest = "sha256:" + createHash("sha256").update(canonicalize({ v: "reelier.capability-limits/internal-v1", contractDigest: digest, limits }), "utf8").digest("hex");
const vectors = {
  principal: { v: "reelier.principal/v1", id: "operator_1", kind: "operator" },
  "delegation-grant": { v: "reelier.delegation-grant/v1", tenant: "tenant_1", grantId: "grant_1", parentDigest: null, sponsor: "sponsor_1", grantor: "operator_1", grantee: "gate_1", issuedAt: at, expiresAt: "2026-02-01T00:00:00.000Z", constraints },
  "source-bundle": { v: "reelier.source-bundle/v1", tenant: "tenant_1", definitionDigest: digest, projectionSchemaId: "highlevel.appointment-reminder/v1", sourceRefsDigest: vectorSourceRefsDigest, readSetDigest: vectorReadSetDigest, sourceIdentity: "source_1", triggerIdentity: "trigger_1", observedAt: at, freshUntil: "2026-01-01T00:01:00.000Z", provenance: { resolverId: "resolver_1", observations: vectorObservations }, claims: { grounded: [{ claimId: "appointment_time", projectionPointer: "/appointment/startTime" }], authored: [], unresolved: [] }, projection: { appointment: { startTime: "2026-01-02T12:00:00.000Z" } } },
  "outcome-contract": { v: "reelier.outcome-contract/v1", tenant: "tenant_1", alias: "definition_1", contractId: "contract_1", validFrom: at, validUntil: "2026-02-01T00:00:00.000Z", packDigest: digest, definitionDigest: digest, sponsor: "sponsor_1", audiences: ["requester_1"], delegationGrantDigest: digest, connectorId: "highlevel", accountId: "location_1", sourceAuthority: { resolverId: "highlevel_appointment", projectionSchemaId: "highlevel.appointment-reminder/v1", allowedReadEndpointIds: ["appointments.get", "contacts.get"], authorizedProjectionPointers: ["/appointment/startTime", "/contact/phone"], maxFreshnessSeconds: 60 }, riskClasses: ["message"], limits, policyCommitment: { schemaId: "highlevel.sms-reminder-policy/v1", jcsBase64: Buffer.from(policyJcs, "utf8").toString("base64"), digest: policyDigest } },
  "outcome-request": { v: "reelier.outcome-request/v1", requestId: "request_1", sourceRefs: { appointment: "ref_1" }, choices: {} },
  "transport-effect": { v: "reelier.transport-effect/v1", endpointId: "connector_1", method: "POST", path: "/v1/messages", query: "account=tenant_1&mode=send", headers: { "Content-Type": "application/json" }, bodyBase64: "e30=", riskClass: "message", idempotency: "native", preconditions: [], reconciliation: { recipeId: "message-readback" } },
  "compiled-capability": { v: "reelier.compiled-capability/v1", tenant: "tenant_1", requester: "requester_1", definitionAlias: "definition_1", requestDigest: digest, requestKey: digest, contractDigest: digest, sourceBundleDigest: digest, sourceSnapshotDigest: digest, authorityStateDigest: digest, limits, limitsDigest: vectorLimitsDigest, capabilityId: "capability_1", outcomeKey: digest, effectDigest: digest, issuedAt: at, expiresAt: "2026-01-01T00:01:00.000Z" },
  "decision-context": acceptedDecisionContext,
  "gate-event": gateEvent,
  "authority-receipt": { v: "reelier.authority-receipt/v1", receiptId: "receipt_1", gateEventDigest, decisionContextDigest, decisionContext: acceptedDecisionContext, claims: { authorization: "verified", sourceCompleteness: "verified", dispatch: "verified", providerAcknowledgment: "unchecked", reconciliation: "absent", topology: "unchecked", completeness: "unchecked" } },
  "pack-manifest": { v: "reelier.outcome-pack-manifest/v1", packId: "first_party", packDigest: digest, definitions: ["definition_1"] },
};
function makeVector(kind, value) {
  const canonical = canonicalize(value);
  const digest = "sha256:" + createHash("sha256").update(canonical, "utf8").digest("hex");
  const purposeDigest = "sha256:" + createHash("sha256").update(canonicalize({ digest, purpose: kind }), "utf8").digest("hex");
  const sig = sign(null, Buffer.from(`reelier-authority-v1\n${purposeDigest}`, "utf8"), vectorPrivateKey).toString("base64");
  return { canonical, digest, signature: { alg: "ed25519", sig }, value };
}
const renderedVectors = Object.fromEntries(Object.entries(vectors).map(([kind, value]) => [kind, {
  ...makeVector(kind, value),
  ...(kind === "transport-effect" ? { compiledRequest: { target: `${value.path}?${value.query}`, bodyUtf8: Buffer.from(value.bodyBase64, "base64").toString("utf8") } } : {}),
}]));
renderedVectors["decision-context"].variants = { preCompileRefusal: makeVector("decision-context", refusedDecisionContext) };
const rendered = JSON.stringify(renderedVectors, null, 2) + "\n";
const target = new URL("../contract/authority/v1/golden-vectors.json", import.meta.url);
const decisionContextSchema = JSON.parse(await readFile(new URL("../contract/authority/v1/decision-context.schema.json", import.meta.url), "utf8"));
const receiptSchema = JSON.parse(await readFile(new URL("../contract/authority/v1/authority-receipt.schema.json", import.meta.url), "utf8"));
const { $schema: _decisionMetaSchema, $id: _decisionId, ...decisionContextBody } = decisionContextSchema;
if (canonicalize(decisionContextBody) !== canonicalize(receiptSchema?.properties?.decisionContext)) {
  throw new Error("authority schema drift: receipt-embedded DecisionContext must equal the standalone DecisionContext schema");
}
if (process.argv.includes("--copy-schemas")) {
  await mkdir(new URL("../dist/authority/schemas/", import.meta.url), { recursive: true });
  await cp(new URL("../contract/authority/v1/", import.meta.url), new URL("../dist/authority/schemas/", import.meta.url), { recursive: true });
  process.exit(0);
}
if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")) !== rendered) throw new Error("authority golden vectors drift; run node scripts/build-authority-contract.mjs");
} else await writeFile(target, rendered, "utf8");
