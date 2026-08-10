import test from "node:test";
import assert from "node:assert/strict";
import { readGuardedLiveProviderConfig, runGuardedLiveProviderCertification } from "../../src/authority/host/live-certification.js";

test("live provider certification is inert unless explicitly enabled", async () => {
  const config = readGuardedLiveProviderConfig({});
  const result = await runGuardedLiveProviderCertification({ config, execute: async () => { throw new Error("must not execute"); } });
  assert.deepEqual(result, { provider: "", status: "skipped", writes: 0, cleanupRequired: false });
});

test("enabled live certification requires references and reports cleanup", async () => {
  assert.throws(() => readGuardedLiveProviderConfig({ REELIER_LIVE_CERTIFY: "1" }), /requires HTTPS endpoint/);
  const config = readGuardedLiveProviderConfig({ REELIER_LIVE_CERTIFY: "1", REELIER_LIVE_PROVIDER: "github", REELIER_LIVE_ENDPOINT: "https://api.example.test", REELIER_LIVE_ACCOUNT: "account_1", REELIER_LIVE_CREDENTIAL_REF: "secret_ref", REELIER_LIVE_CLEANUP_REF: "cleanup_ref" });
  const result = await runGuardedLiveProviderCertification({ config, execute: async () => ({ writes: 1 }) });
  assert.deepEqual(result, { provider: "github", status: "passed", writes: 1, cleanupRequired: true });
});
