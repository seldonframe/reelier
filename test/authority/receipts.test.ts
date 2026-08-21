import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFileReceiptPublication, __testSetReceiptsDurabilityProbe, type ReceiptsDurabilityProbeEventV1 } from "../../src/authority/host/receipts.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";

const state = { reservation: { reservationId: "r1", state: "reserved", intent: { effectDigest: "sha256:" + "1".repeat(64) } }, effect: { x: 1 }, effectCanonicalBase64: "e30=", effectDigest: "sha256:" + "1".repeat(64) } as any;

test("file receipt publication is immutable and idempotent across a restart", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const root = await mkdtemp(path.join(tmpdir(), "reelier-receipts-"));
  try {
    const input = { phase: "dispatch" as const, state, outcome: { kind: "acknowledged" as const, resultDigest: "sha256:" + "2".repeat(64) }, dispatchedRequestDigest: "sha256:" + "3".repeat(64) };
    const first = await createFileReceiptPublication({ rootDir: root }).publish(input);
    const second = await createFileReceiptPublication({ rootDir: root }).publish(input);
    assert.deepEqual(second, first);
    const files = (await import("node:fs/promises")).readdir(root);
    assert.equal((await files).length, 1);
    const body = JSON.parse(await readFile(path.join(root, (await files)[0]!), "utf8"));
    assert.equal(body.receiptRef, first.receiptRef);
  } finally { restore(); }
});

test("file receipt publication persists an authoritative durable chain across restart", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const root = await mkdtemp(path.join(tmpdir(), "reelier-durable-receipts-"));
  const identity = { v: "reelier.durable-dispatch-publication-identity/v1", reservationId: "r1", tenant: "tenant_1", requestDigest: "sha256:" + "2".repeat(64), capabilityDigest: "sha256:" + "3".repeat(64), effectDigest: state.effectDigest, routeAuthorityDigest: "sha256:" + "4".repeat(64), expectedDispatchedRequestDigest: "sha256:" + "5".repeat(64), reservationIntentDigest: "sha256:" + "6".repeat(64) } as const;
  const reservation = { phase: "reservation" as const, identity, state, outcome: { kind: "ambiguous" as const, resultDigest: "sha256:" + "7".repeat(64) }, dispatchedRequestDigest: null, priorReceiptDigest: null };
  try {
    const first = createFileReceiptPublication({ rootDir: root });
    assert.equal(typeof first.publishReservation, "function");
    assert.equal(typeof first.loadDurableHead, "function");
    const rootReceipt = await first.publishReservation!(reservation);
    const terminal = await first.publish({ phase: "dispatch", state, outcome: { kind: "acknowledged", resultDigest: "sha256:" + "8".repeat(64) }, dispatchedRequestDigest: identity.expectedDispatchedRequestDigest, priorReceiptDigest: rootReceipt.receiptRef });

    const restarted = createFileReceiptPublication({ rootDir: root });
    const head = await restarted.loadDurableHead!({ v: "reelier.durable-dispatch-publication-query/v1", identity, ledgerState: "dispatched", sendStarted: true });
    assert.deepEqual(head, { v: "reelier.durable-dispatch-publication-head/v1", identity, receiptRef: terminal.receiptRef, evidenceDigest: terminal.evidenceDigest, reservationReceiptRef: rootReceipt.receiptRef, priorReceiptRef: rootReceipt.receiptRef, phase: "dispatch", terminalKind: "acknowledged" });
    assert.deepEqual(await restarted.loadDurableHead!({ v: "reelier.durable-dispatch-publication-query/v1", identity, ledgerState: "dispatched", sendStarted: true }), head, "exact readback converges");
  } finally { restore(); }
});

test("a valid durable chain copied to a different genuine publication root refuses", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux"), parent = await mkdtemp(path.join(tmpdir(), "reelier-durable-root-binding-")), rootA = path.join(parent, "root-a"), rootB = path.join(parent, "root-b");
  try {
    await mkdir(rootA);
    const { identity, terminal } = await publishedDurableChain(rootA), query = { v: "reelier.durable-dispatch-publication-query/v1", identity, ledgerState: "dispatched", sendStarted: true } as const;
    assert.equal((await createFileReceiptPublication({ rootDir: rootA }).loadDurableHead!(query))?.receiptRef, terminal.receiptRef, "reopening the same resolved root preserves its publisher identity");
    await cp(rootA, rootB, { recursive: true });
    await assert.rejects(() => createFileReceiptPublication({ rootDir: rootB }).loadDurableHead!(query), /publisher|root|binding|legacy|version/i);
  } finally { restore(); await rm(parent, { recursive: true, force: true }); }
});

