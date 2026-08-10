import { authenticateOutcomeRequest, deriveAuthorityRequestKey } from "../keys.js";
import type { AuthorityGate, GateResult, RedactedGateStatus } from "../gate.js";
import type { GateDecisionRecord, GateDecisionSink } from "../decision.js";
import type { AuthorityLedger, ReservationLinkage } from "../ledger.js";
import type { DispatchCoordinator } from "./dispatch.js";
import type { AuthorityIngressOutcome } from "../ingress/mcp.js";
import type { DelegationAuthority } from "./delegation-service.js";

export interface AuthorityHostRuntimeDependencies {
  readonly gate: AuthorityGate;
  readonly dispatch: DispatchCoordinator;
  readonly ledger: AuthorityLedger;
  readonly decisions: GateDecisionSink;
  readonly shadow?: (input: Readonly<{ alias: string; request: unknown; tenant: string; requester: string }>) => Promise<Readonly<{ requestId: string; verdict: "accepted" | "refused"; reasonCode: string; lifecycleState: string }>>;
  readonly delegation?: DelegationAuthority;
}

export function createAuthorityHostRuntime(deps: AuthorityHostRuntimeDependencies) {
  if (!deps || typeof deps !== "object") throw new TypeError("authority runtime dependencies required");
  const refusal = (requestId: string, reasonCode: string, lifecycleState = "refused"): AuthorityIngressOutcome => Object.freeze({ requestId, verdict: "refused", reasonCode, lifecycleState });
  const accepted = (requestId: string, lifecycleState: string, receiptRef?: string): AuthorityIngressOutcome => Object.freeze({ requestId, verdict: "accepted", reasonCode: "accepted", lifecycleState, ...(receiptRef ? { receiptRef } : {}) });

  async function outcome(alias: string, input: unknown, context: { readonly tenant: string; readonly requester: string }): Promise<AuthorityIngressOutcome> {
    const requestId = readRequestId(input);
    let authenticated;
    try { authenticated = authenticateOutcomeRequest({ tenant: context.tenant, requester: context.requester, definitionAlias: alias, request: input }); }
    catch { return refusal(requestId, "invalid-request"); }
    if (deps.shadow) {
      try { const report = await deps.shadow({ alias, request: input, tenant: context.tenant, requester: context.requester }); return Object.freeze({ requestId: report.requestId, verdict: "refused" as const, reasonCode: `shadow-${report.reasonCode}`, lifecycleState: "shadow" }); }
      catch { return refusal(requestId, "shadow-unavailable", "unavailable"); }
    }
    let result: GateResult;
    try { result = await deps.gate.decide(authenticated); }
    catch { return refusal(requestId, "gate-unavailable", "unavailable"); }
    if (result.kind === "unavailable") return refusal(requestId, result.reason, "unavailable");
    if (result.kind === "refused") return redacted(result.status);
    if (result.kind === "existing") return redacted(result.status);
    try {
      const dispatchResult = await deps.dispatch.dispatch(result.handle);
      const linkage = result.signedDecision.reservationId ? await deps.ledger.lookupReservationLinkage(result.signedDecision.reservationId) : undefined;
      const state = linkage?.state ?? dispatchLifecycle(dispatchResult.kind);
      return accepted(requestId, state, linkage?.receiptRef);
    } catch { return refusal(requestId, "dispatch-unavailable", "unavailable"); }
  }

  async function status(input: unknown, context: { readonly tenant: string; readonly requester: string }): Promise<AuthorityIngressOutcome> {
    const requestId = readRequestId(input);
    if (!requestId) return refusal("", "invalid-request");
    let requestKey: string;
    try { requestKey = deriveAuthorityRequestKey({ tenant: context.tenant, requester: context.requester, requestId }); }
    catch { return refusal(requestId, "invalid-request"); }
    try {
      const ingress = await deps.ledger.lookupIngress(requestKey);
      if (!ingress) return refusal(requestId, "not-found", "unknown");
      const found = await deps.decisions.lookupPrimaryByIngress(ingress.ingressClaimDigest);
      if (!found.ok || found.status === "absent") return refusal(requestId, "not-found", "unknown");
      return await statusFromDecision(found.record, deps.ledger);
    } catch { return refusal(requestId, "status-unavailable", "unavailable"); }
  }

  const delegationRequest = deps.delegation ? async (input: unknown, context: { readonly tenant: string; readonly requester: string }): Promise<unknown> => {
    try {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("invalid delegation request");
      const raw = input as Record<string, unknown>;
      const allowed = new Set(["taskId", "parentAllocationId", "child", "effects"]);
      if (Object.keys(raw).some(key => !allowed.has(key))) throw new TypeError("delegation request contains an identity or unknown field");
      return await deps.delegation!.request(Object.assign({}, raw, { tenant: context.tenant, parentPrincipal: context.requester }) as never);
    } catch (error) { return Object.freeze({ verdict: "refused", reasonCode: error instanceof Error ? error.message : "delegation-refused", lifecycleState: "refused" }); }
  } : undefined;
  const delegationStatus = deps.delegation ? async (input: unknown, context: { readonly tenant: string; readonly requester: string }): Promise<unknown> => {
    try { const grantId = readField(input, "grantId"); return await deps.delegation!.status({ tenant: context.tenant, requester: context.requester, grantId }); }
    catch (error) { return Object.freeze({ verdict: "refused", reasonCode: error instanceof Error ? error.message : "delegation-status-unavailable", lifecycleState: "unknown" }); }
  } : undefined;
  const taskCreate = deps.delegation ? async (input: unknown, context: { readonly tenant: string; readonly requester: string }): Promise<unknown> => {
    try {
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("invalid task request");
      const raw = input as Record<string, unknown>;
      const allowed = new Set(["taskId", "rootGrant", "effects"]);
      if (Object.keys(raw).some(key => !allowed.has(key))) throw new TypeError("task request contains an identity or unknown field");
      if (typeof raw.taskId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(raw.taskId)) throw new TypeError("invalid task id");
      if (!Number.isSafeInteger(raw.effects) || Number(raw.effects) <= 0) throw new TypeError("invalid task effects budget");
      if (!raw.rootGrant || typeof raw.rootGrant !== "object" || Array.isArray(raw.rootGrant)) throw new TypeError("root grant is required");
      const rootGrant = raw.rootGrant as Record<string, unknown>;
      const grant = rootGrant.grant;
      if (!grant || typeof grant !== "object" || Array.isArray(grant)) throw new TypeError("root grant value is required");
      const grantValue = grant as Record<string, unknown>;
      if (grantValue.tenant !== context.tenant || grantValue.sponsor !== context.requester || grantValue.parentDigest !== null) throw new TypeError("root grant identity is outside host context");
      await deps.delegation!.registerRoot({ taskId: String(raw.taskId), rootGrant: raw.rootGrant as never, effects: Number(raw.effects) });
      return Object.freeze({ taskId: String(raw.taskId), verdict: "accepted", reasonCode: "task-created", lifecycleState: "active" });
    } catch (error) { return Object.freeze({ taskId: input && typeof input === "object" && typeof (input as Record<string, unknown>).taskId === "string" ? String((input as Record<string, unknown>).taskId) : "", verdict: "refused", reasonCode: error instanceof Error ? error.message : "task-refused", lifecycleState: "refused" }); }
  } : undefined;
  const taskStatus = deps.delegation ? async (input: unknown, context: { readonly tenant: string; readonly requester: string }): Promise<unknown> => {
    try { const taskId = readField(input, "taskId"); return await deps.delegation!.taskStatus({ tenant: context.tenant, requester: context.requester, taskId }); }
    catch (error) { return Object.freeze({ verdict: "refused", reasonCode: error instanceof Error ? error.message : "task-status-unavailable", lifecycleState: "unknown" }); }
  } : undefined;
  return Object.freeze({ outcome, status, delegationRequest, delegationStatus, taskCreate, taskStatus });
}

