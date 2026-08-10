import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../wire.js";
import { signAuthorityDigest } from "../crypto.js";
import { createAuthorityGate } from "../gate.js";
import { createTrustRoots } from "../trust.js";
import { verifyTrustedAuthority } from "../trust.js";
import { createConnectorRegistry } from "../connector.js";
import { createAuthorityStatePort } from "../state.js";
import { createStaticPackRegistry } from "../pack.js";
import { createFileGateDecisionSink } from "../decision.js";
import { FsAuthorityLedger } from "./fs-ledger.js";
import { createDispatchCoordinator, type DispatchAdapter } from "./dispatch.js";
import { createJsonHttpsDispatchAdapter } from "./json-https-connector.js";
import { createFileReceiptPublication } from "./receipts.js";
import { createAuthorityHostRuntime } from "./runtime.js";
import type { AuthorityHostConfig } from "./config.js";
import type { AuthorityHostRuntime } from "./server.js";
import { createSecretResolver } from "./secret-resolver.js";
import { firstPartyPacks, createFirstPartySourceRegistry } from "../../packs/index.js";
import { loadAuthorityDeployment } from "./deployment.js";
import { loadOrCreateLocalGateSigner } from "./gate-signer.js";
import type { DelegationAuthority } from "./delegation-service.js";
import { assertFreshManagedTopologyEvidence, assertManagedTopologyEvidence, type SignedTopologyEvidenceV1, type TopologyEvidenceV1 } from "./topology.js";
import { verifyAuthorityLease } from "./lease.js";
import type { SignedAuthorityLeaseV1 } from "../types.js";

/** Builds the local host from signed-artifact boundaries. An empty workspace is intentionally
 * usable for discovery and status, but every Outcome refuses until a signed contract is installed. */
export interface LocalAuthorityRuntimeOptions {
  readonly dispatchAdapter?: DispatchAdapter;
  readonly delegation?: DelegationAuthority;
  readonly topologyEvidence?: TopologyEvidenceV1;
  readonly signedTopologyEvidence?: SignedTopologyEvidenceV1;
  readonly topologySigner?: Readonly<{ signerId: string; publicKey: import("node:crypto").KeyObject }>;
  readonly signedLease?: SignedAuthorityLeaseV1;
  readonly leaseSigner?: Readonly<{ signerId: string; publicKey: import("node:crypto").KeyObject }>;
}

