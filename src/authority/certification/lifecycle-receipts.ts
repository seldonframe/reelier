import { createPublicKey } from "node:crypto";
import path from "node:path";
import { createAuthorityEvidence, createAuthorityReceipt, createAuthorityReceiptBundle } from "../evidence.js";
import { signAuthorityDigest, verifyAuthoritySignature } from "../crypto.js";
import type { AuthorityKind, AuthorityReceipt, AuthorityReceiptBundle, AuthorityWireByKind, SignedAuthorityArtifact } from "../types.js";
import { parseAuthorityReceiptBundle } from "../evidence.js";
import { authorityDigest, parseAuthorityWire } from "../wire.js";
import { createFileReceiptPublication } from "../host/receipts.js";
import type { DispatchOutcome, DispatchPublication, DispatchRequestState } from "../host/dispatch.js";
import type { CertificationLifecycleAuthorityMaterial } from "./lifecycle-authority.js";
import { certificationWorkspaceRoot, confinedExistingDirectory, ensureConfinedDirectory, listConfinedFileNames, publishPrivateContentAddressed, readConfinedFile } from "./filesystem.js";
import { AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST } from "../adapter-contract.js";
import { verifyAuthorityReceiptBundle } from "../verify.js";
import { createPortableAuthorityReceiptPublication } from "../host/portable-receipts.js";
import { constructAuthorityReceiptBundle, refreshLifecycleAuthorityReceiptSigningAuthority, type ValidatedAuthorityReceiptSigningAuthorityV1 } from "../host/receipt-authority.js";

export interface CertificationReceiptExtensionV1 { readonly v: "reelier.certification-receipt-extension/v1"; readonly receiptDigest: string; readonly adapterContractDigest: string; readonly signerId: string; readonly signature: Readonly<{ alg: "ed25519"; sig: string }> }

export function createCertificationLifecycleReceiptPublication(input: Readonly<{ rootDir: string; lifecycle: CertificationLifecycleAuthorityMaterial; signedGrants: readonly any[]; now: () => Date }>): DispatchPublication {
  const local = createFileReceiptPublication({ rootDir: path.join(input.rootDir, "local") });
  const prior = new Map<string, AuthorityReceipt>();
  const portablePublication: DispatchPublication = Object.freeze({ async publish(value: Parameters<DispatchPublication["publish"]>[0]) {
    const signingAuthority=await refreshLifecycleAuthorityReceiptSigningAuthority(input.lifecycle);
    const recovered = (value.state as any).contract ? undefined : await priorBundle(input.rootDir, value.state.effectDigest, input.lifecycle, input.signedGrants);
    if (recovered && recovered.receipt.value.receiptId === portableReceiptId(value.state.reservation.reservationId, value.phase, value.outcome.resultDigest)) {
      const reconciliation = recovered.evidence.value.reconciliation;
      if (reconciliation.verdict !== (value.outcome.reconciliationStatus ?? "not-attempted") || reconciliation.normalizedProjectionDigest !== (value.outcome.normalizedProjectionDigest ?? null)) throw new TypeError("portable receipt recovery conflicts with the durable terminal receipt");
      await ensureExtension(input.rootDir, recovered, input.lifecycle);
      return Object.freeze({ receiptRef: authorityDigest(recovered.receipt.value), evidenceDigest: recovered.evidence.digest });
    }
    let priorReceipt = prior.get(value.state.reservation.reservationId) ?? recovered?.receipt.value;
    if (!priorReceipt && value.phase === "dispatch") {
      const reservation = await portable(value.state, { kind: "ambiguous", resultDigest: authorityDigest({ reservationId: value.state.reservation.reservationId, phase: "reservation" }), reconciliationStatus: "not-attempted" }, "reservation", {...input,signingAuthority});
      await save(input.rootDir, reservation); await ensureExtension(input.rootDir, reservation, input.lifecycle); priorReceipt = reservation.receipt.value;
    }
    const bundle = await portable(value.state, value.outcome, value.phase, {...input,signingAuthority}, priorReceipt, recovered);
    prior.set(value.state.reservation.reservationId, bundle.receipt.value);
    await save(input.rootDir, bundle);
    if (input.lifecycle.schedule === "cut-after-conflict-receipt-before-extension" && value.phase === "reconcile" && value.outcome.reconciliationStatus === "conflict") throw new Error("controlled cut");
    await ensureExtension(input.rootDir, bundle, input.lifecycle);
    return Object.freeze({ receiptRef: authorityDigest(bundle.receipt.value), evidenceDigest: bundle.evidence.digest });
  } });
  return createPortableAuthorityReceiptPublication({ localPublication: local, portablePublication, beforePublish: async () => { await certificationWorkspaceRoot(input.rootDir); } });
}

