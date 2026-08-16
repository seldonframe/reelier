import Ajv2020 from "ajv/dist/2020.js";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ARTIFACT_NAMES = Object.freeze([
  "descriptor.json", "delegation.json", "coverage.json", "dispatch.json", "provider-state.json", "receipt.json", "failure-injection.json", "final-report.json",
]);
const PROPERTY_NAMES = Object.freeze(["descriptor", "delegation", "coverage", "dispatch", "providerState", "receipt", "failureInjection", "finalReport"]);
const TASK6_REPORT = ".superpowers/sdd/task-6-failure-injection-report.md";
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

function grant(grantId, parentDigest, grantor, grantee, effects) {
  return Object.freeze({
    v: "reelier.delegation-grant/v1", tenant: "tenant_fixture", grantId, parentDigest, sponsor: "operator_fixture", grantor, grantee,
    issuedAt: AT, expiresAt: "2026-08-16T12:10:00.000Z",
    constraints: {
      definitionAliases: ["hermetic_state_set_v1"], audiences: ["local_fixture"], connectorAccounts: [{ connectorId: "hermetic", accountId: "fixture" }],
      projectionPointers: ["/value", "/revision"], riskClasses: ["fixture-reversible"],
      limits: { maxEffectsPerWindow: effects, windowSeconds: 600, maxEffectsPerSourceTrigger: effects, maxBodyBytes: effects === 2 ? 2048 : 1024 },
    },
  });
}

function buildDelegation() {
  const parentGrant = grant("grant_parent", null, "operator_fixture", "principal_parent", 2);
  const parentCommitmentDigest = digest(parentGrant);
  const childGrant = grant("grant_child", parentCommitmentDigest, "principal_parent", "principal_child", 1);
  const childCommitmentDigest = digest(childGrant);
  const signed = { v: "reelier.signed-delegation-commitment/v1", signerId: "operator_fixture", grantDigest: childCommitmentDigest, grant: childGrant };
  return Object.freeze({
    v: "reelier.hermetic-delegation-evidence/v0", parentGrant, parentCommitmentDigest, childGrant, childCommitmentDigest,
    principal: { v: "reelier.principal/v1", id: "principal_child", kind: "requester" },
    sessionBinding: {
      v: "reelier.authority-cell-session-binding/v1", cellId: "cell_local_fixture", adapterContractDigest: digest("hermetic-adapter-contract"), authorityContractDigest: digest("authority-contract-v1"),
      tenant: "tenant_fixture", principalId: "principal_child", taskId: "task_hermetic_fixture", runtimeSessionId: "session_host_bound", jobId: "job_hermetic_fixture", jobCardDigest: digest("hermetic-job-card"),
      grantId: "grant_child", grantDigest: childCommitmentDigest, allocationId: "allocation_child_1", profileDigest: digest("hermetic-profile"), activationDigest: digest("hermetic-activation"), profileTrustHeadDigest: digest("hermetic-trust-head"),
      expiresAt: "2026-08-16T12:10:00.000Z", bindingObservedAt: AT, bindingFreshUntil: "2026-08-16T12:05:00.000Z", topologyEvidenceDigest: digest("local-authority-host-topology"), topologyFreshUntil: "2026-08-16T12:05:00.000Z",
    },
    signerId: "operator_fixture", publicKey, signature: signature(signed),
  });
}

function buildCoverage() {
  return Object.freeze({
    v: "reelier.hermetic-coverage-evidence/v0", mode: "discovery-only", status: "failed", passEligibility: false, topology: "unchecked", completeness: "unchecked",
    reasonCodes: ["discovery-is-non-authorizing", "route-enforcement-not-proved", "traffic-completeness-not-proved"],
  });
}

