import test from "node:test";
import assert from "node:assert/strict";
import { runAuthorityCommand } from "../../src/authority/cli.js";

test("authority certify preflight reports missing live references without secrets", async () => {
  const previous = { certify: process.env.REELIER_LIVE_CERTIFY, provider: process.env.REELIER_LIVE_PROVIDER, account: process.env.REELIER_LIVE_ACCOUNT, credential: process.env.REELIER_LIVE_CREDENTIAL_REF, cleanup: process.env.REELIER_LIVE_CLEANUP_REF };
  try {
    delete process.env.REELIER_LIVE_CERTIFY;
    delete process.env.REELIER_LIVE_PROVIDER;
    delete process.env.REELIER_LIVE_ACCOUNT;
    delete process.env.REELIER_LIVE_CREDENTIAL_REF;
    delete process.env.REELIER_LIVE_CLEANUP_REF;
    let output = "";
    const original = console.log;
    console.log = (...args: unknown[]) => { output += args.join(" "); };
    const code = await runAuthorityCommand({ positional: ["certify", "preflight"], flags: new Set(), opts: {} });
    console.log = original;
    assert.equal(code, 1);
    assert.match(output, /reelier\.certification-preflight\/v1/);
  } finally {
    for (const [key, value] of Object.entries({ REELIER_LIVE_CERTIFY: previous.certify, REELIER_LIVE_PROVIDER: previous.provider, REELIER_LIVE_ACCOUNT: previous.account, REELIER_LIVE_CREDENTIAL_REF: previous.credential, REELIER_LIVE_CLEANUP_REF: previous.cleanup })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("authority certify run refuses until a live adapter is explicitly configured", async () => {
  const previous = process.env.REELIER_LIVE_CERTIFY;
  try {
    process.env.REELIER_LIVE_CERTIFY = "1";
    let output = "";
    const original = console.error;
    console.error = (...args: unknown[]) => { output += args.join(" "); };
    const code = await runAuthorityCommand({ positional: ["certify", "run"], flags: new Set(), opts: { adapter: "github-labels" } });
    console.error = original;
    assert.equal(code, 1);
    assert.match(output, /adapter-runner-not-configured/);
  } finally {
    if (previous === undefined) delete process.env.REELIER_LIVE_CERTIFY; else process.env.REELIER_LIVE_CERTIFY = previous;
  }
});