async function statusFromDecision(record: GateDecisionRecord, ledger: AuthorityLedger): Promise<AuthorityIngressOutcome> {
  const requestId = record.decisionContext.requestId;
  if (record.gateEvent.verdict !== "accepted" || !record.reservationId) return Object.freeze({ requestId, verdict: "refused", reasonCode: record.gateEvent.reasonCode, lifecycleState: "refused" });
  const linkage = await ledger.lookupReservationLinkage(record.reservationId);
  if (!linkage) return Object.freeze({ requestId, verdict: "refused", reasonCode: "not-found", lifecycleState: "unknown" });
  return Object.freeze({ requestId, verdict: "accepted", reasonCode: "accepted", lifecycleState: linkage.state, ...(linkage.receiptRef ? { receiptRef: linkage.receiptRef } : {}) });
}

function redacted(status: RedactedGateStatus): AuthorityIngressOutcome {
  return Object.freeze({ requestId: status.requestId, verdict: status.verdict, reasonCode: status.reasonCode, lifecycleState: status.lifecycleState, ...(status.receiptRef ? { receiptRef: status.receiptRef } : {}) });
}

function readRequestId(input: unknown): string {
  return input && typeof input === "object" && !Array.isArray(input) && typeof (input as Record<string, unknown>).requestId === "string" ? String((input as Record<string, unknown>).requestId) : "";
}

function readField(input: unknown, name: string): string {
  if (!input || typeof input !== "object" || Array.isArray(input) || typeof (input as Record<string, unknown>)[name] !== "string" || !(input as Record<string, unknown>)[name]) throw new TypeError("invalid request");
  return String((input as Record<string, unknown>)[name]);
}

function dispatchLifecycle(kind: "acknowledged" | "definitive-failure" | "ambiguous"): string {
  return kind === "acknowledged" ? "acknowledged" : kind;
}
