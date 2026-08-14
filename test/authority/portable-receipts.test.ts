import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { signAuthorityDigest } from "../../src/authority/crypto.js";
import {
  createSanitizedPortableOutcomeEvidenceExport,
  createPortableOutcomeEvidencePublication,
  portableSignerIdFromPublicKey,
  type PortableOutcomeEvidencePublicationV1,
} from "../../src/authority/host/portable-receipts.js";
import { verifyPortableOutcomeEvidencePublication, verifySanitizedPortableOutcomeEvidenceExport } from "../../src/authority/verify.js";
import { httpResponseSemanticsProfileDigest } from "../../src/authority/host/http-response-semantics.js";
import { authorityDigest } from "../../src/authority/wire.js";

const DIGEST = (label: string) => authorityDigest({ label });

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signer = { signerId: "cell_evidence", sign: (digest: string) => signAuthorityDigest(privateKey, "authority-evidence", digest) };
  const expectedResponseSemanticsProfile = { v: "reelier.http-response-semantics/v1" as const, profileId: "github.issue-labels.hermetic-v1", acknowledgedStatuses: [200] };
  const materializedRequest = {
    v: "reelier.portable-materialized-http-request/v1" as const,
    method: "PUT" as const,
    originClass: "github-api" as const,
    pathTemplate: "/repos/{owner}/{repository}/issues/{issueNumber}/labels" as const,
    queryState: "absent" as const,
    reviewedHeaderNames: ["content-type"],
    bodyDigest: DIGEST("body"),
  };
  const responseSemanticsProfile = { v: "reelier.portable-http-response-semantics/v1" as const, profileDigest: httpResponseSemanticsProfileDigest(expectedResponseSemanticsProfile), acknowledgedStatuses: [200] };
  const responseObservation = { v: "reelier.portable-http-response-observation/v1" as const, status: 200, classification: "acknowledged" as const };
  const projectionSchemaDigest = authorityDigest({ schemaId: "github-labels/v1", pointers: ["/labels"] });
  const routeAuthority = {
    v: "reelier.portable-route-authority/v1" as const,
    writeRouteDigest: DIGEST("write-route"),
    readRouteDigest: DIGEST("independent-read-route"),
    accountDigest: DIGEST("opaque-account"),
    authenticatedProviderIdentityDigest: DIGEST("authenticated-identity"),
    expectedMaterializedRequestDigest: DIGEST("confidential-exact-request"),
    portableMaterializedRequestDigest: authorityDigest(materializedRequest),
    responseSemanticsProfileDigest: responseSemanticsProfile.profileDigest,
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
    projectionDigest: authorityDigest({ labels: ["before"] }),
    complete: true as const,
    observedAt: "2026-08-13T12:00:01.000Z",
  };
  const postStateEvidence = { ...preStateEvidence, projectionDigest: authorityDigest({ labels: ["after"] }), observedAt: "2026-08-13T12:00:03.000Z" };
  const receiptChain = [DIGEST("dispatch-receipt"), DIGEST("reconciliation-receipt")];
  const collectionCounts = { receipts: 2, receiptExtensions: 2, portableOutcomeEvidence: 1 };
  const terminalDigest = DIGEST("terminal");
  const currentTrustObservation = { v: "reelier.portable-current-trust-observation/v1" as const, observedAt: "2026-08-13T12:00:04.000Z", expiresAt: "2026-08-13T12:05:04.000Z", activeAuthorityEvidenceSignerIds: [signer.signerId] };
  const input: Parameters<typeof createPortableOutcomeEvidencePublication>[0] = {
    requestId: DIGEST("request_native_labels"),
    routeAuthority,
    authenticatedIdentity,
    materializedRequest,
    responseSemanticsProfile,
    responseObservation,
    preStateEvidence,
    postStateEvidence,
    expectedPostProjectionDigest: postStateEvidence.projectionDigest,
    confidence: "exact",
    authoritativeStateSource: "hermetic-github-fixture",
    reconciliation: { verdict: "matched", providerWriteCount: 1, resendCount: 0, observedProjectionDigest: postStateEvidence.projectionDigest },
    cleanupParentReceiptDigest: receiptChain[0]!,
    receiptChain,
    collectionCounts,
    terminalDigest,
    currentTrustObservation,
    executionSigner: signer,
    reconciliationSigner: signer,
  };
  const publication = createPortableOutcomeEvidencePublication(input);
  const verify = (value: unknown, overrides: Record<string, unknown> = {}) => verifyPortableOutcomeEvidencePublication(value, {
    executionVerifier: { signerId: signer.signerId, publicKey, purpose: "authority-evidence" },
    reconciliationVerifier: { signerId: signer.signerId, publicKey, purpose: "authority-evidence" },
    currentTrustObservation,
    receiptChain,
    collectionCounts,
    terminalDigest,
    now: new Date("2026-08-13T12:04:00.000Z"),
    expectedResponseSemanticsProfile,
    ...overrides,
  });
  const create = (overrides: Record<string, unknown>) => createPortableOutcomeEvidencePublication({ ...input, ...overrides } as Parameters<typeof createPortableOutcomeEvidencePublication>[0]);
  return { publication, verify, create, signer, publicKey, materializedRequest, currentTrustObservation, receiptChain, collectionCounts, terminalDigest, expectedResponseSemanticsProfile };
}

