import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMissionProcessControlV1, stopOwnedMissionProcessV1 } from "../../src/operator/mission-process-control.js";

test("an exact local control capability stops only its Reelier-owned mission and disappears on close", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-mission-control-process-"));
  let stops = 0;
  try {
    const control = await createMissionProcessControlV1({ root, missionId: "mission-owned", stop: async () => { stops += 1; } });
    const descriptor = await readFile(path.join(root, ".reelier", "operator", "processes", "mission-owned.json"), "utf8");
    assert.doesNotMatch(descriptor, /provider|credential|prompt|reasoning/i);
    await assert.rejects(() => stopOwnedMissionProcessV1({ root, missionId: "mission-crossed" }), /not active|not found/i);
    assert.deepEqual(await stopOwnedMissionProcessV1({ root, missionId: "mission-owned" }), { status: "stopped", missionId: "mission-owned" });
    assert.equal(stops, 1);
    await control.close();
    await assert.rejects(() => readFile(path.join(root, ".reelier", "operator", "processes", "mission-owned.json"), "utf8"), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