async function portable(state: DispatchRequestState, outcome: DispatchOutcome, phase: "reservation"|"dispatch"|"cancelled"|"ambiguous"|"reconcile", input: Readonly<{ lifecycle: CertificationLifecycleAuthorityMaterial; signedGrants: readonly any[]; now: () => Date;signingAuthority:ValidatedAuthorityReceiptSigningAuthorityV1 }>, prior?: AuthorityReceipt, recovered?: AuthorityReceiptBundle): Promise<AuthorityReceiptBundle> {
  const raw = state as any, decision = raw.signedDecision ?? (recovered ? { decisionContext: recovered.receipt.value.decisionContext, decisionContextDigest: recovered.receipt.value.decisionContextDigest, gateEvent: recovered.gateEvent.value, gateEventDigest: recovered.gateEvent.digest, signerId: recovered.gateEvent.signerId, signature: recovered.gateEvent.signature } : undefined), contract = raw.contract?.contract ?? recovered?.contract.value, source = raw.source?.bundle ?? recovered?.sourceBundle.value, capability = raw.capability ?? recovered?.capability.value, effect = raw.effect ?? recovered?.transportEffect.value;
  const at = input.now().toISOString(), receiptId = portableReceiptId(state.reservation.reservationId, phase, outcome.resultDigest);
  const states: any[] = [{ state: "reserved", at, eventDigest: authorityDigest({ state: "reserved", reservationId: state.reservation.reservationId }) }];
  if (phase !== "cancelled" && phase !== "reservation") states.push({ state: "dispatched", at, eventDigest: authorityDigest({ state: "dispatched", reservationId: state.reservation.reservationId }) });
  const terminal = phase === "cancelled" ? "cancelled" : outcome.kind === "acknowledged" ? "acknowledged" : outcome.kind === "definitive-failure" ? "definitive-failure" : "ambiguous";
  if (phase !== "reservation") states.push({ state: terminal, at, eventDigest: authorityDigest({ state: terminal, result: outcome.resultDigest }) });
  if (phase === "reconcile") states.push({ state: "reconciled", at, eventDigest: authorityDigest({ state: "reconciled", verdict: outcome.reconciliationStatus }) });
  const evidence = createAuthorityEvidence({ evidenceId: `evidence_${receiptId.slice(8)}`, receiptId, decisionContextDigest: decision.decisionContextDigest, gateEventDigest: decision.gateEventDigest, effectDigest: authorityDigest(effect), reservationId: `reservation_${authorityDigest(state.reservation.reservationId).slice(7, 31)}`, timeline: states, dispatchedRequestDigest: phase === "cancelled" || phase === "reservation" ? null : authorityDigest({ v: "reelier.dispatched-request/v1", reservationId: state.reservation.reservationId, effectDigest: state.effectDigest, effect }), providerResponseDigest: outcome.kind === "acknowledged" ? outcome.providerResultDigest ?? outcome.resultDigest : null, reconciliation: { recipeId: effect.reconciliation.recipeId, verdict: phase === "reservation" ? "not-attempted" : outcome.reconciliationStatus ?? "not-attempted", normalizedProjectionDigest: phase === "reservation" ? null : outcome.normalizedProjectionDigest ?? null }, topology: { egress: "unchecked", secretIsolation: "verified", ingressAuthentication: "verified", notes: "Hermetic in-Cell provider; production topology not asserted." } });
  const receipt = createAuthorityReceipt({ receiptId, gateEventDigest: decision.gateEventDigest, decisionContextDigest: decision.decisionContextDigest, decisionContext: decision.decisionContext, evidence, priorReceiptDigest: prior ? authorityDigest(prior) : null, claims: { authorization: "verified", sourceCompleteness: "verified", dispatch: phase === "cancelled" || phase === "reservation" ? "absent" : "verified", providerAcknowledgment: outcome.kind === "acknowledged" ? "verified" : "unchecked", reconciliation: outcome.reconciliationStatus === "matched" ? "verified" : "unchecked", topology: "unchecked", completeness: "unchecked" } });
  const pack = parseAuthorityWire("pack-manifest", { v: "reelier.outcome-pack-manifest/v1", packId: "github_issue_labels", packDigest: contract.packDigest, definitions: [decision.decisionContext.definitionAlias] });
  return constructAuthorityReceiptBundle({phase,state,outcome,observedAt:at,foundations:{contract:recovered?.contract??signed("outcome-contract",contract,input.lifecycle),delegation:recovered?.delegation??input.signedGrants.map(grant=>signedExisting("delegation-grant",grant)),gateEvent:recovered?.gateEvent??signedExisting("gate-event",{value:decision.gateEvent,digest:decision.gateEventDigest,signerId:decision.signerId,signature:decision.signature}),packManifest:pack},signingAuthority:input.signingAuthority,...(prior?{priorReceipt:prior}:{}),...(recovered?{recovered}:{})});
}

