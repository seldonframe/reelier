import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { signAuthorityDigest } from "../../src/authority/crypto.js";
import {
  createPortableOutcomeEvidencePublication,
  type PortableOutcomeEvidencePublicationV1,
} from "../../src/authority/host/portable-receipts.js";
import { verifyPortableOutcomeEvidencePublication } from "../../src/authority/verify.js";
import { authorityDigest } from "../../src/authority/wire.js";

const DIGEST = (label: string) => authorityDigest({ label });

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signer = { signerId: "cell_evidence", sign: (digest: string) => signAuthorityDigest(privateKey, "authority-evidence", digest) };
  const materializedRequest = {
    v: "reelier.materialized-http-request/v1" as const,
    method: "PUT" as const,
    origin: "https://api.github.test",
    normalizedPath: "/repos/1/issues/2/labels",
    normalizedQuery: "",
    reviewedHeaders: { accept: "application/vnd.github+json" },
    bodyDigest: DIGEST("body"),
  };
  const responseSemanticsProfile = { v: "reelier.http-response-semantics/v1" as const, profileId: "github-label-put-v1", acknowledgedStatuses: [200] };
  const projectionSchemaDigest = authorityDigest({ schemaId: "github-labels/v1", pointers: ["/labels"] });
  const routeAuthority = {
    v: "reelier.portable-route-authority/v1" as const,
    writeRouteDigest: DIGEST("write-route"),
    readRouteDigest: DIGEST("independent-read-route"),
    accountDigest: DIGEST("opaque-account"),
    authenticatedProviderIdentityDigest: DIGEST("authenticated-identity"),
    expectedMaterializedRequestDigest: authorityDigest(materializedRequest),
    responseSemanticsProfileDigest: authorityDigest(responseSemanticsProfile),
    projectionSchemaDigest,
  };
  const authenticatedIdentity = {
    v: "reelier.portable-authenticated-identity/v1" as const,
    identityDigest: routeAuthority.authenticatedProviderIdentityDigest,
    providerId: "github" as const,
    accountDigest: routeAuthority.accountDigest,
    routeDigest: routeAuthority.writeRouteDigest,
    observedAt: "2026-08-13T12:00:00.000Z",
  };
  const preStateEvidence = {
    v: "reelier.portable-comparable-state/v1" as const,
    readRouteDigest: routeAuthority.readRouteDigest,
    accountDigest: routeAuthority.accountDigest,
    projectionSchemaDigest,
    projection: { labels: ["before"] },
    complete: true as const,
    observedAt: "2026-08-13T12:00:01.000Z",
  };
  const postStateEvidence = { ...preStateEvidence, projection: { labels: ["after"] }, observedAt: "2026-08-13T12:00:03.000Z" };
  const receiptChain = [DIGEST("dispatch-receipt"), DIGEST("reconciliation-receipt")];
  const collectionCounts = { receipts: 2, receiptExtensions: 2, portableOutcomeEvidence: 1 };
  const terminalDigest = DIGEST("terminal");
  const currentTrustObservation = { v: "reelier.portable-current-trust-observation/v1" as const, observedAt: "2026-08-13T12:00:04.000Z", expiresAt: "2026-08-13T12:05:04.000Z", activeAuthorityEvidenceSignerIds: [signer.signerId] };
  const publication = createPortableOutcomeEvidencePublication({
    requestId: "request_native_labels",
    routeAuthority,
    authenticatedIdentity,
    materializedRequest,
    responseSemanticsProfile,
    preStateEvidence,
    postStateEvidence,
    expectedPostProjectionDigest: authorityDigest(postStateEvidence.projection),
    confidence: "exact",
    authoritativeStateSource: "hermetic-github-fixture",
    reconciliation: { verdict: "matched", providerWriteCount: 1, resendCount: 0, observedProjectionDigest: authorityDigest(postStateEvidence.projection) },
    cleanupParentReceiptDigest: receiptChain[0]!,
    receiptChain,
    collectionCounts,
    terminalDigest,
    currentTrustObservation,
    executionSigner: signer,
    reconciliationSigner: signer,
  });
  const verify = (value: unknown, overrides: Record<string, unknown> = {}) => verifyPortableOutcomeEvidencePublication(value, {
    executionVerifier: { signerId: signer.signerId, publicKey, purpose: "authority-evidence" },
    reconciliationVerifier: { signerId: signer.signerId, publicKey, purpose: "authority-evidence" },
    currentTrustObservation,
    receiptChain,
    collectionCounts,
    terminalDigest,
    now: new Date("2026-08-13T12:04:00.000Z"),
    ...overrides,
  });
  return { publication, verify, signer, publicKey, materializedRequest, currentTrustObservation, receiptChain, collectionCounts, terminalDigest };
}

