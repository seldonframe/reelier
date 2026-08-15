import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectProfileGovernanceStatus, loadProfileGovernanceFromOperatorTrust } from "../../src/authority/host/profile-governance-loader.js";
import { governanceRef, tenant, verificationTime, writeProfileGovernanceFixture } from "./profile-governance-fixture.js";

test("cold loader admits the fixed operator-owned governance directory deterministically", async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), "reelier-profile-loader-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const fixture = await writeProfileGovernanceFixture(home);
  const input = { tenant, governanceRef, expectedManifestDigest: fixture.manifestDigest, expectedTrustHeadDigest: fixture.manifest.trustHeadDigest, homedir: home, verificationTime };
  const first = await loadProfileGovernanceFromOperatorTrust(input);
  const second = await loadProfileGovernanceFromOperatorTrust(input);
  assert.notEqual(first, second, "each cold load mints a fresh opaque admission");
  assert.deepEqual(await inspectProfileGovernanceStatus(input), { status: "verified", profileDigest: fixture.manifest.profileDigest, activationDigest: fixture.manifest.activationDigest, trustHeadDigest: fixture.manifest.trustHeadDigest });
});

test("loader refuses missing, substituted, traversing, and malformed operator trust", async t => {
  for (const mutation of ["missing", "manifest-substitution", "trust-head-substitution", "path-traversal", "extra-field"] as const) {
    const home = await mkdtemp(path.join(os.tmpdir(), `reelier-profile-${mutation}-`));
    t.after(() => rm(home, { recursive: true, force: true }));
    const fixture = await writeProfileGovernanceFixture(home);
    const input: any = { tenant, governanceRef, expectedManifestDigest: fixture.manifestDigest, expectedTrustHeadDigest: fixture.manifest.trustHeadDigest, homedir: home, verificationTime };
    if (mutation === "missing") await unlink(path.join(fixture.root, "activation.json"));
    if (mutation === "manifest-substitution") input.expectedManifestDigest = `sha256:${"0".repeat(64)}`;
    if (mutation === "trust-head-substitution") input.expectedTrustHeadDigest = `sha256:${"0".repeat(64)}`;
    if (mutation === "path-traversal") input.governanceRef = "../escape";
    if (mutation === "extra-field") input.extra = true;
    await assert.rejects(() => loadProfileGovernanceFromOperatorTrust(input), TypeError, mutation);
  }
});

test("loader refuses an accessor without invoking it", async () => {
  let getters = 0;
  const input = Object.defineProperty({ tenant, governanceRef, expectedManifestDigest: `sha256:${"0".repeat(64)}`, expectedTrustHeadDigest: `sha256:${"0".repeat(64)}`, verificationTime }, "homedir", { enumerable: true, get() { getters += 1; return os.homedir(); } });
  await assert.rejects(() => loadProfileGovernanceFromOperatorTrust(input as never), /own data|exact fields|plain record/i);
  assert.equal(getters, 0);
});

test("status inspection is sanitized and never returns an admission handle", async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), "reelier-profile-status-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const fixture = await writeProfileGovernanceFixture(home);
  await writeFile(path.join(fixture.root, "manifest.json"), "{}\n");
  const status = await inspectProfileGovernanceStatus({ tenant, governanceRef, expectedManifestDigest: fixture.manifestDigest, expectedTrustHeadDigest: fixture.manifest.trustHeadDigest, homedir: home, verificationTime });
  assert.equal(status.status, "failed");
  assert.equal("governance" in status, false);
  assert.equal("handle" in status, false);
});
