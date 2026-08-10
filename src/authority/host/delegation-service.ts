import type { DelegationGrant } from "../types.js";
import { authorityDigest } from "../wire.js";
import { validateChildDelegationRequest, type StoredSignedGrant } from "../delegation.js";
import { FsDelegationBudgetLedger } from "./delegation-budget.js";

export interface DelegationAuthoritySigner {
  signGrant(value: DelegationGrant): Promise<StoredSignedGrant>;
}

export interface DelegationAuthority {
  registerRoot(input: Readonly<{ taskId: string; rootGrant: StoredSignedGrant; effects: number }>): Promise<void>;
  request(input: Readonly<{ tenant: string; parentPrincipal: string; taskId: string; parentAllocationId: string; child: DelegationGrant; effects: number; activeChildCount: number }>): Promise<Readonly<{ verdict: "accepted"; reasonCode: "delegation-allocated"; lifecycleState: "allocated"; grant: DelegationGrant; grantDigest: string; allocationId: string }>>;
  status(input: Readonly<{ tenant: string; requester: string; grantId: string }>): Promise<Readonly<{ grantId: string; taskId: string; parentGrantDigest: string; grantee: string; lifecycleState: "allocated" | "revoked" }>>;
  taskStatus(input: Readonly<{ tenant: string; requester: string; taskId: string }>): Promise<Readonly<{ taskId: string; lifecycleState: "active" | "revoked"; grants: readonly string[] }>>;
  revoke(tenant: string, taskId: string): Promise<void>;
}

interface RootRecord {
  readonly tenant: string;
  readonly taskId: string;
  readonly root: StoredSignedGrant;
  readonly grants: Map<string, { readonly grant: DelegationGrant; readonly digest: string; readonly allocationId: string }>;
  revoked: boolean;
}

export function createDelegationAuthority(input: Readonly<{ root: string; signGrant: (value: DelegationGrant) => Promise<StoredSignedGrant>; now?: () => Date }>): DelegationAuthority {
  const budgets = new FsDelegationBudgetLedger(input.root);
  const roots = new Map<string, RootRecord>();

  async function registerRoot(value: Readonly<{ taskId: string; rootGrant: StoredSignedGrant; effects: number }>): Promise<void> {
    const grant = asGrant(value.rootGrant.grant);
    if (grant.parentDigest !== null) throw new TypeError("root delegation parent digest must be null");
    if (authorityDigest(grant) !== value.rootGrant.digest) throw new TypeError("root delegation digest mismatch");
    if (roots.has(value.taskId)) throw new TypeError("delegation task already exists");
    await budgets.createRoot({ taskId: value.taskId, allocationId: "root", effects: value.effects });
    roots.set(value.taskId, { tenant: grant.tenant, taskId: value.taskId, root: value.rootGrant, grants: new Map([["root", { grant, digest: value.rootGrant.digest, allocationId: "root" }]]), revoked: false });
  }

  async function request(value: Readonly<{ tenant: string; parentPrincipal: string; taskId: string; parentAllocationId: string; child: DelegationGrant; effects: number; activeChildCount: number }>) {
    const record = roots.get(value.taskId);
    if (!record || record.tenant !== value.tenant || record.revoked) throw new TypeError("delegation task is not active");
    const parent = record.grants.get(value.parentAllocationId);
    if (!parent || parent.grant.grantee !== value.parentPrincipal) throw new TypeError("delegation parent principal mismatch");
    if (value.child.tenant !== value.tenant || value.child.grantor !== value.parentPrincipal) throw new TypeError("delegation child identity mismatch");
    validateChildDelegationRequest({ parent: parent.grant, child: value.child, activeChildCount: value.activeChildCount, effects: value.effects, now: input.now?.() ?? new Date() });
    const allocationId = value.child.grantId;
    const signed = await input.signGrant(value.child);
    const signedGrant = asGrant(signed.grant);
    if (authorityDigest(signedGrant) !== signed.digest || signedGrant.grantId !== value.child.grantId) throw new TypeError("authority cell returned an invalid child grant");
    await budgets.allocate({ allocationId, parentAllocationId: value.parentAllocationId, effects: value.effects, maxFanOut: parent.grant.delegationPolicy!.maxFanOut });
    record.grants.set(allocationId, { grant: signedGrant, digest: signed.digest, allocationId });
    return Object.freeze({ verdict: "accepted" as const, reasonCode: "delegation-allocated" as const, lifecycleState: "allocated" as const, grant: signedGrant, grantDigest: signed.digest, allocationId });
  }

  async function status(value: Readonly<{ tenant: string; requester: string; grantId: string }>) {
    for (const record of roots.values()) {
      const entry = [...record.grants.values()].find(candidate => candidate.grant.grantId === value.grantId);
      if (!entry || record.tenant !== value.tenant) continue;
      if (record.root.grant && asGrant(record.root.grant).sponsor !== value.requester && ![...record.grants.values()].some(candidate => candidate.grant.grantee === value.requester)) throw new TypeError("delegation status principal mismatch");
      return Object.freeze({ grantId: value.grantId, taskId: record.taskId, parentGrantDigest: entry.grant.parentDigest ?? "", grantee: entry.grant.grantee, lifecycleState: record.revoked ? "revoked" as const : "allocated" as const });
    }
    throw new TypeError("delegation grant not found");
  }

  async function revoke(tenant: string, taskId: string): Promise<void> {
    const record = roots.get(taskId);
    if (!record || record.tenant !== tenant) throw new TypeError("delegation task not found");
    await budgets.revokeTask(taskId);
    record.revoked = true;
  }

  async function taskStatus(value: Readonly<{ tenant: string; requester: string; taskId: string }>) {
    const record = roots.get(value.taskId);
    if (!record || record.tenant !== value.tenant) throw new TypeError("delegation task not found");
    if (asGrant(record.root.grant).sponsor !== value.requester && ![...record.grants.values()].some(candidate => candidate.grant.grantee === value.requester)) throw new TypeError("task status principal mismatch");
    return Object.freeze({ taskId: value.taskId, lifecycleState: record.revoked ? "revoked" as const : "active" as const, grants: Object.freeze([...record.grants.values()].map(candidate => candidate.grant.grantId).sort()) });
  }

  return Object.freeze({ registerRoot, request, status, taskStatus, revoke });
}

function asGrant(value: unknown): DelegationGrant {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("delegation grant must be an object");
  return value as DelegationGrant;
}
