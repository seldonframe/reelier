import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VerifiedAuthorityReceiptBundle } from "../../src/authority/verify.js";
import { runAuthorityCommand } from "../../src/authority/cli.js";
import { verifyCertificationTaskReceiptGraph } from "../../src/authority/certification/task-receipt-graph.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";
import { continuityEventsFromVerifiedAuthorityReceipt } from "../../src/continuity/authority-bridge.js";
import { FsContinuityLedger } from "../../src/continuity/fs-ledger.js";
import { digest, withRoot } from "./fixtures.js";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function verifiedReceipt(): VerifiedAuthorityReceiptBundle {
  const decisionContext = { tenant: "tenant_1", requestKey: digest("4") };
  const decisionContextDigest = authorityDigest(decisionContext);
  const gateEventDigest = digest("5");
  const evidenceValue = {
    receiptId: "receipt_1",
    decisionContextDigest,
    gateEventDigest,
    reservationId: "reservation_1",
    timeline: [
      { state: "reserved", eventDigest: digest("1") },
      { state: "dispatched", eventDigest: digest("2") },
      { state: "ambiguous", eventDigest: digest("3") },
    ],
  };
  const evidenceDigest = authorityDigest(evidenceValue);
  const receiptValue = {
    receiptId: "receipt_1",
    decisionContextDigest,
    gateEventDigest,
    evidenceDigest,
    decisionContext,
  };
  const receiptDigest = authorityDigest(receiptValue);
  const bundle = deepFreeze({
    evidence: {
      digest: evidenceDigest,
      value: evidenceValue,
    },
    receipt: {
      digest: receiptDigest,
      value: receiptValue,
    },
  });
  return Object.freeze({
    bundle,
    digest: authorityDigest(bundle),
    tenant: "tenant_1",
    claims: Object.freeze({}),
    priorReceiptDigest: null,
  }) as unknown as VerifiedAuthorityReceiptBundle;
}

test("a frozen self-hashed structural receipt cannot impersonate verifier-produced native evidence", () => {
  assert.throws(
    () => continuityEventsFromVerifiedAuthorityReceipt(verifiedReceipt() as never),
    /native|verifier-produced|provenance|brand/i,
  );
});

