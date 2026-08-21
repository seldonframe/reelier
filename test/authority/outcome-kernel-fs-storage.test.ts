import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFileOutcomeKernelStorage } from "../../src/authority/host/index.js";
import { authorityDigest } from "../../src/authority/wire.js";
import type { GovernedReceiptV1, MissionClaimV1 } from "../../src/authority/tool-effect-contract.js";

const sha = (c: string) => `sha256:${c.repeat(64)}`;
const mission = (prompt = sha("b")): MissionClaimV1 => ({ v: "reelier.mission-claim/v1", missionId: "mission_1", mandateDigest: sha("a"), promptDigest: prompt, contractDigests: [sha("c")], claimedAt: "2026-08-21T00:00:00.000Z" });

test("file Outcome kernel storage converges claims and receipt heads across reopen", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "reelier-outcome-store-"));
  try {
    const first = await createFileOutcomeKernelStorage({ rootDir });
    const claim = mission(), digest = authorityDigest(claim);
    const races = await Promise.all([first.claimMission(claim, digest), first.claimMission(claim, digest)]);
    assert.deepEqual(new Set(races.map(item => item.status)), new Set(["claimed", "exact-existing"]));
    assert.equal((await first.claimMission(mission(sha("d")), authorityDigest(mission(sha("d"))))).status, "conflict");

    const receipt: GovernedReceiptV1 = { v: "reelier.governed-receipt/v1", receiptId: "receipt_1", outcomeDigest: sha("e"), missionDigest: digest, issuedAt: "2026-08-21T00:00:01.000Z", status: "verified" };
    const receiptDigest = authorityDigest(receipt);
    assert.equal((await first.compareAndPublishReceipt(receipt, receiptDigest)).status, "published");

    const reopened = await createFileOutcomeKernelStorage({ rootDir });
    assert.deepEqual(await reopened.loadMission("mission_1"), claim);
    const head = await reopened.loadReceipt("receipt_1");
    assert.equal(head?.receiptDigest, receiptDigest);
    assert.equal((await reopened.compareAndPublishReceipt(receipt, receiptDigest)).status, "exact-existing");
    assert.equal((await reopened.compareAndPublishReceipt({ ...receipt, outcomeDigest: sha("f") }, authorityDigest({ ...receipt, outcomeDigest: sha("f") }))).status, "conflict");
  } finally { await rm(rootDir, { recursive: true, force: true }); }
});
