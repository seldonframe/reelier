import test from "node:test";
import assert from "node:assert/strict";

test("checkpointed initialization exposes a local dry-run inspection API", async () => {
  const modulePath = "../src/" + "initialization.js";
  const initialization = await import(modulePath) as Record<string, unknown>;

  assert.equal(typeof initialization.initializeInspection, "function");
  assert.deepEqual(initialization.INIT_CHECKPOINT_IDS, [
    "config-surfaces",
    "path-a-coverage",
    "path-b-candidates",
    "path-c-candidates",
    "inspection-report",
  ]);
});
