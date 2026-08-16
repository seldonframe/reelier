import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const checker = await import(pathToFileURL(resolve("conformance/hermetic-outcome/v0/check.mjs")).href);
const failureInjectionChecker = await import(pathToFileURL(resolve("conformance/failure-injection/v0/check.mjs")).href);
const schema = JSON.parse(readFileSync(resolve("conformance/hermetic-outcome/v0/bundle.schema.json"), "utf8"));
const Ajv2020 = createRequire(import.meta.url)("ajv/dist/2020").default;
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const validateGrant = new Ajv2020({ allErrors: true, strict: true, validateFormats: false }).compile(JSON.parse(readFileSync(resolve("contract/authority/v1/delegation-grant.schema.json"), "utf8")));
const validatePrincipal = new Ajv2020({ allErrors: true, strict: true }).compile(JSON.parse(readFileSync(resolve("contract/authority/v1/principal.schema.json"), "utf8")));
const validateSessionBinding = new Ajv2020({ allErrors: true, strict: true }).compile(JSON.parse(readFileSync(resolve("contract/bootstrap/v1/authority-cell-session-binding.schema.json"), "utf8")));

const expectedArtifacts = [
  "descriptor.json",
  "delegation.json",
  "coverage.json",
  "dispatch.json",
  "provider-state.json",
  "receipt.json",
  "failure-injection.json",
  "final-report.json",
] as const;

function temporaryBundle() {
  const directory = mkdtempSync(join(tmpdir(), "reelier-hermetic-outcome-"));
  checker.emitHermeticOutcomeBundle(directory);
  return directory;
}

function readArtifact(directory: string, name: string) {
  return JSON.parse(readFileSync(join(directory, name), "utf8"));
}

function writeArtifact(directory: string, name: string, value: unknown) {
  writeFileSync(join(directory, name), `${JSON.stringify(value)}\n`, "utf8");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}

