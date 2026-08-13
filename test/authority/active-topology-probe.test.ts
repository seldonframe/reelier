import test from "node:test";
import assert from "node:assert/strict";
import {
  createActiveTopologyProbe,
  createLiveTopologyProbe,
  runActiveTopologyProbe,
  type ActiveTopologyProbeOperations,
} from "../../src/authority/host/active-probe.js";

const input = { tenant: "tenant_1", observedAt: "2026-08-10T12:00:00.000Z", expiresAt: "2026-08-10T12:01:00.000Z" };
const fields = ["credentialIsolation", "providerEgress", "rawWriteReachability", "readCoverage", "runtimeIdentity", "declaredSurfaceEnforcement"] as const;

function operations(overrides: Partial<ActiveTopologyProbeOperations> = {}): ActiveTopologyProbeOperations {
  return {
    credentialIsolation: () => "verified",
    providerEgress: () => "verified",
    rawWriteReachability: () => "verified",
    readCoverage: () => "verified",
    runtimeIdentity: () => "verified",
    declaredSurfaceEnforcement: () => "verified",
    ...overrides,
  };
}

test("reference active probe invokes each named operation with a non-secret context", async () => {
  const seen: unknown[] = [];
  const probe = createActiveTopologyProbe({
    probeId: "reference",
    nonce: "test-nonce",
    operations: operations({
      credentialIsolation: context => { seen.push(context); return { ok: true }; },
      providerEgress: context => { seen.push(context); return true; },
    }),
  });
  const result = await runActiveTopologyProbe(probe, input);
  assert.equal(result.evidence.credentialIsolation, "verified");
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0], { ...input, nonce: "test-nonce", mode: "hermetic" });
  assert.deepEqual(seen[1], seen[0]);
  assert.equal(Object.keys(seen[0] as object).includes("secret"), false);
});

test("operation outcomes normalize to four-state claims and reject malformed values", async () => {
  for (const [value, expected] of [[true, "verified"], [false, "failed"], [{ status: "unchecked" }, "unchecked"], [{ ok: false }, "failed"]] as const) {
    const probe = createActiveTopologyProbe({ operations: operations({ providerEgress: () => value as never }), nonce: "n" });
    const result = await runActiveTopologyProbe(probe, input);
    assert.equal(result.evidence.providerEgress, expected);
  }
  const malformed = createActiveTopologyProbe({ operations: operations({ readCoverage: () => "bogus" as never }) });
  await assert.rejects(() => runActiveTopologyProbe(malformed, input), /invalid claim/);
});

test("live probes are guarded by explicit opt-in and still receive no ambient secrets", async () => {
  assert.throws(() => createActiveTopologyProbe({ mode: "live", operations: operations() }), /allowLive/);
  const modes: string[] = [];
  const probe = createLiveTopologyProbe({ allowLive: true, nonce: "live-nonce", operations: operations({ runtimeIdentity: context => { modes.push(context.mode); return true; } }) });
  const result = await runActiveTopologyProbe(probe, input);
  assert.equal(result.evidence.runtimeIdentity, "verified");
  assert.deepEqual(modes, ["live"]);
});

test("operation surface is closed over the six required measurements", () => {
  const extra = { ...operations(), extra: () => "verified" } as never;
  assert.throws(() => createActiveTopologyProbe({ operations: extra }), /exactly cover/);
  for (const field of fields) {
    const missing = { ...operations() } as Record<string, unknown>;
    delete missing[field];
    assert.throws(() => createActiveTopologyProbe({ operations: missing as never }), /exactly cover/);
  }
});