test("a symlink or junction receipt root refuses before durable publication", async t => {
  const restore = __testSetAuthorityCellHostPlatform("linux"), parent = await mkdtemp(path.join(tmpdir(), "reelier-durable-linked-root-")), target = path.join(parent, "target"), linked = path.join(parent, "linked");
  try {
    await mkdir(target);
    try { await symlink(target, linked, process.platform === "win32" ? "junction" : "dir"); }
    catch (error) { if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) { t.skip("host cannot create a directory link"); return; } throw error; }
    const publication = createFileReceiptPublication({ rootDir: linked });
    await assert.rejects(() => publication.publishReservation!({ phase: "reservation", identity: durableIdentity(), state, outcome: { kind: "ambiguous", resultDigest: "sha256:" + "7".repeat(64) }, dispatchedRequestDigest: null, priorReceiptDigest: null }), /canonical|realpath|root|link|junction/i);
    assert.deepEqual(await readdir(target), [], "refusal creates no durable node through the linked root");
  } finally { restore(); await rm(parent, { recursive: true, force: true }); }
});

test("a receipt root below a symlinked or junction ancestor refuses", async t => {
  const restore = __testSetAuthorityCellHostPlatform("linux"), parent = await mkdtemp(path.join(tmpdir(), "reelier-durable-linked-ancestor-")), target = path.join(parent, "target"), linked = path.join(parent, "linked"), lexicalRoot = path.join(linked, "receipts");
  try {
    await mkdir(target);
    try { await symlink(target, linked, process.platform === "win32" ? "junction" : "dir"); }
    catch (error) { if (["EPERM", "EACCES", "ENOTSUP"].includes((error as NodeJS.ErrnoException).code ?? "")) { t.skip("host cannot create a directory link"); return; } throw error; }
    const publication = createFileReceiptPublication({ rootDir: lexicalRoot });
    await assert.rejects(() => publication.publishReservation!({ phase: "reservation", identity: durableIdentity(), state, outcome: { kind: "ambiguous", resultDigest: "sha256:" + "7".repeat(64) }, dispatchedRequestDigest: null, priorReceiptDigest: null }), /canonical|realpath|root|link|junction/i);
    assert.equal((await readdir(target)).includes("receipts"), false, "refusal does not create a root through the linked ancestor");
  } finally { restore(); await rm(parent, { recursive: true, force: true }); }
});

test("legacy durable nodes without publisher-root binding fail closed without rewrite", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux"), root = await mkdtemp(path.join(tmpdir(), "reelier-durable-legacy-root-"));
  try {
    const { identity, durableDir, terminalNode } = await publishedDurableChain(root), file = path.join(durableDir, terminalNode.name);
    await writeFile(file, JSON.stringify({ ...terminalNode.node, v: "reelier.durable-file-publication-node/internal-v1", preimage: { ...terminalNode.node.preimage, v: "reelier.durable-file-publication-preimage/internal-v1", publisherRootDigest: undefined }, publisherRootDigest: undefined }));
    const legacy = await readFile(file);
    const query = { v: "reelier.durable-dispatch-publication-query/v1", identity, ledgerState: "dispatched", sendStarted: true } as const;
    await assert.rejects(() => createFileReceiptPublication({ rootDir: root }).loadDurableHead!(query), /publisher root binding|version/i);
    assert.deepEqual(await readFile(file), legacy, "refusal does not silently migrate or rewrite the legacy node");
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});

async function publishedDurableChain(root: string) {
  const identity = durableIdentity();
  const publication = createFileReceiptPublication({ rootDir: root });
  const rootReceipt = await publication.publishReservation!({ phase: "reservation", identity, state, outcome: { kind: "ambiguous", resultDigest: "sha256:" + "7".repeat(64) }, dispatchedRequestDigest: null, priorReceiptDigest: null });
  const terminal = await publication.publish({ phase: "dispatch", state, outcome: { kind: "acknowledged", resultDigest: "sha256:" + "8".repeat(64) }, dispatchedRequestDigest: identity.expectedDispatchedRequestDigest, priorReceiptDigest: rootReceipt.receiptRef });
  const durableDir = path.join(root, (await readdir(root)).find(name => name.startsWith("durable-"))!);
  const names = (await readdir(durableDir)).filter(name => /^node-[0-9a-f]{64}\.json$/.test(name));
  const nodes = await Promise.all(names.map(async name => ({ name, node: JSON.parse(await readFile(path.join(durableDir, name), "utf8")) })));
  return { identity, rootReceipt, terminal, durableDir, terminalNode: nodes.find(entry => entry.node.head.phase === "dispatch")! };
}

function durableIdentity() { return { v: "reelier.durable-dispatch-publication-identity/v1", reservationId: "r1", tenant: "tenant_1", requestDigest: "sha256:" + "2".repeat(64), capabilityDigest: "sha256:" + "3".repeat(64), effectDigest: state.effectDigest, routeAuthorityDigest: "sha256:" + "4".repeat(64), expectedDispatchedRequestDigest: "sha256:" + "5".repeat(64), reservationIntentDigest: "sha256:" + "6".repeat(64) } as const; }

