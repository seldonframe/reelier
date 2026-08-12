import { createPublicKey } from "node:crypto";
import type { DelegationGrant } from "../types.js";
import { authorityDigest } from "../wire.js";
import { validateChildDelegationRequest, type StoredSignedGrant } from "../delegation.js";
import { verifyAuthoritySignature } from "../crypto.js";
import { parseAuthorityKeyDescriptor, type AuthorityKeyDescriptorV1 } from "../certification/authority.js";
import { FsDelegationBudgetLedger } from "./delegation-budget.js";
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodexSessionGrantBinding } from "./codex-session-activation.js";
import { assertLinuxAuthorityCellHost } from "./platform.js";

export interface DelegationAuthoritySigner {
  signGrant(value: DelegationGrant): Promise<StoredSignedGrant>;
}

export interface DelegationAuthority {
  registerRoot(input: Readonly<{ taskId: string; allocationId?: string; rootGrant: StoredSignedGrant; signerDescriptor?: AuthorityKeyDescriptorV1; effects: number }>): Promise<void>;
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
  readonly signerDescriptor?: AuthorityKeyDescriptorV1;
  readonly grants: Map<string, { readonly grant: DelegationGrant; readonly digest: string; readonly allocationId: string; readonly signed: StoredSignedGrant }>;
  revoked: boolean;
}

