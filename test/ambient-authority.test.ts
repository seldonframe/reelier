import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  authorityDigest,
  createApprovalReplayProtectorV1,
  parseTrustDomainDescriptorV1,
  verifyCustomerRootedAuthorityV1,
  type CustomerApprovalProofV1,
  type HostedAuthorityEnvelopeV1,
  type MissionChildGrantV1,
  type StandingAuthorityEnvelopeV1,
  type TrustDomainDescriptorV1,
} from "../src/authority/index.js";

const now = new Date("2026-08-20T12:00:00.000Z");
const b64url = (value: Buffer) => value.toString("base64url");
const digest = (value: unknown) => authorityDigest(value);
const domain: TrustDomainDescriptorV1 = {
  v: "reelier.trust-domain-descriptor/v1", tenant: "tenant-a", trustDomainId: "td_a", origin: "https://operator.example", rpId: "operator.example", revocationGeneration: 7,
  connectors: [{ connectorId: "github", accountId: "acme/reelier" }], validFrom: "2026-08-20T00:00:00.000Z", validUntil: "2026-08-21T00:00:00.000Z",
};
const limits = { maxEffectsPerWindow: 4, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 };

function fixture(algorithm: "ES256" | "EdDSA" = "ES256") {
  const { privateKey, publicKey } = algorithm === "ES256" ? generateKeyPairSync("ec", { namedCurve: "prime256v1" }) : generateKeyPairSync("ed25519");
  const authority = { v: "reelier.customer-authority/internal-v1", tenant: "tenant-a", connector: { connectorId: "github", accountId: "acme/reelier" }, limits };
  const authorityDigest = digest(authority), trustDomainDigest = digest(domain), nonce = b64url(Buffer.alloc(32, 9));
  const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: b64url(Buffer.from(authorityDigest, "utf8")), origin: domain.origin, crossOrigin: false }));
  const authData = Buffer.concat([createHash("sha256").update(domain.rpId).digest(), Buffer.from([0x05]), Buffer.alloc(4)]);
  const proof: CustomerApprovalProofV1 = {
    v: "reelier.customer-approval-proof/v1", tenant: domain.tenant, trustDomainDigest, authorityDigest, nonce, origin: domain.origin, rpId: domain.rpId,
    issuedAt: "2026-08-20T11:00:00.000Z", expiresAt: "2026-08-20T13:00:00.000Z", revocationGeneration: domain.revocationGeneration,
    connector: authority.connector, limits, credentialId: b64url(Buffer.alloc(32, 8)), algorithm, publicKeyJwk: publicKey.export({ format: "jwk" }), authenticatorData: b64url(authData), clientDataJSON: b64url(clientData), signature: b64url(sign(algorithm === "ES256" ? "sha256" : null, Buffer.concat([authData, createHash("sha256").update(clientData).digest()]), privateKey)),
  };
  const standing: StandingAuthorityEnvelopeV1 = { v: "reelier.standing-authority-envelope/v1", tenant: domain.tenant, trustDomainDigest, authorityDigest, approvalProofDigest: digest(proof), nonce, origin: domain.origin, rpId: domain.rpId, validFrom: proof.issuedAt, validUntil: proof.expiresAt, revocationGeneration: domain.revocationGeneration, connector: authority.connector, limits };
  const hosted: HostedAuthorityEnvelopeV1 = { v: "reelier.hosted-authority-envelope/v1", tenant: domain.tenant, trustDomainDigest, authorityDigest, standingAuthorityDigest: digest(standing), approvalProofDigest: digest(proof), nonce, origin: domain.origin, rpId: domain.rpId, validFrom: standing.validFrom, validUntil: standing.validUntil, revocationGeneration: domain.revocationGeneration, connector: authority.connector, limits, issuer: "reelier-hosted" };
  const mission: MissionChildGrantV1 = { v: "reelier.mission-child-grant/v1", tenant: domain.tenant, trustDomainDigest, authorityDigest, hostedAuthorityDigest: digest(hosted), standingAuthorityDigest: digest(standing), grantId: "mission-1", nonce: b64url(Buffer.alloc(32, 3)), validFrom: "2026-08-20T11:30:00.000Z", validUntil: "2026-08-20T12:30:00.000Z", revocationGeneration: domain.revocationGeneration, connector: authority.connector, limits: { ...limits, maxEffectsPerWindow: 1 } };
  return { proof, standing, hosted, mission };
}

test("customer-rooted authority verifies a WebAuthn approval once and binds all envelopes", () => {
  const value = fixture(); const replay = createApprovalReplayProtectorV1();
  const verified = verifyCustomerRootedAuthorityV1({ domain, ...value, now, replay });
  assert.equal(verified.mission.grantId, "mission-1");
  assert.throws(() => verifyCustomerRootedAuthorityV1({ domain, ...value, now, replay }), /replay/);
});

test("customer-rooted authority accepts the WebAuthn EdDSA profile", () => {
  const value = fixture("EdDSA");
  assert.equal(verifyCustomerRootedAuthorityV1({ domain, ...value, now, replay: createApprovalReplayProtectorV1() }).proof.algorithm, "EdDSA");
});

test("authority rejects tenant aliasing, expiry, and any child widening", () => {
  const value = fixture();
  assert.throws(() => parseTrustDomainDescriptorV1({ ...domain, origin: "http://operator.example" }), /origin/);
  assert.throws(() => verifyCustomerRootedAuthorityV1({ domain, ...value, mission: { ...value.mission, limits: { ...limits, maxEffectsPerWindow: 5 } }, now, replay: createApprovalReplayProtectorV1() }), /widening/);
  assert.throws(() => verifyCustomerRootedAuthorityV1({ domain, ...value, proof: { ...value.proof, expiresAt: "2026-08-20T11:59:00.000Z" }, now, replay: createApprovalReplayProtectorV1() }), /binding|expired|validity/);
});
