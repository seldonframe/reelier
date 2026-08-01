import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadPolicyForWrap, policyPaths, policyRecordFromLoad, emptyPolicy, type PolicyRecord } from "../src/policy.js";

// ---------------------------------------------------------------------------
// docs/specs/policy-attestation-v1.md §2 — the policy record.
//
// The whole point: a run under a live enforcing policy and a run with no
// policy file at all must stop producing byte-identical evidence. `status`
// uses the existing four-state vocabulary with its existing meanings.
// ---------------------------------------------------------------------------

async function tmpRepo(): Promise<{ cwd: string; home: string; cleanup: () => Promise<void> }> {
  const cwd = await mkdtemp(path.join(tmpdir(), "reelier-polrec-cwd-"));
  const home = await mkdtemp(path.join(tmpdir(), "reelier-polrec-home-"));
  return {
    cwd,
    home,
    cleanup: async () => {
      await rm(cwd, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    },
  };
}

async function writeProjectPolicy(cwd: string, home: string, body: string | Buffer): Promise<string> {
  const { project } = policyPaths(cwd, home);
  await mkdir(path.dirname(project), { recursive: true });
  await writeFile(project, body);
  return project;
}

const CLEAN_POLICY = 'version: 1\ndeny:\n  - tool: "crm.delete_*"\n  - endpoint: "*.stripe.com"\ndry_run:\n  - tool: "crm.*"\n';

// --- the four states -------------------------------------------------------

test("policy record: a clean, in-force policy is `verified` with a digest, a source and rule counts", async () => {
  const { cwd, home, cleanup } = await tmpRepo();
  try {
    await writeProjectPolicy(cwd, home, CLEAN_POLICY);
    const rec = policyRecordFromLoad(await loadPolicyForWrap(cwd, home));

    assert.equal(rec.status, "verified");
    assert.match(rec.digest!, /^sha256:[0-9a-f]{64}$/);
    assert.equal(rec.sourcePath, "project");
    assert.deepEqual(rec.rules, { deny: 2, dryRun: 1, toolScoped: 2 });
  } finally {
    await cleanup();
  }
});

test("policy record: a malformed policy is `failed` and STILL carries a digest (an unparseable file has no canonical form)", async () => {
  const { cwd, home, cleanup } = await tmpRepo();
  try {
    await writeProjectPolicy(cwd, home, "  bad: indent\n");
    const rec = policyRecordFromLoad(await loadPolicyForWrap(cwd, home));

    assert.equal(rec.status, "failed");
    assert.match(rec.digest!, /^sha256:[0-9a-f]{64}$/);
    assert.equal(rec.sourcePath, "project");
    // Rule counts are omitted: nothing parsed, so there is nothing to count.
    assert.equal(rec.rules, undefined);
  } finally {
    await cleanup();
  }
});

test("policy record: an unreadable policy is `unchecked` with NO digest — bytes we never read cannot be hashed", async () => {
  const { cwd, home, cleanup } = await tmpRepo();
  try {
    const { project } = policyPaths(cwd, home);
    await mkdir(project, { recursive: true }); // EISDIR — see policy.test.ts's fixture note
    const rec = policyRecordFromLoad(await loadPolicyForWrap(cwd, home));

    assert.equal(rec.status, "unchecked");
    assert.equal(rec.digest, undefined);
    assert.equal(rec.sourcePath, "project"); // WHICH file is unreadable is material and leaks nothing
    assert.equal(rec.rules, undefined);
  } finally {
    await cleanup();
  }
});

test("policy record: no file at either candidate is `absent` — digest and sourcePath both omitted", async () => {
  const { cwd, home, cleanup } = await tmpRepo();
  try {
    const rec = policyRecordFromLoad(await loadPolicyForWrap(cwd, home));

    assert.equal(rec.status, "absent");
    assert.equal(rec.digest, undefined);
    assert.equal(rec.sourcePath, undefined);
    assert.equal(rec.rules, undefined);
  } finally {
    await cleanup();
  }
});

test("policy record: the global file is named `global`, never an absolute path", async () => {
  const { cwd, home, cleanup } = await tmpRepo();
  try {
    const { global } = policyPaths(cwd, home);
    await mkdir(path.dirname(global), { recursive: true });
    await writeFile(global, CLEAN_POLICY, "utf8");

    const rec = policyRecordFromLoad(await loadPolicyForWrap(cwd, home));
    assert.equal(rec.status, "verified");
    assert.equal(rec.sourcePath, "global");
  } finally {
    await cleanup();
  }
});

// --- the digest ------------------------------------------------------------

test("policy digest: over RAW FILE BYTES — a BOM'd file and its BOM-less twin hash differently (S8 regression class)", async () => {
  const withBom = await tmpRepo();
  const without = await tmpRepo();
  try {
    // The S8 review found a UTF-8 BOM masking the `state_gate` key while the
    // warning insisted the file contained no such key. A canonical-form
    // digest cannot see a BOM. A raw-bytes digest can, and two files a human
    // reads as identical hashing differently is the SIGNAL, not the noise.
    await writeProjectPolicy(withBom.cwd, withBom.home, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(CLEAN_POLICY, "utf8")]));
    await writeProjectPolicy(without.cwd, without.home, Buffer.from(CLEAN_POLICY, "utf8"));

    const bomRec = policyRecordFromLoad(await loadPolicyForWrap(withBom.cwd, withBom.home));
    const plainRec = policyRecordFromLoad(await loadPolicyForWrap(without.cwd, without.home));

    assert.ok(bomRec.digest, "a BOM'd file still gets a digest");
    assert.ok(plainRec.digest);
    assert.notEqual(bomRec.digest, plainRec.digest);
    // And the digest is exactly sha256 over the bytes on disk — nothing
    // normalizes the BOM out of the hashed input.
    const expected = "sha256:" + createHash("sha256").update(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(CLEAN_POLICY, "utf8")])).digest("hex");
    assert.equal(bomRec.digest, expected);
  } finally {
    await withBom.cleanup();
    await without.cleanup();
  }
});

