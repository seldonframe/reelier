import canonicalize from "canonicalize";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const directoryFlag = process.argv.indexOf("--directory");
if (directoryFlag !== -1 && !process.argv[directoryFlag + 1]) throw new Error("--directory requires a path");
const contractDirectory = directoryFlag === -1
  ? fileURLToPath(new URL("../contract/authority/v1/", import.meta.url))
  : resolve(process.argv[directoryFlag + 1]);
const target = join(contractDirectory, "golden-vectors.json");
const descriptorTarget = join(contractDirectory, "adapter-contract-v1.json");
const adapterContractSourceTarget = fileURLToPath(new URL("../src/authority/adapter-contract.ts", import.meta.url));
const adapterContractTemplateTarget = fileURLToPath(new URL("../src/authority/adapter-contract-template.ts", import.meta.url));
const sourceFlag = process.argv.indexOf("--source");
if (sourceFlag !== -1 && !process.argv[sourceFlag + 1]) throw new Error("--source requires a path");
const adapterContractSource = sourceFlag === -1 ? adapterContractSourceTarget : resolve(process.argv[sourceFlag + 1]);
const adapterContractMembers = [
  "authority-evidence.schema.json", "authority-key-descriptor.schema.json", "authority-receipt-bundle.schema.json", "authority-receipt.schema.json",
  "boundable-task-candidate.schema.json", "certification-cell-activation.schema.json", "certification-endpoint-manifest-v2.schema.json", "certification-endpoint-manifest.schema.json",
  "certification-operator-config-v3.schema.json", "certification-runner-manifest-v2.schema.json", "certification-runner-manifest.schema.json", "certification-scenario-plan.schema.json",
  "certification-test-manifest.schema.json", "compiled-capability.schema.json", "connection-adoption.schema.json", "connection-descriptor.schema.json",
  "connection-inventory.schema.json", "decision-context.schema.json", "delegation-grant.schema.json", "gate-event.schema.json", "golden-vectors.json",
  "observation-envelope.schema.json", "observed-action.schema.json", "outcome-contract.schema.json", "outcome-request.schema.json", "pack-manifest.schema.json",
  "principal.schema.json", "shadow-report.schema.json", "signed-certification-readiness.schema.json", "source-bundle.schema.json",
  "staged-artifact-commitment.schema.json", "transport-effect.schema.json", "trust-event.schema.json",
];

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
const evidenceEventDigest = "sha256:" + createHash("sha256").update(canonicalize({ v: "reelier.authority-evidence-event/internal-v1", reservationId: "reservation_1", state: "reserved", at }), "utf8").digest("hex");
const evidenceDispatchEventDigest = "sha256:" + createHash("sha256").update(canonicalize({ v: "reelier.authority-evidence-event/internal-v1", reservationId: "reservation_1", state: "dispatched", at: "2026-01-01T00:00:01.000Z" }), "utf8").digest("hex");
const authorityEvidence = { v: "reelier.authority-evidence/v1", evidenceId: "evidence_1", receiptId: "receipt_1", decisionContextDigest, gateEventDigest, effectDigest: "sha256:" + "6".repeat(64), reservationId: "reservation_1", timeline: [{ state: "reserved", at, eventDigest: evidenceEventDigest }, { state: "dispatched", at: "2026-01-01T00:00:01.000Z", eventDigest: evidenceDispatchEventDigest }], dispatchedRequestDigest: "sha256:" + "a".repeat(64), providerResponseDigest: "sha256:" + "b".repeat(64), reconciliation: { recipeId: "fixture-reconcile", verdict: "not-attempted", normalizedProjectionDigest: null }, topology: { egress: "unchecked", secretIsolation: "unchecked", ingressAuthentication: "verified", notes: null } };
const authorityEvidenceDigest = "sha256:" + createHash("sha256").update(canonicalize(authorityEvidence), "utf8").digest("hex");
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
  "authority-evidence": authorityEvidence,
  "authority-receipt": { v: "reelier.authority-receipt/v1", receiptId: "receipt_1", gateEventDigest, decisionContextDigest, decisionContext: acceptedDecisionContext, evidenceDigest: authorityEvidenceDigest, priorReceiptDigest: null, claims: { authorization: "verified", sourceCompleteness: "verified", dispatch: "verified", providerAcknowledgment: "unchecked", reconciliation: "absent", topology: "unchecked", completeness: "unchecked" } },
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
const decisionContextSchema = JSON.parse(await readFile(join(contractDirectory, "decision-context.schema.json"), "utf8"));
const receiptSchema = JSON.parse(await readFile(join(contractDirectory, "authority-receipt.schema.json"), "utf8"));
const { $schema: _decisionMetaSchema, $id: _decisionId, ...decisionContextBody } = decisionContextSchema;
if (canonicalize(decisionContextBody) !== canonicalize(receiptSchema?.properties?.decisionContext)) {
  throw new Error("authority schema drift: receipt-embedded DecisionContext must equal the standalone DecisionContext schema");
}
const descriptor = await renderAdapterContractDescriptor(contractDirectory);
const renderedDescriptor = JSON.stringify(descriptor, null, 2) + "\n";
const renderedAdapterContractSource = await renderAdapterContractSource(descriptor);
if (process.argv.includes("--copy-schemas")) {
  await mkdir(new URL("../dist/authority/schemas/", import.meta.url), { recursive: true });
  await cp(contractDirectory, new URL("../dist/authority/schemas/", import.meta.url), { recursive: true });
  process.exit(0);
}
if (process.argv.includes("--check")) {
  if (normalizeText(await readFile(target, "utf8")) !== rendered) throw new Error("authority golden vectors drift; run node scripts/build-authority-contract.mjs");
  if (normalizeText(await readFile(descriptorTarget, "utf8")) !== renderedDescriptor) throw new Error("authority adapter contract drift; run node scripts/build-authority-contract.mjs");
  if (normalizeText(await readFile(adapterContractSource, "utf8")) !== renderedAdapterContractSource) throw new Error("authority adapter contract source drift; run node scripts/build-authority-contract.mjs");
} else await writeFile(target, rendered, "utf8");
if (!process.argv.includes("--check")) {
  await writeFile(descriptorTarget, renderedDescriptor, "utf8");
  await writeFile(adapterContractSource, renderedAdapterContractSource, "utf8");
}

