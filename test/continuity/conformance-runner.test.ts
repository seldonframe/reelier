import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const { checkContinuityAdapterCandidate } = await import(pathToFileURL(resolve("conformance/continuity-adapter/v1/check.mjs")).href);

const candidate = pathToFileURL(resolve("conformance/continuity-adapter/v1/fixtures/core-candidate.mjs")).href;

test("core candidate passes the closed continuity adapter contract", async () => {
  const report = await checkContinuityAdapterCandidate(candidate);
  assert.equal(report.v, "reelier.continuity-adapter-conformance-report/v1");
  assert.equal(report.status, "passed");
  assert.equal(report.maturity, "reproduced");
  assert.equal(report.checks.every((item: { status: string }) => item.status === "passed"), true);
  assert.deepEqual(report.nonClaims, {
    contentCorrectness: "not-proved",
    productionReadiness: "not-proved",
    safety: "not-proved",
    topology: "not-proved",
    trafficCompleteness: "not-proved",
  });
});

test("runner fails a candidate that dispatches during open", async () => {
  const report = await checkContinuityAdapterCandidate(candidate, { mutation: "dispatch-on-open" });
  assert.equal(report.status, "failed");
  assert.equal(report.checks.find((item: { id: string }) => item.id === "resume-is-read-only")?.status, "failed");
});

test("runner fails identity override and evidence upgrade candidates", async () => {
  for (const mutation of ["identity-from-input", "unchecked-as-verified"] as const) {
    const report = await checkContinuityAdapterCandidate(candidate, { mutation });
    assert.equal(report.status, "failed");
  }
});

test("runner rejects adversarial lifecycle and cleanup candidates", async () => {
  const cases = [
    ["replacement-state-loss", "replacement-projection"],
    ["reserve-on-repeat-open", "resume-is-read-only"],
    ["ambiguous-open-resend", "ambiguity-blocks-resend"],
    ["status-side-effects", "status-does-not-dispatch"],
    ["mutate-then-throw", "identity-isolation-refuses"],
    ["unchecked-as-verified", "uncertainty-is-honest"],
    ["missing-close", "candidate-cleanup"],
    ["rejecting-close", "candidate-cleanup"],
  ] as const;
  for (const [mutation, check] of cases) {
    const report = await checkContinuityAdapterCandidate(candidate, { mutation });
    assert.equal(report.status, "failed", mutation);
    assert.equal(report.checks.find((item: { id: string }) => item.id === check)?.status, "failed", mutation);
  }
});

test("runner rejects zero authority digests and malformed semantic versions", async () => {
  for (const mutation of ["zero-digest", "malformed-semver", "numeric-prerelease-zero"] as const) {
    const report = await checkContinuityAdapterCandidate(candidate, { mutation });
    assert.equal(report.status, "failed", mutation);
    assert.equal(report.checks[0]?.id, "closed-schema");
  }
});

test("ambiguity resume cannot invoke either authority port", async () => {
  for (const mutation of ["ambiguous-open-status", "ambiguous-open-outcome"] as const) {
    const report = await checkContinuityAdapterCandidate(candidate, { mutation });
    assert.equal(report.checks.find((item: { id: string }) => item.id === "ambiguity-blocks-resend")?.status, "failed", mutation);
  }
});

test("malformed descriptors and cleanup faults remain closed reports", async () => {
  for (const mutation of ["malformed-missing-close", "malformed-rejecting-close"] as const) {
    const report = await checkContinuityAdapterCandidate(candidate, { mutation });
    assert.equal(report.status, "failed");
    assert.equal(report.v, "reelier.continuity-adapter-conformance-report/v1");
  }
  const cli = spawnSync(process.execPath, ["conformance/continuity-adapter/v1/check.mjs", "./missing-candidate.mjs"], { encoding: "utf8" });
  assert.equal(cli.status, 1);
  assert.equal(JSON.parse(cli.stdout).status, "failed");
  assert.equal(cli.stderr, "");
});

test("public protocol exposes exactly the three specified mutations", async () => {
  const protocol = await readFile("conformance/continuity-adapter/v1/protocol.d.ts", "utf8");
  assert.match(protocol, /"dispatch-on-open" \| "identity-from-input" \| "unchecked-as-verified"/);
  assert.doesNotMatch(protocol, /replacement-state-loss|missing-close|malformed-semver/);
});

test("uncertainty checks reject swapped and conflated consequence lifecycles", async () => {
  for (const mutation of ["swap-uncertain-states", "conflate-uncertain-states"] as const) {
    const report = await checkContinuityAdapterCandidate(candidate, { mutation });
    assert.equal(report.checks.find((item: { id: string }) => item.id === "uncertainty-is-honest")?.status, "failed", mutation);
  }
});

test("candidate schema accepts SemVer build metadata and rejects malformed identifiers", async () => {
  const schema = JSON.parse(await readFile("conformance/continuity-adapter/v1/candidate.schema.json", "utf8"));
  const { default: Ajv2020 } = await import("ajv/dist/2020.js");
  const validate = new (Ajv2020 as unknown as new (options: { strict: boolean }) => { compile(value: unknown): (value: unknown) => boolean })({ strict: true }).compile(schema);
  const candidate = (harnessVersion: string) => ({ v: "reelier.continuity-adapter-candidate/v1", adapterId: "core", harnessId: "core", harnessVersion, reelierCommit: "44d512263b3e77a301b4d875ab03217712b17c37", authorityAdapterContractDigest: "sha256:7f46242b26d9c921f4e1ec9de6418ac5fc8c03d70c4415c25e799ae0e73a1512" });
  assert.equal(validate(candidate("1.2.3")), true);
  assert.equal(validate(candidate("1.2.3-alpha.1")), true);
  assert.equal(validate(candidate("1.2.3+build.1")), true);
  assert.equal(validate(candidate("1.2.3-alpha.1+build.1")), true);
  assert.equal(validate(candidate("1.2.3-01")), false);
  assert.equal(validate(candidate("1.2.3+build..1")), false);
  assert.equal(validate(candidate("1.2.3+build_1")), false);
});
