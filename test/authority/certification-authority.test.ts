import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../../src/authority/wire.js";
import {
  createSignedCertificationReadiness,
  parseAuthorityKeyDescriptor,
  parseTrustEvents,
  verifySignedCertificationReadiness,
} from "../../src/authority/certification/authority.js";

const at = "2026-08-11T20:00:00.000Z";
const later = "2026-08-11T20:01:00.000Z";

function keyDescriptor(keyId: string, role: "human-sponsor" | "authority-cell", purpose: string, publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"]): any {
  return {
    v: "reelier.authority-key-descriptor/v1",
    keyId,
    role,
    purpose,
    algorithm: "ed25519",
    publicKeySpkiBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
  };
}

function candidate(): any {
  return {
    v: "reelier.certification-readiness-candidate/v1",
    status: "awaiting-human-signature",
    preparationReady: true,
    signatureStatus: "absent",
    authorization: "absent",
    dispatchable: false,
    completeness: "unchecked",
    configDigest: `sha256:${"1".repeat(64)}`,
    selectionDigest: `sha256:${"2".repeat(64)}`,
    preflightDigest: `sha256:${"3".repeat(64)}`,
    scenarios: ["github-issue-labels"],
    identifiers: {
      taskId: `task_${"a".repeat(24)}`,
      jobCardId: `job_${"b".repeat(24)}`,
      rootGrantId: `grant_${"c".repeat(24)}`,
      authorityCellId: `cell_${"d".repeat(24)}`,
      signerId: `signer_${"e".repeat(24)}`,
    },
    commitments: { resources: [], cleanup: [], credentials: [], runners: { status: "configured", artifacts: [] }, tests: { status: "configured", artifacts: [] }, topology: "absent", signatureStatus: "absent" },
  };
}

function trustEvent(sequence: number, action: "activate" | "revoke", descriptorDigest: string, previousEventDigest: string | null, occurredAt = at): any {
  return { v: "reelier.authority-trust-event/v1", eventId: `trust_${sequence}_${"f".repeat(12)}`, sequence, action, keyDescriptorDigest: descriptorDigest, occurredAt, previousEventDigest };
}

function validFixture() {
  const human = generateKeyPairSync("ed25519");
  const cell = generateKeyPairSync("ed25519");
  const readiness = candidate();
  const humanDescriptor = keyDescriptor(readiness.identifiers.signerId, "human-sponsor", "certification-readiness", human.publicKey);
  const cellDescriptor = keyDescriptor("cell_receipt_key", "authority-cell", "authority-receipt", cell.publicKey);
  const first = trustEvent(0, "activate", authorityDigest(humanDescriptor), null);
  const second = trustEvent(1, "activate", authorityDigest(cellDescriptor), authorityDigest(first));
  return { human, readiness, humanDescriptor, cellDescriptor, events: [first, second] };
}

test("human-signed readiness binds the candidate root, selection, generated IDs, scenarios, Cell keys, and trust history without becoming dispatchable", () => {
  const fixture = validFixture();
  const signed = createSignedCertificationReadiness({
    readinessCandidate: fixture.readiness,
    readinessCandidateDigest: authorityDigest(fixture.readiness),
    humanKeyDescriptor: fixture.humanDescriptor,
    cellKeyDescriptors: [fixture.cellDescriptor],
    trustEvents: fixture.events,
    humanPrivateKey: fixture.human.privateKey,
    authorizedAt: later,
  });
  const verified = verifySignedCertificationReadiness({
    signed,
    readinessCandidate: fixture.readiness,
    humanTrustRoot: fixture.humanDescriptor,
    keyDescriptors: [fixture.humanDescriptor, fixture.cellDescriptor],
    trustEvents: fixture.events,
  });
  assert.equal(verified.authorization, "verified");
  assert.equal(verified.dispatchable, false);
  assert.equal(signed.dispatchable, false);
  assert.equal(signed.configurationRoot, fixture.readiness.configDigest);
  assert.equal(signed.selectionDigest, fixture.readiness.selectionDigest);
  assert.deepEqual(signed.identifiers, fixture.readiness.identifiers);
  assert.deepEqual(signed.scenarios, fixture.readiness.scenarios);
  assert.deepEqual(signed.activatedCellKeyDescriptorDigests, [authorityDigest(fixture.cellDescriptor)]);
});

test("key descriptors and trust events are closed and enforce the exact role-purpose matrix", () => {
  const fixture = validFixture();
  assert.throws(() => parseAuthorityKeyDescriptor({ ...fixture.humanDescriptor, extra: true }), /closed/i);
  assert.throws(() => parseAuthorityKeyDescriptor({ ...fixture.humanDescriptor, purpose: "authority-receipt" }), /role.*purpose|purpose.*role/i);
  assert.throws(() => parseAuthorityKeyDescriptor({ ...fixture.cellDescriptor, purpose: "certification-readiness" }), /role.*purpose|purpose.*role/i);
  assert.throws(() => parseTrustEvents([{ ...fixture.events[0], extra: true }], [fixture.humanDescriptor, fixture.cellDescriptor]), /closed/i);
  assert.throws(() => parseTrustEvents([fixture.events[0], { ...fixture.events[1], previousEventDigest: null }], [fixture.humanDescriptor, fixture.cellDescriptor]), /chain|previous/i);
});

