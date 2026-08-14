import type { KeyObject } from "node:crypto";
import type { AuthorityReceipt, AuthorityReceiptBundle, AuthoritySignature, ClaimStatus } from "./types.js";
import { authorityDigest } from "./wire.js";
import { parseAuthorityReceiptBundle } from "./evidence.js";
import { verifyTrustedAuthority, createTrustRoots, type TrustRoots, type TrustRootEntry } from "./trust.js";
import { validateDelegationChain } from "./delegation.js";
import { verifyStoredContract } from "./contract.js";
import { verifyAuthoritySignature } from "./crypto.js";
import { assertPortableInertRecord, portableExecutionStatementDigest, portableReconciliationStatementDigest, type PortableOutcomeEvidencePublicationV1 } from "./host/portable-receipts.js";

export interface AuthorityReceiptVerificationOptions {
  readonly trustRoots: TrustRoots | readonly TrustRootEntry[];
  readonly tenant: string;
  readonly now?: Date;
  readonly priorReceipt?: AuthorityReceipt;
}

export interface VerifiedAuthorityReceiptBundle {
  readonly bundle: AuthorityReceiptBundle;
  readonly digest: string;
  readonly tenant: string;
  readonly claims: Readonly<AuthorityReceipt["claims"]>;
  readonly priorReceiptDigest: string | null;
}

/**
 * Strict offline verifier for portable authority bundles. Every artifact is
 * schema-closed, digest-bound, purpose-signed and cross-linked before a
 * verified result is returned. This function never upgrades completeness to
 * verified: receipt coverage is a deployment/topology claim, not a proof of
 * safety.
 */