test("response semantics are externally ratified rather than authenticated by the artifact itself", () => {
  const f = fixture();
  for (const acknowledgedStatuses of [[201], [200, 201], [204, 226]]) {
    const responseSemanticsProfile = { ...f.publication.responseSemanticsProfile, profileDigest: f.publication.responseSemanticsProfile.profileDigest as string, acknowledgedStatuses };
    const routeAuthority = { ...f.publication.routeAuthority, responseSemanticsProfileDigest: responseSemanticsProfile.profileDigest };
    const responseObservation = { ...f.publication.responseObservation, status: acknowledgedStatuses[0], classification: "acknowledged" };
    assert.throws(() => f.verify(f.create({ responseSemanticsProfile, routeAuthority, responseObservation })), /extern|trusted|ratified|profile|semantics/i);
  }
  const responseSemanticsProfile = { ...f.publication.responseSemanticsProfile, profileDigest: DIGEST("attacker-profile") };
  const routeAuthority = { ...f.publication.routeAuthority, responseSemanticsProfileDigest: responseSemanticsProfile.profileDigest };
  assert.throws(() => f.verify(f.create({ responseSemanticsProfile, routeAuthority })), /extern|trusted|ratified|profile|semantics/i);
  assert.throws(() => f.verify(f.publication, { expectedResponseSemanticsProfile: undefined }), /extern|trusted|ratified|profile|semantics|required/i);
});

test("the sanitized portable export joins the private graph without copying identities", () => {
  const f = fixture();
  const exportKeys = generateKeyPairSync("ed25519");
  const exportSigner = { signerId: portableSignerIdFromPublicKey(exportKeys.publicKey), publicKey: exportKeys.publicKey, sign: (digest: string) => signAuthorityDigest(exportKeys.privateKey, "authority-evidence", digest) };
  const privateGraph = {
    jobCard: { sponsor: "maxime@example.com", accountId: "account_fixlyai" },
    sourceReceipt: { login: "maxime", repository: "reelier-certification" },
    portableOutcomeEvidence: [f.publication],
  };
  const portable = createSanitizedPortableOutcomeEvidenceExport({ privateGraph, verifiedAt: "2026-08-13T12:04:00.000Z", signer: exportSigner });
  const json = JSON.stringify(portable);
  assert.deepEqual(Object.keys(portable), ["v", "privateGraphDigest", "outcomeCollectionDigest", "outcomeCount", "responseSemanticsProfilesDigest", "verifiedAt", "signerId", "signature"]);
  for (const forbidden of ["maxime@example.com", "account_fixlyai", "reelier-certification", "jobCard", "sourceReceipt", "accountId", "login"]) assert.equal(json.includes(forbidden), false, `sanitized portable export leaked ${forbidden}`);
  assert.equal(verifySanitizedPortableOutcomeEvidenceExport(portable, { privateGraph, verifier: { signerId: exportSigner.signerId, publicKey: exportKeys.publicKey, purpose: "authority-evidence" } }).status, "verified");
  assert.throws(() => verifySanitizedPortableOutcomeEvidenceExport(portable, { privateGraph: { ...privateGraph, jobCard: { sponsor: "attacker@example.com" } }, verifier: { signerId: exportSigner.signerId, publicKey: exportKeys.publicKey, purpose: "authority-evidence" } }), /graph|digest|join/i);
  for (const signerId of ["maxime@example.com", "account_fixlyai", "github-login", "free form reviewer"]) {
    assert.throws(() => createSanitizedPortableOutcomeEvidenceExport({ privateGraph, verifiedAt: "2026-08-13T12:04:00.000Z", signer: { ...exportSigner, signerId } }), /opaque|digest|signer/i);
  }
});

