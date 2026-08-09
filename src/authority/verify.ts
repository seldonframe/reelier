import type { AuthorityReceipt, AuthorityReceiptBundle, ClaimStatus } from "./types.js";
import { authorityDigest } from "./wire.js";
import { parseAuthorityReceiptBundle } from "./evidence.js";
import { verifyTrustedAuthority, createTrustRoots, type TrustRoots, type TrustRootEntry } from "./trust.js";
import { validateDelegationChain } from "./delegation.js";
import { verifyStoredContract } from "./contract.js";

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
