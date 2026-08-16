import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { inspectProfileGovernanceStatus, loadProfileGovernanceFromOperatorTrust } from "../../src/authority/host/profile-governance-loader.js";
import { admittedProfileGovernanceState } from "../../src/authority/host/profile-governance.js";
import { authorityDigest } from "../../src/authority/wire.js";
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

test("operator-root commitment includes the accepted physical directory identity", async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), "reelier-profile-physical-root-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const fixture = await writeProfileGovernanceFixture(home);
  const admitted = await loadProfileGovernanceFromOperatorTrust({ tenant, governanceRef, expectedManifestDigest: fixture.manifestDigest, expectedTrustHeadDigest: fixture.manifest.trustHeadDigest, homedir: home, verificationTime });
  const physical = await (await import("node:fs/promises")).lstat(fixture.root);
  assert.equal(admittedProfileGovernanceState(admitted).operatorRootDigest, authorityDigest({
    v: "reelier.profile-governance-operator-root/v1", tenant, governanceRef,
    canonicalRoot: fixture.root, device: String(physical.dev), inode: String(physical.ino),
  }));
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

test("loader refuses a governance-root junction even when it contains a complete valid generation", async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), "reelier-profile-junction-home-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "reelier-profile-junction-target-"));
  t.after(() => Promise.all([rm(home, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  const fixture = await writeProfileGovernanceFixture(home);
  const moved = path.join(outside, "generation");
  await rename(fixture.root, moved);
  await symlink(moved, fixture.root, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(() => loadProfileGovernanceFromOperatorTrust({ tenant, governanceRef, expectedManifestDigest: fixture.manifestDigest, expectedTrustHeadDigest: fixture.manifest.trustHeadDigest, homedir: home, verificationTime }), /link|junction|physical|canonical/i);
});

test("each of the six cold reads refuses a child from a different generation", async t => {
  const names = ["trust-pin.json", "manifest.json", "profile.json", "conformance-report.json", "conformance.json", "activation.json"] as const;
  for (const name of names) {
    const home = await mkdtemp(path.join(os.tmpdir(), `reelier-profile-six-read-${name.replace(".json", "")}-`));
    t.after(() => rm(home, { recursive: true, force: true }));
    const fixture = await writeProfileGovernanceFixture(home);
    const target = path.join(fixture.root, name);
    const displaced = `${target}.accepted-generation`;
    await rename(target, displaced);
    await writeFile(target, "{}\n", { flag: "wx" });
    await assert.rejects(
      () => loadProfileGovernanceFromOperatorTrust({ tenant, governanceRef, expectedManifestDigest: fixture.manifestDigest, expectedTrustHeadDigest: fixture.manifest.trustHeadDigest, homedir: home, verificationTime }),
      /invalid|closed|digest|manifest|trust|profile|conformance|activation/i,
      name,
    );
  }
});

test("a child replacement after a successful cold load cannot be adopted as the same generation", async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), "reelier-profile-child-replacement-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const fixture = await writeProfileGovernanceFixture(home);
  const input = { tenant, governanceRef, expectedManifestDigest: fixture.manifestDigest, expectedTrustHeadDigest: fixture.manifest.trustHeadDigest, homedir: home, verificationTime };
  await loadProfileGovernanceFromOperatorTrust(input);
  const target = path.join(fixture.root, "activation.json");
  await rename(target, `${target}.accepted-generation`);
  await writeFile(target, "{}\n", { flag: "wx" });
  await assert.rejects(() => loadProfileGovernanceFromOperatorTrust(input), /activation|invalid|closed|digest/i);
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

type LoaderOpenEvent = Readonly<{
  name: string;
  phase: "before-child-open" | "child-opened" | "after-child-read";
}>;

async function installLoaderOpenBarrier(barrier: (event: LoaderOpenEvent) => Promise<void>): Promise<() => void> {
  const implementation = await import("../../src/authority/host/profile-governance-loader.js") as Record<string, unknown>;
  const install = implementation.__testSetProfileGovernanceFilesystemBarrier;
  assert.equal(typeof install, "function", "the package-private loader open barrier is required for deterministic physical-root races");
  return (install as (value: typeof barrier) => () => void)(barrier);
}

test("all six child opens remain bound to the retained operator root through swap and restore", async t => {
  const names = ["trust-pin.json", "manifest.json", "profile.json", "conformance-report.json", "conformance.json", "activation.json"] as const;
  for (const name of names) {
    const home = await mkdtemp(path.join(os.tmpdir(), `reelier-profile-root-open-${name.replace(".json", "")}-`));
    t.after(() => rm(home, { recursive: true, force: true }));
    const fixture = await writeProfileGovernanceFixture(home);
    const accepted = `${fixture.root}.accepted`;
    const replacement = `${fixture.root}.replacement`;
    let swapped = false;
    const restore = await installLoaderOpenBarrier(async event => {
      if (event.name !== name) return;
      if (event.phase === "before-child-open") {
        await rename(fixture.root, accepted);
        await mkdir(fixture.root);
        await writeFile(path.join(fixture.root, name), "{}\n", { flag: "wx" });
        swapped = true;
      } else if (event.phase === "child-opened" && swapped) {
        await rename(fixture.root, replacement);
        await rename(accepted, fixture.root);
      }
    });
    try {
      const admitted = await loadProfileGovernanceFromOperatorTrust({ tenant, governanceRef, expectedManifestDigest: fixture.manifestDigest, expectedTrustHeadDigest: fixture.manifest.trustHeadDigest, homedir: home, verificationTime });
      assert.equal(admittedProfileGovernanceState(admitted).manifestDigest, fixture.manifestDigest, name);
      assert.equal(await (await import("node:fs/promises")).readFile(path.join(replacement, name), "utf8"), "{}\n", `${name} must not be sourced from the pathname replacement`);
    } finally {
      restore();
    }
  }
});

test("child replacement before, during, and after open is refused without a mixed generation", async t => {
  for (const attackPhase of ["before-child-open", "child-opened", "after-child-read"] as const) {
    const home = await mkdtemp(path.join(os.tmpdir(), `reelier-profile-child-${attackPhase}-`));
    t.after(() => rm(home, { recursive: true, force: true }));
    const fixture = await writeProfileGovernanceFixture(home);
    const target = path.join(fixture.root, "activation.json"), accepted = `${target}.accepted`, replacement = `${target}.replacement`;
    const restore = await installLoaderOpenBarrier(async event => {
      if (event.name !== "activation.json" || event.phase !== attackPhase) return;
      await rename(target, accepted);
      await writeFile(target, "{}\n", { flag: "wx" });
      await rename(target, replacement);
      await rename(accepted, target);
    });
    try {
      await assert.rejects(
        () => loadProfileGovernanceFromOperatorTrust({ tenant, governanceRef, expectedManifestDigest: fixture.manifestDigest, expectedTrustHeadDigest: fixture.manifest.trustHeadDigest, homedir: home, verificationTime }),
        /identity|generation|changed|replacement|physical|open/i,
        attackPhase,
      );
    } finally {
      restore();
    }
  }
});

test("Linux child opens governance artifacts relative to a retained directory fd", { skip: process.platform === "linux" ? false : "requires an already-available Linux Node executor" }, async t => {
  const home = await mkdtemp(path.join(os.tmpdir(), "reelier-linux-openat-loader-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const script = `import {mkdir,mkdtemp,open,readFile,rename,rm,writeFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';const root=await mkdtemp(path.join(os.tmpdir(),'reelier-openat-'));const accepted=path.join(root,'accepted'),replacement=path.join(root,'replacement'),moved=path.join(root,'moved');await mkdir(accepted);await writeFile(path.join(accepted,'child.json'),'accepted');const handle=await open(accepted,'r');await rename(accepted,moved);await mkdir(accepted);await writeFile(path.join(accepted,'child.json'),'replacement');const value=await readFile('/proc/self/fd/'+handle.fd+'/child.json','utf8');await handle.close();process.stdout.write(JSON.stringify({value,replacement:await readFile(path.join(accepted,'child.json'),'utf8')}));await rm(root,{recursive:true,force:true});`;
  const child = await promisify(execFile)(process.execPath, ["--input-type=module", "--eval", script], { cwd: process.cwd(), env: { ...process.env, HOME: home, USERPROFILE: home } });
  assert.deepEqual(JSON.parse(child.stdout), { value: "accepted", replacement: "replacement" });
});
