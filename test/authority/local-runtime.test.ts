import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLocalAuthorityRuntime } from "../../src/authority/host/local.js";
import { createDelegationAuthority } from "../../src/authority/host/delegation-service.js";
import { authorityDigest } from "../../src/authority/wire.js";
import { signAuthorityDigest } from "../../src/authority/crypto.js";
import type { DelegationGrant } from "../../src/authority/types.js";

test("local authority serve uses the real gate and refuses an unsigned empty deployment", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-local-runtime-"));
  try {
    const runtime = await createLocalAuthorityRuntime({ version: 1, tenant: "tenant_1", requester: "operator", definitions: ["gmail_reply_send_v1"], ledgerDir: path.join(root, "ledger"), decisionDir: path.join(root, "decisions"), receiptDir: path.join(root, "receipts"), endpoints: [] });
    const result = await runtime.outcome("gmail_reply_send_v1", { v: "reelier.outcome-request/v1", requestId: "local-1", sourceRefs: { thread: "opaque" }, choices: {} }, { tenant: "tenant_1", requester: "operator" });
    assert.equal(result.verdict, "refused");
    assert.equal(result.reasonCode, "contract-not-found");
    const status = await runtime.status({ requestId: "local-1" }, { tenant: "tenant_1", requester: "operator" });
    assert.equal(status.reasonCode, "contract-not-found");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("local authority catalog lists only configured definitions and loads an opaque job reference", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-local-catalog-"));
  try {
    const runtime = await createLocalAuthorityRuntime({ version: 1, tenant: "tenant_1", requester: "operator", definitions: ["gmail_reply_send_v1"], ledgerDir: path.join(root, "ledger"), decisionDir: path.join(root, "decisions"), receiptDir: path.join(root, "receipts"), endpoints: [] });
    const found = await runtime.jobsSearch!({ query: "gmail" }, { tenant: "tenant_1", requester: "operator" }) as { jobs: Array<{ jobId: string; alias: string }> };
    assert.deepEqual(found.jobs, [{ jobId: "gmail_reply_send_v1", alias: "gmail_reply_send_v1" }]);
    const loaded = await runtime.jobLoad!({ jobId: "gmail_reply_send_v1" }, { tenant: "tenant_1", requester: "operator" }) as { jobRef: string };
    assert.equal(loaded.jobRef, "gmail_reply_send_v1");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("local authority runtime refuses a malformed signed deployment instead of silently using an empty authority state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-local-deployment-"));
  try {
    const deploymentPath = path.join(root, "deployment.json");
    await (await import("node:fs/promises")).writeFile(deploymentPath, JSON.stringify({ v: "reelier.authority-deployment/v1", tenant: "tenant_1", state: { tenant: "tenant_1", definitionAlias: "gmail_reply_send_v1", stateVersion: 1, candidates: [] }, connectors: "not-an-array", trust: [], sourceDirectory: "sources" }));
    await assert.rejects(() => createLocalAuthorityRuntime({ version: 1, tenant: "tenant_1", requester: "operator", definitions: ["gmail_reply_send_v1"], ledgerDir: path.join(root, "ledger"), decisionDir: path.join(root, "decisions"), receiptDir: path.join(root, "receipts"), endpoints: [], deploymentPath } as never), /deployment connectors|trust roots|unknown or missing field/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("managed local authority refuses a non-exclusive topology", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-managed-topology-"));
  try {
    await assert.rejects(() => createLocalAuthorityRuntime({ version: 1, tenant: "tenant_1", requester: "operator", definitions: ["gmail_reply_send_v1"], topology: "same-user", ledgerDir: path.join(root, "ledger"), decisionDir: path.join(root, "decisions"), receiptDir: path.join(root, "receipts"), endpoints: [], cloud: { baseUrl: "https://cloud.example", tokenRef: "cloud-token" } }), /managed authority requires isolated topology/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("managed local authority refuses isolated declarations without host topology evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-managed-topology-evidence-"));
  try {
    await assert.rejects(() => createLocalAuthorityRuntime({ version: 1, tenant: "tenant_1", requester: "operator", definitions: ["gmail_reply_send_v1"], topology: "isolated", ledgerDir: path.join(root, "ledger"), decisionDir: path.join(root, "decisions"), receiptDir: path.join(root, "receipts"), endpoints: [], cloud: { baseUrl: "https://cloud.example", tokenRef: "cloud-token" } }), /topology evidence/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("managed local authority accepts only complete verified topology evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-managed-topology-verified-"));
  try {
    const evidence = { v: "reelier.topology-evidence/v1" as const, credentialIsolation: "verified" as const, providerEgress: "verified" as const, rawWriteReachability: "verified" as const, readCoverage: "verified" as const, runtimeIdentity: "verified" as const, declaredSurfaceEnforcement: "verified" as const };
    const runtime = await createLocalAuthorityRuntime({ version: 1, tenant: "tenant_1", requester: "operator", definitions: ["gmail_reply_send_v1"], topology: "isolated", ledgerDir: path.join(root, "ledger"), decisionDir: path.join(root, "decisions"), receiptDir: path.join(root, "receipts"), endpoints: [], cloud: { baseUrl: "https://cloud.example", tokenRef: "cloud-token" } }, { topologyEvidence: evidence });
    assert.equal(typeof runtime.status, "function");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("local runtime creates a root task only for the authenticated sponsor", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-local-task-create-"));
  try {
    const keys = generateKeyPairSync("ed25519");
    const delegation = createDelegationAuthority({ root: path.join(root, "delegations"), signGrant: async value => ({ grant: value, digest: authorityDigest(value), signerId: "authority-cell", signature: signAuthorityDigest(keys.privateKey, "delegation-grant", authorityDigest(value)) }) });
    const runtime = await createLocalAuthorityRuntime({ version: 1, tenant: "tenant_1", requester: "operator", definitions: [], ledgerDir: path.join(root, "ledger"), decisionDir: path.join(root, "decisions"), receiptDir: path.join(root, "receipts"), endpoints: [] }, { delegation });
    const grant: DelegationGrant = { v: "reelier.delegation-grant/v1", tenant: "tenant_1", grantId: "root", parentDigest: null, sponsor: "operator", grantor: "operator", grantee: "coordinator", issuedAt: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z", constraints: { definitionAliases: [], audiences: ["coordinator"], connectorAccounts: [], projectionPointers: [], riskClasses: [], limits: { maxEffectsPerWindow: 10, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 } }, delegationPolicy: { mayDelegate: true, maxDepth: 1, maxFanOut: 1, maxChildDurationSeconds: 60, maxDelegatedEffects: 1 } };
    const signed = { grant, digest: authorityDigest(grant), signerId: "operator", signature: { alg: "ed25519" as const, sig: "unused" } };
    const created = await runtime.taskCreate!({ taskId: "task_1", rootGrant: signed, effects: 1 }, { tenant: "tenant_1", requester: "operator" });
    assert.deepEqual(created, { taskId: "task_1", verdict: "accepted", reasonCode: "task-created", lifecycleState: "active" });
    const refused = await runtime.taskCreate!({ taskId: "task_2", rootGrant: { ...signed, grant: { ...grant, sponsor: "attacker" } }, effects: 1 }, { tenant: "tenant_1", requester: "operator" });
    assert.equal((refused as { verdict: string }).verdict, "refused");
  } finally { await rm(root, { recursive: true, force: true }); }
});
