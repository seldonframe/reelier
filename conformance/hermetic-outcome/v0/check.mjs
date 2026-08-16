import Ajv2020 from "ajv/dist/2020.js";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildFailureInjectionReport } from "../../failure-injection/v0/check.mjs";

export const ARTIFACT_NAMES = Object.freeze([
  "descriptor.json", "delegation.json", "coverage.json", "dispatch.json", "provider-state.json", "receipt.json", "failure-injection.json", "final-report.json",
]);
const PROPERTY_NAMES = Object.freeze(["descriptor", "delegation", "coverage", "dispatch", "providerState", "receipt", "failureInjection", "finalReport"]);
const AT = "2026-08-16T12:00:00.000Z";
const schema = JSON.parse(readFileSync(fileURLToPath(new URL("./bundle.schema.json", import.meta.url)), "utf8"));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

// RFC 8410 PKCS#8 encoding around a fixed 32-byte fixture seed. This is public test material,
// never a production authority key or credential.
const fixtureSeed = Buffer.from("4f3c2d1e0f102132435465768798a9bacbdcedfe0f1e2d3c4b5a69788796a5b4", "hex");
const fixturePrivateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), fixtureSeed]), format: "der", type: "pkcs8" });
const fixturePublicKey = createPublicKey(fixturePrivateKey);
const publicKey = fixturePublicKey.export({ format: "der", type: "spki" }).toString("base64");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function bytes(value) {
  return Buffer.from(JSON.stringify(canonical(value)), "utf8");
}

function digest(value) {
  const input = Buffer.isBuffer(value) ? value : bytes(value);
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}

function signature(value) {
  return Object.freeze({ alg: "ed25519", sig: sign(null, bytes(value), fixturePrivateKey).toString("base64") });
}

function grant(grantId, parentDigest, grantor, grantee, effects, definitionAliases) {
  return Object.freeze({
    v: "reelier.delegation-grant/v1", tenant: "tenant_fixture", grantId, parentDigest, sponsor: "operator_fixture", grantor, grantee,
    issuedAt: AT, expiresAt: "2026-08-16T12:10:00.000Z",
    constraints: {
      definitionAliases, audiences: ["local_fixture"], connectorAccounts: [{ connectorId: "hermetic", accountId: "fixture" }],
      projectionPointers: ["/value", "/revision"], riskClasses: ["fixture-reversible"],
      limits: { maxEffectsPerWindow: effects, windowSeconds: 600, maxEffectsPerSourceTrigger: effects, maxBodyBytes: effects === 2 ? 2048 : 1024 },
    },
  });
}

function buildDelegation() {
  const parentGrant = grant("grant_parent", null, "operator_fixture", "principal_parent", 2, ["hermetic_state_reset_v1", "hermetic_state_set_v1"]);
  const parentCommitmentDigest = digest(parentGrant);
  const childGrant = grant("grant_child", parentCommitmentDigest, "principal_parent", "principal_child", 1, ["hermetic_state_set_v1"]);
  const childCommitmentDigest = digest(childGrant);
  const signed = { v: "reelier.signed-delegation-commitment/v1", signerId: childGrant.grantor, grantDigest: childCommitmentDigest, grant: childGrant };
  return Object.freeze({
    v: "reelier.hermetic-delegation-evidence/v0", parentGrant, parentCommitmentDigest, childGrant, childCommitmentDigest,
    principal: { v: "reelier.principal/v1", id: "principal_child", kind: "requester" },
    sessionBinding: {
      v: "reelier.authority-cell-session-binding/v1", cellId: "cell_local_fixture", adapterContractDigest: digest("hermetic-adapter-contract"), authorityContractDigest: digest("authority-contract-v1"),
      tenant: "tenant_fixture", principalId: "principal_child", taskId: "task_hermetic_fixture", runtimeSessionId: "session_host_bound", jobId: "job_hermetic_fixture", jobCardDigest: digest("hermetic-job-card"),
      grantId: "grant_child", grantDigest: childCommitmentDigest, allocationId: "allocation_child_1", profileDigest: digest("hermetic-profile"), activationDigest: digest("hermetic-activation"), profileTrustHeadDigest: digest("hermetic-trust-head"),
      expiresAt: "2026-08-16T12:10:00.000Z", bindingObservedAt: AT, bindingFreshUntil: "2026-08-16T12:05:00.000Z", topologyEvidenceDigest: digest("local-authority-host-topology"), topologyFreshUntil: "2026-08-16T12:05:00.000Z",
    },
    signerId: childGrant.grantor, publicKey, signature: signature(signed),
  });
}