export function createDelegationAuthority(input: Readonly<{ root: string; signGrant: (value: DelegationGrant) => Promise<StoredSignedGrant>; now?: () => Date }>): DelegationAuthority {
  assertLinuxAuthorityCellHost();
  const rootPath = path.resolve(input.root);
  const budgets = new FsDelegationBudgetLedger(rootPath);
  const roots = new Map<string, RootRecord>();
  const registryPath = path.join(rootPath, "delegation-registry.json");
  const lockPath = path.join(rootPath, "delegation-registry.lock");
  let loaded: Promise<void> | undefined;

  async function ensureLoaded(): Promise<void> {
    loaded ??= loadRegistry();
    await loaded;
  }

  async function registerRoot(value: Readonly<{ taskId: string; allocationId?: string; rootGrant: StoredSignedGrant; signerDescriptor?: AuthorityKeyDescriptorV1; effects: number }>): Promise<void> {
    const grant = asGrant(value.rootGrant.grant);
    const allocationId = value.allocationId ?? "root";
    if (grant.parentDigest !== null) throw new TypeError("root delegation parent digest must be null");
    if (authorityDigest(grant) !== value.rootGrant.digest) throw new TypeError("root delegation digest mismatch");
    const signerDescriptor = value.signerDescriptor === undefined ? undefined : verifiedDelegationSigner(value.signerDescriptor, value.rootGrant);
    const release = await acquireRegistryLock();
    try {
      await loadRegistry();
      loaded = Promise.resolve();
      const existing = roots.get(value.taskId);
      if (existing) {
        const allocation = await budgets.get(existing.rootAllocationId);
        if (existing.rootAllocationId !== allocationId || authorityDigest(existing.root) !== authorityDigest(value.rootGrant) || authorityDigest(existing.signerDescriptor ?? null) !== authorityDigest(signerDescriptor ?? null) || !allocation || allocation.effects !== value.effects || allocation.revoked || existing.revoked) throw new TypeError("delegation root activation conflict");
        return;
      }
      await budgets.createRoot({ taskId: value.taskId, allocationId, effects: value.effects });
      roots.set(value.taskId, { tenant: grant.tenant, taskId: value.taskId, root: value.rootGrant, rootAllocationId: allocationId, ...(signerDescriptor ? { signerDescriptor } : {}), grants: new Map([[allocationId, { grant, digest: value.rootGrant.digest, allocationId, signed: value.rootGrant }]]), revoked: false });
      try { await persistRegistryUnlocked(); } catch (error) { roots.delete(value.taskId); loaded = undefined; throw error; }
    } finally { await release(); }
  }

  async function request(value: Readonly<{ tenant: string; parentPrincipal: string; taskId: string; parentAllocationId: string; child: DelegationGrant; effects: number }>) {
    const signed = await input.signGrant(value.child);
    return registerSignedChild({ tenant: value.tenant, parentPrincipal: value.parentPrincipal, taskId: value.taskId, parentAllocationId: value.parentAllocationId, signedChild: signed, effects: value.effects });
  }

  async function registerSignedChild(value: SignedChildRegistration & Readonly<{ signerDescriptor?: AuthorityKeyDescriptorV1 }>): Promise<SignedChildResult> {
    const release = await acquireRegistryLock();
    try {
    await loadRegistry(); loaded = Promise.resolve();
    const record = roots.get(value.taskId);
    if (!record || record.tenant !== value.tenant || record.revoked) throw new TypeError("delegation task is not active");
    if (value.signerDescriptor && (!record.signerDescriptor || authorityDigest(record.signerDescriptor) !== authorityDigest(value.signerDescriptor))) throw new TypeError("authority-signed child signer is not the host-observed active task signer");
    const parent = record.grants.get(value.parentAllocationId);
    if (!parent || parent.grant.grantee !== value.parentPrincipal) throw new TypeError("delegation parent principal mismatch");
    const signed = value.signedChild, signedGrant = asGrant(signed.grant);
    if (signedGrant.tenant !== value.tenant || signedGrant.grantor !== value.parentPrincipal) throw new TypeError("delegation child identity mismatch");
    if (signedGrant.parentDigest !== parent.digest) throw new TypeError("delegation child parent digest mismatch");
    const existing = record.grants.get(signedGrant.grantId);
    if (existing) {
      const allocation = await budgets.get(existing.allocationId);
      if (authorityDigest(existing.signed) === authorityDigest(signed) && allocation?.parentAllocationId === value.parentAllocationId && allocation.effects === value.effects) return Object.freeze({ verdict: "accepted" as const, reasonCode: "delegation-allocated" as const, lifecycleState: "allocated" as const, grant: existing.grant, grantDigest: existing.digest, allocationId: existing.allocationId });
      throw new TypeError("delegation child grant id already exists with conflicting authority");
    }
    const now = input.now?.() ?? new Date();
    const activeChildCount = [...record.grants.values()].filter(candidate => candidate.grant.parentDigest === parent.digest && Date.parse(candidate.grant.expiresAt) > now.getTime()).length;
    validateChildDelegationRequest({ parent: parent.grant, child: signedGrant, activeChildCount, effects: value.effects, now });
    const allocationId = signedGrant.grantId;
    if (authorityDigest(signedGrant) !== signed.digest) throw new TypeError("authority cell returned an invalid child grant");
    await budgets.allocate({ allocationId, parentAllocationId: value.parentAllocationId, effects: value.effects, maxFanOut: parent.grant.delegationPolicy!.maxFanOut });
    record.grants.set(allocationId, { grant: signedGrant, digest: signed.digest, allocationId, signed });
    await persistRegistryUnlocked();
    return Object.freeze({ verdict: "accepted" as const, reasonCode: "delegation-allocated" as const, lifecycleState: "allocated" as const, grant: signedGrant, grantDigest: signed.digest, allocationId });
    } finally { await release(); }
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

  const service = Object.freeze({ registerRoot, request, status, taskStatus, resolveSessionBinding, revoke, budget: budgets });
  authoritySignedChildRegistrars.set(service, registerSignedChild);
  return service;

  async function loadRegistry(): Promise<void> {
    await ensureRegistryRoot();
    let raw: string;
    try { raw = await readFile(registryPath, "utf8"); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") { roots.clear(); return; }
      throw new Error("delegation registry unavailable", { cause: error });
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch (error) { throw new Error("delegation registry is corrupt", { cause: error }); }
    if (!parsed || typeof parsed !== "object" || (parsed as Record<string, unknown>).v !== "reelier.delegation-registry/v1" || !Array.isArray((parsed as Record<string, unknown>).tasks)) throw new Error("delegation registry is corrupt");
    const loadedRoots = new Map<string, RootRecord>();
    for (const item of (parsed as { tasks: unknown[] }).tasks) {
      if (!item || typeof item !== "object" || typeof (item as Record<string, unknown>).taskId !== "string" || typeof (item as Record<string, unknown>).tenant !== "string" || !Array.isArray((item as Record<string, unknown>).grants)) throw new Error("delegation registry is corrupt");
      const value = item as { taskId: string; tenant: string; root: StoredSignedGrant; rootAllocationId?: string; signerDescriptor?: AuthorityKeyDescriptorV1; grants: StoredSignedGrant[]; revoked?: boolean };
      const rootGrant = asGrant(value.root.grant);
      if (authorityDigest(rootGrant) !== value.root.digest) throw new Error("delegation registry digest mismatch");
      const signerDescriptor = value.signerDescriptor === undefined ? undefined : verifiedDelegationSigner(value.signerDescriptor, value.root);
      const grants = new Map<string, { readonly grant: DelegationGrant; readonly digest: string; readonly allocationId: string; readonly signed: StoredSignedGrant }>();
      const rootAllocationId = value.rootAllocationId ?? "root";
      grants.set(rootAllocationId, { grant: rootGrant, digest: value.root.digest, allocationId: rootAllocationId, signed: value.root });
      for (const stored of value.grants) {
        const child = asGrant(stored.grant);
        if (authorityDigest(child) !== stored.digest) throw new Error("delegation registry child digest mismatch");
        grants.set(child.grantId, { grant: child, digest: stored.digest, allocationId: child.grantId, signed: stored });
      }
      loadedRoots.set(value.taskId, { tenant: value.tenant, taskId: value.taskId, root: value.root, rootAllocationId, ...(signerDescriptor ? { signerDescriptor } : {}), grants, revoked: value.revoked === true });
    }
    roots.clear();
    for (const [taskId, record] of loadedRoots) roots.set(taskId, record);
  }

  async function persistRegistry(): Promise<void> {
    const release = await acquireRegistryLock();
    try {
      await persistRegistryUnlocked();
    } finally { await release(); }
  }

  async function persistRegistryUnlocked(): Promise<void> {
    const tasks = [...roots.values()].map(record => ({ v: "reelier.delegation-task/v1", taskId: record.taskId, tenant: record.tenant, root: record.root, rootAllocationId: record.rootAllocationId, ...(record.signerDescriptor ? { signerDescriptor: record.signerDescriptor } : {}), grants: [...record.grants.values()].filter(item => item.allocationId !== record.rootAllocationId).map(item => item.signed), revoked: record.revoked }));
    const temporary = `${registryPath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
    await writeFile(temporary, JSON.stringify({ v: "reelier.delegation-registry/v1", tasks }), "utf8");
    await rename(temporary, registryPath);
  }

  async function acquireRegistryLock(): Promise<() => Promise<void>> {
    await ensureRegistryRoot();
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

  async function ensureRegistryRoot(): Promise<void> {
    const parent = path.dirname(rootPath);
    await requireUnlinkedDirectory(parent);
    try { await mkdir(rootPath); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    await requireUnlinkedDirectory(rootPath);
    const [canonicalParent, canonicalRoot] = await Promise.all([realpath(parent), realpath(rootPath)]);
    if (path.relative(canonicalParent, path.dirname(canonicalRoot)) !== "") throw new TypeError("delegation registry directory is not confined to its exact parent");
  }
}

type SignedChildRegistration = Readonly<{ tenant: string; parentPrincipal: string; taskId: string; parentAllocationId: string; signedChild: StoredSignedGrant; effects: number }>;
type SignedChildResult = Readonly<{ verdict: "accepted"; reasonCode: "delegation-allocated"; lifecycleState: "allocated"; grant: DelegationGrant; grantDigest: string; allocationId: string }>;
const authoritySignedChildRegistrars = new WeakMap<object, (input: SignedChildRegistration & Readonly<{ signerDescriptor?: AuthorityKeyDescriptorV1 }>) => Promise<SignedChildResult>>();

/** Direct-module Cell bridge. Deliberately omitted from host/package barrels. */
export async function registerAuthoritySignedChild(service: DelegationAuthority, input: SignedChildRegistration & Readonly<{ signerDescriptor: AuthorityKeyDescriptorV1 }>): Promise<SignedChildResult> {
  const register = authoritySignedChildRegistrars.get(service as object);
  if (!register) throw new TypeError("genuine branded delegation authority required");
  const descriptor = parseAuthorityKeyDescriptor(input.signerDescriptor), child = asGrant(input.signedChild.grant), digest = authorityDigest(child);
  if (descriptor.role !== "authority-cell" || descriptor.purpose !== "delegation-grant" || input.signedChild.signerId !== descriptor.keyId || input.signedChild.digest !== digest || !verifyAuthoritySignature(createPublicKey({ key: Buffer.from(descriptor.publicKeySpkiBase64, "base64"), format: "der", type: "spki" }), "delegation-grant", digest, input.signedChild.signature)) throw new TypeError("authority-signed child signer must be active and its purpose, digest, and signature valid");
  return register({ tenant: input.tenant, parentPrincipal: input.parentPrincipal, taskId: input.taskId, parentAllocationId: input.parentAllocationId, signedChild: input.signedChild, signerDescriptor: descriptor, effects: input.effects });
}

function verifiedDelegationSigner(value: unknown, signed: StoredSignedGrant): AuthorityKeyDescriptorV1 {
  const descriptor = parseAuthorityKeyDescriptor(value), digest = authorityDigest(asGrant(signed.grant));
  if (descriptor.role !== "authority-cell" || descriptor.purpose !== "delegation-grant" || descriptor.keyId !== signed.signerId || signed.digest !== digest || !verifyAuthoritySignature(createPublicKey({ key: Buffer.from(descriptor.publicKeySpkiBase64, "base64"), format: "der", type: "spki" }), "delegation-grant", digest, signed.signature)) throw new TypeError("delegation root signer descriptor, digest, or signature is invalid");
  return descriptor;
}

async function requireUnlinkedDirectory(target: string): Promise<void> {
  const resolved = path.resolve(target), parsed = path.parse(resolved);
  let current = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError("delegation registry directory is linked or not confined");
  }
}

function asGrant(value: unknown): DelegationGrant {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("delegation grant must be an object");
  return value as DelegationGrant;
}