function portableReceiptId(reservationId: string, phase: string, resultDigest: string): string { return `receipt_${authorityDigest({ reservationId, phase, result: resultDigest }).slice(7, 31)}`; }

async function priorBundle(root: string, effectDigest: string, lifecycle: CertificationLifecycleAuthorityMaterial, signedGrants: readonly any[]): Promise<AuthorityReceiptBundle | undefined> {
  const directory = await confinedExistingDirectory(root, ["portable"]); if (!directory) return undefined;
  const matches: AuthorityReceiptBundle[] = [];
  for (const name of await listConfinedFileNames(root, directory)) { if (!name.endsWith(".json")) continue; const bundle = parseAuthorityReceiptBundle(JSON.parse((await readConfinedFile(root, directory, name)).toString("utf8"))); if (bundle.transportEffect.digest === effectDigest) matches.push(bundle); }
  if (matches.length === 0) return undefined;
  const digests = matches.map(bundle => authorityDigest(bundle.receipt.value)); if (new Set(digests).size !== matches.length) throw new TypeError("portable receipt recovery chain contains duplicate nodes");
  const roots = matches.filter(bundle => bundle.receipt.value.priorReceiptDigest === null); if (roots.length !== 1) throw new TypeError("portable receipt recovery chain is forked or incomplete");
  const tenant = roots[0]!.receipt.value.decisionContext.tenant, directPrincipal = signedGrants.at(-1)?.grant?.grantee;
  if (typeof tenant !== "string" || typeof directPrincipal !== "string") throw new TypeError("portable receipt recovery authority is incomplete");
  const trustRoots = [
    ...[...lifecycle.direct.values()].map(key => ({ tenant, signerId: key.descriptor.keyId, principalId: key.descriptor.purpose === "delegation-grant" ? signedGrants[0]?.grant?.grantor : directPrincipal, publicKey: descriptorPublicKey(key.descriptor.publicKeySpkiBase64), purposes: [key.descriptor.purpose] })),
    ...[...lifecycle.artifacts.values()].map(key => ({ tenant, signerId: key.descriptor.keyId, principalId: directPrincipal, publicKey: descriptorPublicKey(key.descriptor.publicKeySpkiBase64), purposes: [key.descriptor.purpose] })),
  ] as any;
  let head = roots[0]!, prior: AuthorityReceipt | undefined, visited = 0;
  for (;;) { verifyAuthorityReceiptBundle(head, { tenant, trustRoots, ...(prior ? { priorReceipt: prior } : {}) }); visited += 1; const digest = authorityDigest(head.receipt.value), successors = matches.filter(bundle => bundle.receipt.value.priorReceiptDigest === digest); if (successors.length === 0) break; if (successors.length !== 1) throw new TypeError("portable receipt recovery chain is forked or incomplete"); prior = head.receipt.value; head = successors[0]!; }
  if (visited !== matches.length) throw new TypeError("portable receipt recovery chain is forked or incomplete"); return head;
}
function descriptorPublicKey(base64: string) { return createPublicKey({ key: Buffer.from(base64, "base64"), format: "der", type: "spki" }); }
async function save(root: string, bundle: AuthorityReceiptBundle): Promise<void> { await publishPrivateContentAddressed(root, "portable", `${bundle.receipt.value.receiptId}.json`, `${JSON.stringify(bundle)}\n`); const directory = await ensureConfinedDirectory(root, ["portable"]); const stored = parseAuthorityReceiptBundle(JSON.parse((await readConfinedFile(root, directory, `${bundle.receipt.value.receiptId}.json`)).toString("utf8"))); if (authorityDigest(stored) !== authorityDigest(bundle)) throw new TypeError("portable receipt publication conflicts with immutable receipt"); }