test("removing the route/request/native post-state extension makes offline verification refuse", () => {
  const f = fixture();
  assert.equal(f.verify(f.publication).status, "verified");
  for (const key of ["routeAuthority", "materializedRequest", "postStateEvidence"] as const) {
    const changed: any = structuredClone(f.publication);
    delete changed[key];
    assert.throws(() => f.verify(changed), /route|request|post-state|closed|exact/i);
  }
});

test("substituting any bound digest, source, signer role, cleanup link, chain order, count, or terminal is detected", () => {
  const f = fixture();
  const mutations: readonly ((value: any) => void)[] = [
    value => { value.routeAuthority.readRouteDigest = DIGEST("substituted-read-route"); },
    value => { value.materializedRequest.bodyDigest = DIGEST("substituted-body"); },
    value => { value.postStateEvidence.projection = { labels: ["substituted"] }; },
    value => { value.evidence.authoritativeStateSource = "github-api"; },
    value => { value.evidence.executionAttestationSignerId = "wrong-role"; },
    value => { value.evidence.cleanupParentReceiptDigest = DIGEST("wrong-parent"); },
  ];
  for (const mutate of mutations) {
    const changed: any = structuredClone(f.publication);
    mutate(changed);
    assert.throws(() => f.verify(changed), /digest|source|signer|cleanup|route|request|post-state|attestation/i);
  }
  assert.throws(() => f.verify(f.publication, { receiptChain: [...f.receiptChain].reverse() }), /chain|order|digest/i);
  assert.throws(() => f.verify(f.publication, { collectionCounts: { ...f.collectionCounts, receipts: 1 } }), /count|collection|digest/i);
  assert.throws(() => f.verify(f.publication, { terminalDigest: DIGEST("substituted-terminal") }), /terminal|digest/i);
});

test("false exact, pending, absent, self-anchored, accessor-backed, extra-key, stale, and secret-bearing evidence refuse", () => {
  const f = fixture();
  for (const confidence of ["pending", "absent"] as const) {
    const changed: any = structuredClone(f.publication);
    changed.evidence.confidence = confidence;
    assert.throws(() => f.verify(changed), /pending|absent|confidence|signature/i);
  }
  const falseExact: any = structuredClone(f.publication);
  falseExact.postStateEvidence.complete = false;
  assert.throws(() => f.verify(falseExact), /exact|complete|comparable|signature/i);
  const selfAnchored: any = structuredClone(f.publication);
  selfAnchored.evidence.cleanupParentReceiptDigest = authorityDigest(selfAnchored);
  assert.throws(() => f.verify(selfAnchored), /self|cleanup|receipt|signature/i);
  const accessor: any = structuredClone(f.publication);
  Object.defineProperty(accessor.routeAuthority, "readRouteDigest", { enumerable: true, get: () => DIGEST("getter") });
  assert.throws(() => f.verify(accessor), /accessor|canonical|closed|route/i);
  const extra: any = structuredClone(f.publication);
  extra.evidence.unreviewed = true;
  assert.throws(() => f.verify(extra), /extra|closed|canonical/i);
  assert.throws(() => f.verify(f.publication, { now: new Date("2026-08-13T12:06:00.000Z") }), /stale|expired|trust/i);
  const secret: any = structuredClone(f.publication);
  secret.materializedRequest.reviewedHeaders.authorization = "canary-private-token";
  assert.throws(() => f.verify(secret), /secret|confidential|authorization|header/i);
});

test("the exact PortableOutcomeEvidenceV1 surface remains closed", () => {
  const { publication } = fixture();
  assert.deepEqual(Object.keys((publication as PortableOutcomeEvidencePublicationV1).evidence), [
    "v", "routeAuthorityDigest", "materializedRequestDigest", "responseSemanticsProfileDigest",
    "preStateEvidenceDigest", "postStateEvidenceDigest", "confidence", "authoritativeStateSource",
    "executionAttestationSignerId", "reconciliationAttestationSignerId", "attestationSignerRelationship",
    "cleanupParentReceiptDigest",
  ]);
});