test("offline verification rejects purpose, role, candidate, config, selection, ID, scenario, Cell-key, and trust-history substitution", () => {
  const fixture = validFixture();
  const signed = createSignedCertificationReadiness({ readinessCandidate: fixture.readiness, readinessCandidateDigest: authorityDigest(fixture.readiness), humanKeyDescriptor: fixture.humanDescriptor, cellKeyDescriptors: [fixture.cellDescriptor], trustEvents: fixture.events, humanPrivateKey: fixture.human.privateKey, authorizedAt: later });
  const verify = (overrides: Record<string, unknown>) => verifySignedCertificationReadiness({ signed, readinessCandidate: fixture.readiness, humanTrustRoot: fixture.humanDescriptor, keyDescriptors: [fixture.humanDescriptor, fixture.cellDescriptor], trustEvents: fixture.events, ...overrides } as never);
  assert.throws(() => verify({ signed: { ...signed, purpose: "authority-receipt" } }), /purpose|signature/i);
  assert.throws(() => verify({ signed: { ...signed, signerRole: "authority-cell" } }), /role|signature/i);
  assert.throws(() => verify({ readinessCandidate: { ...fixture.readiness, preflightDigest: `sha256:${"4".repeat(64)}` } }), /candidate|digest|link/i);
  for (const [field, value] of [
    ["configurationRoot", `sha256:${"5".repeat(64)}`],
    ["selectionDigest", `sha256:${"6".repeat(64)}`],
    ["identifiers", { ...signed.identifiers, taskId: `task_${"0".repeat(24)}` }],
    ["scenarios", ["slack-topic"]],
    ["activatedCellKeyDescriptorDigests", []],
    ["trustHistoryDigest", `sha256:${"7".repeat(64)}`],
  ] as const) assert.throws(() => verify({ signed: { ...signed, [field]: value } }), /signature|link|trust|cell|scenario|identifier|selection|configuration/i, field);
});

test("offline verification rejects inactive, revoked, late-activated, and malformed trust histories", () => {
  const fixture = validFixture();
  const signed = createSignedCertificationReadiness({ readinessCandidate: fixture.readiness, readinessCandidateDigest: authorityDigest(fixture.readiness), humanKeyDescriptor: fixture.humanDescriptor, cellKeyDescriptors: [fixture.cellDescriptor], trustEvents: fixture.events, humanPrivateKey: fixture.human.privateKey, authorizedAt: later });
  const verify = (events: readonly any[]) => verifySignedCertificationReadiness({ signed: { ...signed, trustHistoryDigest: authorityDigest(events) }, readinessCandidate: fixture.readiness, humanTrustRoot: fixture.humanDescriptor, keyDescriptors: [fixture.humanDescriptor, fixture.cellDescriptor], trustEvents: events });
  assert.throws(() => verify([fixture.events[0]]), /cell.*active|descriptor.*active/i);
  const revoked = trustEvent(2, "revoke", authorityDigest(fixture.cellDescriptor), authorityDigest(fixture.events[1]), later);
  assert.throws(() => verify([...fixture.events, revoked]), /revoked|active/i);
  const late = trustEvent(1, "activate", authorityDigest(fixture.cellDescriptor), authorityDigest(fixture.events[0]), "2026-08-11T20:02:00.000Z");
  assert.throws(() => verify([fixture.events[0], late]), /activated after|late|authorized|active/i);
  assert.throws(() => verify([{ ...fixture.events[0], sequence: 1 }, fixture.events[1]]), /sequence/i);
});

test("signing refuses a private key that does not match the pre-existing human descriptor", () => {
  const fixture = validFixture();
  const wrong = generateKeyPairSync("ed25519");
  assert.throws(() => createSignedCertificationReadiness({ readinessCandidate: fixture.readiness, readinessCandidateDigest: authorityDigest(fixture.readiness), humanKeyDescriptor: fixture.humanDescriptor, cellKeyDescriptors: [fixture.cellDescriptor], trustEvents: fixture.events, humanPrivateKey: createPrivateKey(wrong.privateKey.export({ type: "pkcs8", format: "pem" })), authorizedAt: later }), /private key.*descriptor|signer/i);
  assert.doesNotThrow(() => createPublicKey({ key: Buffer.from(fixture.humanDescriptor.publicKeySpkiBase64, "base64"), format: "der", type: "spki" }));
});

test("portable authority key, trust event, and signed readiness schemas are closed", async () => {
  const Ajv2020 = createRequire(import.meta.url)("ajv/dist/2020").default;
  const ajv = new Ajv2020({ strict: true });
  const fixture = validFixture();
  const signed = createSignedCertificationReadiness({ readinessCandidate: fixture.readiness, readinessCandidateDigest: authorityDigest(fixture.readiness), humanKeyDescriptor: fixture.humanDescriptor, cellKeyDescriptors: [fixture.cellDescriptor], trustEvents: fixture.events, humanPrivateKey: fixture.human.privateKey, authorizedAt: later });
  const load = async (name: string) => JSON.parse(await readFile(path.join(process.cwd(), "contract", "authority", "v1", name), "utf8"));
  const descriptorSchema = await load("authority-key-descriptor.schema.json");
  const eventSchema = await load("trust-event.schema.json");
  const readinessSchema = await load("signed-certification-readiness.schema.json");
  assert.equal(ajv.validate(descriptorSchema, fixture.humanDescriptor), true, JSON.stringify(ajv.errors));
  assert.equal(ajv.validate(eventSchema, fixture.events[0]), true, JSON.stringify(ajv.errors));
  assert.equal(ajv.validate(readinessSchema, signed), true, JSON.stringify(ajv.errors));
  assert.equal(ajv.validate(descriptorSchema, { ...fixture.humanDescriptor, extra: true }), false);
  assert.equal(ajv.validate(eventSchema, { ...fixture.events[0], extra: true }), false);
  assert.equal(ajv.validate(readinessSchema, { ...signed, dispatchable: true }), false);
  assert.equal(ajv.validate(readinessSchema, { ...signed, extra: true }), false);
});
