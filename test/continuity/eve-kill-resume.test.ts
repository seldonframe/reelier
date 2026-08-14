import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
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
      assert.deepEqual(value.counters, { outcomeRequests: 0, statusReads: 0, providerDispatches: 0, reservations: 0 });
    });
    await t.test("Path C apply survives process death without resend", () => {
      const value = matrix.scenarios.outcomeCut;
      assert.equal(Number(value.outcomeRequests) >= 2, true, JSON.stringify(value));
      assert.equal(value.providerDispatches, 1);
      assert.equal(value.reservations, 1);
      assert.equal(value.providerWrites, 1);
      assert.equal(value.verifierProducedConsequence, true);
      assert.equal(value.ambiguousRequiresReconcile, true);
      assert.deepEqual(value.retryEvidence, { sameCoordinates: true, distinctMetaIds: true, type: "step.started" });
    });
    await t.test("overlapping stream cursor deduplicates by event id", () => {
      const value = matrix.scenarios.streamOverlap;
      assert.equal(Number(value.overlapCount) > 0, true);
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