function buildCore() {
  const delegation = buildDelegation();
  const request = { v: "reelier.hermetic-provider-request/v0", resourceId: "fixture_switch", value: "on", idempotencyKey: digest("fixture-switch-on") };
  const dispatchedRequestDigest = digest(request);
  const preState = Object.freeze({ resourceId: "fixture_switch", value: "off", revision: 0 });
  const postState = Object.freeze({ resourceId: "fixture_switch", value: "on", revision: 1 });
  const acknowledgment = Object.freeze({ v: "reelier.provider-acknowledgment/v1", status: "acknowledged", providerEventId: "provider_event_1", reservationId: "reservation_fixture_1" });
  const decisionContext = Object.freeze({
    v: "reelier.decision-context/v1", tenant: "tenant_fixture", requester: "principal_child", definitionAlias: "hermetic_state_set_v1", requestId: "request_fixture_1",
    requestDigest: digest(request), requestKey: request.idempotencyKey, contractDigest: digest("hermetic-contract"), capabilityId: "grant_child", capabilityDigest: delegation.childCommitmentDigest,
    outcomeKey: digest("fixture-switch-outcome"), effectDigest: digest({ resourceId: request.resourceId, value: request.value }), snapshots: { sourceBundleDigest: digest(preState), authorityStateDigest: digest(delegation.sessionBinding) },
  });
  const decisionContextDigest = digest(decisionContext);
  const gateEvent = Object.freeze({ v: "reelier.gate-event/v1", eventId: "gate_event_fixture_1", at: AT, verdict: "accepted", reasonCode: "accepted", decisionContextDigest });
  const gateEventDigest = digest(gateEvent);
  const postStateUnsigned = {
    v: "reelier.certification-post-state-evidence/v1", requestId: "request_fixture_1", dispatchRequestDigest: dispatchedRequestDigest, permitSnapshotDigest: digest(gateEvent),
    expectedProjectionDigest: digest(postState), preSourceBundleDigest: null, projectionSchemaId: "reelier.hermetic-provider-state-projection/v0", projectionSchemaDigest: digest({ resourceId: "string", value: ["off", "on"], revision: "integer" }),
    preProjectionDigest: digest(preState), observedProjectionDigest: digest(postState), observationMethod: "hermetic-authoritative-read", observedAt: AT, confidence: "exact", signerId: "operator_fixture",
  };
  const postStateEvidence = Object.freeze({ ...postStateUnsigned, signature: signature(postStateUnsigned) });
  const providerState = Object.freeze({ v: "reelier.hermetic-provider-state/v0", preState, postState, restoredState: preState, acknowledgment, postStateEvidence, providerEffectCount: 1, rollbackEffectCount: 1 });
  const dispatch = Object.freeze({
    v: "reelier.hermetic-dispatch-evidence/v0", decisionContext, decisionContextDigest, delegationCommitmentDigest: delegation.childCommitmentDigest,
    gateEvent, gateEventDigest, reservation: { reservationId: "reservation_fixture_1", idempotencyKey: request.idempotencyKey, state: "reconciled", effectsReserved: 1 },
    dispatchedRequestDigest, providerResponseDigest: digest(acknowledgment),
    attempts: [
      { attemptId: "attempt_original", reservationId: "reservation_fixture_1", decision: "dispatched", providerEffectDelta: 1 },
      { attemptId: "attempt_retry", reservationId: "reservation_fixture_1", decision: "duplicate", providerEffectDelta: 0 },
    ],
  });
  const receipt = Object.freeze({
    v: "reelier.authority-receipt/v1", receiptId: "receipt_fixture_1", gateEventDigest, decisionContextDigest, evidenceDigest: digest(providerState), priorReceiptDigest: null, decisionContext,
    claims: { authorization: "verified", sourceCompleteness: "verified", dispatch: "verified", providerAcknowledgment: "verified", reconciliation: "verified", topology: "unchecked", completeness: "unchecked" },
  });
  return { delegation, coverage: buildCoverage(), dispatch, providerState, receipt };
}

function task6Digest() {
  return digest(readFileSync(resolve(TASK6_REPORT)));
}