test("sanitized signer identity is derived from the actual signing key and rejects key or signature substitution", () => {
  const f = fixture();
  const exportKeys = generateKeyPairSync("ed25519");
  const otherKeys = generateKeyPairSync("ed25519");
  const privateGraph = { portableOutcomeEvidence: [f.publication] };
  const signerId = portableSignerIdFromPublicKey(exportKeys.publicKey);
  const signer = { signerId, publicKey: exportKeys.publicKey, sign: (digest: string) => signAuthorityDigest(exportKeys.privateKey, "authority-evidence", digest) };
  const portable = createSanitizedPortableOutcomeEvidenceExport({ privateGraph, verifiedAt: "2026-08-13T12:04:00.000Z", signer });
  assert.equal(verifySanitizedPortableOutcomeEvidenceExport(portable, { privateGraph, verifier: { signerId, publicKey: exportKeys.publicKey, purpose: "authority-evidence" } }).status, "verified");
  assert.throws(() => createSanitizedPortableOutcomeEvidenceExport({ privateGraph, verifiedAt: "2026-08-13T12:04:00.000Z", signer: { ...signer, publicKey: otherKeys.publicKey } }), /derived|public|signer|key/i);
  assert.throws(() => verifySanitizedPortableOutcomeEvidenceExport(portable, { privateGraph, verifier: { signerId: portableSignerIdFromPublicKey(otherKeys.publicKey), publicKey: otherKeys.publicKey, purpose: "authority-evidence" } }), /derived|public|signer|signature|invalid/i);
  assert.throws(() => verifySanitizedPortableOutcomeEvidenceExport({ ...portable, signerId: DIGEST("unrelated-key") }, { privateGraph, verifier: { signerId, publicKey: exportKeys.publicKey, purpose: "authority-evidence" } }), /derived|public|signer|signature|invalid/i);
});

test("the complete sanitized portable artifact satisfies its closed nonidentifying schema", async () => {
  const f = fixture();
  const keys = generateKeyPairSync("ed25519");
  const privateGraph = { jobCard: { sponsor: "maxime@example.com", accountId: "account_fixlyai" }, portableOutcomeEvidence: [f.publication] };
  const portable = createSanitizedPortableOutcomeEvidenceExport({ privateGraph, verifiedAt: "2026-08-13T12:04:00.000Z", signer: { signerId: portableSignerIdFromPublicKey(keys.publicKey), publicKey: keys.publicKey, sign: digest => signAuthorityDigest(keys.privateKey, "authority-evidence", digest) } });
  const schema = JSON.parse(await readFile(path.resolve("contract/certification/v1/sanitized-portable-outcome-evidence.schema.json"), "utf8"));
  const Ajv2020 = createRequire(import.meta.url)("ajv/dist/2020").default;
  const validate = new Ajv2020({ strict: false }).compile(schema);
  assert.equal(validate(JSON.parse(JSON.stringify(portable))), true, JSON.stringify(validate.errors));
  const leaked: any = { ...portable, accountId: "account_fixlyai" };
  assert.equal(validate(leaked), false);
  assert.doesNotMatch(JSON.stringify(portable), /maxime@example\.com|account_fixlyai|jobCard|accountId/i);
});

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
  secret.materializedRequest.authorization = "canary-private-token";
  assert.throws(() => f.verify(secret), /secret|confidential|authorization|header/i);
});