function extensionFor(bundle: AuthorityReceiptBundle, lifecycle: CertificationLifecycleAuthorityMaterial): CertificationReceiptExtensionV1 { const key = lifecycle.direct.get("authority-receipt"); if (!key) throw new TypeError("receipt extension signer is absent"); const body = { v: "reelier.certification-receipt-extension/v1" as const, receiptDigest: authorityDigest(bundle.receipt.value), adapterContractDigest: AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST, signerId: key.descriptor.keyId }; return Object.freeze({ ...body, signature: signAuthorityDigest(key.privateKey, "authority-receipt", authorityDigest(body)) }); }
async function saveExtension(root: string, extension: CertificationReceiptExtensionV1): Promise<void> { await publishPrivateContentAddressed(root, "extensions", `${extension.receiptDigest.slice(7)}.json`, `${JSON.stringify(extension)}\n`); }
async function ensureExtension(root: string, bundle: AuthorityReceiptBundle, lifecycle: CertificationLifecycleAuthorityMaterial): Promise<void> { const expected = extensionFor(bundle, lifecycle), expectedBytes = Buffer.from(`${JSON.stringify(expected)}\n`, "utf8"); await saveExtension(root, expected); const directory = await ensureConfinedDirectory(root, ["extensions"]), storedBytes = await readConfinedFile(root, directory, `${expected.receiptDigest.slice(7)}.json`); if (!storedBytes.equals(expectedBytes)) throw new TypeError("certification receipt extension bytes conflict with the durable receipt"); const stored = JSON.parse(storedBytes.toString("utf8")); const key = lifecycle.direct.get("authority-receipt"); if (!key || !verifyAuthoritySignature(descriptorPublicKey(key.descriptor.publicKeySpkiBase64), "authority-receipt", authorityDigest({ v: stored.v, receiptDigest: stored.receiptDigest, adapterContractDigest: stored.adapterContractDigest, signerId: stored.signerId }), stored.signature)) throw new TypeError("certification receipt extension signature is invalid"); }
export async function loadCertificationReceiptExtensions(root: string): Promise<readonly CertificationReceiptExtensionV1[]> { const directory = await confinedExistingDirectory(root, ["extensions"]); if (!directory) return Object.freeze([]); const extensions: CertificationReceiptExtensionV1[] = []; for (const name of await listConfinedFileNames(root, directory)) { if (!name.endsWith(".json")) continue; const raw = JSON.parse((await readConfinedFile(root, directory, name)).toString("utf8")); const fields = ["v", "receiptDigest", "adapterContractDigest", "signerId", "signature"]; if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).join("\0") !== fields.join("\0") || raw.v !== "reelier.certification-receipt-extension/v1" || !/^sha256:[0-9a-f]{64}$/.test(raw.receiptDigest) || raw.adapterContractDigest !== AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST || typeof raw.signerId !== "string" || raw.signature?.alg !== "ed25519" || typeof raw.signature?.sig !== "string") throw new TypeError("certification receipt extension is invalid"); extensions.push(Object.freeze(raw)); } return Object.freeze(extensions); }

function signed<K extends AuthorityKind>(kind: K, value: AuthorityWireByKind[K], material: CertificationLifecycleAuthorityMaterial): SignedAuthorityArtifact<K> { const key = material.direct.get(kind as any) ?? material.artifacts.get(kind as any); if (!key) throw new TypeError(`lifecycle signer absent for ${kind}`); const parsed = parseAuthorityWire(kind, value) as AuthorityWireByKind[K], digest = authorityDigest(parsed); return Object.freeze({ kind, signerId: key.descriptor.keyId, digest, value: parsed, signature: signAuthorityDigest(key.privateKey, kind, digest) }); }
function signedExisting<K extends AuthorityKind>(kind: K, stored: any): SignedAuthorityArtifact<K> { const value = parseAuthorityWire(kind, stored.value ?? stored.grant), digest = stored.digest; return Object.freeze({ kind, signerId: stored.signerId, digest, value, signature: stored.signature }) as SignedAuthorityArtifact<K>; }
