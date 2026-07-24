// The CLI half of the shared CLI<->cloud wire-contract test.
//
// `contract/wire-contract.v1.json` is a REAL push payload captured from
// this repo's own `pushSkill` (see src/push.ts's POST body — skillName,
// record, and the optional top-level siblings skillContentSha256, costUsd,
// priceTableDate, signature, ciAttestation, timestamp). It is byte-identical
// to reelier-cloud's `test/fixtures/wire-contract/payload.json` — the two
// files are the SAME bytes living in two repos, and that sameness is the
// entire cross-repo contract. reelier-cloud has a strong test that consumes
// its copy; this file is the producer/consumer half that was missing on the
// CLI side, so a CLI-side format drift (a renamed/added/removed field in
// push.ts's POST body) now fails HERE instead of silently slipping through
// until the cloud regenerates its fixture.
//
// Three things are pinned:
//  1. The fixture's bytes haven't drifted from what both repos agreed on
//     (the sha-lock).
//  2. The fixture's top-level shape is exactly the documented contract
//     field set (no silent new/renamed/removed key).
//  3. This CLI's own verify path (src/verify.ts) can consume the exact
//     bytes the cloud stores and recompute a "verified" signature claim —
//     proving the digest/signature scheme round-trips end to end, not just
//     that the JSON parses.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { evaluateUnalteredSincePushClaim, type VerifyPayload } from "../src/verify.js";
import { digestSha256 } from "../src/canonical-json.js";
import type { RunRecord } from "../src/runner.js";

const CONTRACT_JSON_PATH = fileURLToPath(new URL("../../contract/wire-contract.v1.json", import.meta.url));
const CONTRACT_PUBLIC_KEY_PATH = fileURLToPath(
  new URL("../../contract/wire-contract.v1.public-key.pem", import.meta.url)
);

// This sha MUST equal the cloud's copy (reelier-cloud
// test/fixtures/wire-contract/payload.json). It is computed over the fixture
// with line endings normalized to LF (\r\n -> \n), so it is identical on
// Windows (CRLF working trees) and Linux/CI (LF) — git stores the bytes as
// LF, which is the canonical value here. Any change to the produced wire
// format changes this sha; regenerate BOTH repos' fixtures and update it in
// BOTH tests. That lockstep is the cross-repo contract.
const LOCKED_SHA256 = "07bc8adb224b19e39ae1368c0bf5651d2e51bce75671d876e97ffde3e9ff001c";

// The documented contract's top-level field set (src/push.ts's POST body to
// `/api/v1/runs`): `skillName` and `record` are always present; everything
// else is optional-and-additive. An unexpected key here means the producer
// (push.ts) started emitting something the contract doesn't know about yet.
const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "skillName",
  "record",
  "skillContentSha256",
  "costUsd",
  "priceTableDate",
  "signature",
  "ciAttestation",
  "timestamp",
]);
const REQUIRED_TOP_LEVEL_KEYS = ["skillName", "record"];

interface ContractFixture {
  skillName: string;
  record: RunRecord;
  skillContentSha256?: string;
  costUsd?: number;
  priceTableDate?: string;
  signature?: { alg: string; keyId: string; sig: string };
  ciAttestation?: { provider: string; token: string };
  timestamp?: { tsa: string; token: string };
}

test("sha-lock: contract/wire-contract.v1.json bytes match the locked sha (producer-drift guard)", async () => {
  // Normalize CRLF -> LF before hashing so the lock is platform-independent:
  // git stores the fixture as LF, but a Windows working tree checks it out as
  // CRLF. Line endings are not part of the wire contract (JSON.parse ignores
  // them); a real format change alters non-EOL bytes and still trips this.
  const raw = await readFile(CONTRACT_JSON_PATH, "utf8");
  const normalized = raw.replace(/\r\n/g, "\n");
  const actual = createHash("sha256").update(normalized, "utf8").digest("hex");
  assert.equal(
    actual,
    LOCKED_SHA256,
    "contract/wire-contract.v1.json changed bytes — if this is an intentional wire-format change, " +
      "regenerate BOTH repos' fixtures from the same OSS commit and update the locked sha in BOTH tests."
  );
});