export async function createLocalAuthorityRuntime(config: AuthorityHostConfig, options: LocalAuthorityRuntimeOptions = {}): Promise<AuthorityHostRuntime> {
  if (config.cloud && config.topology !== "isolated") throw new TypeError("managed authority requires isolated topology");
  if (config.cloud) {
    if (!options.signedTopologyEvidence || !options.topologySigner) throw new TypeError("managed authority requires signed topology evidence");
    assertFreshManagedTopologyEvidence(options.signedTopologyEvidence, { tenant: config.tenant, now: new Date(), signerId: options.topologySigner.signerId, publicKey: options.topologySigner.publicKey, maxAgeMs: 5 * 60 * 1000 });
    assertManagedTopologyEvidence(options.signedTopologyEvidence.evidence);
    if (!options.signedLease || !options.leaseSigner) throw new TypeError("managed authority requires a signed lease");
    verifyAuthorityLease(options.signedLease, { tenant: config.tenant, now: new Date(), signerId: options.leaseSigner.signerId, publicKey: options.leaseSigner.publicKey, topologyEvidenceDigest: options.signedTopologyEvidence.digest });
  }
  await mkdir(config.ledgerDir, { recursive: true }); await mkdir(config.decisionDir, { recursive: true }); await mkdir(config.receiptDir, { recursive: true });
  const deployment = config.deploymentPath ? await loadAuthorityDeployment(config.deploymentPath) : undefined;
  if (deployment && deployment.tenant !== config.tenant) throw new TypeError("authority deployment tenant does not match host config");
  const ledger = new FsAuthorityLedger(config.ledgerDir);
  const decisions = createFileGateDecisionSink(config.decisionDir);
  const gateSigner = await loadOrCreateLocalGateSigner(config.gateKeyFile ?? path.join(config.receiptDir, "..", "keys", "local-gate.pem"));
  const { privateKey, publicKey } = gateSigner;
  const deploymentGate = deployment?.trustEntries.find(entry => entry.signerId === "local-gate");
  if (deploymentGate && !deploymentGate.publicKey.export({ type: "spki", format: "der" }).equals(publicKey.export({ type: "spki", format: "der" }))) throw new TypeError("deployment local gate key does not match host gate key");
  const trustRoots = createTrustRoots([...(deployment?.trustEntries.filter(entry => entry.signerId !== "local-gate") ?? []), { tenant: config.tenant, signerId: "local-gate", principalId: config.requester, publicKey, purposes: ["gate-event", "principal", "delegation-grant"] }]);
  const packs = createStaticPackRegistry(firstPartyPacks.map(pack => pack.definition));
  const sources = createFirstPartySourceRegistry(config.tenant);
  const snapshot = deployment?.state;
  const connectorRegistry = deployment?.connectorRegistry ?? createConnectorRegistry([]);
  const state = createAuthorityStatePort({
    async loadCompleteContractSet(tenant, definitionAlias) { return { ok: true as const, snapshot: snapshot && snapshot.tenant === tenant && snapshot.definitionAlias === definitionAlias ? snapshot : { tenant, definitionAlias, stateVersion: 1, candidates: [] }, backendToken: Object.freeze({}) }; },
    async advanceVersion(backendToken) { void backendToken; return { ok: true as const, backendObservedToken: Object.freeze({}) }; },
    async withCurrent(_token, callback) { return { ok: true as const, value: await callback() }; },
    async executeSourceReads(plans) {
      if (!deployment) return { ok: false as const, reason: "unavailable" as const };
      try {
        const observations = await Promise.all(plans.map(async plan => ({ planDigest: plan.planDigest, rawBytes: Uint8Array.from(await readFile(path.join(deployment.sourceDirectory, `${plan.opaqueHandle}.json`))) })));
        return { ok: true as const, observations };
      } catch { return { ok: false as const, reason: "unavailable" as const }; }
    },
  });
  const gate = createAuthorityGate({ trustRoots, packs, sources, connectors: connectorRegistry, state, ledger, localGatePolicyDigest: authorityDigest({ v: "reelier.local-gate-policy/v1", tenant: config.tenant }), decisionSink: decisions, signer: { async sign(input) { return { signerId: "local-gate", signature: signAuthorityDigest(privateKey, input.purpose, input.digest) }; } }, eventId: () => `evt_${randomUUID()}`, capabilityId: () => `cap_${randomUUID()}` });
  const publication = createFileReceiptPublication({ rootDir: config.receiptDir });
  const adapter = options.dispatchAdapter ?? createJsonHttpsDispatchAdapter({ endpoints: config.endpoints, secrets: createSecretResolver() });
  const dispatch = createDispatchCoordinator(ledger, adapter, undefined, publication, options.delegation?.budget);
  const runtime = createAuthorityHostRuntime({ gate, dispatch, ledger, decisions, delegation: options.delegation, ...(options.delegation ? { verifyRootGrant: (grant, tenant) => { verifyTrustedAuthority(trustRoots, { tenant, signerId: grant.signerId, purpose: "delegation-grant", advertisedDigest: grant.digest, value: grant.grant, signature: grant.signature }); } } : {}) });
  const jobs = Object.freeze(config.definitions.map(alias => Object.freeze({ jobId: alias, alias })));
  return Object.freeze({
    ...runtime,
    async jobsSearch(input: unknown) {
      const query = input && typeof input === "object" && !Array.isArray(input) && typeof (input as Record<string, unknown>).query === "string" ? String((input as Record<string, unknown>).query).toLowerCase() : "";
      return Object.freeze({ requestId: "", verdict: "accepted" as const, reasonCode: "jobs-found", lifecycleState: "catalog", jobs: Object.freeze(jobs.filter(job => !query || job.alias.toLowerCase().includes(query))) });
    },
    async jobLoad(input: unknown) {
      const jobId = input && typeof input === "object" && !Array.isArray(input) && typeof (input as Record<string, unknown>).jobId === "string" ? String((input as Record<string, unknown>).jobId) : "";
      if (!jobs.some(job => job.jobId === jobId)) return Object.freeze({ requestId: "", verdict: "refused" as const, reasonCode: "job-not-found", lifecycleState: "unknown" });
      return Object.freeze({ requestId: "", verdict: "accepted" as const, reasonCode: "job-loaded", lifecycleState: "loaded", jobRef: jobId });
    },
    async invoke(input: unknown, context: { readonly tenant: string; readonly requester: string }) {
      if (!input || typeof input !== "object" || Array.isArray(input)) return Object.freeze({ requestId: "", verdict: "refused" as const, reasonCode: "invalid-request", lifecycleState: "refused" });
      const raw = input as Record<string, unknown>;
      const jobRef = typeof raw.jobRef === "string" ? raw.jobRef : "";
      if (!jobs.some(job => job.jobId === jobRef)) return Object.freeze({ requestId: typeof raw.requestId === "string" ? raw.requestId : "", verdict: "refused" as const, reasonCode: "job-not-found", lifecycleState: "unknown" });
      const request = { ...raw }; delete request.jobRef;
      return runtime.outcome(jobRef, request, context);
    },
  });
}