function buildCoverage() {
  return Object.freeze({
    v: "reelier.hermetic-coverage-evidence/v0", mode: "discovery-only", status: "failed", passEligibility: false, topology: "unchecked", completeness: "unchecked",
    reasonCodes: ["discovery-is-non-authorizing", "route-enforcement-not-proved", "traffic-completeness-not-proved"],
  });
}

export class LocalProvider {
  constructor(initialState = { resourceId: "fixture_switch", value: "off", revision: 0 }) {
    this.state = structuredClone(initialState);
    this.operations = [];
    this.reservation = null;
    this.completed = new Map();
  }

  read() {
    const state = structuredClone(this.state);
    this.operations.push(Object.freeze({ operation: "read", state }));
    return state;
  }

  reserve(request) {
    if (this.reservation !== null) throw new TypeError("local provider permits exactly one reservation");
    this.reservation = { id: "reservation_fixture_1", idempotencyKey: request.idempotencyKey, state: "reserved", effectsReserved: 1 };
    this.operations.push(Object.freeze({ operation: "reserve", reservationId: this.reservation.id, idempotencyKey: request.idempotencyKey }));
    return this.reservation;
  }

  dispatch(reservation, request) {
    this.assertRequest(reservation, request);
    if (this.completed.has(request.idempotencyKey)) throw new TypeError("duplicate local provider dispatch must use retry");
    this.state = { resourceId: request.resourceId, value: request.value, revision: this.state.revision + 1 };
    const acknowledgment = Object.freeze({ v: "reelier.provider-acknowledgment/v1", status: "acknowledged", providerEventId: "provider_event_1", reservationId: reservation.id });
    this.completed.set(request.idempotencyKey, acknowledgment);
    const attempt = Object.freeze({ attemptId: "attempt_original", reservationId: reservation.id, requestKey: request.idempotencyKey, decision: "dispatched", providerEffectDelta: 1 });
    this.operations.push(Object.freeze({ operation: "dispatch", reservationId: reservation.id, idempotencyKey: request.idempotencyKey, decision: "dispatched", effectDelta: 1 }));
    return { acknowledgment, attempt };
  }

  retry(reservation, request) {
    this.assertRequest(reservation, request);
    if (!this.completed.has(request.idempotencyKey)) throw new TypeError("local provider cannot retry an undispatched request");
    const attempt = Object.freeze({ attemptId: "attempt_retry", reservationId: reservation.id, requestKey: request.idempotencyKey, decision: "duplicate", providerEffectDelta: 0 });
    this.operations.push(Object.freeze({ operation: "retry", reservationId: reservation.id, idempotencyKey: request.idempotencyKey, decision: "duplicate", effectDelta: 0 }));
    return { acknowledgment: this.completed.get(request.idempotencyKey), attempt };
  }

  rollback(preState) {
    if (this.completed.size !== 1) throw new TypeError("local provider rollback requires one completed effect");
    this.state = structuredClone(preState);
    this.reservation.state = "reconciled";
    this.operations.push(Object.freeze({ operation: "rollback", resourceId: preState.resourceId, effectDelta: 1 }));
  }

  assertRequest(reservation, request) {
    if (reservation !== this.reservation || reservation.idempotencyKey !== request.idempotencyKey) throw new TypeError("local provider request does not match its reservation");
  }
}