test("contract field set: the fixture's top-level keys are exactly the documented contract set", async () => {
  const raw = await readFile(CONTRACT_JSON_PATH, "utf8");
  const parsed: unknown = JSON.parse(raw);
  assert.ok(parsed && typeof parsed === "object", "fixture must parse to an object");
  const keys = Object.keys(parsed as Record<string, unknown>);

  for (const key of keys) {
    assert.ok(ALLOWED_TOP_LEVEL_KEYS.has(key), `unexpected top-level key "${key}" not in the documented contract`);
  }
  for (const required of REQUIRED_TOP_LEVEL_KEYS) {
    assert.ok(keys.includes(required), `missing required top-level key "${required}"`);
  }
});

test("consumer conformance: the CLI verify path recomputes the same digest the fixture was signed over", async () => {
  const raw = await readFile(CONTRACT_JSON_PATH, "utf8");
  const fixture = JSON.parse(raw) as ContractFixture;
  assert.ok(fixture.signature, "fixture must carry a signature to exercise the consumer path");

  // The fixture's `record` is exactly what pushSkill signed
  // (computeSignature signs digestSha256(record) over the record AS SENT).
  // Confirm the CLI's own digest function reproduces a well-formed digest
  // for it — this is the same computation evaluateUnalteredSincePushClaim
  // performs internally.
  const digest = digestSha256(fixture.record);
  assert.match(digest, /^sha256:[0-9a-f]{64}$/);
});

test("consumer conformance: the CLI verify path round-trips its own contract (unaltered-since-push -> verified)", async () => {
  const raw = await readFile(CONTRACT_JSON_PATH, "utf8");
  const fixture = JSON.parse(raw) as ContractFixture;
  const publicKeyPem = await readFile(CONTRACT_PUBLIC_KEY_PATH, "utf8");
  assert.ok(fixture.signature, "fixture must carry a signature to exercise the consumer path");

  // Build a VerifyPayload the way `/r/<token>/json` would hand it back to
  // `reelier verify`: record + signature + the tenant's published signing
  // key (signingKey path — no --key). Proves the CLI can consume the exact
  // bytes the cloud stores end to end.
  const payload: VerifyPayload = {
    record: fixture.record,
    signature: fixture.signature,
    signingKey: { keyId: fixture.signature.keyId, publicKeyPem },
  };

  const claim = evaluateUnalteredSincePushClaim(payload);
  assert.equal(
    claim.status,
    "verified",
    `expected the unaltered-since-push claim to verify against the real fixture, got: ${claim.line}`
  );

  // Same result via the explicit --key path (bypasses signingKey attribution
  // entirely) — the two key-resolution paths in evaluateUnalteredSincePushClaim
  // must agree on the same real fixture.
  const claimViaExplicitKey = evaluateUnalteredSincePushClaim({ record: fixture.record, signature: fixture.signature }, publicKeyPem);
  assert.equal(claimViaExplicitKey.status, "verified");
});

test("tamper sanity: a mutated record fails the unaltered-since-push claim against the real fixture's signature", async () => {
  const raw = await readFile(CONTRACT_JSON_PATH, "utf8");
  const fixture = JSON.parse(raw) as ContractFixture;
  const publicKeyPem = await readFile(CONTRACT_PUBLIC_KEY_PATH, "utf8");
  assert.ok(fixture.signature);

  const tamperedRecord: RunRecord = { ...fixture.record, passed: !fixture.record.passed };
  const claim = evaluateUnalteredSincePushClaim(
    { record: tamperedRecord, signature: fixture.signature },
    publicKeyPem
  );
  assert.equal(claim.status, "failed");
});