test("the bridge preserves the verifier-produced native outcome proof edges", async () => {
  await withRoot(async root => {
    const output = join(root, "factory-evidence");
    const stdout: string[] = [];
    const originalLog = console.log;
    const restorePlatform = __testSetAuthorityCellHostPlatform("linux");
    console.log = (...values: unknown[]) => { stdout.push(values.join(" ")); };
    try {
      const code = await runAuthorityCommand({ positional: ["certify", "factory-journey"], flags: new Set(), opts: { out: output } });
      assert.equal(code, 0);
    } finally {
      console.log = originalLog;
      restorePlatform();
    }
    const line = JSON.parse(stdout.at(-1) ?? "null") as { graphPath: string; trustPath: string };
    const graph = JSON.parse(await readFile(line.graphPath, "utf8"));
    const trustPin = JSON.parse(await readFile(line.trustPath, "utf8"));
    const signerId = trustPin.keyDescriptors.find((item: any) => item.role === "authority-cell" && item.purpose === "authority-evidence")?.keyId;
    const currentTrustObservation = {
      v: "reelier.portable-current-trust-observation/v1",
      observedAt: "2026-08-11T20:00:00.000Z",
      expiresAt: "2026-08-11T21:00:00.000Z",
      activeAuthorityEvidenceSignerIds: [signerId],
    };
    const expectedResponseSemanticsProfile = {
      v: "reelier.http-response-semantics/v1" as const,
      profileId: "github.issue-labels.hermetic-v1",
      acknowledgedStatuses: [200],
    };
    const verified = verifyCertificationTaskReceiptGraph(graph, {
      trustPin,
      currentTrustObservation,
      now: new Date("2026-08-11T20:10:00.000Z"),
      expectedResponseSemanticsProfile,
    });
    const events = continuityEventsFromVerifiedAuthorityReceipt(verified as never);
    assert.ok(events.length > 0);
    const event = events.at(-1)! as any;
    const publication = graph.portableOutcomeEvidence[0];
    const requestId = graph.postStateEvidence[0].requestId;
    const requestReceipts = graph.receipts.filter((item: any) => item.receipt.value.decisionContext.requestId === requestId);
    const terminalReceipt = requestReceipts.at(-1);
    assert.equal(event.semanticOperationId, publication.requestId);
    assert.equal(event.reservationId, terminalReceipt.evidence.value.reservationId);
    assert.equal(event.verification.status, "verified");
    assert.equal(event.verification.graphDigest, authorityDigest(graph));
    assert.equal(event.verification.routeAuthorityDigest, publication.evidence.routeAuthorityDigest);
    assert.equal(event.verification.authenticatedIdentityDigest, authorityDigest(publication.authenticatedIdentity));
    assert.equal(event.verification.materializedRequestDigest, publication.evidence.materializedRequestDigest);
    assert.equal(event.verification.responseSemanticsProfileDigest, publication.evidence.responseSemanticsProfileDigest);
    assert.equal(event.verification.preStateEvidenceDigest, publication.evidence.preStateEvidenceDigest);
    assert.equal(event.verification.postStateEvidenceDigest, publication.evidence.postStateEvidenceDigest);
    assert.deepEqual(event.verification.claimStatuses, terminalReceipt.receipt.value.claims);
    assert.deepEqual(event.verification.noResend, { status: "verified", resendCount: 0 });
    assert.equal(event.verification.receiptChainDigest, publication.receiptChainDigest);
    assert.equal(event.verification.cleanupParentReceiptDigest, publication.evidence.cleanupParentReceiptDigest);
    assert.equal(event.verification.terminalDigest, publication.terminalDigest);
    assert.equal(event.verification.currentTrustObservationDigest, publication.currentTrustObservationDigest);

    const actor = {
      v: "reelier.authenticated-workload/v1" as const,
      taskId: graph.taskId,
      principalId: "principal_continuity",
      workloadId: "workload_continuity",
      runtimeSessionId: "session_continuity",
      harnessId: "codex",
    };
    const ledger = new FsContinuityLedger(join(root, "continuity"));
    const opened = await ledger.append(actor, {
      v: "reelier.continuity-checkpoint/v1",
      taskId: graph.taskId,
      expectedCursor: 0,
      actorPrincipalId: actor.principalId,
      workloadId: actor.workloadId,
      jobCardDigest: digest("a"),
      authoritySnapshotDigest: digest("b"),
      proposedEvents: [{ type: "task.opened", eventId: "event_opened", outcome: "Complete the governed task", completionProjection: "Verified provider projection", nonGoals: [] }],
      evidenceRefs: [],
    });
    assert.equal(opened.ok, true);
    const appended = await (ledger as any).appendVerifiedAuthority(actor, {
      taskId: graph.taskId,
      expectedCursor: 1,
      actorPrincipalId: actor.principalId,
      workloadId: actor.workloadId,
      jobCardDigest: digest("a"),
    }, verified);
    assert.equal(appended.ok, true);
    await assert.rejects(
      () => new FsContinuityLedger(join(root, "continuity")).read(graph.taskId),
      /external.*anchor|anchor.*resolver/i,
    );
    const ledgerOptions = {
      resolveAuthorityAnchors: async (request: { taskId: string; authoritySnapshotDigest: string }) => {
        assert.equal(request.taskId, graph.taskId);
        assert.equal(request.authoritySnapshotDigest, authorityDigest({ trustPin, currentTrustObservation, expectedResponseSemanticsProfile }));
        return { trustPin, currentTrustObservation, expectedResponseSemanticsProfile };
      },
    };
    const restarted = await new FsContinuityLedger(join(root, "continuity"), ledgerOptions).read(graph.taskId);
    assert.equal((restarted.state?.consequences.values().next().value as any)?.verification.status, "verified");

    const taskDirectory = join(root, "continuity", graph.taskId);
    const segmentNames = (await readdir(taskDirectory)).filter((name) => name.endsWith(".json")).sort();
    const authoritySegmentName = segmentNames.at(-1)!;
    const authoritySegmentPath = join(taskDirectory, authoritySegmentName);
    const authoritySegment = JSON.parse(await readFile(authoritySegmentPath, "utf8"));

    const substitutedSegment = structuredClone(authoritySegment);
    substitutedSegment.authoritySnapshotDigest = digest("f");
    substitutedSegment.authorityImports[0].authoritySnapshotDigest = digest("f");
    const substitutedDigest = authorityDigest(substitutedSegment);
    const substitutedPath = join(taskDirectory, `${authoritySegmentName.slice(0, 16)}-${substitutedDigest.slice("sha256:".length)}.json`);
    const retainedOriginalPath = join(root, "retained-original-authority-segment.json");
    await writeFile(substitutedPath, authorityCanonicalBytes(substitutedSegment));
    await rename(authoritySegmentPath, retainedOriginalPath);
    await assert.rejects(
      () => new FsContinuityLedger(join(root, "continuity"), ledgerOptions).read(graph.taskId),
      /expected values|authority snapshot|anchor/i,
    );
    await rename(substitutedPath, join(root, "rejected-substituted-authority-segment.json"));
    await rename(retainedOriginalPath, authoritySegmentPath);

    const replayGraph = JSON.parse(Buffer.from(authoritySegment.authorityImports[0].graphJsonBase64, "base64").toString("utf8"));
    replayGraph.taskId = `${graph.taskId}_tampered`;
    authoritySegment.authorityImports[0].graphJsonBase64 = Buffer.from(JSON.stringify(replayGraph), "utf8").toString("base64");
    const tamperedDigest = authorityDigest(authoritySegment);
    const tamperedPath = join(taskDirectory, `${authoritySegmentName.slice(0, 16)}-${tamperedDigest.slice("sha256:".length)}.json`);
    await writeFile(tamperedPath, authorityCanonicalBytes(authoritySegment));
    await rename(authoritySegmentPath, join(root, "replaced-authority-segment.json"));
    await assert.rejects(
      () => new FsContinuityLedger(join(root, "continuity"), ledgerOptions).read(graph.taskId),
      /corruption.*(signature|lineage|task|portable|graph)/i,
    );
  });
});
