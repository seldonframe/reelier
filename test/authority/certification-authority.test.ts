import test from "node:test";
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";
import { createRequire } from "node:module";
import { chmod, link, mkdir, mkdtemp, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { authorityDigest } from "../../src/authority/wire.js";
import {
  createSignedCertificationReadiness,
  parseAuthorityKeyDescriptor,
  parseTrustEvents,
  signCertificationReadinessArtifact,
  verifySignedCertificationReadiness,
} from "../../src/authority/certification/authority.js";
import { initializeCertification } from "../../src/authority/certification/initializer.js";
import { parseCertificationReadinessCandidate, sealCertificationReadiness } from "../../src/authority/certification/readiness.js";
import { writeCertificationInputManifests } from "./certification-input-fixture.js";
import { certificationRunnerRegistryDigest } from "../../src/authority/certification/runner-registry.js";

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
  const base = {
    v: "reelier.certification-readiness-candidate/v1",
    status: "awaiting-human-signature",
    preparationReady: true,
    signatureStatus: "absent",
    authorization: "absent",
    dispatchable: false,
    completeness: "unchecked",
    configDigest: `sha256:${"1".repeat(64)}`,
    selectionDigest: `sha256:${"2".repeat(64)}`,
    preflightDigest: "",
    scenarios: ["github-issue-labels"],
    identifiers: {
      taskId: `task_${"a".repeat(24)}`,
      jobCardId: `job_${"b".repeat(24)}`,
      rootGrantId: `grant_${"c".repeat(24)}`,
      authorityCellId: `cell_${"d".repeat(24)}`,
      signerId: `signer_${"e".repeat(24)}`,
    },
    commitments: { resources: [], cleanup: [], credentials: [], runners: { status: "configured", artifacts: [] }, tests: { status: "configured", artifacts: [] }, plans: { status: "configured", artifacts: [] }, endpoints: { status: "configured", artifacts: [] }, runnerRegistryDigest: certificationRunnerRegistryDigest, topology: "absent", signatureStatus: "absent" },
  };
  return { ...base, preflightDigest: preflightForCandidate(base).digest };
}

