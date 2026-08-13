import test from "node:test";
import assert from "node:assert/strict";
import { readGuardedLiveProviderConfig } from "../../src/authority/host/live-certification.js";
import { CERTIFICATION_SCENARIO_IDS, createProviderCertificationAdapters, runCertificationSuite } from "../../src/authority/host/provider-certification.js";

const config = (provider: string) => readGuardedLiveProviderConfig({ REELIER_LIVE_CERTIFY: "1", REELIER_LIVE_PROVIDER: provider, REELIER_LIVE_ENDPOINT: "https://provider.example.test", REELIER_LIVE_ACCOUNT: "account_1", REELIER_LIVE_CREDENTIAL_REF: `${provider}-ref`, REELIER_LIVE_CLEANUP_REF: `${provider}-cleanup` });

test("provider registry exposes the six founder-stack scenarios", () => {
  const adapters = createProviderCertificationAdapters({
    async runScenario() { return { status: "passed", writes: 1, receiptGraphDigest: "sha256:" + "a".repeat(64), exceptionDigest: null, resentAfterAmbiguity: false }; },
    async cleanupScenario() { return "verified"; },
  });
  assert.deepEqual(adapters.map(adapter => adapter.id), [...CERTIFICATION_SCENARIO_IDS]);
});

test("provider suite runs scenarios sequentially and preserves cleanup evidence", async () => {
  const calls: string[] = [];
  const adapters = createProviderCertificationAdapters({
    async runScenario({ scenarioId }) { calls.push(`run:${scenarioId}`); return { status: "passed", writes: 1, receiptGraphDigest: "sha256:" + "a".repeat(64), exceptionDigest: null, resentAfterAmbiguity: false }; },
    async cleanupScenario({ scenarioId }) { calls.push(`cleanup:${scenarioId}`); return "verified"; },
  });
  const results = await runCertificationSuite({ acknowledgeLive: true, scenarios: [config("github"), config("cloudflare"), config("neon"), config("cloudflare"), config("hubspot"), config("slack")], adapters });
  assert.equal(results.length, 6);
  assert.equal(calls.length, 12);
  assert.equal(calls[0], "run:github-vercel-release");
  assert.equal(calls[1], "cleanup:github-vercel-release");
});
