import path from "node:path";
import { createAuthorityEvidence, createAuthorityReceipt, createAuthorityReceiptBundle } from "../evidence.js";
import { signAuthorityDigest } from "../crypto.js";
import type { AuthorityKind, AuthorityReceipt, AuthorityReceiptBundle, AuthorityWireByKind, SignedAuthorityArtifact } from "../types.js";
import { parseAuthorityReceiptBundle } from "../evidence.js";
import { authorityDigest, parseAuthorityWire } from "../wire.js";
import { createFileReceiptPublication } from "../host/receipts.js";
import type { DispatchOutcome, DispatchPublication, DispatchRequestState } from "../host/dispatch.js";
import type { CertificationLifecycleAuthorityMaterial } from "./lifecycle-authority.js";
import { certificationWorkspaceRoot, confinedExistingDirectory, ensureConfinedDirectory, listConfinedFileNames, publishPrivateContentAddressed, readConfinedFile } from "./filesystem.js";

export function createCertificationLifecycleReceiptPublication(input: Readonly<{ rootDir: string; lifecycle: CertificationLifecycleAuthorityMaterial; signedRootGrant: any; now: () => Date }>): DispatchPublication {
  const local = createFileReceiptPublication({ rootDir: path.join(input.rootDir, "local") });
  const prior = new Map<string, AuthorityReceipt>();
  return Object.freeze({ async publish(value: Parameters<DispatchPublication["publish"]>[0]) {
    await certificationWorkspaceRoot(input.rootDir);
    const published = await local.publish(value);
    const recovered = (value.state as any).contract ? undefined : await priorBundle(input.rootDir, value.state.effectDigest);
    let priorReceipt = prior.get(value.state.reservation.reservationId) ?? recovered?.receipt.value;
    if (!priorReceipt && value.phase === "dispatch") {
      const reservation = portable(value.state, { kind: "ambiguous", resultDigest: authorityDigest({ reservationId: value.state.reservation.reservationId, phase: "reservation" }), reconciliationStatus: "not-attempted" }, "reservation", input);
      await save(input.rootDir, reservation); priorReceipt = reservation.receipt.value;
    }
    const bundle = portable(value.state, value.outcome, value.phase, input, priorReceipt, recovered);
    prior.set(value.state.reservation.reservationId, bundle.receipt.value);
    await save(input.rootDir, bundle);
    return published;
  } });
}