export function buildHermeticOutcomeBundle() {
  const core = buildCore();
  const failureInjection = Object.freeze({
    v: "reelier.hermetic-failure-injection/v0", task6Report: TASK6_REPORT, task6ReportDigest: task6Digest(), task6Status: "failed",
    cases: [
      { caseId: "duplicate-retry", task6Disposition: "reconciliation-required", result: "verified-zero-effect" },
      { caseId: "provider-ack-without-matching-post-state", task6Disposition: "reconciliation-required", result: "checker-refuses-mismatch" },
    ],
    nonClaims: ["task6-live-fault-injection-not-proved", "task6-non-passing-results-not-upgraded"],
  });
  const finalReport = Object.freeze({
    v: "reelier.hermetic-outcome-final-report/v0", status: "non-passing", outcomeEvidence: "verified", coverage: "discovery-only",
    receiptDigest: digest(core.receipt), delegationDigest: digest(core.delegation), providerStateDigest: digest(core.providerState),
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

  const expected = buildHermeticOutcomeBundle();
  const signed = { v: "reelier.signed-delegation-commitment/v1", signerId: bundle.delegation?.signerId, grantDigest: bundle.delegation?.childCommitmentDigest, grant: bundle.delegation?.childGrant };
  let signatureValid = false;
  try { signatureValid = verify(null, bytes(signed), createPublicKey({ key: Buffer.from(bundle.delegation.publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(bundle.delegation.signature.sig, "base64")); } catch { signatureValid = false; }
  if (!signatureValid || digest(bundle.delegation.childGrant) !== bundle.delegation.childCommitmentDigest || bundle.delegation.childGrant.parentDigest !== bundle.delegation.parentCommitmentDigest) errors.push("delegation signature or commitment linkage is invalid");
  if (bundle.delegation?.sessionBinding?.principalId !== bundle.delegation?.childGrant?.grantee || bundle.delegation?.sessionBinding?.grantDigest !== bundle.delegation?.childCommitmentDigest || bundle.delegation?.sessionBinding?.runtimeSessionId !== "session_host_bound" || !bundle.delegation?.sessionBinding?.topologyEvidenceDigest) errors.push("host-bound principal does not link to the child delegation");
  if (!(bundle.delegation?.childGrant?.constraints?.limits?.maxEffectsPerWindow < bundle.delegation?.parentGrant?.constraints?.limits?.maxEffectsPerWindow)) errors.push("child delegation budget is not attenuated");

  if (bundle.receipt?.decisionContext?.capabilityDigest !== bundle.delegation?.childCommitmentDigest || bundle.dispatch?.delegationCommitmentDigest !== bundle.delegation?.childCommitmentDigest) errors.push("receipt capability does not link to delegation commitment");
  if (digest(bundle.dispatch?.decisionContext) !== bundle.dispatch?.decisionContextDigest || bundle.receipt?.decisionContextDigest !== bundle.dispatch?.decisionContextDigest || bundle.receipt?.gateEventDigest !== bundle.dispatch?.gateEventDigest) errors.push("receipt does not link to the dispatch decision");
  if (bundle.receipt?.evidenceDigest !== digest(bundle.providerState)) errors.push("receipt evidence does not link to provider state");

  const expectedPostDigest = digest(bundle.providerState?.postState);
  if (bundle.providerState?.postStateEvidence?.expectedProjectionDigest !== expectedPostDigest || bundle.providerState?.postStateEvidence?.observedProjectionDigest !== expectedPostDigest || !same(bundle.providerState?.postState, expected.providerState.postState)) errors.push("provider post-state projection mismatch");
  const { signature: postSignature, ...postStateUnsigned } = bundle.providerState?.postStateEvidence ?? {};
  let postSignatureValid = false;
  try { postSignatureValid = verify(null, bytes(postStateUnsigned), createPublicKey({ key: Buffer.from(bundle.delegation.publicKey, "base64"), format: "der", type: "spki" }), Buffer.from(postSignature.sig, "base64")); } catch { postSignatureValid = false; }
  if (!postSignatureValid) errors.push("post-state verifier signature is invalid");
  if (!same(bundle.providerState?.restoredState, bundle.providerState?.preState)) errors.push("reversible transition did not restore pre-state");
  const attempts = bundle.dispatch?.attempts ?? [];
  if (attempts.length !== 2 || attempts[0]?.reservationId !== attempts[1]?.reservationId || attempts[1]?.decision !== "duplicate" || attempts[1]?.providerEffectDelta !== 0 || bundle.providerState?.providerEffectCount !== 1) errors.push("duplicate retry produced or could hide a duplicate effect");

  if (!same(bundle.coverage, expected.coverage)) errors.push("coverage must remain discovery-only and non-passing");
  for (const name of ARTIFACT_NAMES.slice(1)) {
    const index = ARTIFACT_NAMES.indexOf(name);
    if (bundle.descriptor?.commitments?.[name] !== digest(bundle[PROPERTY_NAMES[index]])) errors.push(`descriptor commitment mismatch for ${name}`);
  }
  if (bundle.failureInjection?.task6ReportDigest !== task6Digest()) errors.push("Task 6 failure-injection report linkage is invalid");
  if (!same(bundle.finalReport, expected.finalReport)) errors.push("final report claims or evidence linkage are invalid");
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