test("every confidence rejects malformed reconciliation and normalized query credentials", () => {
  const f = fixture();
  const observedProjectionDigest = f.publication.reconciliation.observedProjectionDigest;
  const malformed = [
    { verdict: "invented", providerWriteCount: 1, resendCount: 0, observedProjectionDigest },
    { verdict: "not-attempted", providerWriteCount: 1, resendCount: 0, observedProjectionDigest },
    { verdict: "matched", providerWriteCount: -1, resendCount: 0, observedProjectionDigest },
    { verdict: "matched", providerWriteCount: 1.5, resendCount: 0, observedProjectionDigest },
    { verdict: "matched", providerWriteCount: 1, resendCount: -1, observedProjectionDigest },
    { verdict: "matched", providerWriteCount: 1, resendCount: 1, observedProjectionDigest },
  ];
  for (const confidence of ["exact", "partial", "pending", "absent"] as const) {
    for (const reconciliation of malformed) {
      assert.throws(() => f.verify(f.create({ confidence, reconciliation })), /reconciliation|verdict|count|resend/i);
    }
  }
  for (const normalizedQuery of ["access_token=canary-private-token", "access%5Ftoken=canary-private-token", "safe=access%5Ftoken%3Dcanary-private-token", "access+token=canary", "safe=api+key", "AcCeSs%5fToKeN=canary", "access%ZZtoken=canary"]) {
    const materializedRequest = { ...f.materializedRequest, normalizedQuery };
    assert.throws(() => f.verify(f.create({ materializedRequest })), /secret|credential|query|confidential/i);
  }
  const duplicateStatuses = { ...f.publication.responseSemanticsProfile, acknowledgedStatuses: [200, 200] };
  const duplicateStatusRoute = { ...f.publication.routeAuthority };
  assert.throws(() => f.verify(f.create({ responseSemanticsProfile: duplicateStatuses, routeAuthority: duplicateStatusRoute })), /response|status|duplicate|semantics/i);
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

test("portable request projection binds a separate confidential materialized request commitment", () => {
  const f = fixture();
  const routeAuthority = { ...f.publication.routeAuthority, expectedMaterializedRequestDigest: DIGEST("confidential-exact-request"), portableMaterializedRequestDigest: authorityDigest(f.materializedRequest) };
  assert.equal(f.verify(f.create({ routeAuthority })).status, "verified");
  const mismatched = { ...routeAuthority, portableMaterializedRequestDigest: DIGEST("wrong-portable-projection") };
  assert.throws(() => f.verify(f.create({ routeAuthority: mismatched })), /request|projection|digest|route/i);
});

test("signed portable evidence structurally refuses identifying and free-form request surfaces", () => {
  const f = fixture();
  const counterexamples: readonly Readonly<{ label: string; overrides: Record<string, unknown> }>[] = [
    { label: "request id", overrides: { requestId: "request_maxime@example.com" } },
    { label: "origin", overrides: { materializedRequest: { ...f.materializedRequest, origin: "https://maxime.example.test" } } },
    { label: "query order", overrides: { materializedRequest: { ...f.materializedRequest, normalizedQuery: "z=1&a=2" } } },
    { label: "header value", overrides: { materializedRequest: { ...f.materializedRequest, reviewedHeaders: { "x-login": "maxime@example.com" } } } },
    { label: "profile id", overrides: { responseSemanticsProfile: { ...f.publication.responseSemanticsProfile, profileId: "maxime@example.com" } } },
    { label: "account-like state", overrides: { preStateEvidence: { ...f.publication.preStateEvidence, projection: { labels: ["fixlyai"] } } } },
    { label: "reviewer secret", overrides: { postStateEvidence: { ...f.publication.postStateEvidence, projection: { labels: ["ghp_real_secret"] } }, expectedPostProjectionDigest: authorityDigest({ labels: ["ghp_real_secret"] }), reconciliation: { ...f.publication.reconciliation, observedProjectionDigest: authorityDigest({ labels: ["ghp_real_secret"] }) } } },
  ];
  for (const counterexample of counterexamples) {
    assert.throws(() => {
      const signed = f.create(counterexample.overrides);
      f.verify(signed);
    }, /portable|opaque|identif|request|origin|query|header|profile|projection|confidential/i, counterexample.label);
  }
});

test("portable JSON exposes only opaque or closed canonical request, response, and state projections", () => {
  const f = fixture();
  const publication: any = f.publication;
  assert.match(publication.requestId, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(publication.materializedRequest, {
    v: "reelier.portable-materialized-http-request/v1",
    method: "PUT",
    originClass: "github-api",
    pathTemplate: "/repos/{owner}/{repository}/issues/{issueNumber}/labels",
    queryState: "absent",
    reviewedHeaderNames: ["content-type"],
    bodyDigest: DIGEST("body"),
  });
  assert.deepEqual(publication.responseSemanticsProfile, {
    v: "reelier.portable-http-response-semantics/v1",
    profileDigest: f.publication.routeAuthority.responseSemanticsProfileDigest,
    acknowledgedStatuses: [200],
  });
  assert.deepEqual(Object.keys(publication.preStateEvidence), ["v", "readRouteDigest", "accountDigest", "projectionSchemaDigest", "projectionDigest", "complete", "observedAt"]);
  assert.deepEqual(Object.keys(publication.postStateEvidence), ["v", "readRouteDigest", "accountDigest", "projectionSchemaDigest", "projectionDigest", "complete", "observedAt"]);
  for (const forbidden of ["maxime@example.com", "fixlyai", "reelier-certification", "ghp_real_secret", "canary-private-token"]) {
    assert.equal(JSON.stringify(publication).toLowerCase().includes(forbidden.toLowerCase()), false, `portable JSON leaked ${forbidden}`);
  }
});
