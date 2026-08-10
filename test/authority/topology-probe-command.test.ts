import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseTopologyProbeMachineConfig, runTopologyProbeCommand } from "../../src/authority/host/topology-probe-command.js";
import { authorityDigest } from "../../src/authority/wire.js";

const baseWithoutDigest = {
  v: "reelier.topology-probe-config/v1" as const,
  role: "agent" as const,
  runtimeSession: "session-1",
  providerCredentialEnvNames: ["GITHUB_TOKEN"],
  allowedCredentialEnvNames: ["OPENAI_API_KEY"],
  rawWriteRouteIds: [],
  readSurfaceIds: ["github.issue.read"],
  providerEndpoints: ["api.github.com"],
  egressProxy: null,
};
const base = { ...baseWithoutDigest, schemaDigest: authorityDigest({ v: "reelier.topology-probe-declared-surface/v1", role: baseWithoutDigest.role, providerCredentialEnvNames: baseWithoutDigest.providerCredentialEnvNames, allowedCredentialEnvNames: baseWithoutDigest.allowedCredentialEnvNames, rawWriteRouteIds: baseWithoutDigest.rawWriteRouteIds, readSurfaceIds: baseWithoutDigest.readSurfaceIds, providerEndpoints: baseWithoutDigest.providerEndpoints, egressProxy: baseWithoutDigest.egressProxy }) };

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

test("probe configuration schema digest is derived from the declared surface", () => {
  assert.throws(() => parseTopologyProbeMachineConfig({ ...base, readSurfaceIds: ["github.commit.read"] }), /schema digest does not match/);
});

test("Cell topology resolves its project-specific internal gateway from a non-secret environment reference", () => {
  const egressProxy = { baseUrl: "env:REELIER_EGRESS_PROXY_BASE_URL", bearerEnvName: "REELIER_EGRESS_GATEWAY_BEARER" };
  const config = { ...base, role: "cell" as const, egressProxy, schemaDigest: authorityDigest({ v: "reelier.topology-probe-declared-surface/v1", role: "cell", providerCredentialEnvNames: base.providerCredentialEnvNames, allowedCredentialEnvNames: base.allowedCredentialEnvNames, rawWriteRouteIds: base.rawWriteRouteIds, readSurfaceIds: base.readSurfaceIds, providerEndpoints: base.providerEndpoints, egressProxy }) };
  const parsed = parseTopologyProbeMachineConfig(config, { REELIER_EGRESS_PROXY_BASE_URL: "http://reelier-cert-egress.internal:8443" });
  assert.deepEqual(parsed.egressProxy, { baseUrl: "http://reelier-cert-egress.internal:8443", bearerEnvName: "REELIER_EGRESS_GATEWAY_BEARER" });
  assert.throws(() => parseTopologyProbeMachineConfig(config, {}), /environment reference is unavailable/);
});

test("the committed Fly probe manifests carry derived surface digests rather than placeholders", async () => {
  for (const name of ["agent-runtime", "authority-cell", "egress-gateway"]) {
    const config = JSON.parse(await readFile(`infra/fly/authority-cell/${name}.topology-probe.json`, "utf8"));
    const parsed = parseTopologyProbeMachineConfig(config, { REELIER_EGRESS_PROXY_BASE_URL: "http://reelier-cert-egress.internal:8443" });
    assert.match(parsed.schemaDigest, /^sha256:[0-9a-f]{64}$/);
    assert.notEqual(parsed.schemaDigest, "sha256:" + "c".repeat(64));
  }
});