function portable(state: DispatchRequestState, outcome: DispatchOutcome, phase: string, input: Readonly<{ lifecycle: CertificationLifecycleAuthorityMaterial; signedRootGrant: any; now: () => Date }>, prior?: AuthorityReceipt, recovered?: AuthorityReceiptBundle): AuthorityReceiptBundle {
  const raw = state as any, decision = raw.signedDecision ?? (recovered ? { decisionContext: recovered.receipt.value.decisionContext, decisionContextDigest: recovered.receipt.value.decisionContextDigest, gateEvent: recovered.gateEvent.value, gateEventDigest: recovered.gateEvent.digest, signerId: recovered.gateEvent.signerId, signature: recovered.gateEvent.signature } : undefined), contract = raw.contract?.contract ?? recovered?.contract.value, source = raw.source?.bundle ?? recovered?.sourceBundle.value, capability = raw.capability ?? recovered?.capability.value, effect = raw.effect ?? recovered?.transportEffect.value;
  const at = input.now().toISOString(), receiptId = `receipt_${authorityDigest({ reservationId: state.reservation.reservationId, phase, result: outcome.resultDigest }).slice(7, 31)}`;
  const states: any[] = [{ state: "reserved", at, eventDigest: authorityDigest({ state: "reserved", reservationId: state.reservation.reservationId }) }];
  if (phase !== "cancelled" && phase !== "reservation") states.push({ state: "dispatched", at, eventDigest: authorityDigest({ state: "dispatched", reservationId: state.reservation.reservationId }) });
  const terminal = phase === "cancelled" ? "cancelled" : outcome.kind === "acknowledged" ? "acknowledged" : outcome.kind === "definitive-failure" ? "definitive-failure" : "ambiguous";
  if (phase !== "reservation") states.push({ state: terminal, at, eventDigest: authorityDigest({ state: terminal, result: outcome.resultDigest }) });
  if (phase === "reconcile") states.push({ state: "reconciled", at, eventDigest: authorityDigest({ state: "reconciled", verdict: outcome.reconciliationStatus }) });
  const evidence = createAuthorityEvidence({ evidenceId: `evidence_${receiptId.slice(8)}`, receiptId, decisionContextDigest: decision.decisionContextDigest, gateEventDigest: decision.gateEventDigest, effectDigest: authorityDigest(effect), reservationId: `reservation_${authorityDigest(state.reservation.reservationId).slice(7, 31)}`, timeline: states, dispatchedRequestDigest: phase === "cancelled" || phase === "reservation" ? null : authorityDigest({ v: "reelier.dispatched-request/v1", reservationId: state.reservation.reservationId, effectDigest: state.effectDigest, effect }), providerResponseDigest: outcome.kind === "acknowledged" ? outcome.providerResultDigest ?? outcome.resultDigest : null, reconciliation: { recipeId: effect.reconciliation.recipeId, verdict: phase === "reservation" ? "not-attempted" : outcome.reconciliationStatus ?? "not-attempted", normalizedProjectionDigest: phase === "reservation" ? null : outcome.normalizedProjectionDigest ?? null }, topology: { egress: "unchecked", secretIsolation: "verified", ingressAuthentication: "verified", notes: "Hermetic in-Cell provider; production topology not asserted." } });
  const receipt = createAuthorityReceipt({ receiptId, gateEventDigest: decision.gateEventDigest, decisionContextDigest: decision.decisionContextDigest, decisionContext: decision.decisionContext, evidence, priorReceiptDigest: prior ? authorityDigest(prior) : null, claims: { authorization: "verified", sourceCompleteness: "verified", dispatch: phase === "cancelled" || phase === "reservation" ? "absent" : "verified", providerAcknowledgment: outcome.kind === "acknowledged" ? "verified" : "unchecked", reconciliation: outcome.reconciliationStatus === "matched" ? "verified" : "unchecked", topology: "unchecked", completeness: "unchecked" } });
  const pack = parseAuthorityWire("pack-manifest", { v: "reelier.outcome-pack-manifest/v1", packId: "github_issue_labels", packDigest: contract.packDigest, definitions: [decision.decisionContext.definitionAlias] });
  return createAuthorityReceiptBundle({ v: "reelier.authority-receipt-bundle/v1", contract: recovered?.contract ?? signed("outcome-contract", contract, input.lifecycle), delegation: recovered?.delegation ?? [signedExisting("delegation-grant", input.signedRootGrant)], sourceBundle: recovered?.sourceBundle ?? signed("source-bundle", source, input.lifecycle), capability: recovered?.capability ?? signed("compiled-capability", capability, input.lifecycle), transportEffect: recovered?.transportEffect ?? signed("transport-effect", effect, input.lifecycle), gateEvent: recovered?.gateEvent ?? signedExisting("gate-event", { value: decision.gateEvent, digest: decision.gateEventDigest, signerId: decision.signerId, signature: decision.signature }), evidence: signed("authority-evidence", evidence, input.lifecycle), receipt: signed("authority-receipt", receipt, input.lifecycle), packManifest: recovered?.packManifest ?? signed("pack-manifest", pack, input.lifecycle) });
}

async function priorBundle(root: string, effectDigest: string): Promise<AuthorityReceiptBundle | undefined> { const directory = await confinedExistingDirectory(root, ["portable"]); if (!directory) return undefined; for (const name of await listConfinedFileNames(root, directory)) { if (!name.endsWith(".json")) continue; const bundle = parseAuthorityReceiptBundle(JSON.parse((await readConfinedFile(root, directory, name)).toString("utf8"))); if (bundle.transportEffect.digest === effectDigest) return bundle; } return undefined; }
async function save(root: string, bundle: AuthorityReceiptBundle): Promise<void> { await publishPrivateContentAddressed(root, "portable", `${bundle.receipt.value.receiptId}.json`, `${JSON.stringify(bundle)}\n`); const directory = await ensureConfinedDirectory(root, ["portable"]); const stored = parseAuthorityReceiptBundle(JSON.parse((await readConfinedFile(root, directory, `${bundle.receipt.value.receiptId}.json`)).toString("utf8"))); if (authorityDigest(stored) !== authorityDigest(bundle)) throw new TypeError("portable receipt publication conflicts with immutable receipt"); }

function signed<K extends AuthorityKind>(kind: K, value: AuthorityWireByKind[K], material: CertificationLifecycleAuthorityMaterial): SignedAuthorityArtifact<K> { const key = material.direct.get(kind as any) ?? material.artifacts.get(kind as any); if (!key) throw new TypeError(`lifecycle signer absent for ${kind}`); const parsed = parseAuthorityWire(kind, value) as AuthorityWireByKind[K], digest = authorityDigest(parsed); return Object.freeze({ kind, signerId: key.descriptor.keyId, digest, value: parsed, signature: signAuthorityDigest(key.privateKey, kind, digest) }); }
function signedExisting<K extends AuthorityKind>(kind: K, stored: any): SignedAuthorityArtifact<K> { const value = parseAuthorityWire(kind, stored.value ?? stored.grant), digest = stored.digest; return Object.freeze({ kind, signerId: stored.signerId, digest, value, signature: stored.signature }) as SignedAuthorityArtifact<K>; }
