import test from "node:test";
import assert from "node:assert/strict";
import { authenticateOutcomeRequest } from "../src/authority/keys.js";
import { createAuthorityHostRuntime } from "../src/authority/host/runtime.js";
import type { AuthorityGate, GateResult } from "../src/authority/gate.js";
import type { DispatchCoordinator } from "../src/authority/host/dispatch.js";
import type { AuthorityLedger, ReservationLinkage } from "../src/authority/ledger.js";
import type { GateDecisionSink } from "../src/authority/decision.js";

const request = { v: "reelier.outcome-request/v1", requestId: "req-runtime-1", sourceRefs: { source: "opaque-source" }, choices: {} } as const;

test("authority runtime authenticates host identity, dispatches once, and returns durable status", async () => {
  let dispatched = 0;
  const gateResult = { kind: "accepted", signedDecision: { reservationId: "res-runtime-1", gateEvent: { verdict: "accepted", reasonCode: "accepted", at: "2026-08-09T00:00:00.000Z" }, decisionContext: { requestId: request.requestId } }, handle: Object.freeze({}) } as unknown as GateResult;
  const gate: AuthorityGate = { decide: async () => gateResult };
  const dispatch: DispatchCoordinator = {
    dispatch: async () => { dispatched += 1; return { kind: "acknowledged", resultDigest: "sha256:" + "1".repeat(64) }; },
    cancel: async () => ({ kind: "definitive-failure", resultDigest: "sha256:" + "2".repeat(64) }),
    recover: async () => [],
  };
  const linkage: ReservationLinkage = { reservationId: "res-runtime-1", state: "acknowledged", ingressClaimDigest: "sha256:" + "3".repeat(64), capabilityId: "cap", capabilityDigest: "sha256:" + "4".repeat(64), authorityStateDigest: "sha256:" + "5".repeat(64), decisionContextDigest: "sha256:" + "6".repeat(64), updatedAt: "2026-08-09T00:00:01.000Z" };
  const ledger = { lookupReservationLinkage: async () => linkage, lookupIngress: async () => ({ requestId: request.requestId, requestKey: "key", definitionAlias: "gmail_reply_send_v1", ingressClaimDigest: linkage.ingressClaimDigest, bindingStatus: "bound" }), lookupIngressClaimLinkage: async () => ({ tenant: "tenant-a", requester: "human-a", requestId: request.requestId, definitionAlias: "gmail_reply_send_v1", requestDigest: "sha256:" + "7".repeat(64), requestKey: "key", ingressClaimDigest: linkage.ingressClaimDigest }) } as unknown as AuthorityLedger;
  const decisions = { lookupPrimaryByIngress: async () => ({ ok: true, status: "found", record: { reservationId: linkage.reservationId, gateEvent: { verdict: "accepted", reasonCode: "accepted", at: "2026-08-09T00:00:00.000Z" }, decisionContext: { requestId: request.requestId } } }) } as unknown as GateDecisionSink;
  const runtime = createAuthorityHostRuntime({ gate, dispatch, ledger, decisions });
  const result = await runtime.outcome("gmail_reply_send_v1", request, { tenant: "tenant-a", requester: "human-a" });
  assert.equal(result.verdict, "accepted");
  assert.equal(result.lifecycleState, "acknowledged");
  assert.equal(dispatched, 1);
  const status = await runtime.status({ requestId: request.requestId }, { tenant: "tenant-a", requester: "human-a" });
  assert.equal(status.lifecycleState, "acknowledged");
});

test("authority runtime does not trust identity fields from the request body", async () => {
  let seen: unknown;
  const gate: AuthorityGate = { decide: async requestValue => { seen = requestValue; return { kind: "unavailable", reason: "signer-unavailable" }; } };
  const runtime = createAuthorityHostRuntime({ gate, dispatch: {} as DispatchCoordinator, ledger: {} as AuthorityLedger, decisions: {} as GateDecisionSink });
  const result = await runtime.outcome("gmail_reply_send_v1", { ...request, tenant: "attacker", requester: "attacker" }, { tenant: "tenant-a", requester: "human-a" });
  assert.equal(result.verdict, "refused");
  assert.equal(seen, undefined);
});

test("shadow runtime returns a report-only lifecycle and never an accepted receipt", async () => {
  const runtime = createAuthorityHostRuntime({ gate: {} as AuthorityGate, dispatch: {} as DispatchCoordinator, ledger: {} as AuthorityLedger, decisions: {} as GateDecisionSink, shadow: async ({ request }) => ({ requestId: String((request as Record<string, unknown>).requestId), verdict: "accepted", reasonCode: "ready", lifecycleState: "shadow" }) });
  const result = await runtime.outcome("gmail_reply_send_v1", request, { tenant: "tenant-a", requester: "human-a" });
  assert.equal(result.verdict, "refused");
  assert.equal(result.lifecycleState, "shadow");
});
