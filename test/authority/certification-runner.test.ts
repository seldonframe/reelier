import test from "node:test";
import assert from "node:assert/strict";
import { readGuardedLiveProviderConfig } from "../../src/authority/host/live-certification.js";
import { runCertification, type CertificationAdapter } from "../../src/authority/host/certification-runner.js";

const config = readGuardedLiveProviderConfig({
  REELIER_LIVE_CERTIFY: "1",
  REELIER_LIVE_PROVIDER: "github",
  REELIER_LIVE_ENDPOINT: "https://api.github.com",
  REELIER_LIVE_ACCOUNT: "account_1",
  REELIER_LIVE_CREDENTIAL_REF: "github-ref",
  REELIER_LIVE_CLEANUP_REF: "github-cleanup",
});

function adapter(overrides: Partial<CertificationAdapter> = {}): CertificationAdapter {
  return {
    id: "github-labels",
    provider: "github",
    async run() { return { status: "passed", writes: 1, receiptGraphDigest: "sha256:" + "a".repeat(64), exceptionDigest: null, resentAfterAmbiguity: false }; },
    async cleanup() { return "verified"; },
    ...overrides,
  };
}

test("certification runner requires explicit live acknowledgement and an adapter", async () => {
  await assert.rejects(() => runCertification({ config: { ...config, enabled: false }, acknowledgeLive: true, adapterId: "github-labels", adapters: [adapter()] }), /explicit live certification/);
  await assert.rejects(() => runCertification({ config, acknowledgeLive: false, adapterId: "github-labels", adapters: [adapter()] }), /explicit live certification/);
  await assert.rejects(() => runCertification({ config, acknowledgeLive: true, adapterId: "missing", adapters: [adapter()] }), /unknown certification adapter/);
});

test("runner refuses ambiguity retries and requires verified cleanup", async () => {
  await assert.rejects(() => runCertification({ config, acknowledgeLive: true, adapterId: "github-labels", adapters: [adapter({ async run() { return { status: "ambiguous", writes: 1, receiptGraphDigest: null, exceptionDigest: "sha256:" + "b".repeat(64), resentAfterAmbiguity: true }; } })] }), /automatic resend/);
  await assert.rejects(() => runCertification({ config, acknowledgeLive: true, adapterId: "github-labels", adapters: [adapter({ async cleanup() { return "failed"; } })] }), /cleanup/);
});

test("runner returns immutable redacted evidence for a passed scenario", async () => {
  const result = await runCertification({ config, acknowledgeLive: true, adapterId: "github-labels", adapters: [adapter()] });
  assert.deepEqual(result, {
    v: "reelier.certification-evidence/v1",
    provider: "github",
    scenarioId: "github-labels",
    status: "passed",
    writes: 1,
    cleanup: "verified",
    receiptGraphDigest: "sha256:" + "a".repeat(64),
    exceptionDigest: null,
  });
  assert.equal(Object.isFrozen(result), true);
});
