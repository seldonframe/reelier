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
import { createFileReceiptPublication } from "./receipts.js";
import { createAuthorityHostRuntime } from "./runtime.js";
import type { AuthorityHostConfig } from "./config.js";
import type { AuthorityHostRuntime } from "./server.js";
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
  const dispatch = createDispatchCoordinator(ledger, { async dispatch() { return { kind: "definitive-failure", resultDigest: authorityDigest({ v: "reelier.local-dispatch/v1", reason: "connector-not-configured" }) }; } }, undefined, publication);
  return createAuthorityHostRuntime({ gate, dispatch, ledger, decisions });
}
