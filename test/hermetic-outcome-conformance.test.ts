import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const checker = await import(pathToFileURL(resolve("conformance/hermetic-outcome/v0/check.mjs")).href);
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
    assert.equal(delegation.childGrant.parentDigest, delegation.parentCommitmentDigest);
    assert.ok(delegation.childGrant.constraints.limits.maxEffectsPerWindow < delegation.parentGrant.constraints.limits.maxEffectsPerWindow);
    assert.equal(delegation.signature.alg, "ed25519");

    assert.equal(loaded.dispatch.gateEvent.v, "reelier.gate-event/v1");
    assert.equal(loaded.dispatch.gateEvent.verdict, "accepted");
    assert.equal(loaded.dispatch.reservation.state, "reconciled");
    assert.equal(loaded.providerState.acknowledgment.status, "acknowledged");
    assert.equal(loaded.providerState.postStateEvidence.confidence, "exact");
    assert.match(loaded.providerState.postStateEvidence.permitSnapshotDigest, /^sha256:[0-9a-f]{64}$/);
    assert.match(loaded.providerState.postStateEvidence.projectionSchemaDigest, /^sha256:[0-9a-f]{64}$/);
    assert.match(loaded.providerState.postStateEvidence.preProjectionDigest, /^sha256:[0-9a-f]{64}$/);
    assert.deepEqual(loaded.providerState.restoredState, loaded.providerState.preState);
    assert.equal(loaded.receipt.v, "reelier.authority-receipt/v1");
    assert.equal(loaded.finalReport.status, "non-passing");
    assert.equal(loaded.finalReport.outcomeEvidence, "verified");
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
    assert.deepEqual(bundle.dispatch.attempts.map((attempt: any) => attempt.reservationId), [bundle.dispatch.reservation.reservationId, bundle.dispatch.reservation.reservationId]);
    assert.deepEqual(bundle.dispatch.attempts.map((attempt: any) => attempt.decision), ["dispatched", "duplicate"]);
    assert.equal(bundle.dispatch.attempts[1].providerEffectDelta, 0);
    assert.equal(bundle.providerState.providerEffectCount, 1);
    assert.equal(bundle.failureInjection.cases.find((item: any) => item.caseId === "duplicate-retry").result, "verified-zero-effect");
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