async function renderAdapterContractDescriptor(directory) {
  if (adapterContractMembers.join("\0") !== [...adapterContractMembers].sort().join("\0")) throw new Error("adapter contract members must be sorted");
  if (new Set(adapterContractMembers).size !== adapterContractMembers.length) throw new Error("adapter contract members must be unique");
  if (adapterContractMembers.some(path => path.includes("/") || path.includes("\\") || path === "adapter-contract-v1.json" || path === "." || path === "..")) throw new Error("adapter contract member path is invalid");
  const actualFiles = await readdir(directory, { withFileTypes: true });
  const actualNames = actualFiles.filter(entry => entry.isFile()).map(entry => entry.name).filter(name => name !== "adapter-contract-v1.json").sort();
  if (actualNames.join("\0") !== adapterContractMembers.join("\0")) throw new Error("authority adapter contract membership drift");
  const members = await Promise.all(adapterContractMembers.map(async path => ({
    path,
    digest: `sha256:${createHash("sha256").update(normalizeContractBytes(await readFile(join(directory, path)))).digest("hex")}`,
  })));
  const goldenVectorsDigest = members.find(member => member.path === "golden-vectors.json")?.digest;
  if (!goldenVectorsDigest) throw new Error("authority adapter contract must include golden vectors");
  const unsigned = { v: "reelier.adapter-contract/v1", domain: "reelier.adapter-contract/v1\\0", members, goldenVectorsDigest };
  return { ...unsigned, digest: `sha256:${createHash("sha256").update(canonicalize(unsigned), "utf8").digest("hex")}` };
}

async function renderAdapterContractSource(descriptor) {
  const template = await readFile(adapterContractTemplateTarget, "utf8");
  return normalizeText(template.replace("null as never", JSON.stringify(descriptor, null, 2)));
}

function normalizeText(text) {
  return text.replace(/\r\n/g, "\n");
}

function normalizeContractBytes(bytes) {
  return Buffer.from(normalizeText(bytes.toString("utf8")), "utf8");
}
