// The ID seam between the shipped ledger and every durable/journal identity.
//
// `FsAuthorityLedger` mints reservation ids as the raw transaction digest `sha256:<64hex>`
// (`src/authority/host/fs-ledger.ts` `reserve`). The durable receipt identity and the signed
// journal both key on a colon-free identifier. These tests drive a reservation minted by the REAL
// ledger — never a fabricated fixture — through publish, a crash after send-started, restart, and
// recovery, so the seam is proven end to end rather than asserted about a hand-written snapshot.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";
import { authenticateOutcomeRequest, authenticatedOutcomeRequestState } from "../../src/authority/keys.js";
import { CAPABILITY_LIFETIME_MS, type AuthorityLedger, type LedgerState, type ReservationIntent, type ReservationSnapshot, type TransitionEvent } from "../../src/authority/ledger.js";
import { FsAuthorityLedger } from "../../src/authority/host/fs-ledger.js";
import { createDispatchCoordinator, type DispatchAdapter } from "../../src/authority/host/dispatch.js";
import { createPreparedDispatch } from "../../src/authority/host/prepared-dispatch.js";
import { materializedHttpRequestDigest, type MaterializedHttpRequestProjectionV1 } from "../../src/authority/host/http-response-semantics.js";
import { createFileReceiptPublication } from "../../src/authority/host/receipts.js";
import { createReservedDispatchHandle } from "../../src/authority/gate.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";
import { bindableTempRoot } from "./bindable-root.js";

const t0 = Date.parse("2026-08-19T12:00:00.000Z");
const sha = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;
const effect = { v: "reelier.transport-effect/v1", endpointId: "write", method: "POST", path: "/items", query: "", headers: { "Content-Type": "application/json" }, bodyBase64: Buffer.from("{}").toString("base64"), riskClass: "test", idempotency: "native", preconditions: [], reconciliation: { recipeId: "recipe" } } as const;
const projection: MaterializedHttpRequestProjectionV1 = { v: "reelier.materialized-http-request/v1", method: "POST", origin: "https://api.github.test", normalizedPath: "/items", normalizedQuery: "", reviewedHeaders: {}, bodyDigest: sha("1") };
const materializedRequestDigest = materializedHttpRequestDigest(projection);
const routeAuthority = { v: "reelier.route-authority-snapshot/v1" as const, connectorRegistrationDigest: sha("2"), operatorConfigurationDigest: sha("3"), routeDigest: sha("4"), providerId: "github", connectorId: "github", accountId: "account_1", providerAccountIdentity: "github:owner", endpointId: "write", credentialSlotId: "slot_1", slotInstanceId: "instance_1", slotVersion: "1", authenticatedProviderIdentityDigest: sha("5"), sourceReadRouteDigest: sha("6"), projectionSchemaDigest: sha("7"), expectedMaterializedRequestDigest: materializedRequestDigest, authorityGeneration: sha("d"), authorityExpiresAt: new Date(t0 + 60_000).toISOString() };

function releaseIntent(): ReservationIntent {
  const limits = { maxEffectsPerWindow: 2, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 };
  const requestWire = { v: "reelier.outcome-request/v1", requestId: "request_1", sourceRefs: { source: "ref_1" }, choices: {} };
  const canonicalRequestBytes = authorityCanonicalBytes(requestWire);
  const requestDigest = `sha256:${createHash("sha256").update(canonicalRequestBytes).digest("hex")}`;
  const scalar = { tenant: "tenant_1", requester: "requester_1", definitionAlias: "definition_1", requestId: "request_1", requestKey: authenticatedOutcomeRequestState(authenticateOutcomeRequest({ tenant: "tenant_1", requester: "requester_1", definitionAlias: "definition_1", request: requestWire })).requestKey, ingressClaimDigest: sha("9"), decisionContextDigest: sha("7"), contractDigest: sha("a"), sourceBundleDigest: sha("b"), sourceSnapshotDigest: sha("c"), authorityStateDigest: sha("d"), limits, limitsDigest: "", capabilityId: "capability_1", outcomeKey: sha("3"), effectDigest: authorityDigest(effect), issuedAt: new Date(t0).toISOString(), expiresAt: new Date(t0 + CAPABILITY_LIFETIME_MS).toISOString(), limitSlots: [{ kind: "contract-window" as const, key: sha("5"), maximum: 2 }, { kind: "source-trigger" as const, key: sha("6"), maximum: 1 }], effectCanonicalBase64: authorityCanonicalBytes(effect).toString("base64"), routeAuthority };
  scalar.limitsDigest = authorityDigest({ v: "reelier.capability-limits/internal-v1", contractDigest: scalar.contractDigest, limits });
  const capabilityBytes = authorityCanonicalBytes({ v: "reelier.compiled-capability/v1", tenant: scalar.tenant, requester: scalar.requester, definitionAlias: scalar.definitionAlias, requestDigest, requestKey: scalar.requestKey, contractDigest: scalar.contractDigest, sourceBundleDigest: scalar.sourceBundleDigest, sourceSnapshotDigest: scalar.sourceSnapshotDigest, authorityStateDigest: scalar.authorityStateDigest, limits, limitsDigest: scalar.limitsDigest, capabilityId: scalar.capabilityId, outcomeKey: scalar.outcomeKey, effectDigest: scalar.effectDigest, issuedAt: scalar.issuedAt, expiresAt: scalar.expiresAt });
  return { ...scalar, canonicalRequestBytes, capabilityBytes, requestDigest, canonicalRequestDigest: requestDigest, capabilityDigest: `sha256:${createHash("sha256").update(capabilityBytes).digest("hex")}` } as unknown as ReservationIntent;
}

