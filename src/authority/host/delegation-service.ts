import type { DelegationGrant } from "../types.js";
import { authorityDigest } from "../wire.js";
import { validateChildDelegationRequest, type StoredSignedGrant } from "../delegation.js";
import { FsDelegationBudgetLedger } from "./delegation-budget.js";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexSessionGrantBinding } from "./codex-session-activation.js";

export interface DelegationAuthoritySigner {
  signGrant(value: DelegationGrant): Promise<StoredSignedGrant>;
}

export interface DelegationAuthority {
  registerRoot(input: Readonly<{ taskId: string; allocationId?: string; rootGrant: StoredSignedGrant; effects: number }>): Promise<void>;
  request(input: Readonly<{ tenant: string; parentPrincipal: string; taskId: string; parentAllocationId: string; child: DelegationGrant; effects: number }>): Promise<Readonly<{ verdict: "accepted"; reasonCode: "delegation-allocated"; lifecycleState: "allocated"; grant: DelegationGrant; grantDigest: string; allocationId: string }>>;
  status(input: Readonly<{ tenant: string; requester: string; grantId: string }>): Promise<Readonly<{ grantId: string; taskId: string; parentGrantDigest: string; grantee: string; lifecycleState: "allocated" | "revoked" }>>;
  taskStatus(input: Readonly<{ tenant: string; requester: string; taskId: string }>): Promise<Readonly<{ taskId: string; lifecycleState: "active" | "revoked"; grants: readonly string[] }>>;
  resolveSessionBinding(input: Readonly<{ tenant: string; taskId: string; principalId: string }>): Promise<CodexSessionGrantBinding>;
  revoke(tenant: string, taskId: string): Promise<void>;
  readonly budget: FsDelegationBudgetLedger;
}

interface RootRecord {
  readonly tenant: string;
  readonly taskId: string;
  readonly root: StoredSignedGrant;
  readonly rootAllocationId: string;
  readonly grants: Map<string, { readonly grant: DelegationGrant; readonly digest: string; readonly allocationId: string; readonly signed: StoredSignedGrant }>;
  revoked: boolean;
}