export function verifyAuthorityReceiptBundle(value: unknown, options: AuthorityReceiptVerificationOptions): VerifiedAuthorityReceiptBundle {
  if (!options || typeof options.tenant !== "string" || options.tenant.length === 0) throw new TypeError("authority verification tenant is required");
  const roots: TrustRoots = Array.isArray(options.trustRoots)
    ? createTrustRoots(options.trustRoots as readonly TrustRootEntry[])
    : options.trustRoots as TrustRoots;
  const bundle = parseAuthorityReceiptBundle(value);
  const artifacts = [bundle.contract, ...bundle.delegation, bundle.sourceBundle, bundle.capability, bundle.transportEffect, bundle.gateEvent, bundle.evidence, bundle.receipt, bundle.packManifest] as const;
  for (const artifact of artifacts) {
    const verified = verifyTrustedAuthority(roots, {
      tenant: options.tenant,
      signerId: artifact.signerId,
      purpose: artifact.kind,
      advertisedDigest: artifact.digest,
      value: artifact.value,
      signature: artifact.signature,
    });
    if (verified.digest !== artifact.digest) throw new TypeError(`${artifact.kind} artifact digest changed during verification`);
  }
  const detached = new Set<string>();
  for (const signature of bundle.signatures) {
    const key = `${signature.kind}\0${signature.signerId}\0${signature.digest}`;
    if (detached.has(key)) throw new TypeError("duplicate detached authority signature");
    detached.add(key);
    const artifact = artifacts.find(item => item.kind === signature.kind && item.signerId === signature.signerId && item.digest === signature.digest);
    if (!artifact) throw new TypeError("detached authority signature does not match an artifact");
    verifyTrustedAuthority(roots, { tenant: options.tenant, signerId: signature.signerId, purpose: signature.kind, advertisedDigest: signature.digest, value: artifact.value, signature: signature.signature });
  }
  if (detached.size !== artifacts.length) throw new TypeError("receipt bundle is missing a detached artifact signature");

  const receipt = bundle.receipt.value;
  const context = receipt.decisionContext;
  if (context.tenant !== options.tenant || context.contractDigest === null || context.capabilityDigest === null || context.effectDigest === null || context.snapshots.sourceBundleDigest === null) throw new TypeError("authority receipt context is incomplete or cross-tenant");
  if (receipt.evidenceDigest !== bundle.evidence.digest) throw new TypeError("authority receipt evidence digest mismatch");
  const priorReceiptDigest = receipt.priorReceiptDigest ?? null;
  if (priorReceiptDigest !== null) {
    if (!options.priorReceipt) throw new TypeError("prior receipt is required to verify a chained receipt");
    const prior = options.priorReceipt;
    if (authorityDigest(prior) !== priorReceiptDigest) throw new TypeError("prior receipt digest mismatch");
    if (prior.decisionContext.tenant !== options.tenant || prior.decisionContext.requestId !== context.requestId) throw new TypeError("prior receipt identity mismatch");
  }
  if (receipt.claims.completeness === "verified") throw new TypeError("authority receipt cannot verify completeness");
  verifyTimeline(bundle);
  const evidence = bundle.evidence.value;
  const states = new Set(evidence.timeline.map(entry => entry.state));
  if (bundle.gateEvent.value.verdict !== "accepted" && receipt.claims.authorization === "verified") throw new TypeError("refused gate cannot carry verified authorization claim");
  if (receipt.claims.dispatch === "verified" && !states.has("dispatched")) throw new TypeError("dispatch claim exceeds evidence");
  if (receipt.claims.providerAcknowledgment === "verified" && (!states.has("acknowledged") || evidence.providerResponseDigest === null)) throw new TypeError("provider acknowledgment claim exceeds evidence");
  if (receipt.claims.reconciliation === "verified" && evidence.reconciliation.verdict !== "matched") throw new TypeError("reconciliation claim exceeds evidence");
  if (receipt.claims.topology === "verified" && [evidence.topology.egress, evidence.topology.secretIsolation, evidence.topology.ingressAuthentication].some(value => value !== "verified")) throw new TypeError("topology claim exceeds evidence");

  // Offline verification is historical: absent an explicit evaluation clock,
  // validate standing authority at the terminal evidence event, not at the
  // verifier's wall clock (otherwise old but valid receipts expire on read).
  const terminalAt = bundle.evidence.value.timeline[bundle.evidence.value.timeline.length - 1]?.at;
  const now = options.now ?? new Date(terminalAt ? Date.parse(terminalAt) : Date.now());
  const grants = bundle.delegation.map(item => ({ grant: item.value, digest: item.digest, signerId: item.signerId, signature: item.signature }));
  const chain = validateDelegationChain({ tenant: options.tenant, sponsor: bundle.contract.value.sponsor, now, trustRoots: roots, grants });
  const verifiedContract = verifyStoredContract({ stored: { contract: bundle.contract.value, digest: bundle.contract.digest, signerId: bundle.contract.signerId, signature: bundle.contract.signature }, trustRoots: roots, tenant: options.tenant });
  if (verifiedContract.signerPrincipalId !== chain.leafGrantee) throw new TypeError("contract signer does not have delegation authority");
  if (bundle.contract.value.delegationGrantDigest !== chain.leafDigest) throw new TypeError("contract delegation digest mismatch");
  if (bundle.contract.value.alias !== context.definitionAlias) throw new TypeError("contract definition alias mismatch");
  if (bundle.contract.value.packDigest !== bundle.packManifest.value.packDigest || bundle.packManifest.value.definitions.indexOf(context.definitionAlias) < 0) throw new TypeError("pack manifest binding mismatch");

  return Object.freeze({ bundle, digest: authorityDigest(bundle), tenant: options.tenant, claims: Object.freeze({ ...receipt.claims }), priorReceiptDigest });
}

export function verifyAuthorityReceipt(value: unknown, options: AuthorityReceiptVerificationOptions): VerifiedAuthorityReceiptBundle {
  return verifyAuthorityReceiptBundle(value, options);
}

export interface PortableOutcomeEvidenceVerifier {
  readonly signerId: string;
  readonly publicKey: KeyObject;
  readonly purpose: "authority-evidence";
}

export interface PortableOutcomeEvidenceVerificationOptions {
  readonly executionVerifier: PortableOutcomeEvidenceVerifier;
  readonly reconciliationVerifier: PortableOutcomeEvidenceVerifier;
  readonly currentTrustObservation: Readonly<Record<string, unknown>>;
  readonly receiptChain: readonly string[];
  readonly collectionCounts: Readonly<Record<string, number>>;
  readonly terminalDigest: string;
  readonly now: Date;
}

/** Strict offline verifier for the native HTTPS outcome extension. Trust and
 * graph anchors are supplied by the caller; the publication cannot anchor
 * itself by asserting that its own signer or terminal is current. */
