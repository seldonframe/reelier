import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FsContinuityLedger } from "../../src/continuity/fs-ledger.js";
import { actor, checkpoint, decision, digest, opened, withRoot } from "./fixtures.js";

test("ledger persists canonical digest-chained checkpoints across restart", async () => {
  await withRoot(async root => {
    const first = new FsContinuityLedger(root);
    const appended = await first.append(actor, checkpoint(0, [opened]));
    assert.equal(appended.ok, true);
    assert.equal(appended.cursor, 1);
    const restarted = new FsContinuityLedger(root);
    const snapshot = await restarted.read("task_1");
    assert.equal(snapshot.cursor, 1);
    assert.equal(snapshot.state?.outcome, "Ship the bounded release");
  });
});

test("ledger refuses stale cursors atomically", async () => {
  await withRoot(async root => {
    const ledger = new FsContinuityLedger(root);
    await ledger.append(actor, checkpoint(0, [opened]));
    const before = await ledger.read("task_1");
    const stale = await ledger.append(actor, checkpoint(0, [decision]));
    const after = await ledger.read("task_1");
    assert.deepEqual(stale, { ok: false, reason: "stale-cursor", expectedCursor: 0, actualCursor: 1 });
    assert.equal(after.segmentDigest, before.segmentDigest);
    assert.equal(after.state?.decisions.size, 0);
  });
});

test("ledger blocks on orphaned writer locks instead of guessing recovery", async () => {
  await withRoot(async root => {
    const ledger = new FsContinuityLedger(root);
    await mkdir(join(root, "task_1", ".writer-lock"), { recursive: true });
    await assert.rejects(() => ledger.append(actor, checkpoint(0, [opened])), /writer lock|busy/i);
  });
});

test("ledger detects changed segment bytes before returning resumable state", async () => {
  await withRoot(async root => {
    const ledger = new FsContinuityLedger(root);
    await ledger.append(actor, checkpoint(0, [opened]));
    const files = await readdir(join(root, "task_1"));
    const segment = files.find((file) => file.endsWith(".json"));
    assert.ok(segment);
    const path = join(root, "task_1", segment);
    const body = await readFile(path, "utf8");
    await writeFile(path, body.replace("bounded release", "unbounded release"));
    await assert.rejects(() => ledger.read("task_1"), /digest|canonical|corrupt/i);
  });
});

test("ledger rejects unknown task-directory entries", async () => {
  await withRoot(async root => {
    const ledger = new FsContinuityLedger(root);
    await ledger.append(actor, checkpoint(0, [opened]));
    await writeFile(join(root, "task_1", "notes.txt"), "not a segment");
    await assert.rejects(() => ledger.read("task_1"), /unknown.*entry/i);
  });
});

test("ledger refuses a task path that is a directory link", async () => {
  await withRoot(async root => {
    const target = join(root, "outside");
    await mkdir(target);
    await symlink(target, join(root, "task_1"), "junction");
    const ledger = new FsContinuityLedger(root);
    await assert.rejects(() => ledger.append(actor, checkpoint(0, [opened])), /symbolic link|directory link/i);
    assert.deepEqual(await readdir(target), []);
  });
});

test("append responses preserve evidence references from every prior segment", async () => {
  await withRoot(async root => {
    const ledger = new FsContinuityLedger(root);
    await ledger.append(actor, { ...checkpoint(0, [opened]), evidenceRefs: [digest("e")] });
    const second = await ledger.append(actor, { ...checkpoint(1, []), evidenceRefs: [digest("f")] });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.deepEqual(second.state.evidenceRefs, [digest("e"), digest("f")]);
    assert.deepEqual((await new FsContinuityLedger(root).read("task_1")).state?.evidenceRefs, [digest("e"), digest("f")]);
  });
});
