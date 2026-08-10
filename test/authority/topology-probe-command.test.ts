import test from "node:test";
import assert from "node:assert/strict";
import { runTopologyProbeCommand } from "../../src/authority/host/topology-probe-command.js";

const base = {
  v: "reelier.topology-probe-config/v1" as const,
  role: "agent" as const,
  runtimeSession: "session-1",
  providerCredentialEnvNames: ["GITHUB_TOKEN"],
  allowedCredentialEnvNames: ["OPENAI_API_KEY"],
  rawWriteRouteIds: [],
  readSurfaceIds: ["github.issue.read"],
  providerEndpoints: ["api.github.com"],
  schemaDigest: "sha256:" + "a".repeat(64),
};

test("topology snapshot reports names and commitments without values", async () => {
  const result = await runTopologyProbeCommand({ action: "snapshot", argument: "challenge-1", config: base, env: { OPENAI_API_KEY: "model-secret", GITHUB_TOKEN: "provider-secret", PATH: "/bin" } });
  assert.deepEqual(result, {
    v: "reelier.topology-probe-snapshot/v1",
    role: "agent",
    nonce: "challenge-1",
    runtimeSession: "session-1",
    providerCredentialRefs: ["GITHUB_TOKEN"],
    unexpectedCredentialRefs: [],
    rawWriteRouteIds: [],
    readSurfaceIds: ["github.issue.read"],
    providerEndpoints: ["api.github.com"],
    schemaDigest: base.schemaDigest,
  });
  assert.equal(JSON.stringify(result).includes("model-secret"), false);
  assert.equal(JSON.stringify(result).includes("provider-secret"), false);
});

test("topology snapshot exposes unexpected secret-shaped environment names", async () => {
  const result = await runTopologyProbeCommand({ action: "snapshot", argument: "challenge-2", config: base, env: { UNDECLARED_SECRET: "do-not-return" } });
  assert.equal(result.v, "reelier.topology-probe-snapshot/v1");
  if (result.v !== "reelier.topology-probe-snapshot/v1") throw new Error("unexpected probe result");
  assert.deepEqual(result.unexpectedCredentialRefs, ["UNDECLARED_SECRET"]);
  assert.equal(JSON.stringify(result).includes("do-not-return"), false);
});

test("egress probe accepts only a declared endpoint and returns a boolean", async () => {
  const yes = await runTopologyProbeCommand({ action: "egress", argument: "api.github.com", config: base, env: {}, connect: async endpoint => endpoint === "api.github.com" });
  assert.deepEqual(yes, { v: "reelier.topology-probe-egress/v1", endpoint: "api.github.com", reachable: true });
  await assert.rejects(() => runTopologyProbeCommand({ action: "egress", argument: "evil.example", config: base, env: {}, connect: async () => true }), /not declared/);
});

test("probe configuration is closed and validates all identifiers", async () => {
  await assert.rejects(() => runTopologyProbeCommand({ action: "snapshot", argument: "challenge-3", config: { ...base, extra: true } as never, env: {} }), /closed/);
  await assert.rejects(() => runTopologyProbeCommand({ action: "snapshot", argument: "bad nonce!", config: base, env: {} }), /nonce/);
});