test("restart validation rejects a forged evidence digest and a forged terminal kind", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const root = await mkdtemp(path.join(tmpdir(), "reelier-durable-forge-"));
  try {
    const { identity, durableDir, terminalNode } = await publishedDurableChain(root);
    const query = { v: "reelier.durable-dispatch-publication-query/v1", identity, ledgerState: "dispatched", sendStarted: true } as const;
    await writeFile(path.join(durableDir, terminalNode.name), JSON.stringify({ ...terminalNode.node, head: { ...terminalNode.node.head, evidenceDigest: "sha256:" + "e".repeat(64) } }));
    await assert.rejects(() => createFileReceiptPublication({ rootDir: root }).loadDurableHead!(query, "terminal"), /invalid or conflicting/);
    await writeFile(path.join(durableDir, terminalNode.name), JSON.stringify({ ...terminalNode.node, head: { ...terminalNode.node.head, terminalKind: "definitive-failure" } }));
    await assert.rejects(() => createFileReceiptPublication({ rootDir: root }).loadDurableHead!(query, "terminal"), /invalid or conflicting/);
  } finally { restore(); }
});

test("a dispatched query refuses a chain whose terminal dirent is lost", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const root = await mkdtemp(path.join(tmpdir(), "reelier-durable-lost-dirent-"));
  try {
    const { identity, rootReceipt, durableDir, terminalNode } = await publishedDurableChain(root);
    const query = { v: "reelier.durable-dispatch-publication-query/v1", identity, ledgerState: "dispatched", sendStarted: true } as const;
    await unlink(path.join(durableDir, terminalNode.name));
    await assert.rejects(() => createFileReceiptPublication({ rootDir: root }).loadDurableHead!(query, "terminal"), /terminal receipt is absent/);
    const recovering = await createFileReceiptPublication({ rootDir: root }).loadDurableHead!(query, "root-or-terminal");
    assert.equal(recovering?.receiptRef, rootReceipt.receiptRef, "recovery of a pre-terminal crash still reads the reservation root");
    assert.equal(recovering?.phase, "reservation");
  } finally { restore(); }
});

test("durable file publication snapshots the reservation identity before caller mutation", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux"), root = await mkdtemp(path.join(tmpdir(), "reelier-durable-identity-snapshot-"));
  const identity: any = { v: "reelier.durable-dispatch-publication-identity/v1", reservationId: "r1", tenant: "tenant_1", requestDigest: "sha256:" + "2".repeat(64), capabilityDigest: "sha256:" + "3".repeat(64), effectDigest: state.effectDigest, routeAuthorityDigest: "sha256:" + "4".repeat(64), expectedDispatchedRequestDigest: "sha256:" + "5".repeat(64), reservationIntentDigest: "sha256:" + "6".repeat(64) };
  try {
    const publication = createFileReceiptPublication({ rootDir: root });
    const rootReceipt = await publication.publishReservation!({ phase: "reservation", identity, state, outcome: { kind: "ambiguous", resultDigest: "sha256:" + "7".repeat(64) }, dispatchedRequestDigest: null, priorReceiptDigest: null });
    const original = { ...identity };
    identity.effectDigest = "sha256:" + "9".repeat(64);
    const terminal = await publication.publish({ phase: "dispatch", state, outcome: { kind: "acknowledged", resultDigest: "sha256:" + "8".repeat(64) }, dispatchedRequestDigest: original.expectedDispatchedRequestDigest, priorReceiptDigest: rootReceipt.receiptRef });
    const head = await createFileReceiptPublication({ rootDir: root }).loadDurableHead!({ v: "reelier.durable-dispatch-publication-query/v1", identity: original, ledgerState: "dispatched", sendStarted: true });
    assert.equal(head?.receiptRef, terminal.receiptRef);
    assert.equal(head?.identity.effectDigest, state.effectDigest);
  } finally { restore(); }
});

test("directory syncs follow node create, durable-dir mkdir, and legacy rename", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const root = await mkdtemp(path.join(tmpdir(), "reelier-durable-fsync-order-"));
  const events: ReceiptsDurabilityProbeEventV1[] = [];
  const restoreProbe = __testSetReceiptsDurabilityProbe(event => events.push(event));
  try {
    const identity = { v: "reelier.durable-dispatch-publication-identity/v1", reservationId: "r1", tenant: "tenant_1", requestDigest: "sha256:" + "2".repeat(64), capabilityDigest: "sha256:" + "3".repeat(64), effectDigest: state.effectDigest, routeAuthorityDigest: "sha256:" + "4".repeat(64), expectedDispatchedRequestDigest: "sha256:" + "5".repeat(64), reservationIntentDigest: "sha256:" + "6".repeat(64) } as const;
    await createFileReceiptPublication({ rootDir: root }).publishReservation!({ phase: "reservation", identity, state, outcome: { kind: "ambiguous", resultDigest: "sha256:" + "7".repeat(64) }, dispatchedRequestDigest: null, priorReceiptDigest: null });
    assert.deepEqual(events.map(event => `${event.kind}:${event.site}`), ["created:durable-mkdir", "synced:durable-mkdir", "created:node-create", "synced:node-create"]);
    events.length = 0;
    await createFileReceiptPublication({ rootDir: root }).publish({ phase: "dispatch", state, outcome: { kind: "acknowledged", resultDigest: "sha256:" + "8".repeat(64) }, dispatchedRequestDigest: "sha256:" + "3".repeat(64) });
    assert.deepEqual(events.map(event => `${event.kind}:${event.site}`), ["created:legacy-rename", "synced:legacy-rename"]);
  } finally { restoreProbe(); restore(); }
});