export function verifyPortableOutcomeEvidencePublication(value: unknown, options: PortableOutcomeEvidenceVerificationOptions): Readonly<{ status: "verified"; digest: string }> {
  const fields = ["v", "requestId", "evidence", "routeAuthority", "authenticatedIdentity", "materializedRequest", "responseSemanticsProfile", "responseObservation", "preStateEvidence", "postStateEvidence", "expectedPostProjectionDigest", "reconciliation", "receiptChainDigest", "collectionCountsDigest", "terminalDigest", "currentTrustObservationDigest", "executionAttestation", "reconciliationAttestation"];
  const publication = portableExact(value, fields, "outcome publication") as unknown as PortableOutcomeEvidencePublicationV1;
  if (publication.v !== "reelier.portable-outcome-evidence-publication/v1" || typeof publication.requestId !== "string" || !/^sha256:[0-9a-f]{64}$/.test(publication.requestId)) throw new TypeError("portable outcome request must be an opaque digest");
  assertPortableDeepInert(publication);
  if (portableContainsConfidential(publication)) throw new TypeError("portable outcome evidence contains secret or confidential material");
  const evidenceFields = ["v", "routeAuthorityDigest", "materializedRequestDigest", "responseSemanticsProfileDigest", "preStateEvidenceDigest", "postStateEvidenceDigest", "confidence", "authoritativeStateSource", "executionAttestationSignerId", "reconciliationAttestationSignerId", "attestationSignerRelationship", "cleanupParentReceiptDigest"];
  const evidence = portableExact(publication.evidence, evidenceFields, "outcome evidence");
  const route = portableExact(publication.routeAuthority, ["v", "writeRouteDigest", "readRouteDigest", "accountDigest", "authenticatedProviderIdentityDigest", "expectedMaterializedRequestDigest", "portableMaterializedRequestDigest", "responseSemanticsProfileDigest", "projectionSchemaDigest"], "route authority");
  const identity = portableExact(publication.authenticatedIdentity, ["v", "identityDigest", "providerId", "accountDigest", "routeDigest", "observedAt"], "authenticated identity");
  const request = portableExact(publication.materializedRequest, ["v", "method", "originClass", "pathTemplate", "queryState", "reviewedHeaderNames", "bodyDigest"], "materialized request");
  const profile = portableExact(publication.responseSemanticsProfile, ["v", "profileDigest", "acknowledgedStatuses"], "response semantics profile");
  const responseObservation = portableExact(publication.responseObservation, ["v", "status", "classification"], "response observation");
  const pre = portableExact(publication.preStateEvidence, ["v", "readRouteDigest", "accountDigest", "projectionSchemaDigest", "projectionDigest", "complete", "observedAt"], "pre-state evidence");
  const post = portableExact(publication.postStateEvidence, ["v", "readRouteDigest", "accountDigest", "projectionSchemaDigest", "projectionDigest", "complete", "observedAt"], "post-state evidence");
  const reconciliation = portableExact(publication.reconciliation, ["verdict", "providerWriteCount", "resendCount", "observedProjectionDigest"], "reconciliation evidence");
  const execution = portableAttestation(publication.executionAttestation, "execution"), reconciled = portableAttestation(publication.reconciliationAttestation, "reconciliation");
  const digest = /^sha256:[0-9a-f]{64}$/;
  for (const candidate of [evidence.routeAuthorityDigest, evidence.materializedRequestDigest, evidence.responseSemanticsProfileDigest, evidence.preStateEvidenceDigest, evidence.postStateEvidenceDigest, publication.expectedPostProjectionDigest, publication.receiptChainDigest, publication.collectionCountsDigest, publication.terminalDigest, publication.currentTrustObservationDigest]) if (typeof candidate !== "string" || !digest.test(candidate)) throw new TypeError("portable outcome digest is invalid");
  if (evidence.v !== "reelier.portable-outcome-evidence/v1" || !["exact", "partial", "pending", "absent"].includes(evidence.confidence) || !["hermetic-github-fixture", "github-api"].includes(evidence.authoritativeStateSource) || evidence.attestationSignerRelationship !== "same-authority-cell") throw new TypeError("portable outcome evidence is invalid");
  if (!["matched", "conflict"].includes(reconciliation.verdict) || !Number.isSafeInteger(reconciliation.providerWriteCount) || reconciliation.providerWriteCount < 0 || !Number.isSafeInteger(reconciliation.resendCount) || reconciliation.resendCount < 0) throw new TypeError("portable reconciliation verdict or counters are invalid");
  if (reconciliation.resendCount > 0) throw new TypeError("portable reconciliation contradicts the no-resend claim");
  if (evidence.confidence === "pending" || evidence.confidence === "absent") throw new TypeError("portable outcome pending or absent evidence cannot pass");
  if (authorityDigest(route) !== evidence.routeAuthorityDigest || authorityDigest(request) !== evidence.materializedRequestDigest || authorityDigest(profile) !== evidence.responseSemanticsProfileDigest || authorityDigest(pre) !== evidence.preStateEvidenceDigest || authorityDigest(post) !== evidence.postStateEvidenceDigest) throw new TypeError("portable exact comparable route, request, profile, or post-state digest is substituted");
  if (route.v !== "reelier.portable-route-authority/v1" || identity.v !== "reelier.portable-authenticated-identity/v1" || ![route.writeRouteDigest, route.readRouteDigest, route.accountDigest, route.authenticatedProviderIdentityDigest, route.expectedMaterializedRequestDigest, route.portableMaterializedRequestDigest, route.responseSemanticsProfileDigest, route.projectionSchemaDigest].every(item => typeof item === "string" && digest.test(item))) throw new TypeError("portable route authority is invalid");
  if (route.writeRouteDigest === route.readRouteDigest) throw new TypeError("portable exact evidence requires an independently joined read route");
  if (identity.identityDigest !== route.authenticatedProviderIdentityDigest || identity.routeDigest !== route.writeRouteDigest || identity.accountDigest !== route.accountDigest || identity.providerId !== "github" || !portableTime(identity.observedAt)) throw new TypeError("portable authenticated identity route or account join is invalid");
  if (route.portableMaterializedRequestDigest !== authorityDigest(request) || route.responseSemanticsProfileDigest !== profile.profileDigest) throw new TypeError("portable materialized request projection or response profile is not route-authorized");
  if (request.v !== "reelier.portable-materialized-http-request/v1" || request.method !== "PUT" || request.originClass !== "github-api" || request.pathTemplate !== "/repos/{owner}/{repository}/issues/{issueNumber}/labels" || request.queryState !== "absent" || !Array.isArray(request.reviewedHeaderNames) || Object.getPrototypeOf(request.reviewedHeaderNames) !== Array.prototype || request.reviewedHeaderNames.length !== 1 || request.reviewedHeaderNames[0] !== "content-type" || typeof request.bodyDigest !== "string" || !digest.test(request.bodyDigest)) throw new TypeError("portable non-identifying canonical materialized request projection is invalid");
  if (profile.v !== "reelier.portable-http-response-semantics/v1" || typeof profile.profileDigest !== "string" || !digest.test(profile.profileDigest) || !Array.isArray(profile.acknowledgedStatuses) || profile.acknowledgedStatuses.length === 0 || profile.acknowledgedStatuses.some((status: unknown) => !Number.isInteger(status) || (status as number) < 200 || (status as number) > 299) || new Set(profile.acknowledgedStatuses).size !== profile.acknowledgedStatuses.length || profile.acknowledgedStatuses.some((status: number, index: number) => index > 0 && status <= profile.acknowledgedStatuses[index - 1])) throw new TypeError("portable response semantics profile statuses are invalid, unordered, or duplicated");
  const expectedResponseClassification = profile.acknowledgedStatuses.includes(responseObservation.status) ? "acknowledged" : "ambiguous";
  if (responseObservation.v !== "reelier.portable-http-response-observation/v1" || !Number.isInteger(responseObservation.status) || responseObservation.status < 100 || responseObservation.status > 599 || responseObservation.classification !== expectedResponseClassification) throw new TypeError("portable initial response classification is inconsistent with the sealed profile");
  for (const [label, state] of [["pre-state", pre], ["post-state", post]] as const) if (state.v !== "reelier.portable-comparable-state/v1" || state.readRouteDigest !== route.readRouteDigest || state.accountDigest !== route.accountDigest || state.projectionSchemaDigest !== route.projectionSchemaDigest || typeof state.complete !== "boolean" || !portableTime(state.observedAt)) throw new TypeError(`portable ${label} route/account/schema join is invalid`);
  const observedProjectionDigest = post.projectionDigest;
  if (typeof pre.projectionDigest !== "string" || !digest.test(pre.projectionDigest) || typeof post.projectionDigest !== "string" || !digest.test(post.projectionDigest)) throw new TypeError("portable comparable state must use opaque projection digests");
  if (publication.expectedPostProjectionDigest !== observedProjectionDigest || reconciliation.observedProjectionDigest !== observedProjectionDigest) throw new TypeError("portable post-state projection is substituted");
  if (evidence.confidence === "exact" && (!pre.complete || !post.complete || reconciliation.verdict !== "matched" || reconciliation.providerWriteCount !== 1 || reconciliation.resendCount !== 0 || Date.parse(post.observedAt) < Date.parse(pre.observedAt))) throw new TypeError("portable exact evidence requires complete comparable authoritative pre/post state and no resend");
  if (evidence.authoritativeStateSource !== "hermetic-github-fixture" && evidence.authoritativeStateSource !== "github-api") throw new TypeError("portable authoritative source is invalid");
  if (evidence.executionAttestationSignerId !== options.executionVerifier.signerId || evidence.reconciliationAttestationSignerId !== options.reconciliationVerifier.signerId || evidence.executionAttestationSignerId !== evidence.reconciliationAttestationSignerId || execution.signerId !== evidence.executionAttestationSignerId || reconciled.signerId !== evidence.reconciliationAttestationSignerId) throw new TypeError("portable authority-cell signer relationship is invalid");
  if (execution.statementDigest !== portableExecutionStatementDigest(publication) || reconciled.statementDigest !== portableReconciliationStatementDigest(publication)) throw new TypeError("portable cleanup-bound attestation signature statement digest is invalid");
  verifyPortableAttestation(execution, options.executionVerifier); verifyPortableAttestation(reconciled, options.reconciliationVerifier);
  if (!Array.isArray(options.receiptChain) || publication.receiptChainDigest !== authorityDigest(options.receiptChain)) throw new TypeError("portable receipt chain order or digest is invalid");
  if (publication.collectionCountsDigest !== authorityDigest(options.collectionCounts)) throw new TypeError("portable collection counts digest is invalid");
  if (publication.terminalDigest !== options.terminalDigest) throw new TypeError("portable terminal digest is invalid");
  if (evidence.cleanupParentReceiptDigest !== null && (!options.receiptChain.includes(evidence.cleanupParentReceiptDigest) || evidence.cleanupParentReceiptDigest === authorityDigest(publication))) throw new TypeError("portable cleanup parent is missing or self-anchored");
  const trust = portableExact(options.currentTrustObservation, ["v", "observedAt", "expiresAt", "activeAuthorityEvidenceSignerIds"], "current trust observation");
  if (publication.currentTrustObservationDigest !== authorityDigest(trust) || trust.v !== "reelier.portable-current-trust-observation/v1" || !portableTime(trust.observedAt) || !portableTime(trust.expiresAt) || !Array.isArray(trust.activeAuthorityEvidenceSignerIds) || !trust.activeAuthorityEvidenceSignerIds.includes(execution.signerId) || options.now.getTime() > Date.parse(trust.expiresAt) || options.now.getTime() < Date.parse(trust.observedAt)) throw new TypeError("portable current trust observation is stale, expired, or missing the signer");
  return Object.freeze({ status: "verified", digest: authorityDigest(publication) });
}

