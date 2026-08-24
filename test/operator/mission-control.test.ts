import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveOutcomeLifecycleV1,
  parseMissionControlMissionV1,
} from "../../src/operator/mission-control.js";

const BASE_MISSION = Object.freeze({
  v: "reelier.mission-control-mission/v1" as const,
  missionId: "mission-1",
  workspaceDigest: `sha256:${"a".repeat(64)}`,
  harness: "codex" as const,
  harnessLifecycle: "exited" as const,
  outcomeLifecycle: "completed-unverified" as const,
  attentionState: "watching" as const,
  attentionReasons: ["harness-exited-without-evidence"],
  evidenceRefs: [] as readonly string[],
  processOwnership: "reelier" as const,
  imported: false,
  updatedAt: "2026-08-24T12:00:00.000Z",
});

test("a clean harness exit cannot certify its own Outcome", () => {
  assert.equal(deriveOutcomeLifecycleV1({ harnessLifecycle: "exited", localEvidenceCount: 0 }), "completed-unverified");
  assert.equal(deriveOutcomeLifecycleV1({ harnessLifecycle: "exited", localEvidenceCount: 2 }), "locally-observed");
  assert.equal(deriveOutcomeLifecycleV1({ harnessLifecycle: "failed", localEvidenceCount: 2 }), "failed");
  assert.equal(deriveOutcomeLifecycleV1({ harnessLifecycle: "exited", localEvidenceCount: 2, managedLifecycle: "reconciled" }), "reconciled");
  assert.equal(deriveOutcomeLifecycleV1({ harnessLifecycle: "exited", localEvidenceCount: 2, managedLifecycle: "ambiguous" }), "ambiguous");
});

test("mission records are closed, inert, bounded, and detached", () => {
  const source = { ...BASE_MISSION, attentionReasons: [...BASE_MISSION.attentionReasons], evidenceRefs: [] as string[] };
  const parsed = parseMissionControlMissionV1(source);
  source.attentionReasons[0] = "mutated";
  assert.equal(parsed.attentionReasons[0], "harness-exited-without-evidence");
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.attentionReasons), true);

  assert.throws(() => parseMissionControlMissionV1({ ...BASE_MISSION, extra: true }), /unknown|shape/i);
  assert.throws(() => parseMissionControlMissionV1({ ...BASE_MISSION, harnessLifecycle: "complete" }), /harness lifecycle/i);
  assert.throws(() => parseMissionControlMissionV1({ ...BASE_MISSION, outcomeLifecycle: "verified" }), /outcome lifecycle/i);
  assert.throws(() => parseMissionControlMissionV1({ ...BASE_MISSION, attentionState: "urgent" }), /attention state/i);

  const accessor = { ...BASE_MISSION } as Record<string, unknown>;
  Object.defineProperty(accessor, "missionId", { enumerable: true, get: () => { throw new Error("must not execute"); } });
  assert.throws(() => parseMissionControlMissionV1(accessor), /accessor|descriptor|inert/i);

  let trapCount = 0;
  const proxied = new Proxy({ ...BASE_MISSION }, { ownKeys() { trapCount += 1; return Reflect.ownKeys(BASE_MISSION); } });
  assert.throws(() => parseMissionControlMissionV1(proxied), /proxy|inert/i);
  assert.equal(trapCount, 0);
});

test("imported sessions are always observe-only", () => {
  assert.throws(() => parseMissionControlMissionV1({ ...BASE_MISSION, imported: true, processOwnership: "reelier" }), /imported.*external|ownership/i);
  const parsed = parseMissionControlMissionV1({ ...BASE_MISSION, imported: true, processOwnership: "external" });
  assert.equal(parsed.processOwnership, "external");
});