function buildCore(provider) {
  const delegation = buildDelegation();
  const request = Object.freeze({ v: "reelier.hermetic-provider-request/v0", resourceId: "fixture_switch", value: "on", idempotencyKey: digest("fixture-switch-on") });
  const dispatchedRequestDigest = digest(request);
  const preState = Object.freeze(provider.read());
  const decisionContext = Object.freeze({
    v: "reelier.decision-context/v1", tenant: "tenant_fixture", requester: "principal_child", definitionAlias: "hermetic_state_set_v1", requestId: "request_fixture_1",
    requestDigest: digest(request), requestKey: request.idempotencyKey, contractDigest: digest("hermetic-contract"), capabilityId: "grant_child", capabilityDigest: delegation.childCommitmentDigest,
    outcomeKey: digest("fixture-switch-outcome"), effectDigest: digest({ resourceId: request.resourceId, value: request.value }), snapshots: { sourceBundleDigest: digest(preState), authorityStateDigest: digest(delegation.sessionBinding) },
  });
  const decisionContextDigest = digest(decisionContext);
  const gateEvent = Object.freeze({ v: "reelier.gate-event/v1", eventId: "gate_event_fixture_1", at: AT, verdict: "accepted", reasonCode: "accepted", decisionContextDigest });
  const gateEventDigest = digest(gateEvent);
  const reservation = provider.reserve(request);
  const dispatched = provider.dispatch(reservation, request);
  const postState = Object.freeze(provider.read());
  const retried = provider.retry(reservation, request);
  provider.rollback(preState);
  const restoredState = Object.freeze(provider.read());
  const providerEffectCount = provider.operations.filter((operation) => operation.operation === "dispatch").reduce((total, operation) => total + operation.effectDelta, 0);
  const rollbackEffectCount = provider.operations.filter((operation) => operation.operation === "rollback").reduce((total, operation) => total + operation.effectDelta, 0);
  const postStateUnsigned = {
    v: "reelier.certification-post-state-evidence/v1", requestId: "request_fixture_1", dispatchRequestDigest: dispatchedRequestDigest, permitSnapshotDigest: digest(gateEvent),
    expectedProjectionDigest: digest(postState), preSourceBundleDigest: null, projectionSchemaId: "reelier.hermetic-provider-state-projection/v0", projectionSchemaDigest: digest({ resourceId: "string", value: ["off", "on"], revision: "integer" }),
    preProjectionDigest: digest(preState), observedProjectionDigest: digest(postState), observationMethod: "hermetic-authoritative-read", observedAt: AT, confidence: "exact", signerId: "operator_fixture",
  };
  const postStateEvidence = Object.freeze({ ...postStateUnsigned, signature: signature(postStateUnsigned) });
  const providerState = Object.freeze({ v: "reelier.hermetic-provider-state/v0", preState, postState, restoredState, acknowledgment: dispatched.acknowledgment, postStateEvidence, providerEffectCount, rollbackEffectCount });
  const dispatch = Object.freeze({
    v: "reelier.hermetic-dispatch-evidence/v0", decisionContext, decisionContextDigest, delegationCommitmentDigest: delegation.childCommitmentDigest,
    gateEvent, gateEventDigest, reservation: structuredClone(reservation),
    authorizedRequest: request, dispatchedRequestDigest, providerResponseDigest: digest(dispatched.acknowledgment),
    attempts: [dispatched.attempt, retried.attempt],
  });
  const receipt = Object.freeze({
    v: "reelier.authority-receipt/v1", receiptId: "receipt_fixture_1", gateEventDigest, decisionContextDigest, evidenceDigest: digest(providerState), priorReceiptDigest: null, decisionContext,
    claims: { authorization: "verified", sourceCompleteness: "verified", dispatch: "verified", providerAcknowledgment: "verified", reconciliation: "verified", topology: "unchecked", completeness: "unchecked" },
  });
  return { delegation, coverage: buildCoverage(), dispatch, providerState, receipt };
}

export function buildHermeticOutcomeBundle(provider = new LocalProvider()) {
  const core = buildCore(provider);
  const task6Report = buildFailureInjectionReport();
  const task6Cases = new Map(task6Report.cases.map((item) => [item.caseId, item]));
  const failureInjection = Object.freeze({
    v: "reelier.hermetic-failure-injection/v0", task6Report, task6ReportDigest: digest(task6Report), task6Status: task6Report.status,
    cases: [
      { caseId: "duplicate-retry", task6Disposition: task6Cases.get("duplicate-retry").observedResult.disposition, result: "verified-zero-effect" },
      { caseId: "provider-ack-without-matching-post-state", task6Disposition: task6Cases.get("provider-ack-without-matching-post-state").observedResult.disposition, result: "checker-refuses-mismatch" },
    ],
    nonClaims: ["task6-live-fault-injection-not-proved", "task6-non-passing-results-not-upgraded"],
  });
  const finalReport = Object.freeze({
    v: "reelier.hermetic-outcome-final-report/v0", status: "non-passing", outcomeEvidence: "verified", coverage: "discovery-only",
    receiptDigest: digest(core.receipt), delegationDigest: digest(core.delegation), providerStateDigest: digest(core.providerState), dispatchDigest: digest(core.dispatch),
    coverageDigest: digest(core.coverage), failureInjectionDigest: digest(failureInjection),
    humanExceptions: ["github-live-escalation-requires-operator"],
    nonClaims: ["live-provider-execution-not-proved", "route-enforcement-not-proved", "traffic-completeness-not-proved", "production-safety-not-proved", "content-correctness-not-proved"],
    reasonCodes: ["discovery-only-coverage-is-non-passing"],
  });
  const withoutDescriptor = { ...core, failureInjection, finalReport };
  const commitments = Object.fromEntries(ARTIFACT_NAMES.slice(1).map((name, index) => [name, digest(withoutDescriptor[PROPERTY_NAMES[index + 1]])]));
  const descriptor = Object.freeze({ v: "reelier.hermetic-outcome-descriptor/v0", bundleId: "hermetic-reversible-transition", schemaId: "reelier.hermetic-outcome-bundle/v0", artifactNames: ARTIFACT_NAMES, commitments });
  return structuredClone({ descriptor, ...withoutDescriptor });
}