function preflightForCandidate(value: any): any {
  const body = {
    v: "reelier.certification-preflight/v2", configDigest: value.configDigest, selectionDigest: value.selectionDigest,
    identifiers: value.identifiers, scenarios: value.scenarios, resources: value.commitments.resources, cleanup: value.commitments.cleanup,
    credentialReferences: value.commitments.credentials, inputs: { runners: value.commitments.runners, tests: value.commitments.tests, plans: value.commitments.plans, endpoints: value.commitments.endpoints }, runnerRegistryDigest: value.commitments.runnerRegistryDigest,
    topology: value.commitments.topology, trust: "unchecked", signatureStatus: "absent", authorization: "absent", completeness: "unchecked",
    missing: [], ok: true, preparationReady: true, executionReady: false, dispatchable: false,
  };
  return { ...body, digest: authorityDigest(body) };
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
    preflight: preflightForCandidate(fixture.readiness), humanKeyDescriptor: fixture.humanDescriptor,
    cellKeyDescriptors: [fixture.cellDescriptor],
    trustEvents: fixture.events,
    humanPrivateKey: fixture.human.privateKey,
    authorizedAt: later,
  });
  const verified = verifySignedCertificationReadiness({
    signed,
    readinessCandidate: fixture.readiness, preflight: preflightForCandidate(fixture.readiness),
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

test("readiness activates a distinct purpose-separated delegation-grant Cell key", () => {
  const fixture = validFixture();
  const delegation = generateKeyPairSync("ed25519");
  const descriptor = keyDescriptor("cell_delegation_key", "authority-cell", "delegation-grant", delegation.publicKey);
  const activation = trustEvent(2, "activate", authorityDigest(descriptor), authorityDigest(fixture.events[1]));
  const events = [...fixture.events, activation];
  assert.equal(parseAuthorityKeyDescriptor(descriptor).purpose, "delegation-grant");
  const signed = createSignedCertificationReadiness({ readinessCandidate: fixture.readiness, readinessCandidateDigest: authorityDigest(fixture.readiness), preflight: preflightForCandidate(fixture.readiness), humanKeyDescriptor: fixture.humanDescriptor, cellKeyDescriptors: [fixture.cellDescriptor, descriptor], trustEvents: events, humanPrivateKey: fixture.human.privateKey, authorizedAt: later });
  assert.ok(signed.activatedCellKeyDescriptorDigests.includes(authorityDigest(descriptor)));
  const reused = keyDescriptor("cell_delegation_reused", "authority-cell", "delegation-grant", createPublicKey({ key: Buffer.from(fixture.cellDescriptor.publicKeySpkiBase64, "base64"), format: "der", type: "spki" }));
  assert.throws(() => createSignedCertificationReadiness({ readinessCandidate: fixture.readiness, readinessCandidateDigest: authorityDigest(fixture.readiness), preflight: preflightForCandidate(fixture.readiness), humanKeyDescriptor: fixture.humanDescriptor, cellKeyDescriptors: [fixture.cellDescriptor, reused], trustEvents: events, humanPrivateKey: fixture.human.privateKey, authorizedAt: later }), /SPKI|key material|fingerprint.*unique/i);
});

test("readiness separately activates a purpose-bound human Job Card signer", () => {
  const fixture = validFixture();
  const jobSigner = generateKeyPairSync("ed25519");
  const jobDescriptor = keyDescriptor("human_job_card_signer", "human-sponsor", "signed-job-card", jobSigner.publicKey);
  const jobActivation = trustEvent(2, "activate", authorityDigest(jobDescriptor), authorityDigest(fixture.events[1]));
  const events = [...fixture.events, jobActivation];
  assert.equal(parseAuthorityKeyDescriptor(jobDescriptor).purpose, "signed-job-card");
  const signed = createSignedCertificationReadiness({
    readinessCandidate: fixture.readiness,
    readinessCandidateDigest: authorityDigest(fixture.readiness),
    preflight: preflightForCandidate(fixture.readiness),
    humanKeyDescriptor: fixture.humanDescriptor,
    cellKeyDescriptors: [fixture.cellDescriptor],
    jobCardKeyDescriptors: [jobDescriptor],
    trustEvents: events,
    humanPrivateKey: fixture.human.privateKey,
    authorizedAt: later,
  } as never) as any;
  assert.deepEqual(signed.activatedJobCardKeyDescriptorDigests, [authorityDigest(jobDescriptor)]);
  assert.equal(verifySignedCertificationReadiness({
    signed,
    readinessCandidate: fixture.readiness,
    preflight: preflightForCandidate(fixture.readiness),
    humanTrustRoot: fixture.humanDescriptor,
    keyDescriptors: [fixture.humanDescriptor, jobDescriptor, fixture.cellDescriptor],
    trustEvents: events,
  }).authorization, "verified");
  assert.throws(() => verifySignedCertificationReadiness({
    signed: { ...signed, activatedJobCardKeyDescriptorDigests: [] },
    readinessCandidate: fixture.readiness,
    preflight: preflightForCandidate(fixture.readiness),
    humanTrustRoot: fixture.humanDescriptor,
    keyDescriptors: [fixture.humanDescriptor, jobDescriptor, fixture.cellDescriptor],
    trustEvents: events,
  }), /job.card|signature|descriptor.*link/i);
});

test("offline verification rejects purpose, role, candidate, config, selection, ID, scenario, Cell-key, and trust-history substitution", () => {
  const fixture = validFixture();
  const preflight = preflightForCandidate(fixture.readiness);
  const signed = createSignedCertificationReadiness({ readinessCandidate: fixture.readiness, readinessCandidateDigest: authorityDigest(fixture.readiness), preflight, humanKeyDescriptor: fixture.humanDescriptor, cellKeyDescriptors: [fixture.cellDescriptor], trustEvents: fixture.events, humanPrivateKey: fixture.human.privateKey, authorizedAt: later });
  const verify = (overrides: Record<string, unknown>) => verifySignedCertificationReadiness({ signed, readinessCandidate: fixture.readiness, preflight, humanTrustRoot: fixture.humanDescriptor, keyDescriptors: [fixture.humanDescriptor, fixture.cellDescriptor], trustEvents: fixture.events, ...overrides } as never);
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
  const preflight = preflightForCandidate(fixture.readiness);
  const signed = createSignedCertificationReadiness({ readinessCandidate: fixture.readiness, readinessCandidateDigest: authorityDigest(fixture.readiness), preflight, humanKeyDescriptor: fixture.humanDescriptor, cellKeyDescriptors: [fixture.cellDescriptor], trustEvents: fixture.events, humanPrivateKey: fixture.human.privateKey, authorizedAt: later });
  const verify = (events: readonly any[]) => verifySignedCertificationReadiness({ signed: { ...signed, trustHistoryDigest: authorityDigest(events) }, readinessCandidate: fixture.readiness, preflight, humanTrustRoot: fixture.humanDescriptor, keyDescriptors: [fixture.humanDescriptor, fixture.cellDescriptor], trustEvents: events });
  assert.throws(() => verify([fixture.events[0]]), /cell.*active|descriptor.*active/i);
  const revoked = trustEvent(2, "revoke", authorityDigest(fixture.cellDescriptor), authorityDigest(fixture.events[1]), later);
  assert.throws(() => verify([...fixture.events, revoked]), /revoked|active/i);
  const late = trustEvent(1, "activate", authorityDigest(fixture.cellDescriptor), authorityDigest(fixture.events[0]), "2026-08-11T20:02:00.000Z");
  assert.throws(() => verify([fixture.events[0], late]), /activated after|late|authorized|active/i);
  assert.throws(() => verify([{ ...fixture.events[0], sequence: 1 }, fixture.events[1]]), /sequence/i);
  assert.throws(() => verify([fixture.events[0], { ...fixture.events[1], eventId: fixture.events[0].eventId }]), /event.*unique|duplicate/i);
});

test("offline verification refuses ambiguous or duplicate descriptor sets", () => {
  const fixture = validFixture();
  const preflight = preflightForCandidate(fixture.readiness);
  const signed = createSignedCertificationReadiness({ readinessCandidate: fixture.readiness, readinessCandidateDigest: authorityDigest(fixture.readiness), preflight, humanKeyDescriptor: fixture.humanDescriptor, cellKeyDescriptors: [fixture.cellDescriptor], trustEvents: fixture.events, humanPrivateKey: fixture.human.privateKey, authorizedAt: later });
  assert.throws(() => verifySignedCertificationReadiness({ signed, readinessCandidate: fixture.readiness, preflight, humanTrustRoot: fixture.humanDescriptor, keyDescriptors: [fixture.humanDescriptor, fixture.humanDescriptor, fixture.cellDescriptor], trustEvents: fixture.events }), /descriptor.*unique|human.*exactly one/i);
});

test("canonical signatures reject alternate text and byte encodings for the same or a different digest identity", () => {
  const fixture = validFixture();
  const preflight = preflightForCandidate(fixture.readiness);
  const signed = createSignedCertificationReadiness({ readinessCandidate: fixture.readiness, readinessCandidateDigest: authorityDigest(fixture.readiness), preflight, humanKeyDescriptor: fixture.humanDescriptor, cellKeyDescriptors: [fixture.cellDescriptor], trustEvents: fixture.events, humanPrivateKey: fixture.human.privateKey, authorizedAt: later });
  const verify = (sig: string) => verifySignedCertificationReadiness({ signed: { ...signed, signature: { alg: "ed25519", sig } }, readinessCandidate: fixture.readiness, preflight, humanTrustRoot: fixture.humanDescriptor, keyDescriptors: [fixture.humanDescriptor, fixture.cellDescriptor], trustEvents: fixture.events });
  const bytes = Buffer.from(signed.signature.sig, "base64");
  assert.equal(bytes.length, 64);
  for (const mutation of [
    `${signed.signature.sig}\n`,
    `${signed.signature.sig}junk`,
    signed.signature.sig.replace(/==$/, ""),
    `${signed.signature.sig}=`,
    Buffer.concat([bytes, Buffer.from([0])]).toString("base64"),
  ]) assert.throws(() => verify(mutation), /canonical|signature|64 bytes/i);
  const identities = new Set([signed.signature.sig, `${signed.signature.sig}\n`, `${signed.signature.sig}junk`, signed.signature.sig.replace(/==$/, "")].map(sig => authorityDigest({ ...signed, signature: { alg: "ed25519", sig } })));
  assert.equal(identities.size, 4, "textually distinct signatures would create multiple artifact digests unless canonical form is enforced");
});

test("the shared readiness parser deeply validates commitments and their preflight link", () => {
  const fixture = validFixture();
  const preflight = preflightForCandidate(fixture.readiness);
  assert.deepEqual(parseCertificationReadinessCandidate(fixture.readiness, preflight), fixture.readiness);
  assert.throws(() => parseCertificationReadinessCandidate({ ...fixture.readiness, commitments: { malicious: true } }, preflight), /commitments.*closed|commitment/i);
  const { topology: _omitted, ...omitted } = fixture.readiness.commitments;
  assert.throws(() => parseCertificationReadinessCandidate({ ...fixture.readiness, commitments: omitted }, preflight), /commitments.*closed|commitment/i);
  assert.throws(() => parseCertificationReadinessCandidate({ ...fixture.readiness, commitments: { ...fixture.readiness.commitments, extra: true } }, preflight), /commitments.*closed|commitment/i);
  assert.throws(() => parseCertificationReadinessCandidate({ ...fixture.readiness, commitments: { ...fixture.readiness.commitments, topology: "configured" } }, preflight), /preflight.*link|commitment/i);
  assert.throws(() => parseCertificationReadinessCandidate({ ...fixture.readiness, preflightDigest: `sha256:${"9".repeat(64)}` }, preflight), /preflight.*link|digest/i);
  assert.throws(() => parseCertificationReadinessCandidate(fixture.readiness, { ...preflight, digest: `sha256:${"8".repeat(64)}` }), /preflight.*digest|link/i);
});

test("human and Cell roles and Cell purposes cannot reuse one canonical SPKI key", () => {
  const fixture = validFixture();
  const reused = keyDescriptor("cell_reused_key", "authority-cell", "authority-receipt", fixture.human.publicKey);
  const first = trustEvent(0, "activate", authorityDigest(fixture.humanDescriptor), null);
  const second = trustEvent(1, "activate", authorityDigest(reused), authorityDigest(first));
  assert.throws(() => createSignedCertificationReadiness({ readinessCandidate: fixture.readiness, readinessCandidateDigest: authorityDigest(fixture.readiness), preflight: preflightForCandidate(fixture.readiness), humanKeyDescriptor: fixture.humanDescriptor, cellKeyDescriptors: [reused], trustEvents: [first, second], humanPrivateKey: fixture.human.privateKey, authorizedAt: later }), /SPKI|key material|fingerprint.*unique/i);
  const sameCellKey = keyDescriptor("cell_evidence_key", "authority-cell", "authority-evidence", createPublicKey({ key: Buffer.from(fixture.cellDescriptor.publicKeySpkiBase64, "base64"), format: "der", type: "spki" }));
  assert.throws(() => createSignedCertificationReadiness({ readinessCandidate: fixture.readiness, readinessCandidateDigest: authorityDigest(fixture.readiness), preflight: preflightForCandidate(fixture.readiness), humanKeyDescriptor: fixture.humanDescriptor, cellKeyDescriptors: [fixture.cellDescriptor, sameCellKey], trustEvents: fixture.events, humanPrivateKey: fixture.human.privateKey, authorizedAt: later }), /SPKI|key material|fingerprint.*unique/i);
});

test("signing refuses a private key that does not match the pre-existing human descriptor", () => {
  const fixture = validFixture();
  const wrong = generateKeyPairSync("ed25519");
  assert.throws(() => createSignedCertificationReadiness({ readinessCandidate: fixture.readiness, readinessCandidateDigest: authorityDigest(fixture.readiness), preflight: preflightForCandidate(fixture.readiness), humanKeyDescriptor: fixture.humanDescriptor, cellKeyDescriptors: [fixture.cellDescriptor], trustEvents: fixture.events, humanPrivateKey: createPrivateKey(wrong.privateKey.export({ type: "pkcs8", format: "pem" })), authorizedAt: later }), /private key.*descriptor|signer/i);
  assert.doesNotThrow(() => createPublicKey({ key: Buffer.from(fixture.humanDescriptor.publicKeySpkiBase64, "base64"), format: "der", type: "spki" }));
});

test("portable authority key, trust event, and signed readiness schemas are closed", async () => {
  const Ajv2020 = createRequire(import.meta.url)("ajv/dist/2020").default;
  const ajv = new Ajv2020({ strict: true });
  const fixture = validFixture();
  const signed = createSignedCertificationReadiness({ readinessCandidate: fixture.readiness, readinessCandidateDigest: authorityDigest(fixture.readiness), preflight: preflightForCandidate(fixture.readiness), humanKeyDescriptor: fixture.humanDescriptor, cellKeyDescriptors: [fixture.cellDescriptor], trustEvents: fixture.events, humanPrivateKey: fixture.human.privateKey, authorizedAt: later });
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

test("file signing consumes an existing human key and confined Task2C2 candidate without persisting private material", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-authorize-"));
  const configPath = path.join(root, "certification.local.json");
  await writeFile(configPath, JSON.stringify({
    v: "reelier.certification-operator-config/v2", authorityConfigPath: "authority/authority.yml", evidenceDirectory: "authority/receipts/certification",
    scenarios: ["github-issue-labels"], resources: { "github-issue-labels": { apiBaseUrl: "https://api.github.com", owner: "fixlyai", repository: "reelier-certification", issueNumber: 1 } },
    cleanup: { "github-issue-labels": ["restore-github-labels"] }, metadata: {}, secretReferences: { githubCredential: "env:REELIER_GITHUB_TOKEN" },
  }), "utf8");
  const initialized = await initializeCertification({ configPath });
  await writeCertificationInputManifests(initialized.workspace, ["github-issue-labels"]);
  const aliasedWorkspace = process.platform === "win32" ? initialized.workspace.toUpperCase() : initialized.workspace;
  const sealed = await sealCertificationReadiness({ workspace: aliasedWorkspace, scenario: "github-issue-labels" });
  assert.equal(path.dirname(path.dirname(sealed.path)), await realpath(initialized.workspace), "sealed artifacts return the canonical confined workspace path");
  const human = generateKeyPairSync("ed25519");
  const cell = generateKeyPairSync("ed25519");
  const humanDescriptor = keyDescriptor(sealed.candidate.identifiers.signerId, "human-sponsor", "certification-readiness", human.publicKey);
  const cellDescriptor = keyDescriptor("cell_receipt_key", "authority-cell", "authority-receipt", cell.publicKey);
  const first = trustEvent(0, "activate", authorityDigest(humanDescriptor), null);
  const second = trustEvent(1, "activate", authorityDigest(cellDescriptor), authorityDigest(first));
  const events = [first, second];
  const descriptorsPath = path.join(root, "descriptors.json");
  const eventsPath = path.join(root, "events.json");
  const keyPath = path.join(root, "human.pem");
  await writeFile(descriptorsPath, JSON.stringify([humanDescriptor, cellDescriptor]));
  await writeFile(eventsPath, JSON.stringify(events));
  await writeFile(keyPath, human.privateKey.export({ type: "pkcs8", format: "pem" }));
  let reviewed: any;
  const sign = () => signCertificationReadinessArtifact({ workspace: initialized.workspace, candidatePath: sealed.path, privateKeyPath: keyPath, descriptorsPath, trustEventsPath: eventsPath, authorizedAt: later, confirm: async summary => { reviewed = summary; return true; } });
  const result = await sign();
  assert.equal(result.signed.dispatchable, false);
  assert.equal(reviewed.readinessCandidateDigest, sealed.digest);
  assert.deepEqual(reviewed.scenarios, sealed.candidate.scenarios);
  assert.deepEqual(reviewed.commitments, sealed.candidate.commitments);
  assert.deepEqual(reviewed.cellKeys, [{ keyId: cellDescriptor.keyId, purpose: cellDescriptor.purpose, descriptorDigest: authorityDigest(cellDescriptor) }]);
  assert.doesNotMatch(JSON.stringify(reviewed), /REELIER_GITHUB_TOKEN|certification\.local\.json|PRIVATE KEY/i);
  assert.match(path.basename(result.path), /^signed-readiness-sha256-[0-9a-f]{64}\.json$/);
  const persisted = await readFile(result.path, "utf8");
  assert.doesNotMatch(persisted, /PRIVATE KEY|BEGIN PRIVATE|MC4CAQ/);
  assert.equal((await sign()).digest, result.digest, "an identical existing publication remains idempotent");
  await chmod(result.path, 0o600);
  await writeFile(result.path, "conflicting publication\n", "utf8");
  await assert.rejects(sign, /publication.*conflict|existing bytes|JSON/i);
  await unlink(result.path);
  const replacement = path.join(root, "replacement.json");
  await writeFile(replacement, `${JSON.stringify(result.signed)}\n`, "utf8");
  await link(replacement, result.path);
  await assert.rejects(sign, /linked|replacement|publication.*conflict/i);
  await assert.rejects(() => signCertificationReadinessArtifact({ workspace: initialized.workspace, candidatePath: sealed.path, privateKeyPath: keyPath, descriptorsPath, trustEventsPath: eventsPath, authorizedAt: later, confirm: undefined as never }), /interactive.*confirmation|required/i);
});