async function mintRealReservation(ledgerDir: string): Promise<Readonly<{ ledger: FsAuthorityLedger; reservation: ReservationSnapshot; candidate: ReservationIntent }>> {
  const ledger = new FsAuthorityLedger(ledgerDir, { now: () => t0, monotonicNow: () => 0 });
  const candidate = releaseIntent();
  const binding = await ledger.bindIngress(authenticateOutcomeRequest({ tenant: candidate.tenant, requester: candidate.requester, definitionAlias: candidate.definitionAlias!, request: JSON.parse(Buffer.from(candidate.canonicalRequestBytes).toString("utf8")) }));
  assert.equal(binding.ok, true);
  const created = await ledger.reserve({ ...candidate, ingressClaimDigest: (binding as { ingressClaimDigest: string }).ingressClaimDigest });
  assert.equal(created.ok, true, `reserve refused: ${JSON.stringify(created)}`);
  const reservation = (created as unknown as { reservation: ReservationSnapshot }).reservation;
  assert.match(reservation.reservationId, /^sha256:[0-9a-f]{64}$/, "the shipped ledger mints raw sha256 reservation ids");
  return { ledger, reservation, candidate };
}

function preparedAdapter(reservation: ReservationSnapshot): DispatchAdapter {
  const description = { v: "reelier.prepared-dispatch-description/v1" as const, routeDigest: routeAuthority.routeDigest, materializedRequestDigest, projection, authorityGeneration: sha("d"), authorityExpiresAt: routeAuthority.authorityExpiresAt, absoluteDeadlineMs: 60_000, reservationId: reservation.reservationId, allocationId: "unbound" };
  return { async prepare() { return createPreparedDispatch({ description, monotonicNow: () => 0, wallClockNow: () => t0, send: async () => ({ kind: "acknowledged" as const, resultDigest: sha("8") }) }); }, async dispatch() { throw new Error("the prepared path is required"); } };
}

test("a raw ledger-minted reservation publishes its durable root and reaches a terminal receipt", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const ledgerRoot = await bindableTempRoot("reelier-id-seam-ledger-");
  const receiptsRoot = await mkdtemp(path.join(tmpdir(), "reelier-id-seam-receipts-"));
  try {
    const { ledger, reservation, candidate } = await mintRealReservation(ledgerRoot);
    const publication = createFileReceiptPublication({ rootDir: receiptsRoot });
    const coordinator = createDispatchCoordinator(ledger, preparedAdapter(reservation), undefined, publication);
    const outcome = await coordinator.dispatch(createReservedDispatchHandle({ reservation, effect, effectCanonicalBase64: candidate.effectCanonicalBase64!, effectDigest: candidate.effectDigest }));
    assert.equal(outcome.kind, "acknowledged");
    assert.match(outcome.receiptRef!, /^sha256:[0-9a-f]{64}$/);
    assert.equal((await ledger.getReservation(reservation.reservationId))?.state, "acknowledged");
  } finally { restore(); await rm(ledgerRoot, { recursive: true, force: true }); await rm(receiptsRoot, { recursive: true, force: true }); }
});

test("crash after send-started recovers by adopting the durable terminal without stranding or resending", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const ledgerRoot = await bindableTempRoot("reelier-id-seam-crash-ledger-");
  const receiptsDir = await mkdtemp(path.join(tmpdir(), "reelier-id-seam-crash-receipts-"));
  try {
    const { ledger, reservation, candidate } = await mintRealReservation(ledgerRoot);
    // The crash lands AFTER the terminal durable node is published and BEFORE the ledger's terminal
    // transition — the exact send-started restart window. Recovery must adopt the durable terminal.
    const crashing = { getReservation: (id: string) => ledger.getReservation(id), commitPreparedDispatch: (input: Parameters<NonNullable<AuthorityLedger["commitPreparedDispatch"]>>[0]) => ledger.commitPreparedDispatch!(input), recover: () => ledger.recover({ deferTerminal: true }), async transition(reservationId: string, expected: LedgerState, event: TransitionEvent) { if (expected === "dispatched") throw new Error("simulated crash before the terminal ledger transition"); return ledger.transition(reservationId, expected, event); } } as unknown as AuthorityLedger;
    const coordinator = createDispatchCoordinator(crashing, preparedAdapter(reservation), undefined, createFileReceiptPublication({ rootDir: receiptsDir }));
    await assert.rejects(() => coordinator.dispatch(createReservedDispatchHandle({ reservation, effect, effectCanonicalBase64: candidate.effectCanonicalBase64!, effectDigest: candidate.effectDigest })), /simulated crash before the terminal ledger transition/);
    const restarted = new FsAuthorityLedger(ledgerRoot, { now: () => t0, monotonicNow: () => 0 });
    let sends = 0;
    const recovery = createDispatchCoordinator(restarted, { async dispatch() { sends += 1; throw new Error("recovery must not resend"); } }, undefined, createFileReceiptPublication({ rootDir: receiptsDir }));
    assert.deepEqual(await recovery.recover(), [], "the durable acknowledged terminal is adopted, not re-marked ambiguous");
    assert.equal(sends, 0);
    const adopted = await restarted.getReservation(reservation.reservationId);
    assert.equal(adopted?.state, "acknowledged");
    assert.match(adopted?.resultDigest ?? "", /^sha256:[0-9a-f]{64}$/);
  } finally { restore(); await rm(ledgerRoot, { recursive: true, force: true }); await rm(receiptsDir, { recursive: true, force: true }); }
});
