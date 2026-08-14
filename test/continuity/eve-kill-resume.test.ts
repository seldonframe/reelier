import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

type Scenario = Readonly<Record<string, unknown>>;
type Matrix = Readonly<{ scenarios: Readonly<Record<string, Scenario>> }>;

test("real Eve 0.37.1 preserves Reelier continuity across process and session boundaries", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "reelier-eve-kill-resume-"));
  const externalResult = process.env.REELIER_EVE_MATRIX_RESULT_PATH;
  const resultPath = externalResult ? resolve(externalResult) : resolve(root, "matrix.json");
  try {
    const run = spawn(process.execPath, [
      resolve("conformance/continuity-adapter/v1/eve-fixture/scripts/eve-process.mjs"),
      "--matrix",
      resultPath,
      "--runtime-root",
      root,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let diagnostics = "";
    run.stdout?.on("data", (chunk) => { diagnostics += String(chunk); });
    run.stderr?.on("data", (chunk) => { diagnostics += String(chunk); });
    const code = await new Promise<number | null>((resolveExit, reject) => {
      run.once("error", reject);
      run.once("close", resolveExit);
    });
    assert.equal(code, 0, diagnostics.slice(-4_000));
    const matrix = JSON.parse(await readFile(resultPath, "utf8")) as Matrix;

    await t.test("checkpoint commit survives process death before tool return", () => {
      const value = matrix.scenarios.checkpointCut;
      assert.equal(value.cursor, 2);
      assert.equal(value.segmentCount, 2);
      assert.equal(value.uncertainClaimCount, 1);
      assert.equal(value.uncertainClaimStatus, "unchecked");
      assert.equal(value.noThirdSegmentAfterReplay, true);
      assert.deepEqual(value.retryEvidence, { sameCoordinates: true, distinctMetaIds: true, type: "step.started" });
      assert.equal(value.recoveryBoundary, "session.waiting");
      assert.equal(value.recoveryPostCount, 0);
      assert.deepEqual(value.counters, { outcomeRequests: 0, statusReads: 0, providerDispatches: 0, reservations: 0 });
    });
    await t.test("Path C apply survives process death without resend", () => {
      const value = matrix.scenarios.outcomeCut;
      assert.equal(Number(value.outcomeRequests) >= 2, true, JSON.stringify(value));
      assert.equal(value.providerDispatches, 1);
      assert.equal(value.reservations, 1);
      assert.equal(value.providerWrites, 1);
      assert.equal(value.verifierProducedConsequence, true);
      assert.equal(value.cutLifecycleState, "ambiguous");
      assert.equal(value.cutVerdict, "unresolved");
      assert.equal(value.ambiguousState, "ambiguous");
      assert.deepEqual(value.ambiguousNextSafeActions, ["reconcile-before-retry"]);
      assert.equal(value.prematureSuccessProjected, false);
      assert.deepEqual(value.retryEvidence, { sameCoordinates: true, distinctMetaIds: true, type: "step.started" });
    });
    await t.test("overlapping stream cursor deduplicates by event id", () => {
      const value = matrix.scenarios.streamOverlap;
      assert.equal(Number(value.overlapCount) > 0, true);
      assert.equal(Number(value.rawRepeatedMetaIdCount) > 0, true, JSON.stringify(value));
      assert.equal(value.duplicateInstrumentationIds, 0);
      assert.equal(value.ledgerUnchanged, true);
    });
    await t.test("compact and clear preserve Reelier continuity", () => {
      const value = matrix.scenarios.compactAndClear;
      assert.equal(value.compactProjectionUnchanged, true);
      assert.equal(value.clearProjectionUnchanged, true);
      assert.equal(value.effectsUnchanged, true);
    });
    await t.test("reset session can be replaced for the same task", () => {
      const value = matrix.scenarios.resetAndReplace;
      assert.equal(value.retiredHttpStatus, 409);
      assert.equal(value.retiredCode, "session_not_active");
      assert.equal(value.projectionUnchanged, true);
      assert.equal(value.runtimeSessionChanged, true);
    });
    await t.test("cross-principal follow-up refuses before model work", () => {
      const value = matrix.scenarios.crossPrincipal;
      assert.equal(value.failedBeforeStepStarted, true, JSON.stringify(value));
      assert.equal(value.ledgerUnchanged, true);
      assert.equal(value.effectsUnchanged, true);
      assert.equal(value.hostIdentityUnchanged, true);
      assert.equal(value.ledgerTaskUnchanged, true);
      assert.equal(value.hostileAuthorityNotProjected, true);
    });
    await t.test("changed mock model leaves projection bytes unchanged", () => {
      const value = matrix.scenarios.modelNeutrality;
      assert.equal(value.projectionBytesUnchanged, true);
      assert.equal(value.effectsUnchanged, true);
    });
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("closed Eve report rejects active and hidden structures before reading them", async () => {
  const moduleUrl = pathToFileURL(resolve("conformance/continuity-adapter/v1/eve-fixture/scripts/run-conformance.mjs")).href;
  const { assertClosedInertReport, assertClosedReport } = await import(moduleUrl) as { assertClosedInertReport(value: unknown): void; assertClosedReport(value: unknown): void };
  const valid = reportFixture();
  assert.doesNotThrow(() => assertClosedInertReport(valid));
  assert.throws(() => assertClosedReport(valid), /closed report validation/i);

  let getterReads = 0;
  const accessor = structuredClone(valid);
  Object.defineProperty(accessor.artifacts, "ledgerHeadDigest", { enumerable: true, get() { getterReads += 1; return `sha256:${"a".repeat(64)}`; } });
  assert.throws(() => assertClosedInertReport(accessor), /inert|descriptor/i);
  assert.equal(getterReads, 0);

  const symbol = structuredClone(valid);
  Object.defineProperty(symbol.nonClaims, Symbol("hidden"), { value: "not-proved", enumerable: true });
  assert.throws(() => assertClosedInertReport(symbol), /symbol|exact/i);

  const hidden = structuredClone(valid);
  Object.defineProperty(hidden.artifacts, "unexpected", { value: "hidden", enumerable: false });
  assert.throws(() => assertClosedInertReport(hidden), /enumerable|exact/i);

  const altered = structuredClone(valid);
  Object.setPrototypeOf(altered.checks[0], { inherited: true });
  assert.throws(() => assertClosedInertReport(altered), /prototype/i);

  const validShape = reportFixture();
  validShape.checks.push({ id: "eve-process-matrix", status: "passed", detail: "passed" }, { id: "focused-continuity", status: "passed", detail: "passed" });
  assert.doesNotThrow(() => assertClosedReport(validShape));
  const badDigest = structuredClone(validShape);
  badDigest.artifacts.reportDigest = "sha256:not-a-digest";
  assert.throws(() => assertClosedReport(badDigest), /closed report validation/i);
  const missingField = structuredClone(validShape) as Partial<typeof validShape>;
  delete missingField.nonClaims;
  assert.throws(() => assertClosedReport(missingField), /closed report validation/i);
});

function reportFixture() {
  return {
    v: "reelier.continuity-eve-conformance-report/v1",
    status: "passed",
    maturity: "reproduced",
    reelierCommit: "a".repeat(40),
    authorityAdapterContractDigest: `sha256:${"b".repeat(64)}`,
    eveVersion: "0.37.1",
    nodeVersion: "v24.9.0",
    checks: [{ id: "generic-candidate", status: "passed", detail: "passed" }],
    artifacts: { ledgerHeadDigest: `sha256:${"c".repeat(64)}`, receiptGraphDigest: `sha256:${"d".repeat(64)}`, reportDigest: `sha256:${"e".repeat(64)}` },
    nonClaims: { contentCorrectness: "not-proved", grokBot: "not-tested", productionReadiness: "not-proved", safety: "not-proved", topology: "not-proved", trafficCompleteness: "not-proved" },
  };
}
