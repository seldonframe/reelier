import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

type Scenario = Readonly<Record<string, unknown>>;
type Matrix = Readonly<{ scenarios: Readonly<Record<string, Scenario>> }>;

test("real Eve 0.39.0 preserves Reelier continuity across process and session boundaries", { timeout: 300_000 }, async (t) => {
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
    const bounded = setTimeout(() => run.kill("SIGKILL"), 240_000); bounded.unref();
    let diagnostics = "";
    run.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      diagnostics += text;
      if (process.env.REELIER_EVE_MATRIX_DIAGNOSTICS === "1") process.stderr.write(`[eve-child:stdout] ${text}`);
    });
    run.stderr?.on("data", (chunk) => {
      const text = String(chunk);
      diagnostics += text;
      if (process.env.REELIER_EVE_MATRIX_DIAGNOSTICS === "1") process.stderr.write(`[eve-child:stderr] ${text}`);
    });
    const code = await new Promise<number | null>((resolveExit, reject) => {
      run.once("error", reject);
      run.once("exit", (exitCode) => {
        run.stdout?.destroy();
        run.stderr?.destroy();
        resolveExit(exitCode);
      });
    });
    clearTimeout(bounded);
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
      assert.deepEqual(value.recoverySessionPosts, []);
      assert.deepEqual(value.counters, { outcomeRequests: 0, statusReads: 0, providerDispatches: 0, reservations: 0 });
    });
    await t.test("genuine governed composite survives Eve process death at exact-head ambiguity without resend", () => {
      const value = matrix.scenarios.outcomeCut;
      assert.equal(value.cutSubmissionStatus, 202);
      assert.equal(value.cutLifecycle, "pending");
      assert.equal(value.processRestarted, true);
      assert.equal(value.runtimeReopens, 1);
      assert.notEqual(value.cutSessionId, value.recoveredSessionId);
      assert.equal(Number(value.cutToolEvents) > 0, true);
      assert.equal(value.mergeWrites, 1);
      assert.equal(value.linearWrites, 2);
      assert.equal(value.linearReads, 2);
      assert.equal(value.reservationCount, 5);
      assert.equal(value.reconciledRequestCount, 1);
      assert.equal(Array.isArray(value.statusToolMessages) && value.statusToolMessages.some((message) => typeof message === "string" && message.includes("reconciled") && message.includes("request_composite")), true, JSON.stringify(value));
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
      assert.equal(Number(value.hostileEventCount) > 0, true);
      assert.equal(value.hostileLedgerCursorAfter, Number(value.hostileLedgerCursorBefore) + 1, JSON.stringify(value));
      assert.equal(value.appendedSegmentCursor, value.hostileLedgerCursorAfter);
      assert.deepEqual(value.taskDirectories, [value.legitimateTaskId]);
      assert.equal(value.appendedSegmentActorTaskId, value.legitimateTaskId);
      assert.equal(value.appendedSegmentActorPrincipalId, value.legitimatePrincipalId);
      assert.equal(value.appendedSegmentActorWorkloadId, value.legitimateWorkloadId);
      assert.equal(value.projectionTaskId, value.legitimateTaskId);
      assert.equal(value.projectionAuthoritySnapshotDigest, value.appendedAuthoritySnapshotDigest);
      assert.equal(value.hostileAuthorityAbsent, true);
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

test("Eve matrix routes every HTTP request through one observable boundary", async () => {
  const processSource = await readFile(resolve("conformance/continuity-adapter/v1/eve-fixture/scripts/eve-process.mjs"), "utf8");
  const streamSource = await readFile(resolve("conformance/continuity-adapter/v1/eve-fixture/scripts/stream.mjs"), "utf8");
  assert.doesNotMatch(processSource, /\bfetch\s*\(/u);
  assert.equal([...streamSource.matchAll(/\bfetch\s*\(/gu)].length, 1);
  assert.match(streamSource, /export function createObservedEveClient/u);
  assert.doesNotMatch(processSource, /recoveryPostCount|ambiguousAppend|event_eve_outcome_(?:reserved|dispatched|ambiguous)/u);
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
    eveVersion: "0.39.0",
    nodeVersion: "v24.9.0",
    checks: [{ id: "generic-candidate", status: "passed", detail: "passed" }],
    artifacts: { ledgerHeadDigest: `sha256:${"c".repeat(64)}`, receiptGraphDigest: `sha256:${"d".repeat(64)}`, reportDigest: `sha256:${"e".repeat(64)}` },
    nonClaims: { contentCorrectness: "not-proved", grokBot: "not-tested", productionReadiness: "not-proved", safety: "not-proved", topology: "not-proved", trafficCompleteness: "not-proved" },
  };
}