test("policy digest: bound to the load-time bytes — mutating the file after load never changes it (the honesty pin)", async () => {
  const { cwd, home, cleanup } = await tmpRepo();
  try {
    const project = await writeProjectPolicy(cwd, home, CLEAN_POLICY);
    const loaded = await loadPolicyForWrap(cwd, home);

    // The operator edits policy.yml while the wrap is still running. The
    // in-memory policy keeps enforcing the OLD rules, so the record must name
    // the OLD bytes. A record that hashed the file at record-write time would
    // claim `verified` over bytes that never governed a single call — a
    // fabricated positive, never-list #1 in its worst form.
    await writeFile(project, 'version: 1\ndeny:\n  - tool: "totally.different_*"\n', "utf8");

    const rec = policyRecordFromLoad(loaded);
    const expected = "sha256:" + createHash("sha256").update(Buffer.from(CLEAN_POLICY, "utf8")).digest("hex");
    assert.equal(rec.status, "verified");
    assert.equal(rec.digest, expected, "digest must be the bytes that were LOADED, not the bytes now on disk");
  } finally {
    await cleanup();
  }
});

test("policy digest: a found policy with no bound bytes degrades to `unchecked`, NEVER `verified`", () => {
  // The safe-direction rule: `verified` is earned or it is not claimed. A
  // caller holding a Policy it cannot tie to a byte buffer has nothing to
  // attest, so it must say so rather than assert the strongest state.
  const rec = policyRecordFromLoad({
    ok: true,
    policy: emptyPolicy(),
    sourcePath: "/x/.reelier/policy.yml",
    which: "project",
    // no digest
  });
  assert.equal(rec.status, "unchecked");
  assert.equal(rec.digest, undefined);
});

// --- privacy ---------------------------------------------------------------

test("policy record: never carries rule content — no glob, host, or absolute path reaches the record", async () => {
  const { cwd, home, cleanup } = await tmpRepo();
  try {
    await writeProjectPolicy(
      cwd,
      home,
      'version: 1\ndeny:\n  - tool: "acme_internal.wipe_ledger"\n  - endpoint: "*.secret-vendor.example"\ndry_run:\n  - tool: "acme_internal.*"\n'
    );
    const rec = policyRecordFromLoad(await loadPolicyForWrap(cwd, home));
    const serialized = JSON.stringify(rec);

    // A policy.yml names internal tools and destination hosts. It is
    // operational topology, and a record is a publishable artifact.
    for (const sentinel of ["acme_internal", "wipe_ledger", "secret-vendor", ".reelier", cwd, home]) {
      assert.equal(serialized.includes(sentinel), false, `record leaked ${sentinel}: ${serialized}`);
    }
    assert.ok(["project", "global"].includes(rec.sourcePath!));
  } finally {
    await cleanup();
  }
});

test("policy record: rule counts describe the file; toolScoped excludes endpoint rules", async () => {
  const { cwd, home, cleanup } = await tmpRepo();
  try {
    await writeProjectPolicy(
      cwd,
      home,
      'version: 1\ndeny:\n  - endpoint: "*.a.example"\n  - endpoint: "*.b.example"\n  - tool: "x.*"\ndry_run:\n  - tool: "y.*"\n'
    );
    const rec = policyRecordFromLoad(await loadPolicyForWrap(cwd, home));
    // toolScoped is the honest denominator for `unmatchedRules` (S4): an
    // endpoint rule has no tool glob, so it can never be reported unmatched,
    // and counting it would silently dilute the ratio.
    assert.deepEqual(rec.rules, { deny: 3, dryRun: 1, toolScoped: 2 });
  } finally {
    await cleanup();
  }
});

// --- shape -----------------------------------------------------------------

test("policy record: absent/unchecked records carry no undefined keys (omitted, never null)", async () => {
  const { cwd, home, cleanup } = await tmpRepo();
  try {
    const rec: PolicyRecord = policyRecordFromLoad(await loadPolicyForWrap(cwd, home));
    assert.deepEqual(Object.keys(rec), ["status"]);
    assert.equal(JSON.stringify(rec), '{"status":"absent"}');
  } finally {
    await cleanup();
  }
});
