import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMissionControlDoctorV1 } from "../../src/operator/doctor.js";

test("Mission Control doctor reports local readiness without an account or Cloud", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-doctor-"));
  try {
    const result = await runMissionControlDoctorV1({ root, probeHarnesses: async () => [
      { descriptor: { v: "reelier.operator-harness/v1", id: "codex", displayName: "Codex", executable: "codex", resumeSupported: true, jsonEventsSupported: true }, installed: true, version: "codex 1", authMode: "installed-session", reason: null },
    ] });
    assert.equal(result.status, "ready");
    assert.equal(result.accountRequired, false);
    assert.equal(result.cloudRequired, false);
    assert.deepEqual(result.productReadyHarnesses, ["codex"]);
    assert.equal(result.journalReadable, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
