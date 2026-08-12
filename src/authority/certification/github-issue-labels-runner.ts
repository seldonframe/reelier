import { createHash, createPublicKey, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { open, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { CertificationCellHost } from "./cell.js";
import { certificationCellHostInternalState } from "./cell.js";
import { parseCertificationOperatorConfigV3 } from "./config.js";
import { parseCertificationScenarioPlan } from "./manifests.js";
import { authorityCanonicalBytes, authorityDigest } from "../wire.js";
import { authenticateOutcomeRequest } from "../keys.js";
import { createTrustRoots } from "../trust.js";
import { signAuthorityDigest, verifyAuthoritySignature } from "../crypto.js";
import { createStaticPackRegistry } from "../pack.js";
import { createSourceRegistry } from "../source.js";
import { createConnectorRegistry } from "../connector.js";
import { createAuthorityStatePort } from "../state.js";
import { createAuthorityGate } from "../gate.js";
import { createFileGateDecisionSink } from "../decision.js";
import { FsAuthorityLedger } from "../host/fs-ledger.js";
import { createDispatchCoordinator } from "../host/dispatch.js";
import { validateContractAgainstDelegation, validateDelegationChain } from "../delegation.js";
import { githubIssueLabelsDefinition, parseGitHubIssueLabelsPolicy } from "../../packs/github/compile.js";
import { createGitHubIssueLabelsSourceResolver } from "../../packs/github/source.js";
import { githubIssueLabelsAlias, githubIssueLabelsDefinitionDigest, githubIssueLabelsPackDigest, githubIssueLabelsPolicySchemaId, githubIssueLabelsReadEndpointId, githubIssueLabelsResolverId, githubIssueLabelsRiskClass, githubIssueLabelsWriteEndpointId } from "../../packs/github/manifest.js";
import { ensureConfinedDirectory, readUnlinkedFile } from "./filesystem.js";
import { assertLinuxAuthorityCellHost } from "../host/platform.js";

export type HermeticGitHubMode = "normal" | "source-drift" | "effect-drift" | "provider-503" | "accessor-response" | "cut-after-budget" | "cut-after-dispatched" | "cut-after-send-intent" | "pause-after-dispatched";
export interface GitHubHermeticRunnerResult { readonly requestId: string; readonly status: "acknowledged" | "refused" | "failed" | "pending-reconciliation"; readonly success: false; readonly providerWrites: number; readonly reservationId: string | null }
export interface GitHubIssueLabelsHermeticComposition { run(input: Readonly<{ bearerToken: string; requestId: string }>): Promise<GitHubHermeticRunnerResult>; recover(): Promise<readonly string[]>; status(input: Readonly<{ bearerToken: string; requestId: string }>): Promise<GitHubHermeticRunnerResult> }
type JournalPhase = "reserved" | "budget-intent" | "budget-consumed" | "dispatched" | "provider-send-intent" | "acknowledged" | "refused" | "failed" | "pending-reconciliation";
interface Journal { readonly v: "reelier.github-certification-journal/v1"; readonly requestId: string; readonly requestDigest: string; readonly reservationId: string; readonly allocationId: string; readonly effectDigest: string; readonly permitSnapshotDigest: string; readonly phase: JournalPhase; readonly providerWrites: number; readonly signerId?: string; readonly signature?: Readonly<{ alg: "ed25519"; sig: string }> }
type Issue = Readonly<{ owner: string; repo: string; issueNumber: number; issueState: string; labels: readonly string[] }>;

/** Non-barrel hermetic test composition. Executable authority comes only from the branded real Cell. */
export async function createGitHubIssueLabelsHermeticComposition(cell: CertificationCellHost, options: Readonly<{ mode: HermeticGitHubMode }>): Promise<GitHubIssueLabelsHermeticComposition> {
  assertLinuxAuthorityCellHost();
  const state = certificationCellHostInternalState(cell);
  const journalAuthority = state.hermeticGitHubAuthority();
  closed(options, ["mode"], "GitHub hermetic composition options");
  const modes: readonly string[] = ["normal", "source-drift", "effect-drift", "provider-503", "accessor-response", "cut-after-budget", "cut-after-dispatched", "cut-after-send-intent", "pause-after-dispatched"];
  if (!modes.includes(options.mode)) throw new TypeError("GitHub hermetic composition mode is invalid");
  const config = parseCertificationOperatorConfigV3(JSON.parse((await readUnlinkedFile(path.join(state.workspace, "config.json"))).toString("utf8")));
  if (config.scenarios.length !== 1 || config.scenarios[0] !== "github-issue-labels") throw new TypeError("GitHub runner requires the exact selected scenario");
  const planFile = JSON.parse((await readUnlinkedFile(path.join(state.workspace, "inputs", "plans", "github-issue-labels.json"))).toString("utf8"));
  parseCertificationScenarioPlan(planFile, config, ["github-issue-labels"]);
  const resource = config.resources["github-issue-labels"] as { apiBaseUrl: string; owner: string; repository: string; issueNumber: number };
  const desired = (config.desiredState["github-issue-labels"] as { labels: readonly string[] }).labels;
  if (resource.apiBaseUrl !== "https://api.github.com") throw new TypeError("GitHub endpoint is not the reviewed endpoint");
  const activation = JSON.parse((await readUnlinkedFile(path.join(state.workspace, "authority", "delegation", "root-activation.json"))).toString("utf8"));
  const constraints = activation.signedRootGrant.grant.constraints;
  const exactAccount = constraints.connectorAccounts.some((item: any) => item.connectorId === "github" && item.accountId === "github_fixlyai_reelier");
  if (!exactAccount || !constraints.definitionAliases.includes(githubIssueLabelsAlias) || !constraints.riskClasses.includes(githubIssueLabelsRiskClass)) throw new TypeError("GitHub account, definition, or risk authority is not exact");
  const journalRoot = await ensureConfinedDirectory(state.workspace, ["authority", "github-label-runner"]);
  const ledgerRoot = await ensureConfinedDirectory(state.workspace, ["authority", "github-label-runner", "ledger"]);
  const decisionRoot = await ensureConfinedDirectory(state.workspace, ["authority", "github-label-runner", "decisions"]);
  const provider = createBrandedProvider(resource, desired, options.mode);
  const gateRuntime = await buildGate({ state, activation, constraints, provider, ledgerRoot, decisionRoot, resource, desired });
  const requestIdsByReservation = new Map<string, string>();
  let providerWrites = 0;
  let controlledCut: ControlledCut | undefined;
  const coordinator = createDispatchCoordinator(gateRuntime.ledger, {
    async dispatch(dispatchState) {
      const requestId = requestIdsByReservation.get(dispatchState.reservation.reservationId); if (!requestId) throw new Error("dispatch request binding missing");
      const current = await loadJournal(journalRoot, requestId, journalAuthority); if (!current) throw new Error("dispatch journal missing");
      await saveJournal(journalRoot, { ...current, phase: "dispatched" }, journalAuthority);
      if (options.mode === "cut-after-dispatched") { controlledCut = new ControlledCut(); throw controlledCut; }
      if (options.mode === "pause-after-dispatched") await new Promise(resolve => setTimeout(resolve, 500));
      await saveJournal(journalRoot, { ...current, phase: "provider-send-intent" }, journalAuthority);
      if (options.mode === "cut-after-send-intent") { controlledCut = new ControlledCut(); throw controlledCut; }
      const rawResponse = await provider.replaceLabels(dispatchState.effect); providerWrites += 1;
      const response = normalizeProviderAcknowledgment(rawResponse);
      if (response.status < 200 || response.status >= 300) return { kind: "definitive-failure" as const, resultDigest: authorityDigest(response), providerStatus: response.status, reconciliationStatus: "not-attempted" as const };
      return { kind: "acknowledged" as const, resultDigest: authorityDigest(response), providerStatus: response.status, reconciliationStatus: "not-attempted" as const };
    },
  });

  async function executeRun(value: Readonly<{ bearerToken: string; requestId: string }>): Promise<GitHubHermeticRunnerResult> {
    closed(value, ["bearerToken", "requestId"], "GitHub runner call"); validateRequestId(value.requestId);
    const accessPermit = await state.issueHermeticGitHubPermit(value.bearerToken); await state.revalidateHermeticGitHubPermit(accessPermit);
    const prior = await loadJournal(journalRoot, value.requestId, journalAuthority); if (prior) return view(prior);
    const permit = await state.issueHermeticGitHubPermit(value.bearerToken);
    const request = { v: "reelier.outcome-request/v1", requestId: value.requestId, sourceRefs: { issue: "issue_1" }, choices: {} };
    const authenticated = authenticateOutcomeRequest({ tenant: activation.authorityCellId, requester: activation.principalId, definitionAlias: githubIssueLabelsAlias, request, executionContext: { v: "reelier.authority-execution-context/v1", taskId: activation.taskId, principalId: activation.principalId, grantId: activation.grantId, grantDigest: activation.signedRootGrant.digest, allocationId: activation.allocationId, runtimeSessionId: activation.runtimeSessionId, jobId: activation.jobId, authorityCellId: activation.authorityCellId } });
    const decided = await gateRuntime.gate.decide(authenticated);
    if (decided.kind !== "accepted") throw new Error(`GitHub AuthorityGate refused: ${JSON.stringify(decided)}`);
    const reservationId = decided.signedDecision.reservationId!;
    requestIdsByReservation.set(reservationId, value.requestId);
    const reservation = await gateRuntime.ledger.getReservation(reservationId); if (!reservation) throw new Error("GitHub reservation missing");
    const read2 = normalizeIssue(await provider.readIssue());
    const expectedResource = read2.owner === resource.owner && read2.repo === resource.repository && read2.issueNumber === resource.issueNumber;
    const effect2 = githubIssueLabelsDefinition.compile({ source: gateRuntime.sourceFor(read2), policy: parseGitHubIssueLabelsPolicy({ desiredLabels: desired }), choices: {} } as any);
    const effectDigest2 = options.mode === "effect-drift" ? authorityDigest({ effect2, drift: true }) : authorityDigest(effect2);
    const permitSnapshotDigest = authorityDigest({ v: "reelier.github-permit-snapshot/v1", activation: authorityDigest(activation), plan: authorityDigest(planFile), allocationId: activation.allocationId, effectDigest: reservation.intent.effectDigest });
    let journal: Journal = { v: "reelier.github-certification-journal/v1", requestId: value.requestId, requestDigest: authorityDigest(request), reservationId, allocationId: activation.allocationId, effectDigest: reservation.intent.effectDigest, permitSnapshotDigest, phase: "reserved", providerWrites: 0 };
    await saveJournal(journalRoot, journal, journalAuthority);
    if (!expectedResource || effectDigest2 !== reservation.intent.effectDigest) {
      await coordinator.cancel(decided.handle, "source-or-effect-drift"); journal = { ...journal, phase: "refused" }; await saveJournal(journalRoot, journal, journalAuthority); return view(journal);
    }
    await state.revalidateHermeticGitHubPermit(permit);
    journal = { ...journal, phase: "budget-intent" }; await saveJournal(journalRoot, journal, journalAuthority);
    await state.delegationAuthority.budget.consumeOnce({ allocationId: activation.allocationId, reservationId, effects: 1 });
    journal = { ...journal, phase: "budget-consumed" }; await saveJournal(journalRoot, journal, journalAuthority);
    if (options.mode === "cut-after-budget") throw new ControlledCut();
    try {
      const outcome = await coordinator.dispatch(decided.handle);
      if (controlledCut) throw controlledCut;
      journal = { ...(await loadJournal(journalRoot, value.requestId, journalAuthority) ?? journal), phase: outcome.kind === "acknowledged" ? "acknowledged" : outcome.kind === "definitive-failure" ? "failed" : "pending-reconciliation", providerWrites };
      await saveJournal(journalRoot, journal, journalAuthority); return view(journal);
    } catch (error) { if (error instanceof ControlledCut) throw error; throw error; }
  }
  async function run(value: Readonly<{ bearerToken: string; requestId: string }>): Promise<GitHubHermeticRunnerResult> {
    closed(value, ["bearerToken", "requestId"], "GitHub runner call"); validateRequestId(value.requestId);
    return withRequestLock(journalRoot, value.requestId, () => executeRun(value));
  }
  async function recover(): Promise<readonly string[]> {
    const recovered: string[] = [];
    for (const name of await readdir(journalRoot)) {
      if (!name.endsWith(".journal.json")) continue; const requestId = name.slice(0, -13); await withRequestLock(journalRoot, requestId, async () => { const journal = await loadJournal(journalRoot, requestId, journalAuthority); if (!journal) return;
      const boundReservation = await gateRuntime.ledger.getReservation(journal.reservationId), allocation = await state.delegationAuthority.budget.get(journal.allocationId);
      if (!boundReservation || boundReservation.intent.requestDigest !== journal.requestDigest || boundReservation.intent.effectDigest !== journal.effectDigest || boundReservation.intent.executionContext?.allocationId !== journal.allocationId || !allocation || allocation.taskId !== activation.taskId || allocation.revoked) throw new TypeError("GitHub dispatch journal authority binding is invalid or tampered");
      const compatible: Record<JournalPhase, readonly string[]> = { reserved: ["reserved"], "budget-intent": ["reserved"], "budget-consumed": ["reserved"], dispatched: ["dispatched", "ambiguous"], "provider-send-intent": ["dispatched", "ambiguous"], acknowledged: ["acknowledged"], refused: ["cancelled", "reconciled"], failed: ["definitive-failure"], "pending-reconciliation": ["ambiguous"] };
      if (!compatible[journal.phase].includes(boundReservation.state)) throw new TypeError("GitHub signed journal rollback conflicts with monotonic ledger truth");
      if (journal.phase === "reserved" || journal.phase === "budget-intent") {
        const reservation = await gateRuntime.ledger.getReservation(journal.reservationId);
        if (reservation?.state === "reserved") {
          const resultDigest = authorityDigest({ v: "reelier.github-pre-network-recovery/v1", reservationId: journal.reservationId, phase: journal.phase });
          const transitioned = await gateRuntime.ledger.transition(journal.reservationId, "reserved", { to: "cancelled", resultDigest });
          if (!transitioned.ok) throw new Error(`GitHub pre-network recovery refused: ${transitioned.reason}`);
        }
        await saveJournal(journalRoot, { ...journal, phase: "refused" }, journalAuthority);
      } else if (journal.phase === "budget-consumed") {
        const reservation = await gateRuntime.ledger.getReservation(journal.reservationId);
        if (reservation?.state === "reserved") {
          const resultDigest = authorityDigest({ v: "reelier.github-pre-network-recovery/v1", reservationId: journal.reservationId, phase: journal.phase });
          const transitioned = await gateRuntime.ledger.transition(journal.reservationId, "reserved", { to: "cancelled", resultDigest });
          if (!transitioned.ok) throw new Error(`GitHub consumed recovery refused: ${transitioned.reason}`);
        }
        await state.delegationAuthority.budget.releaseConsumedOnce({ allocationId: journal.allocationId, reservationId: journal.reservationId, effects: 1 });
        await saveJournal(journalRoot, { ...journal, phase: "refused" }, journalAuthority);
      } else if (journal.phase === "dispatched") {
        const reservation = await gateRuntime.ledger.getReservation(journal.reservationId);
        if (reservation?.state === "ambiguous") {
          await saveJournal(journalRoot, { ...journal, phase: "pending-reconciliation" }, journalAuthority);
        } else {
          await coordinator.recover(); await saveJournal(journalRoot, { ...journal, phase: "pending-reconciliation" }, journalAuthority);
        }
      } else if (journal.phase === "provider-send-intent") { await coordinator.recover(); await saveJournal(journalRoot, { ...journal, phase: "pending-reconciliation" }, journalAuthority); }
      recovered.push(journal.requestId);
      });
    }
    return Object.freeze(recovered);
  }
  return Object.freeze({ run, recover, async status(value: Readonly<{ bearerToken: string; requestId: string }>) { closed(value, ["bearerToken", "requestId"], "GitHub runner status call"); validateRequestId(value.requestId); const accessPermit = await state.issueHermeticGitHubPermit(value.bearerToken); await state.revalidateHermeticGitHubPermit(accessPermit); const journal = await loadJournal(journalRoot, value.requestId, journalAuthority); if (!journal) throw new TypeError("GitHub runner request not found"); return view(journal); } });
}

async function buildGate(input: any) {
  assertLinuxAuthorityCellHost();
  const authority = input.state.hermeticGitHubAuthority();
  const grant = input.activation.signedRootGrant.grant, policyBytes = authorityCanonicalBytes({ desiredLabels: input.desired });
  const accountId = "github_fixlyai_reelier";
  const contract = { v: "reelier.outcome-contract/v1", tenant: input.activation.authorityCellId, alias: githubIssueLabelsAlias, contractId: "github_certification_contract", validFrom: grant.issuedAt, validUntil: grant.expiresAt, packDigest: githubIssueLabelsPackDigest, definitionDigest: githubIssueLabelsDefinitionDigest, sponsor: grant.sponsor, audiences: [input.activation.principalId], delegationGrantDigest: input.activation.signedRootGrant.digest, connectorId: "github", accountId, sourceAuthority: { resolverId: githubIssueLabelsResolverId, projectionSchemaId: "github_issue_labels_projection_v1", allowedReadEndpointIds: [githubIssueLabelsReadEndpointId], authorizedProjectionPointers: ["/owner", "/repo", "/issueNumber", "/issueState", "/labels"], maxFreshnessSeconds: 60 }, riskClasses: [githubIssueLabelsRiskClass], limits: input.constraints.limits, policyCommitment: { schemaId: githubIssueLabelsPolicySchemaId, jcsBase64: policyBytes.toString("base64"), digest: `sha256:${createHash("sha256").update(policyBytes).digest("hex")}` } };
  const contractDigest = authorityDigest(contract), candidate = { contractEnvelope: envelope(contract, contractDigest, authority.contractDescriptor.keyId, null, "outcome-contract", authority.signContract(contractDigest)), delegationEnvelopes: [envelope(grant, input.activation.signedRootGrant.digest, input.activation.signedRootGrant.signerId, null, "delegation-grant", input.activation.signedRootGrant.signature, 0)], stateEvents: [{ index: 0, kind: "activated", contractDigest, at: grant.issuedAt }] };
  const trustRoots = createTrustRoots([{ tenant: input.activation.authorityCellId, signerId: authority.contractDescriptor.keyId, principalId: input.activation.principalId, publicKey: descriptorPublicKey(authority.contractDescriptor), purposes: ["outcome-contract"] }, { tenant: input.activation.authorityCellId, signerId: input.activation.signedRootGrant.signerId, principalId: grant.grantor, publicKey: publicKeyFromPin(input.state.currentTrustPinPath, input.activation.signedRootGrant.signerId), purposes: ["delegation-grant"] }, { tenant: input.activation.authorityCellId, signerId: authority.gateDescriptor.keyId, principalId: input.activation.principalId, publicKey: descriptorPublicKey(authority.gateDescriptor), purposes: ["gate-event"] }]);
  validateContractAgainstDelegation(contract as any, validateDelegationChain({ tenant: input.activation.authorityCellId, sponsor: contract.sponsor, now: input.state.now?.() ?? new Date(), trustRoots, grants: [input.activation.signedRootGrant] }));
  const packs = createStaticPackRegistry([githubIssueLabelsDefinition]), sources = createSourceRegistry([createGitHubIssueLabelsSourceResolver(input.activation.authorityCellId)]), connectors = createConnectorRegistry([{ tenant: input.activation.authorityCellId, connectorId: "github", accountId, providerAccountIdentity: accountId, allowedReadEndpointIds: [githubIssueLabelsReadEndpointId], allowedWriteEndpointIds: [githubIssueLabelsWriteEndpointId], riskClasses: [githubIssueLabelsRiskClass], operatorConfigurationDigest: authorityDigest({ resource: input.resource }) }]);
  const ledger = new FsAuthorityLedger(input.ledgerRoot, { now: () => input.state.now?.().getTime() ?? Date.parse("2026-08-11T20:10:00.000Z") });
  const sourceFor = (issue: Issue) => ({ projection: issue, digest: authorityDigest(issue) });
  const statePort = createAuthorityStatePort({ async loadCompleteContractSet() { return { ok: true as const, snapshot: { tenant: input.activation.authorityCellId, definitionAlias: githubIssueLabelsAlias, stateVersion: 1, candidates: [candidate] } as any, backendToken: {} }; }, async advanceVersion() { return { ok: true as const, backendObservedToken: {} }; }, async withCurrent(_token, callback) { return { ok: true as const, value: await callback() }; }, async executeSourceReads(plans) { const issue = await input.provider.readIssue(); return { ok: true as const, observations: plans.map((plan: any) => ({ planDigest: plan.planDigest, rawBytes: Buffer.from(JSON.stringify(issue)) })) }; } });
  const gate = createAuthorityGate({ trustRoots, packs, sources, connectors, state: statePort, ledger, localGatePolicyDigest: authorityDigest({ v: "reelier.github-certification-gate-policy/v1" }), decisionSink: createFileGateDecisionSink(input.decisionRoot), signer: { async sign(value) { if (value.purpose !== "gate-event") throw new TypeError("GitHub gate signer purpose is invalid"); return { signerId: authority.gateDescriptor.keyId, signature: authority.signGate(value.digest) }; } }, eventId: () => `evt_${randomUUID()}`, capabilityId: () => `cap_${randomUUID()}` });
  return { gate, ledger, sourceFor };
}

function createBrandedProvider(resource: any, desired: readonly string[], mode: HermeticGitHubMode) { let reads = 0; let labels: readonly string[] = ["before"]; return Object.freeze({ async readIssue() { reads += 1; const issue = { owner: resource.owner, repo: resource.repository, issueNumber: resource.issueNumber, issueState: "open", labels: mode === "source-drift" && reads === 2 ? ["drifted"] : labels }; return normalizeIssue(issue); }, async replaceLabels(_effect: unknown) { labels = desired; if (mode === "accessor-response") return Object.create(Object.prototype, { status: { enumerable: true, get() { throw new Error("accessor must not execute"); } }, acknowledgmentId: { enumerable: true, value: "ack" } }); return { status: mode === "provider-503" ? 503 : 200, acknowledgmentId: "ack_1" }; } }); }
function normalizeIssue(value: unknown): Issue { const raw = inertRecord(value, "GitHub issue"); exact(raw, ["owner", "repo", "issueNumber", "issueState", "labels"], "GitHub issue"); const labels = inertArray(raw.labels, "GitHub labels"); if (typeof raw.owner !== "string" || typeof raw.repo !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(raw.owner) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(raw.repo) || !Number.isSafeInteger(raw.issueNumber) || typeof raw.issueState !== "string" || labels.some(x => typeof x !== "string")) throw new TypeError("GitHub issue response invalid"); return Object.freeze({ owner: raw.owner, repo: raw.repo, issueNumber: raw.issueNumber as number, issueState: raw.issueState, labels: Object.freeze([...(labels as string[])].sort()) }); }
function normalizeProviderAcknowledgment(value: unknown) { const raw = inertRecord(value, "GitHub acknowledgment"); exact(raw, ["status", "acknowledgmentId"], "GitHub acknowledgment"); if (!Number.isSafeInteger(raw.status) || typeof raw.acknowledgmentId !== "string") throw new TypeError("GitHub acknowledgment invalid"); return Object.freeze({ status: raw.status as number, acknowledgmentId: raw.acknowledgmentId }); }
function envelope(value: any, digest: string, signerId: string, key: any, purpose: any, signature?: any, index?: number) { return { canonicalBase64: authorityCanonicalBytes(value).toString("base64"), advertisedDigest: digest, signerId, signature: signature ?? signAuthorityDigest(key, purpose, digest), ...(index === undefined ? {} : { index }) }; }
function publicKeyFromPin(pinPath: string, signerId: string) { const pin = JSON.parse(readFileSync(pinPath, "utf8")); const descriptor = pin.keyDescriptors.find((x: any) => x.keyId === signerId); if (!descriptor) throw new TypeError("delegation signer descriptor missing"); return createPublicKey({ key: Buffer.from(descriptor.publicKeySpkiBase64, "base64"), format: "der", type: "spki" }); }
function descriptorPublicKey(descriptor: Readonly<{ publicKeySpkiBase64: string }>) { return createPublicKey({ key: Buffer.from(descriptor.publicKeySpkiBase64, "base64"), format: "der", type: "spki" }); }
class ControlledCut extends Error { constructor() { super("controlled cut"); } }
function journalPath(root: string, requestId: string) { return path.join(root, `${requestId}.journal.json`); }
async function saveJournal(root: string, value: Journal, authority: any) { const prior = await loadJournal(root, value.requestId, authority); if (prior) assertJournalTransition(prior, value); const body = journalBody(value), digest = authorityDigest(body), signed = { ...body, signerId: authority.journalDescriptor.keyId, signature: authority.signJournal(digest) }; const file = journalPath(root, value.requestId), temp = `${file}.${randomUUID()}.tmp`, bytes = Buffer.from(`${JSON.stringify(signed)}\n`); const handle = await open(temp, "wx", 0o600); try { await handle.write(bytes); await handle.sync(); } finally { await handle.close(); } await rename(temp, file); }
async function loadJournal(root: string, requestId: string, authority: any): Promise<Journal | undefined> { try { const journal = parseJournal(JSON.parse((await readUnlinkedFile(journalPath(root, requestId))).toString("utf8")), requestId); if (journal.signerId !== authority.journalDescriptor.keyId || !journal.signature || !verifyAuthoritySignature(descriptorPublicKey(authority.journalDescriptor), "authority-journal", authorityDigest(journalBody(journal)), journal.signature)) throw new TypeError("GitHub dispatch journal signature is invalid or tampered"); return journal; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
function parseJournal(value: unknown, expectedRequestId: string): Journal {
  const raw = inertRecord(value, "GitHub dispatch journal");
  exact(raw, ["v", "requestId", "requestDigest", "reservationId", "allocationId", "effectDigest", "permitSnapshotDigest", "phase", "providerWrites", "signerId", "signature"], "GitHub dispatch journal");
  const phases: readonly string[] = ["reserved", "budget-intent", "budget-consumed", "dispatched", "provider-send-intent", "acknowledged", "refused", "failed", "pending-reconciliation"];
  if (raw.v !== "reelier.github-certification-journal/v1" || raw.requestId !== expectedRequestId || !/^sha256:[0-9a-f]{64}$/.test(raw.requestDigest) || typeof raw.reservationId !== "string" || typeof raw.allocationId !== "string" || !/^sha256:[0-9a-f]{64}$/.test(raw.effectDigest) || !/^sha256:[0-9a-f]{64}$/.test(raw.permitSnapshotDigest) || !phases.includes(raw.phase) || !Number.isSafeInteger(raw.providerWrites) || raw.providerWrites < 0 || raw.providerWrites > 1 || typeof raw.signerId !== "string" || !raw.signature || raw.signature.alg !== "ed25519" || typeof raw.signature.sig !== "string") throw new TypeError("GitHub dispatch journal is invalid");
  return Object.freeze(raw as Journal);
}
function journalBody(value: Journal) { return { v: value.v, requestId: value.requestId, requestDigest: value.requestDigest, reservationId: value.reservationId, allocationId: value.allocationId, effectDigest: value.effectDigest, permitSnapshotDigest: value.permitSnapshotDigest, phase: value.phase, providerWrites: value.providerWrites }; }
function assertJournalTransition(prior: Journal, next: Journal) { const stable = ["requestId", "requestDigest", "reservationId", "allocationId", "effectDigest", "permitSnapshotDigest"] as const; if (stable.some(key => prior[key] !== next[key])) throw new TypeError("GitHub dispatch journal identity conflict"); const allowed: Record<JournalPhase, readonly JournalPhase[]> = { reserved: ["budget-intent", "refused"], "budget-intent": ["budget-consumed", "refused"], "budget-consumed": ["dispatched", "refused"], dispatched: ["provider-send-intent", "pending-reconciliation"], "provider-send-intent": ["acknowledged", "failed", "pending-reconciliation"], acknowledged: [], refused: [], failed: [], "pending-reconciliation": [] }; if (!allowed[prior.phase].includes(next.phase)) throw new TypeError("GitHub dispatch journal phase transition is invalid"); }
async function withRequestLock<T>(root: string, requestId: string, operation: () => Promise<T>): Promise<T> { const lock = path.join(root, `${requestId}.lock`); let handle; try { handle = await open(lock, "wx", 0o600); await handle.writeFile(`${process.pid}\n`, "utf8"); await handle.sync(); return await operation(); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("GitHub dispatch request is busy"); throw error; } finally { if (handle) { await handle.close(); await unlink(lock).catch(() => undefined); } } }
function view(journal: Journal): GitHubHermeticRunnerResult { const status = journal.phase === "acknowledged" ? "acknowledged" : journal.phase === "refused" ? "refused" : journal.phase === "failed" ? "failed" : "pending-reconciliation"; return Object.freeze({ requestId: journal.requestId, status, success: false, providerWrites: journal.providerWrites, reservationId: journal.reservationId }); }
function validateRequestId(value: string) { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(value)) throw new TypeError("GitHub request id invalid"); }
function closed(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, any> { const raw = inertRecord(value, label); exact(raw, keys, label); }
function inertRecord(value: unknown, label: string): Record<string, any> { if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).some(key => typeof key !== "string" || Object.getOwnPropertyDescriptor(value, key)?.get || Object.getOwnPropertyDescriptor(value, key)?.set)) throw new TypeError(`${label} must be an inert plain object`); return value as Record<string, any>; }
function inertArray(value: unknown, label: string): readonly unknown[] { if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).some(key => key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Object.getOwnPropertyDescriptor(value, key)?.get || Object.getOwnPropertyDescriptor(value, key)?.set))) throw new TypeError(`${label} must be an inert dense array`); return value; }
function exact(value: Record<string, any>, keys: readonly string[], label: string) { if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError(`${label} is closed`); }