export function createDelegationAuthority(input: Readonly<{ root: string; signGrant: (value: DelegationGrant) => Promise<StoredSignedGrant>; now?: () => Date }>): DelegationAuthority {
  const budgets = new FsDelegationBudgetLedger(input.root);
  const roots = new Map<string, RootRecord>();
  const registryPath = path.join(input.root, "delegation-registry.json");
  const lockPath = path.join(input.root, "delegation-registry.lock");
  let loaded: Promise<void> | undefined;

  async function ensureLoaded(): Promise<void> {
    loaded ??= loadRegistry();
    await loaded;
  }

  async function registerRoot(value: Readonly<{ taskId: string; allocationId?: string; rootGrant: StoredSignedGrant; effects: number }>): Promise<void> {
    await ensureLoaded();
    const grant = asGrant(value.rootGrant.grant);
    const allocationId = value.allocationId ?? "root";
    if (grant.parentDigest !== null) throw new TypeError("root delegation parent digest must be null");
    if (authorityDigest(grant) !== value.rootGrant.digest) throw new TypeError("root delegation digest mismatch");
    const existing = roots.get(value.taskId);
    if (existing) {
      const allocation = await budgets.get(existing.rootAllocationId);
      if (existing.rootAllocationId !== allocationId || authorityDigest(existing.root) !== authorityDigest(value.rootGrant) || !allocation || allocation.effects !== value.effects || allocation.revoked || existing.revoked) throw new TypeError("delegation root activation conflict");
      return;
    }
    await budgets.createRoot({ taskId: value.taskId, allocationId, effects: value.effects });
    roots.set(value.taskId, { tenant: grant.tenant, taskId: value.taskId, root: value.rootGrant, rootAllocationId: allocationId, grants: new Map([[allocationId, { grant, digest: value.rootGrant.digest, allocationId, signed: value.rootGrant }]]), revoked: false });
    await persistRegistry();
  }

  async function request(value: Readonly<{ tenant: string; parentPrincipal: string; taskId: string; parentAllocationId: string; child: DelegationGrant; effects: number }>) {
    await ensureLoaded();
    const record = roots.get(value.taskId);
    if (!record || record.tenant !== value.tenant || record.revoked) throw new TypeError("delegation task is not active");
    const parent = record.grants.get(value.parentAllocationId);
    if (!parent || parent.grant.grantee !== value.parentPrincipal) throw new TypeError("delegation parent principal mismatch");
    if (value.child.tenant !== value.tenant || value.child.grantor !== value.parentPrincipal) throw new TypeError("delegation child identity mismatch");
    if (value.child.parentDigest !== parent.digest) throw new TypeError("delegation child parent digest mismatch");
    if (record.grants.has(value.child.grantId)) throw new TypeError("delegation child grant id already exists");
    const now = input.now?.() ?? new Date();
    const activeChildCount = [...record.grants.values()].filter(candidate => candidate.grant.parentDigest === parent.digest && Date.parse(candidate.grant.expiresAt) > now.getTime()).length;
    validateChildDelegationRequest({ parent: parent.grant, child: value.child, activeChildCount, effects: value.effects, now });
    const allocationId = value.child.grantId;
    const signed = await input.signGrant(value.child);
    const signedGrant = asGrant(signed.grant);
    if (authorityDigest(signedGrant) !== signed.digest || authorityDigest(signedGrant) !== authorityDigest(value.child) || signedGrant.grantId !== value.child.grantId) throw new TypeError("authority cell returned an invalid child grant");
    await budgets.allocate({ allocationId, parentAllocationId: value.parentAllocationId, effects: value.effects, maxFanOut: parent.grant.delegationPolicy!.maxFanOut });
    record.grants.set(allocationId, { grant: signedGrant, digest: signed.digest, allocationId, signed });
    await persistRegistry();
    return Object.freeze({ verdict: "accepted" as const, reasonCode: "delegation-allocated" as const, lifecycleState: "allocated" as const, grant: signedGrant, grantDigest: signed.digest, allocationId });
  }

  async function status(value: Readonly<{ tenant: string; requester: string; grantId: string }>) {
    await ensureLoaded();
    for (const record of roots.values()) {
      const entry = [...record.grants.values()].find(candidate => candidate.grant.grantId === value.grantId);
      if (!entry || record.tenant !== value.tenant) continue;
      if (record.root.grant && asGrant(record.root.grant).sponsor !== value.requester && ![...record.grants.values()].some(candidate => candidate.grant.grantee === value.requester)) throw new TypeError("delegation status principal mismatch");
      return Object.freeze({ grantId: value.grantId, taskId: record.taskId, parentGrantDigest: entry.grant.parentDigest ?? "", grantee: entry.grant.grantee, lifecycleState: record.revoked ? "revoked" as const : "allocated" as const });
    }
    throw new TypeError("delegation grant not found");
  }

  async function revoke(tenant: string, taskId: string): Promise<void> {
    await ensureLoaded();
    const record = roots.get(taskId);
    if (!record || record.tenant !== tenant) throw new TypeError("delegation task not found");
    await budgets.revokeTask(taskId);
    record.revoked = true;
    await persistRegistry();
  }

  async function taskStatus(value: Readonly<{ tenant: string; requester: string; taskId: string }>) {
    await ensureLoaded();
    const record = roots.get(value.taskId);
    if (!record || record.tenant !== value.tenant) throw new TypeError("delegation task not found");
    if (asGrant(record.root.grant).sponsor !== value.requester && ![...record.grants.values()].some(candidate => candidate.grant.grantee === value.requester)) throw new TypeError("task status principal mismatch");
    return Object.freeze({ taskId: value.taskId, lifecycleState: record.revoked ? "revoked" as const : "active" as const, grants: Object.freeze([...record.grants.values()].map(candidate => candidate.grant.grantId).sort()) });
  }

  async function resolveSessionBinding(value: Readonly<{ tenant: string; taskId: string; principalId: string }>): Promise<CodexSessionGrantBinding> {
    await ensureLoaded();
    const record = roots.get(value.taskId);
    if (!record || record.tenant !== value.tenant || record.revoked) throw new TypeError("delegation task is not active");
    const matching = [...record.grants.values()].filter(candidate => candidate.grant.grantee === value.principalId);
    if (matching.length !== 1) throw new TypeError(matching.length === 0 ? "delegation principal grant not found" : "delegation principal grant is ambiguous");
    const entry = matching[0];
    const now = (input.now?.() ?? new Date()).getTime();
    if (now < Date.parse(entry.grant.issuedAt) || now >= Date.parse(entry.grant.expiresAt)) throw new TypeError("delegation principal grant is not active");
    const allocation = await budgets.get(entry.allocationId);
    if (!allocation || allocation.taskId !== value.taskId || allocation.revoked) throw new TypeError("delegation allocation is not active");
    return Object.freeze({ taskId: value.taskId, grantId: entry.grant.grantId, grantDigest: entry.digest, grantee: entry.grant.grantee, allocationId: entry.allocationId, expiresAt: entry.grant.expiresAt, effects: allocation.effects, lifecycleState: "allocated" as const });
  }

  return Object.freeze({ registerRoot, request, status, taskStatus, resolveSessionBinding, revoke, budget: budgets });

  async function loadRegistry(): Promise<void> {
    await mkdir(input.root, { recursive: true });
    let raw: string;
    try { raw = await readFile(registryPath, "utf8"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new Error("delegation registry unavailable", { cause: error });
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch (error) { throw new Error("delegation registry is corrupt", { cause: error }); }
    if (!parsed || typeof parsed !== "object" || (parsed as Record<string, unknown>).v !== "reelier.delegation-registry/v1" || !Array.isArray((parsed as Record<string, unknown>).tasks)) throw new Error("delegation registry is corrupt");
    for (const item of (parsed as { tasks: unknown[] }).tasks) {
      if (!item || typeof item !== "object" || typeof (item as Record<string, unknown>).taskId !== "string" || typeof (item as Record<string, unknown>).tenant !== "string" || !Array.isArray((item as Record<string, unknown>).grants)) throw new Error("delegation registry is corrupt");
      const value = item as { taskId: string; tenant: string; root: StoredSignedGrant; rootAllocationId?: string; grants: StoredSignedGrant[]; revoked?: boolean };
      const rootGrant = asGrant(value.root.grant);
      if (authorityDigest(rootGrant) !== value.root.digest) throw new Error("delegation registry digest mismatch");
      const grants = new Map<string, { readonly grant: DelegationGrant; readonly digest: string; readonly allocationId: string; readonly signed: StoredSignedGrant }>();
      const rootAllocationId = value.rootAllocationId ?? "root";
      grants.set(rootAllocationId, { grant: rootGrant, digest: value.root.digest, allocationId: rootAllocationId, signed: value.root });
      for (const stored of value.grants) {
        const child = asGrant(stored.grant);
        if (authorityDigest(child) !== stored.digest) throw new Error("delegation registry child digest mismatch");
        grants.set(child.grantId, { grant: child, digest: stored.digest, allocationId: child.grantId, signed: stored });
      }
      roots.set(value.taskId, { tenant: value.tenant, taskId: value.taskId, root: value.root, rootAllocationId, grants, revoked: value.revoked === true });
    }
  }

  async function persistRegistry(): Promise<void> {
    const release = await acquireRegistryLock();
    try {
      const tasks = [...roots.values()].map(record => ({ v: "reelier.delegation-task/v1", taskId: record.taskId, tenant: record.tenant, root: record.root, rootAllocationId: record.rootAllocationId, grants: [...record.grants.values()].filter(item => item.allocationId !== record.rootAllocationId).map(item => item.signed), revoked: record.revoked }));
      const temporary = `${registryPath}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify({ v: "reelier.delegation-registry/v1", tasks }), "utf8");
      await rename(temporary, registryPath);
    } finally { await release(); }
  }

  async function acquireRegistryLock(): Promise<() => Promise<void>> {
    const started = Date.now();
    for (;;) {
      try { await mkdir(lockPath); return async () => { await rm(lockPath, { recursive: true, force: true }); }; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try { if (Date.now() - (await stat(lockPath)).mtimeMs > 20_000) await rm(lockPath, { recursive: true, force: true }); } catch { /* another writer owns it */ }
        if (Date.now() - started > 10_000) throw new Error("delegation registry busy");
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    }
  }
}

function asGrant(value: unknown): DelegationGrant {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("delegation grant must be an object");
  return value as DelegationGrant;
}
