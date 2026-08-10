import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { authorityDigest } from "../wire.js";
import { signAuthorityDigest } from "../crypto.js";
import { createAuthorityGate } from "../gate.js";
import { createTrustRoots } from "../trust.js";
import { createConnectorRegistry } from "../connector.js";
import { createAuthorityStatePort } from "../state.js";
import { createStaticPackRegistry } from "../pack.js";
import { createFileGateDecisionSink } from "../decision.js";
import { FsAuthorityLedger } from "./fs-ledger.js";
import { createDispatchCoordinator } from "./dispatch.js";
import { createJsonHttpsDispatchAdapter } from "./json-https-connector.js";
import { createFileReceiptPublication } from "./receipts.js";
import { createAuthorityHostRuntime } from "./runtime.js";
import type { AuthorityHostConfig } from "./config.js";
import type { AuthorityHostRuntime } from "./server.js";
import { createSecretResolver } from "./secret-resolver.js";
import { firstPartyPacks, createFirstPartySourceRegistry } from "../../packs/index.js";

/** Builds the local host from signed-artifact boundaries. An empty workspace is intentionally
 * usable for discovery and status, but every Outcome refuses until a signed contract is installed. */
export async function createLocalAuthorityRuntime(config: AuthorityHostConfig): Promise<AuthorityHostRuntime> {
  await mkdir(config.ledgerDir, { recursive: true }); await mkdir(config.decisionDir, { recursive: true }); await mkdir(config.receiptDir, { recursive: true });
  const ledger = new FsAuthorityLedger(config.ledgerDir);
  const decisions = createFileGateDecisionSink(config.decisionDir);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const trustRoots = createTrustRoots([{ tenant: config.tenant, signerId: "local-gate", principalId: config.requester, publicKey, purposes: ["gate-event"] }]);
  const packs = createStaticPackRegistry(firstPartyPacks.map(pack => pack.definition));
  const sources = createFirstPartySourceRegistry(config.tenant);
  const state = createAuthorityStatePort({
    async loadCompleteContractSet(tenant, definitionAlias) { return { ok: true as const, snapshot: { tenant, definitionAlias, stateVersion: 1, candidates: [] }, backendToken: Object.freeze({}) }; },
    async advanceVersion(backendToken) { void backendToken; return { ok: true as const, backendObservedToken: Object.freeze({}) }; },
    async withCurrent(_token, callback) { return { ok: true as const, value: await callback() }; },
    async executeSourceReads() { return { ok: false as const, reason: "unavailable" as const }; },
  });
  const gate = createAuthorityGate({ trustRoots, packs, sources, connectors: createConnectorRegistry([]), state, ledger, localGatePolicyDigest: authorityDigest({ v: "reelier.local-gate-policy/v1", tenant: config.tenant }), decisionSink: decisions, signer: { async sign(input) { return { signerId: "local-gate", signature: signAuthorityDigest(privateKey, input.purpose, input.digest) }; } }, eventId: () => `evt_${randomUUID()}`, capabilityId: () => `cap_${randomUUID()}` });
  const publication = createFileReceiptPublication({ rootDir: config.receiptDir });
  const dispatch = createDispatchCoordinator(ledger, createJsonHttpsDispatchAdapter({ endpoints: config.endpoints, secrets: createSecretResolver() }), undefined, publication);
  const runtime = createAuthorityHostRuntime({ gate, dispatch, ledger, decisions });
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