function verifyTimeline(bundle: AuthorityReceiptBundle): void {
  const timeline = bundle.evidence.value.timeline;
  if (timeline.length === 0 || timeline[0].state !== "reserved") throw new TypeError("authority evidence timeline must begin reserved");
  let previousAt = -Infinity;
  let state = "issued";
  const next: Record<string, readonly string[]> = {
    issued: ["reserved"], reserved: ["dispatched", "cancelled"], dispatched: ["acknowledged", "definitive-failure", "ambiguous"], acknowledged: ["reconciled"], "definitive-failure": ["reconciled"], ambiguous: ["reconciled"], reconciled: [], cancelled: [],
  };
  for (const entry of timeline) {
    const at = Date.parse(entry.at);
    if (!Number.isFinite(at) || at < previousAt) throw new TypeError("authority evidence timeline is not chronological");
    previousAt = at;
    if (!next[state]?.includes(entry.state)) throw new TypeError(`authority evidence illegal transition ${state}->${entry.state}`);
    state = entry.state;
  }
  const dispatched = timeline.some(entry => entry.state === "dispatched");
  if (dispatched && bundle.evidence.value.dispatchedRequestDigest === null) throw new TypeError("dispatched evidence requires a request digest");
  if (!dispatched && bundle.evidence.value.dispatchedRequestDigest !== null) throw new TypeError("undispatched evidence cannot carry a request digest");
  const reconciliation = bundle.evidence.value.reconciliation;
  if (reconciliation.verdict === "matched" && reconciliation.normalizedProjectionDigest === null) throw new TypeError("matched reconciliation requires normalized projection evidence");
  if (reconciliation.verdict !== "matched" && reconciliation.normalizedProjectionDigest !== null && reconciliation.verdict !== "conflict") throw new TypeError("unexpected normalized projection evidence");
}