function artifactDigest(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value)), "utf8").digest("hex")}`;
}

test("emits a deterministic closed reversible bundle using existing authority semantics", () => {
  const left = temporaryBundle();
  const right = temporaryBundle();
  try {
    assert.deepEqual(checker.ARTIFACT_NAMES, expectedArtifacts);
    const loaded = checker.loadHermeticOutcomeBundle(left);
    assert.equal(validateSchema(loaded), true, JSON.stringify(validateSchema.errors));
    assert.deepEqual(checker.checkHermeticOutcomeBundle(left), { valid: true, errors: [] });
    for (const name of expectedArtifacts) {
      assert.equal(readFileSync(join(left, name), "utf8"), readFileSync(join(right, name), "utf8"), name);
    }

    const delegation = loaded.delegation;
    assert.equal(delegation.parentGrant.v, "reelier.delegation-grant/v1");
    assert.equal(delegation.childGrant.v, "reelier.delegation-grant/v1");
    assert.equal(delegation.principal.v, "reelier.principal/v1");
    assert.equal(delegation.sessionBinding.v, "reelier.authority-cell-session-binding/v1");
    assert.equal(delegation.sessionBinding.principalId, delegation.childGrant.grantee);
    assert.equal(delegation.sessionBinding.grantId, delegation.childGrant.grantId);
    assert.equal(delegation.childGrant.grantor, delegation.parentGrant.grantee);
    assert.equal(delegation.signerId, delegation.childGrant.grantor);
    assert.equal(delegation.principal.id, delegation.childGrant.grantee);
    assert.equal(delegation.childGrant.parentDigest, delegation.parentCommitmentDigest);
    assert.equal(delegation.parentCommitmentDigest, artifactDigest(delegation.parentGrant));
    assert.ok(delegation.childGrant.constraints.limits.maxEffectsPerWindow < delegation.parentGrant.constraints.limits.maxEffectsPerWindow);
    assert.ok(delegation.childGrant.constraints.limits.maxEffectsPerSourceTrigger < delegation.parentGrant.constraints.limits.maxEffectsPerSourceTrigger);
    assert.ok(delegation.childGrant.constraints.limits.maxBodyBytes < delegation.parentGrant.constraints.limits.maxBodyBytes);
    assert.deepEqual(delegation.parentGrant.constraints.definitionAliases, ["hermetic_state_reset_v1", "hermetic_state_set_v1"]);
    assert.deepEqual(delegation.childGrant.constraints.definitionAliases, ["hermetic_state_set_v1"]);
    assert.equal(delegation.signature.alg, "ed25519");

    assert.equal(loaded.dispatch.gateEvent.v, "reelier.gate-event/v1");
    assert.equal(loaded.dispatch.gateEvent.verdict, "accepted");
    assert.equal(loaded.dispatch.reservation.state, "reconciled");
    assert.deepEqual(loaded.dispatch.attempts.map((attempt: any) => attempt.reservationId), [loaded.dispatch.reservation.id, loaded.dispatch.reservation.id]);
    assert.equal(loaded.dispatch.reservation.idempotencyKey, loaded.dispatch.decisionContext.requestKey);
    assert.deepEqual(loaded.dispatch.attempts.map((attempt: any) => attempt.requestKey), [loaded.dispatch.decisionContext.requestKey, loaded.dispatch.decisionContext.requestKey]);
    assert.equal(loaded.dispatch.dispatchedRequestDigest, loaded.dispatch.decisionContext.requestDigest);
    assert.equal(artifactDigest(loaded.dispatch.authorizedRequest), loaded.dispatch.decisionContext.requestDigest);
    assert.equal(loaded.providerState.acknowledgment.status, "acknowledged");
    assert.equal(loaded.providerState.postStateEvidence.confidence, "exact");
    assert.match(loaded.providerState.postStateEvidence.permitSnapshotDigest, /^sha256:[0-9a-f]{64}$/);
    assert.match(loaded.providerState.postStateEvidence.projectionSchemaDigest, /^sha256:[0-9a-f]{64}$/);
    assert.match(loaded.providerState.postStateEvidence.preProjectionDigest, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(loaded.providerState.restoredState, loaded.providerState.preState);
    assert.equal(loaded.receipt.v, "reelier.authority-receipt/v1");
    assert.equal(loaded.finalReport.status, "non-passing");
    assert.equal(loaded.finalReport.outcomeEvidence, "verified");
    assert.equal(loaded.finalReport.receiptDigest, artifactDigest(loaded.receipt));
    assert.equal(loaded.finalReport.delegationDigest, artifactDigest(loaded.delegation));
    assert.equal(loaded.finalReport.providerStateDigest, artifactDigest(loaded.providerState));
    assert.equal(loaded.finalReport.dispatchDigest, artifactDigest(loaded.dispatch));
    assert.equal(loaded.finalReport.coverageDigest, artifactDigest(loaded.coverage));
    assert.equal(loaded.finalReport.failureInjectionDigest, artifactDigest(loaded.failureInjection));
    assert.ok(loaded.finalReport.humanExceptions.includes("github-live-escalation-requires-operator"));
    assert.ok(loaded.finalReport.nonClaims.includes("production-safety-not-proved"));
  } finally {
    rmSync(left, { recursive: true, force: true });
    rmSync(right, { recursive: true, force: true });
  }
});

test("duplicate retry reuses the reservation and causes no duplicate provider effect", () => {
  const directory = temporaryBundle();
  try {
    const bundle = checker.loadHermeticOutcomeBundle(directory);
    assert.equal(bundle.dispatch.attempts.length, 2);
    assert.deepEqual(bundle.dispatch.attempts.map((attempt: any) => attempt.reservationId), [bundle.dispatch.reservation.id, bundle.dispatch.reservation.id]);
    assert.deepEqual(bundle.dispatch.attempts.map((attempt: any) => attempt.decision), ["dispatched", "duplicate"]);
    assert.equal(bundle.dispatch.attempts[1].providerEffectDelta, 0);
    assert.equal(bundle.providerState.providerEffectCount, 1);
    assert.equal(bundle.failureInjection.cases.find((item: any) => item.caseId === "duplicate-retry").result, "verified-zero-effect");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("builds provider artifacts from real local execution, readback, retry, and rollback operations", () => {
  const provider = new checker.LocalProvider();
  const bundle = checker.buildHermeticOutcomeBundle(provider);

  assert.deepEqual(provider.operations, [
    { operation: "read", state: { resourceId: "fixture_switch", value: "off", revision: 0 } },
    { operation: "reserve", reservationId: "reservation_fixture_1", idempotencyKey: bundle.dispatch.decisionContext.requestKey },
    { operation: "dispatch", reservationId: "reservation_fixture_1", idempotencyKey: bundle.dispatch.decisionContext.requestKey, decision: "dispatched", effectDelta: 1 },
    { operation: "read", state: { resourceId: "fixture_switch", value: "on", revision: 1 } },
    { operation: "retry", reservationId: "reservation_fixture_1", idempotencyKey: bundle.dispatch.decisionContext.requestKey, decision: "duplicate", effectDelta: 0 },
    { operation: "rollback", resourceId: "fixture_switch", effectDelta: 1 },
    { operation: "read", state: { resourceId: "fixture_switch", value: "off", revision: 0 } },
  ]);
  assert.deepEqual(bundle.providerState.preState, provider.operations[0].state);
  assert.deepEqual(bundle.providerState.postState, provider.operations[3].state);
  assert.deepEqual(bundle.providerState.restoredState, provider.operations[6].state);
  assert.equal(bundle.providerState.providerEffectCount, provider.operations.filter((item: any) => item.operation === "dispatch").reduce((total: number, item: any) => total + item.effectDelta, 0));
  assert.equal(bundle.providerState.rollbackEffectCount, provider.operations.filter((item: any) => item.operation === "rollback").reduce((total: number, item: any) => total + item.effectDelta, 0));
});

test("binds failure injection to the executable Task 6 closed report and rejects semantic drift", () => {
  const directory = temporaryBundle();
  try {
    const failureInjection = readArtifact(directory, "failure-injection.json");
    const task6Report = failureInjectionChecker.buildFailureInjectionReport();
    assert.deepEqual(failureInjection.task6Report, task6Report);
    assert.equal(failureInjection.task6ReportDigest, artifactDigest(task6Report));

    failureInjection.task6Report.cases[0].reasonCodes = ["job-not-discovered"];
    failureInjection.task6ReportDigest = artifactDigest(failureInjection.task6Report);
    writeArtifact(directory, "failure-injection.json", failureInjection);

    const finalReport = readArtifact(directory, "final-report.json");
    finalReport.failureInjectionDigest = artifactDigest(failureInjection);
    writeArtifact(directory, "final-report.json", finalReport);

    const descriptor = readArtifact(directory, "descriptor.json");
    descriptor.commitments["failure-injection.json"] = artifactDigest(failureInjection);
    descriptor.commitments["final-report.json"] = artifactDigest(finalReport);
    writeArtifact(directory, "descriptor.json", descriptor);

    const result = checker.checkHermeticOutcomeBundle(directory);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error: string) => /Task 6.*closed report.*drift|Task 6.*executable report/i.test(error)), result.errors.join("\n"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("delegation and host binding remain valid existing Reelier authority artifacts", () => {
  const directory = temporaryBundle();
  try {
    const { delegation } = checker.loadHermeticOutcomeBundle(directory);
    assert.equal(validateGrant(delegation.parentGrant), true, JSON.stringify(validateGrant.errors));
    assert.equal(validateGrant(delegation.childGrant), true, JSON.stringify(validateGrant.errors));
    assert.equal(validatePrincipal(delegation.principal), true, JSON.stringify(validatePrincipal.errors));
    assert.equal(validateSessionBinding(delegation.sessionBinding), true, JSON.stringify(validateSessionBinding.errors));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects wrong receipt to delegation linkage", () => {
  const directory = temporaryBundle();
  try {
    const receipt = readArtifact(directory, "receipt.json");
    receipt.decisionContext.capabilityDigest = `sha256:${"f".repeat(64)}`;
    writeArtifact(directory, "receipt.json", receipt);
    const result = checker.checkHermeticOutcomeBundle(directory);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error: string) => /receipt.*delegation|capability.*link/i.test(error)), result.errors.join("\n"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects a provider post-state mismatch even when acknowledgment remains present", () => {
  const directory = temporaryBundle();
  try {
    const provider = readArtifact(directory, "provider-state.json");
    provider.postState.value = "unexpected";
    writeArtifact(directory, "provider-state.json", provider);
    const result = checker.checkHermeticOutcomeBundle(directory);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error: string) => /post-state|projection/i.test(error)), result.errors.join("\n"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects an invalid exact post-state verifier signature", () => {
  const directory = temporaryBundle();
  try {
    const provider = readArtifact(directory, "provider-state.json");
    provider.postStateEvidence.signature.sig = `${"A".repeat(86)}==`;
    writeArtifact(directory, "provider-state.json", provider);
    const result = checker.checkHermeticOutcomeBundle(directory);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error: string) => /post-state.*signature|verifier.*signature/i.test(error)), result.errors.join("\n"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects every tampered artifact join with a relationship-specific error", async (t) => {
  const wrongDigest = `sha256:${"f".repeat(64)}`;
  const cases: Array<{
    name: string;
    artifact: string;
    mutate: (value: any) => void;
    error: RegExp;
  }> = [
    { name: "final report receipt digest", artifact: "final-report.json", mutate: (value) => { value.receiptDigest = wrongDigest; }, error: /final report receipt digest/i },
    { name: "final report delegation digest", artifact: "final-report.json", mutate: (value) => { value.delegationDigest = wrongDigest; }, error: /final report delegation digest/i },
    { name: "final report provider-state digest", artifact: "final-report.json", mutate: (value) => { value.providerStateDigest = wrongDigest; }, error: /final report provider-state digest/i },
    { name: "final report dispatch digest", artifact: "final-report.json", mutate: (value) => { value.dispatchDigest = wrongDigest; }, error: /final report dispatch digest/i },
    { name: "final report coverage digest", artifact: "final-report.json", mutate: (value) => { value.coverageDigest = wrongDigest; }, error: /final report coverage digest/i },
    { name: "final report failure-injection digest", artifact: "final-report.json", mutate: (value) => { value.failureInjectionDigest = wrongDigest; }, error: /final report failure-injection digest/i },
    { name: "gate-event digest", artifact: "dispatch.json", mutate: (value) => { value.gateEvent.eventId = "gate_event_tampered"; }, error: /gate event digest/i },
    { name: "provider response acknowledgment digest", artifact: "provider-state.json", mutate: (value) => { value.acknowledgment.providerEventId = "provider_event_tampered"; }, error: /provider response digest.*acknowledgment/i },
    { name: "acknowledgment reservation", artifact: "provider-state.json", mutate: (value) => { value.acknowledgment.reservationId = "reservation_tampered"; }, error: /acknowledgment reservation.*dispatch reservation/i },
    { name: "post-state dispatch digest", artifact: "provider-state.json", mutate: (value) => { value.postStateEvidence.dispatchRequestDigest = wrongDigest; }, error: /post-state dispatch request digest/i },
    { name: "post-state permit digest", artifact: "provider-state.json", mutate: (value) => { value.postStateEvidence.permitSnapshotDigest = wrongDigest; }, error: /post-state permit snapshot digest/i },
    { name: "parent grant commitment", artifact: "delegation.json", mutate: (value) => { value.parentGrant.grantee = "principal_tampered"; }, error: /parent commitment digest/i },
    { name: "parent to child principal", artifact: "delegation.json", mutate: (value) => { value.childGrant.grantor = "principal_tampered"; }, error: /child grantor.*parent grantee/i },
    { name: "signed child grantor identity", artifact: "delegation.json", mutate: (value) => { value.signerId = "principal_tampered"; }, error: /delegation signer.*child grantor/i },
    { name: "principal to child binding", artifact: "delegation.json", mutate: (value) => { value.principal.id = "principal_tampered"; }, error: /principal id.*child grantee/i },
    { name: "principal to session binding", artifact: "delegation.json", mutate: (value) => { value.sessionBinding.principalId = "principal_tampered"; }, error: /principal id.*session principal/i },
    { name: "session to signed child grant id", artifact: "delegation.json", mutate: (value) => { value.sessionBinding.grantId = "grant_tampered"; }, error: /session grant id.*child grant id/i },
    { name: "session tenant to child grant", artifact: "delegation.json", mutate: (value) => { value.sessionBinding.tenant = "tenant_tampered"; }, error: /session tenant.*child grant tenant/i },
    { name: "decision requester to session principal", artifact: "dispatch.json", mutate: (value) => { value.decisionContext.requester = "principal_tampered"; }, error: /decision requester.*session principal/i },
    { name: "decision capability id to child grant", artifact: "dispatch.json", mutate: (value) => { value.decisionContext.capabilityId = "grant_tampered"; }, error: /decision capability id.*child grant id/i },
    { name: "max effects per window attenuation", artifact: "delegation.json", mutate: (value) => { value.childGrant.constraints.limits.maxEffectsPerWindow = 3; }, error: /maxEffectsPerWindow attenuation/i },
    { name: "max effects per source trigger attenuation", artifact: "delegation.json", mutate: (value) => { value.childGrant.constraints.limits.maxEffectsPerSourceTrigger = 3; }, error: /maxEffectsPerSourceTrigger attenuation/i },
    { name: "source-trigger allowlist attenuation", artifact: "delegation.json", mutate: (value) => { value.childGrant.constraints.definitionAliases.push("unapproved_source_trigger_v1"); }, error: /source-trigger allowlist attenuation/i },
    { name: "max body bytes attenuation", artifact: "delegation.json", mutate: (value) => { value.childGrant.constraints.limits.maxBodyBytes = 4096; }, error: /maxBodyBytes attenuation/i },
    { name: "original attempt request key", artifact: "dispatch.json", mutate: (value) => { value.attempts[0].requestKey = wrongDigest; }, error: /dispatch attempt request key.*decision context/i },
    { name: "retry attempt request key", artifact: "dispatch.json", mutate: (value) => { value.attempts[1].requestKey = wrongDigest; }, error: /dispatch attempt request key.*decision context/i },
    { name: "reservation idempotency key", artifact: "dispatch.json", mutate: (value) => { value.reservation.idempotencyKey = wrongDigest; }, error: /reservation idempotency key.*request key/i },
    { name: "attempt references a different self-authored reservation", artifact: "dispatch.json", mutate: (value) => { value.attempts[0].reservationId = "reservation_other"; value.attempts[1].reservationId = "reservation_other"; }, error: /dispatch attempt reservation id.*actual reservation/i },
    { name: "unrelated dispatched request", artifact: "dispatch.json", mutate: (value) => { value.dispatchedRequestDigest = wrongDigest; }, error: /dispatched request digest.*authorized decision context/i },
    { name: "authorized request body", artifact: "dispatch.json", mutate: (value) => { value.authorizedRequest = { v: "reelier.hermetic-provider-request/v0", resourceId: "fixture_switch", value: "off", idempotencyKey: value.decisionContext.requestKey }; }, error: /authorized request digest.*decision context/i },
    { name: "authorized request idempotency key", artifact: "dispatch.json", mutate: (value) => { value.authorizedRequest.idempotencyKey = wrongDigest; }, error: /authorized request idempotency key.*decision context request key/i },
  ];

  for (const item of cases) await t.test(item.name, () => {
    const directory = temporaryBundle();
    try {
      const artifact = readArtifact(directory, item.artifact);
      item.mutate(artifact);
      writeArtifact(directory, item.artifact, artifact);
      const result = checker.checkHermeticOutcomeBundle(directory);
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((error: string) => item.error.test(error)), result.errors.join("\n"));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("rejects a missing artifact from the closed bundle", () => {
  const directory = temporaryBundle();
  try {
    unlinkSync(join(directory, "provider-state.json"));
    const result = checker.checkHermeticOutcomeBundle(directory);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error: string) => /missing.*provider-state\.json/i.test(error)), result.errors.join("\n"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects contradictory post-state even when observed and expected digests copy it", () => {
  const directory = temporaryBundle();
  try {
    const provider = readArtifact(directory, "provider-state.json");
    provider.postState.value = "off";
    provider.postStateEvidence.expectedProjectionDigest = artifactDigest(provider.postState);
    provider.postStateEvidence.observedProjectionDigest = artifactDigest(provider.postState);
    writeArtifact(directory, "provider-state.json", provider);
    const result = checker.checkHermeticOutcomeBundle(directory);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error: string) => /post-state.*authorized effect|authorized.*post-state/i.test(error)), result.errors.join("\n"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("discovery-only coverage stays explicit and non-passing", () => {
  const directory = temporaryBundle();
  try {
    const bundle = checker.loadHermeticOutcomeBundle(directory);
    assert.deepEqual(bundle.coverage, {
      v: "reelier.hermetic-coverage-evidence/v0",
      mode: "discovery-only",
      status: "failed",
      passEligibility: false,
      topology: "unchecked",
      completeness: "unchecked",
      reasonCodes: ["discovery-is-non-authorizing", "route-enforcement-not-proved", "traffic-completeness-not-proved"],
    });
    const coverage = readArtifact(directory, "coverage.json");
    coverage.status = "passed";
    coverage.passEligibility = true;
    writeArtifact(directory, "coverage.json", coverage);
    const result = checker.checkHermeticOutcomeBundle(directory);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error: string) => /coverage.*non-passing|coverage.*discovery/i.test(error)), result.errors.join("\n"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