export function emitHermeticOutcomeBundle(directory) {
  const bundle = buildHermeticOutcomeBundle();
  mkdirSync(directory, { recursive: true });
  for (let index = 0; index < ARTIFACT_NAMES.length; index += 1) writeFileSync(join(directory, ARTIFACT_NAMES[index]), `${JSON.stringify(bundle[PROPERTY_NAMES[index]])}\n`, { encoding: "utf8", flag: "wx" });
  return bundle;
}

export function loadHermeticOutcomeBundle(directory) {
  return Object.fromEntries(ARTIFACT_NAMES.map((name, index) => [PROPERTY_NAMES[index], JSON.parse(readFileSync(join(directory, name), "utf8"))]));
}

function same(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

export function checkHermeticOutcomeBundle(directory) {
  const errors = [];
  let actualNames = [];
  try { actualNames = readdirSync(directory).sort(); } catch { return { valid: false, errors: ["bundle directory is unavailable"] }; }
  for (const name of ARTIFACT_NAMES) if (!actualNames.includes(name)) errors.push(`missing artifact ${name}`);
  for (const name of actualNames) if (!ARTIFACT_NAMES.includes(name)) errors.push(`unexpected artifact ${name}`);
  if (errors.length > 0) return { valid: false, errors };

  let bundle;
  try { bundle = loadHermeticOutcomeBundle(directory); } catch (error) { return { valid: false, errors: [`artifact parse failure: ${error.message}`] }; }
  if (!validateSchema(bundle)) errors.push(`bundle schema invalid: ${validateSchema.errors.map((item) => `${item.instancePath} ${item.message}`).join("; ")}`);

  const signed = { v: "reelier.signed-delegation-commitment/v1", signerId: bundle.delegation?.signerId, grantDigest: bundle.delegation?.childCommitmentDigest, grant: bundle.delegation?.childGrant };
  let signatureValid = false;
  try { signatureValid = verify(null, bytes(signed), createPublicKey({ key: Buffer.from(bundle.delegation.publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(bundle.delegation.signature.sig, "base64")); } catch { signatureValid = false; }
  if (digest(bundle.delegation?.parentGrant) !== bundle.delegation?.parentCommitmentDigest) errors.push("parent commitment digest does not match the actual parent grant");
  if (!signatureValid || digest(bundle.delegation?.childGrant) !== bundle.delegation?.childCommitmentDigest || bundle.delegation?.childGrant?.parentDigest !== bundle.delegation?.parentCommitmentDigest) errors.push("delegation signature or child commitment linkage is invalid");
  if (bundle.delegation?.childGrant?.grantor !== bundle.delegation?.parentGrant?.grantee) errors.push("child grantor does not match the parent grantee");
  if (bundle.delegation?.signerId !== bundle.delegation?.childGrant?.grantor) errors.push("delegation signer does not match the signed child grantor");
  if (bundle.delegation?.childGrant?.tenant !== bundle.delegation?.parentGrant?.tenant) errors.push("child grant tenant does not match the parent grant tenant");
  if (bundle.delegation?.principal?.id !== bundle.delegation?.childGrant?.grantee) errors.push("principal id does not match the child grantee");
  if (bundle.delegation?.principal?.id !== bundle.delegation?.sessionBinding?.principalId) errors.push("principal id does not match the session principal");
  if (bundle.delegation?.sessionBinding?.grantId !== bundle.delegation?.childGrant?.grantId) errors.push("session grant id does not match the signed child grant id");
  if (bundle.delegation?.sessionBinding?.tenant !== bundle.delegation?.childGrant?.tenant) errors.push("session tenant does not match the child grant tenant");
  if (bundle.delegation?.sessionBinding?.grantDigest !== bundle.delegation?.childCommitmentDigest || bundle.delegation?.sessionBinding?.runtimeSessionId !== "session_host_bound" || !bundle.delegation?.sessionBinding?.topologyEvidenceDigest) errors.push("host binding does not link to the child delegation");
  const parentConstraints = bundle.delegation?.parentGrant?.constraints;
  const childConstraints = bundle.delegation?.childGrant?.constraints;
  for (const field of ["maxEffectsPerWindow", "maxEffectsPerSourceTrigger", "maxBodyBytes"]) {
    if (!(childConstraints?.limits?.[field] < parentConstraints?.limits?.[field])) errors.push(`${field} attenuation is invalid`);
  }
  const parentAliases = new Set(parentConstraints?.definitionAliases ?? []);
  const childAliases = childConstraints?.definitionAliases ?? [];
  if (childAliases.length >= parentAliases.size || childAliases.some((alias) => !parentAliases.has(alias))) errors.push("source-trigger allowlist attenuation is invalid");

  if (bundle.receipt?.decisionContext?.capabilityDigest !== bundle.delegation?.childCommitmentDigest || bundle.dispatch?.delegationCommitmentDigest !== bundle.delegation?.childCommitmentDigest) errors.push("receipt capability does not link to delegation commitment");
  if (bundle.dispatch?.decisionContext?.requester !== bundle.delegation?.sessionBinding?.principalId) errors.push("decision requester does not match the authoritative session principal");
  if (bundle.dispatch?.decisionContext?.tenant !== bundle.delegation?.sessionBinding?.tenant) errors.push("decision tenant does not match the authoritative session tenant");
  if (bundle.dispatch?.decisionContext?.capabilityId !== bundle.delegation?.childGrant?.grantId) errors.push("decision capability id does not match the signed child grant id");
  if (digest(bundle.dispatch?.decisionContext) !== bundle.dispatch?.decisionContextDigest || digest(bundle.receipt?.decisionContext) !== bundle.receipt?.decisionContextDigest || bundle.receipt?.decisionContextDigest !== bundle.dispatch?.decisionContextDigest || bundle.dispatch?.gateEvent?.decisionContextDigest !== bundle.dispatch?.decisionContextDigest) errors.push("receipt does not link to the actual dispatch decision context");
  if (digest(bundle.dispatch?.gateEvent) !== bundle.dispatch?.gateEventDigest) errors.push("gate event digest does not match the actual gate event");
  if (bundle.receipt?.gateEventDigest !== bundle.dispatch?.gateEventDigest) errors.push("receipt gate event does not link to the dispatch gate event");
  if (bundle.receipt?.evidenceDigest !== digest(bundle.providerState)) errors.push("receipt evidence does not link to provider state");
  if (bundle.dispatch?.providerResponseDigest !== digest(bundle.providerState?.acknowledgment)) errors.push("provider response digest does not match the acknowledgment");
  if (bundle.providerState?.acknowledgment?.reservationId !== bundle.dispatch?.reservation?.id) errors.push("acknowledgment reservation does not match the dispatch reservation");

  const authorizedRequest = bundle.dispatch?.authorizedRequest;
  if (digest(authorizedRequest) !== bundle.dispatch?.decisionContext?.requestDigest) errors.push("authorized request digest does not match the decision context request digest");
  if (bundle.dispatch?.dispatchedRequestDigest !== bundle.dispatch?.decisionContext?.requestDigest) errors.push("dispatched request digest does not match the authorized decision context request digest");
  if (authorizedRequest?.idempotencyKey !== bundle.dispatch?.decisionContext?.requestKey) errors.push("authorized request idempotency key does not match the decision context request key");
  if (digest({ resourceId: authorizedRequest?.resourceId, value: authorizedRequest?.value }) !== bundle.dispatch?.decisionContext?.effectDigest) errors.push("authorized request effect does not match the decision context effect digest");
  const expectedPostState = { resourceId: authorizedRequest?.resourceId, value: authorizedRequest?.value, revision: bundle.providerState?.preState?.revision + 1 };
  const expectedPostDigest = digest(expectedPostState);
  if (bundle.providerState?.postStateEvidence?.expectedProjectionDigest !== expectedPostDigest) errors.push("expected post-state projection does not match the authorized effect");
  if (bundle.providerState?.postStateEvidence?.observedProjectionDigest !== digest(bundle.providerState?.postState)) errors.push("observed provider post-state projection mismatch");
  if (!same(bundle.providerState?.postState, expectedPostState)) errors.push("provider post-state does not match the authorized effect");
  if (bundle.providerState?.postStateEvidence?.preProjectionDigest !== digest(bundle.providerState?.preState)) errors.push("provider pre-state projection mismatch");
  if (bundle.providerState?.postStateEvidence?.requestId !== bundle.dispatch?.decisionContext?.requestId) errors.push("post-state request id does not match the decision context request id");
  if (bundle.providerState?.postStateEvidence?.dispatchRequestDigest !== bundle.dispatch?.dispatchedRequestDigest) errors.push("post-state dispatch request digest does not match dispatch evidence");
  if (bundle.providerState?.postStateEvidence?.permitSnapshotDigest !== bundle.dispatch?.gateEventDigest) errors.push("post-state permit snapshot digest does not match the gate event");
  if (bundle.providerState?.postState?.resourceId !== bundle.providerState?.preState?.resourceId || bundle.providerState?.postState?.revision !== bundle.providerState?.preState?.revision + 1) errors.push("provider post-state transition is not exact");
  const { signature: postSignature, ...postStateUnsigned } = bundle.providerState?.postStateEvidence ?? {};
  let postSignatureValid = false;
  try { postSignatureValid = verify(null, bytes(postStateUnsigned), createPublicKey({ key: Buffer.from(bundle.delegation.publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(postSignature.sig, "base64")); } catch { postSignatureValid = false; }
  if (!postSignatureValid) errors.push("post-state verifier signature is invalid");
  if (!same(bundle.providerState?.restoredState, bundle.providerState?.preState)) errors.push("reversible transition did not restore pre-state");
  const attempts = bundle.dispatch?.attempts ?? [];
  if (attempts.length !== 2 || attempts[0]?.reservationId !== attempts[1]?.reservationId || attempts[1]?.decision !== "duplicate" || attempts[1]?.providerEffectDelta !== 0 || bundle.providerState?.providerEffectCount !== 1) errors.push("duplicate retry produced or could hide a duplicate effect");
  if (attempts.some((attempt) => attempt?.reservationId !== bundle.dispatch?.reservation?.id)) errors.push("dispatch attempt reservation id does not match the actual reservation id");
  if (attempts.some((attempt) => attempt?.requestKey !== bundle.dispatch?.reservation?.idempotencyKey || attempt?.requestKey !== bundle.dispatch?.decisionContext?.requestKey)) errors.push("dispatch attempt request key does not match the reservation idempotency key and decision context request key");
  if (bundle.dispatch?.reservation?.idempotencyKey !== bundle.dispatch?.decisionContext?.requestKey) errors.push("reservation idempotency key does not match the decision context request key");

  if (bundle.coverage?.mode !== "discovery-only" || bundle.coverage?.status !== "failed" || bundle.coverage?.passEligibility !== false || bundle.coverage?.topology !== "unchecked" || bundle.coverage?.completeness !== "unchecked") errors.push("coverage must remain discovery-only and non-passing");
  for (const name of ARTIFACT_NAMES.slice(1)) {
    const index = ARTIFACT_NAMES.indexOf(name);
    if (bundle.descriptor?.commitments?.[name] !== digest(bundle[PROPERTY_NAMES[index]])) errors.push(`descriptor commitment mismatch for ${name}`);
  }
  const executableTask6Report = buildFailureInjectionReport();
  if (!same(bundle.failureInjection?.task6Report, executableTask6Report) || bundle.failureInjection?.task6ReportDigest !== digest(executableTask6Report)) errors.push("Task 6 executable closed report drift is invalid");
  for (const [field, property, label] of [
    ["receiptDigest", "receipt", "receipt"], ["delegationDigest", "delegation", "delegation"], ["providerStateDigest", "providerState", "provider-state"],
    ["dispatchDigest", "dispatch", "dispatch"], ["coverageDigest", "coverage", "coverage"], ["failureInjectionDigest", "failureInjection", "failure-injection"],
  ]) {
    if (bundle.finalReport?.[field] !== digest(bundle[property])) errors.push(`final report ${label} digest does not match the actual artifact`);
  }
  return { valid: errors.length === 0, errors };
}

function main() {
  const [command, target] = process.argv.slice(2);
  if (!target || !["--emit", "--check"].includes(command)) {
    process.stderr.write("usage: node check.mjs --emit <directory> | --check <directory>\n");
    process.exitCode = 2;
    return;
  }
  if (command === "--emit") emitHermeticOutcomeBundle(resolve(target));
  const result = checkHermeticOutcomeBundle(resolve(target));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.valid) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