export type AuthorityReceiptClaimStatus = ClaimStatus;

function portableExact(value: unknown, fields: readonly string[], label: string): Record<string, any> { assertPortableInertRecord(value, label); if (Object.keys(value).join("\0") !== fields.join("\0")) throw new TypeError(`portable ${label} is not closed or canonical`); return value; }
function portableAttestation(value: unknown, purpose: "execution" | "reconciliation"): Record<string, any> { const item = portableExact(value, ["v", "purpose", "statementDigest", "signerId", "signature"], `${purpose} attestation`); if (item.v !== "reelier.portable-outcome-attestation/v1" || item.purpose !== purpose || typeof item.statementDigest !== "string" || typeof item.signerId !== "string") throw new TypeError(`portable ${purpose} attestation is invalid`); return item; }
function verifyPortableAttestation(item: Record<string, any>, verifier: PortableOutcomeEvidenceVerifier): void { const body = { v: item.v, purpose: item.purpose, statementDigest: item.statementDigest, signerId: item.signerId }; if (verifier.purpose !== "authority-evidence" || item.signerId !== verifier.signerId || !verifyAuthoritySignature(verifier.publicKey, "authority-evidence", authorityDigest(body), item.signature as AuthoritySignature)) throw new TypeError("portable purpose-bound authority attestation signature is invalid"); }
function portableTime(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function assertPortableDeepInert(value: unknown): void { if (!value || typeof value !== "object") return; if (Object.getOwnPropertySymbols(value).length > 0 || Object.values(Object.getOwnPropertyDescriptors(value)).some(descriptor => !("value" in descriptor) || descriptor.get || descriptor.set)) throw new TypeError("portable evidence contains accessor-backed data"); for (const child of Object.values(value as Record<string, unknown>)) assertPortableDeepInert(child); }
function portableContainsConfidential(value: unknown): boolean { if (typeof value === "string") return /canary-private-token/i.test(value); if (!value || typeof value !== "object") return false; for (const [key, child] of Object.entries(value as Record<string, unknown>)) { if (/^(authorization|cookie|proxy-authorization|bearerToken|credential|credentials|credentialSlotId|slotInstanceId|slotVersion|privateKey|secret|secretRef|secretToken|token)$/i.test(key) || key === "normalizedQuery" && typeof child === "string" && portableQueryContainsConfidential(child) || portableContainsConfidential(child)) return true; } return false; }
function portableQueryContainsConfidential(query: string): boolean { const auth = /(?:access[-_ ]?token|auth(?:orization)?|bearer|credential|password|secret|api[-_ ]?key)/i; for (const pair of query.split("&")) { const [rawKey, ...rawValue] = pair.split("="); let key = rawKey ?? "", value = rawValue.join("="); try { for (let i = 0; i < 3; i += 1) { const nextKey = decodeURIComponent(key.replace(/\+/g, " ")), nextValue = decodeURIComponent(value.replace(/\+/g, " ")); if (nextKey === key && nextValue === value) break; key = nextKey; value = nextValue; } } catch { return true; } if (auth.test(key) || auth.test(value)) return true; } return false; }
