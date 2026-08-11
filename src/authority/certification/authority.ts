import { createHash, createPublicKey, type KeyObject } from "node:crypto";
import { createPrivateKey } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { signAuthorityDigest, verifyAuthoritySignature } from "../crypto.js";
import type { AuthoritySignature } from "../types.js";
import { authorityDigest } from "../wire.js";
import type { CertificationIdentifiers } from "./initializer.js";
import { parseCertificationReadinessCandidate, type CertificationReadinessCandidate } from "./readiness.js";
import { preflightCertification, type CertificationPreflightV2 } from "./preflight.js";
import { CERTIFICATION_SCENARIO_IDS, type CertificationScenarioId } from "./scenarios.js";
import { certificationWorkspaceRoot, confinedExistingDirectory, publishPrivateContentAddressed, readConfinedFile, readUnlinkedFile } from "./filesystem.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const KEY_ID = /^[a-z][a-z0-9_-]{2,127}$/;
const EVENT_ID = /^[a-z][a-z0-9_-]{2,127}$/;
const HUMAN_PURPOSE = "certification-readiness" as const;
const CELL_PURPOSES = ["authority-evidence", "authority-lease", "authority-receipt", "gate-event", "topology-evidence"] as const;
type CellPurpose = (typeof CELL_PURPOSES)[number];

export type AuthorityKeyDescriptorV1 = Readonly<{
  v: "reelier.authority-key-descriptor/v1";
  keyId: string;
  role: "human-sponsor" | "authority-cell";
  purpose: typeof HUMAN_PURPOSE | CellPurpose;
  algorithm: "ed25519";
  publicKeySpkiBase64: string;
}>;

export type TrustEventV1 = Readonly<{
  v: "reelier.authority-trust-event/v1";
  eventId: string;
  sequence: number;
  action: "activate" | "revoke";
  keyDescriptorDigest: string;
  occurredAt: string;
  previousEventDigest: string | null;
}>;

export type SignedCertificationReadinessV1 = Readonly<{
  v: "reelier.signed-certification-readiness/v1";
  purpose: typeof HUMAN_PURPOSE;
  signerRole: "human-sponsor";
  signerKeyId: string;
  signerKeyDescriptorDigest: string;
  readinessCandidateDigest: string;
  configurationRoot: string;
  selectionDigest: string;
  identifiers: CertificationIdentifiers;
  scenarios: readonly CertificationScenarioId[];
  activatedCellKeyDescriptorDigests: readonly string[];
  trustHistoryDigest: string;
  authorizedAt: string;
  authorization: "human-signed";
  dispatchable: false;
  completeness: "unchecked";
  signature: AuthoritySignature;
}>;

export function parseAuthorityKeyDescriptor(value: unknown): AuthorityKeyDescriptorV1 {
  const raw = object(value, "authority key descriptor");
  closed(raw, ["v", "keyId", "role", "purpose", "algorithm", "publicKeySpkiBase64"], "authority key descriptor");
  if (raw.v !== "reelier.authority-key-descriptor/v1" || typeof raw.keyId !== "string" || !KEY_ID.test(raw.keyId) || raw.algorithm !== "ed25519" || typeof raw.publicKeySpkiBase64 !== "string") throw new TypeError("authority key descriptor is invalid");
  if (raw.role === "human-sponsor") {
    if (raw.purpose !== HUMAN_PURPOSE) throw new TypeError("human-sponsor role and purpose are incompatible");
  } else if (raw.role === "authority-cell") {
    if (typeof raw.purpose !== "string" || !(CELL_PURPOSES as readonly string[]).includes(raw.purpose)) throw new TypeError("authority-cell role and purpose are incompatible");
  } else throw new TypeError("authority key descriptor role is invalid");
  publicKey(raw.publicKeySpkiBase64);
  return Object.freeze({ v: raw.v, keyId: raw.keyId, role: raw.role, purpose: raw.purpose, algorithm: raw.algorithm, publicKeySpkiBase64: raw.publicKeySpkiBase64 }) as AuthorityKeyDescriptorV1;
}

export function parseTrustEvents(value: unknown, descriptors: readonly AuthorityKeyDescriptorV1[]): readonly TrustEventV1[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError("authority trust history must be a non-empty array");
  const known = new Set(descriptors.map(descriptor => authorityDigest(parseAuthorityKeyDescriptor(descriptor))));
  const states = new Map<string, "active" | "revoked">();
  const eventIds = new Set<string>();
  const events: TrustEventV1[] = [];
  let previousDigest: string | null = null;
  let previousTime = -Infinity;
  for (let index = 0; index < value.length; index += 1) {
    const raw = object(value[index], "authority trust event");
    closed(raw, ["v", "eventId", "sequence", "action", "keyDescriptorDigest", "occurredAt", "previousEventDigest"], "authority trust event");
    if (raw.v !== "reelier.authority-trust-event/v1" || typeof raw.eventId !== "string" || !EVENT_ID.test(raw.eventId) || eventIds.has(raw.eventId) || raw.sequence !== index || (raw.action !== "activate" && raw.action !== "revoke") || typeof raw.keyDescriptorDigest !== "string" || !DIGEST.test(raw.keyDescriptorDigest) || !known.has(raw.keyDescriptorDigest) || raw.previousEventDigest !== previousDigest) throw new TypeError("authority trust event IDs must be unique and its sequence, descriptor, and previous-event chain must be valid");
    eventIds.add(raw.eventId);
    const occurredAt = timestamp(raw.occurredAt, "authority trust event occurredAt");
    const time = Date.parse(occurredAt);
    if (time < previousTime) throw new TypeError("authority trust event ordering is invalid");
    const current = states.get(raw.keyDescriptorDigest);
    if (raw.action === "activate" && current !== undefined) throw new TypeError("authority trust descriptor cannot be activated twice");
    if (raw.action === "revoke" && current !== "active") throw new TypeError("authority trust descriptor cannot be revoked before activation");
    states.set(raw.keyDescriptorDigest, raw.action === "activate" ? "active" : "revoked");
    const event = Object.freeze({ v: raw.v, eventId: raw.eventId, sequence: raw.sequence, action: raw.action, keyDescriptorDigest: raw.keyDescriptorDigest, occurredAt, previousEventDigest: raw.previousEventDigest }) as TrustEventV1;
    events.push(event);
    previousDigest = authorityDigest(event);
    previousTime = time;
  }
  return Object.freeze(events);
}

export function createSignedCertificationReadiness(input: Readonly<{
  readinessCandidate: CertificationReadinessCandidate;
  readinessCandidateDigest: string;
  preflight: CertificationPreflightV2;
  humanKeyDescriptor: AuthorityKeyDescriptorV1;
  cellKeyDescriptors: readonly AuthorityKeyDescriptorV1[];
  trustEvents: readonly TrustEventV1[];
  humanPrivateKey: KeyObject;
  authorizedAt: string;
}>): SignedCertificationReadinessV1 {
  const candidate = parseCertificationReadinessCandidate(input.readinessCandidate, input.preflight);
  const candidateDigest = digest(input.readinessCandidateDigest, "readiness candidate digest");
  if (authorityDigest(candidate) !== candidateDigest) throw new TypeError("readiness candidate digest link is invalid");
  const human = parseAuthorityKeyDescriptor(input.humanKeyDescriptor);
  if (human.role !== "human-sponsor" || human.purpose !== HUMAN_PURPOSE || human.keyId !== candidate.identifiers.signerId) throw new TypeError("human signer descriptor does not match the readiness signer");
  const cells = parseCellDescriptors(input.cellKeyDescriptors);
  const descriptors = Object.freeze([human, ...cells]);
  assertUniqueDescriptorKeys(descriptors);
  const events = parseTrustEvents(input.trustEvents, descriptors);
  const authorizedAt = timestamp(input.authorizedAt, "certification authorization time");
  assertActiveAtAuthorization(human, cells, events, authorizedAt);
  const body = Object.freeze({
    v: "reelier.signed-certification-readiness/v1" as const,
    purpose: HUMAN_PURPOSE,
    signerRole: "human-sponsor" as const,
    signerKeyId: human.keyId,
    signerKeyDescriptorDigest: authorityDigest(human),
    readinessCandidateDigest: candidateDigest,
    configurationRoot: candidate.configDigest,
    selectionDigest: candidate.selectionDigest,
    identifiers: candidate.identifiers,
    scenarios: candidate.scenarios,
    activatedCellKeyDescriptorDigests: Object.freeze(cells.map(authorityDigest).sort()),
    trustHistoryDigest: authorityDigest(events),
    authorizedAt,
    authorization: "human-signed" as const,
    dispatchable: false as const,
    completeness: "unchecked" as const,
  });
  const bodyDigest = authorityDigest(body);
  const signature = signAuthorityDigest(input.humanPrivateKey, HUMAN_PURPOSE, bodyDigest);
  if (!verifyAuthoritySignature(publicKey(human.publicKeySpkiBase64), HUMAN_PURPOSE, bodyDigest, signature)) throw new TypeError("human private key does not match the pre-existing signer descriptor");
  return Object.freeze({ ...body, signature });
}

export function verifySignedCertificationReadiness(input: Readonly<{
  signed: unknown;
  readinessCandidate: unknown;
  preflight: unknown;
  humanTrustRoot: unknown;
  keyDescriptors: readonly unknown[];
  trustEvents: readonly unknown[];
}>): Readonly<{ authorization: "verified"; dispatchable: false; completeness: "unchecked"; digest: string }> {
  const candidate = parseCertificationReadinessCandidate(input.readinessCandidate, input.preflight);
  const humanRoot = parseAuthorityKeyDescriptor(input.humanTrustRoot);
  const descriptors = Object.freeze(input.keyDescriptors.map(parseAuthorityKeyDescriptor));
  const descriptorIds = descriptors.map(descriptor => descriptor.keyId);
  const descriptorDigests = descriptors.map(authorityDigest);
  if (new Set(descriptorIds).size !== descriptorIds.length || new Set(descriptorDigests).size !== descriptorDigests.length || descriptors.filter(descriptor => descriptor.role === "human-sponsor").length !== 1) throw new TypeError("authority key descriptors must be unique and contain exactly one human signer");
  assertUniqueDescriptorKeys(descriptors);
  const human = descriptors.find(descriptor => descriptor.keyId === humanRoot.keyId);
  if (!human || authorityDigest(human) !== authorityDigest(humanRoot) || human.role !== "human-sponsor" || human.purpose !== HUMAN_PURPOSE) throw new TypeError("human trust root or signer role is invalid");
  const cells = parseCellDescriptors(descriptors.filter(descriptor => descriptor.role === "authority-cell"));
  const events = parseTrustEvents(input.trustEvents, descriptors);
  const signed = parseSignedCertificationReadiness(input.signed);
  assertActiveAtAuthorization(human, cells, events, signed.authorizedAt);
  if (signed.purpose !== HUMAN_PURPOSE || signed.signerRole !== "human-sponsor" || signed.signerKeyId !== human.keyId || signed.signerKeyDescriptorDigest !== authorityDigest(human)) throw new TypeError("signed readiness signer purpose or role link is invalid");
  if (signed.readinessCandidateDigest !== authorityDigest(candidate) || signed.configurationRoot !== candidate.configDigest || signed.selectionDigest !== candidate.selectionDigest || authorityDigest(signed.identifiers) !== authorityDigest(candidate.identifiers) || authorityDigest(signed.scenarios) !== authorityDigest(candidate.scenarios)) throw new TypeError("signed readiness candidate, configuration, selection, identifier, or scenario link is invalid");
  if (authorityDigest(signed.activatedCellKeyDescriptorDigests) !== authorityDigest(cells.map(authorityDigest).sort())) throw new TypeError("signed readiness activated Cell key link is invalid");
  if (signed.trustHistoryDigest !== authorityDigest(events)) throw new TypeError("signed readiness trust history link is invalid");
  const { signature, ...body } = signed;
  const bodyDigest = authorityDigest(body);
  if (!verifyAuthoritySignature(publicKey(human.publicKeySpkiBase64), HUMAN_PURPOSE, bodyDigest, signature)) throw new TypeError("signed readiness signature is invalid");
  return Object.freeze({ authorization: "verified", dispatchable: false, completeness: "unchecked", digest: authorityDigest(signed) });
}

export function parseSignedCertificationReadiness(value: unknown): SignedCertificationReadinessV1 {
  const raw = object(value, "signed certification readiness");
  closed(raw, ["v", "purpose", "signerRole", "signerKeyId", "signerKeyDescriptorDigest", "readinessCandidateDigest", "configurationRoot", "selectionDigest", "identifiers", "scenarios", "activatedCellKeyDescriptorDigests", "trustHistoryDigest", "authorizedAt", "authorization", "dispatchable", "completeness", "signature"], "signed certification readiness");
  if (raw.v !== "reelier.signed-certification-readiness/v1" || raw.purpose !== HUMAN_PURPOSE || raw.signerRole !== "human-sponsor" || typeof raw.signerKeyId !== "string" || !KEY_ID.test(raw.signerKeyId) || raw.authorization !== "human-signed" || raw.dispatchable !== false || raw.completeness !== "unchecked") throw new TypeError("signed certification readiness purpose, role, or claims are invalid");
  const signatureRaw = object(raw.signature, "signed certification readiness signature");
  closed(signatureRaw, ["alg", "sig"], "signed certification readiness signature");
  if (signatureRaw.alg !== "ed25519" || typeof signatureRaw.sig !== "string") throw new TypeError("signed certification readiness signature is invalid");
  const canonicalSignature = parseCanonicalSignature(signatureRaw.sig);
  return Object.freeze({
    v: raw.v, purpose: raw.purpose, signerRole: raw.signerRole, signerKeyId: raw.signerKeyId,
    signerKeyDescriptorDigest: digest(raw.signerKeyDescriptorDigest, "signer descriptor digest"), readinessCandidateDigest: digest(raw.readinessCandidateDigest, "readiness candidate digest"), configurationRoot: digest(raw.configurationRoot, "configuration root"), selectionDigest: digest(raw.selectionDigest, "selection digest"), identifiers: parseIdentifiers(raw.identifiers), scenarios: scenarioList(raw.scenarios), activatedCellKeyDescriptorDigests: digestList(raw.activatedCellKeyDescriptorDigests, "activated Cell key descriptors"), trustHistoryDigest: digest(raw.trustHistoryDigest, "trust history digest"), authorizedAt: timestamp(raw.authorizedAt, "certification authorization time"), authorization: raw.authorization, dispatchable: false, completeness: raw.completeness, signature: Object.freeze({ alg: signatureRaw.alg, sig: canonicalSignature }),
  });
}

export async function signCertificationReadinessArtifact(input: Readonly<{
  workspace: string;
  candidatePath: string;
  privateKeyPath: string;
  descriptorsPath: string;
  trustEventsPath: string;
  authorizedAt: string;
  confirm: (summary: Readonly<{
    readinessCandidateDigest: string;
    configurationRoot: string;
    selectionDigest: string;
    identifiers: CertificationIdentifiers;
    scenarios: readonly CertificationScenarioId[];
    commitments: CertificationReadinessCandidate["commitments"];
    cellKeys: readonly Readonly<{ keyId: string; purpose: CellPurpose; descriptorDigest: string }>[];
    trustHistoryDigest: string;
    dispatchable: false;
  }>) => Promise<boolean>;
}>): Promise<Readonly<{ signed: SignedCertificationReadinessV1; digest: string; path: string }>> {
  if (typeof input.confirm !== "function") throw new TypeError("interactive human confirmation is required before readiness signing");
  const root = await certificationWorkspaceRoot(path.resolve(input.workspace));
  const readinessDirectory = await confinedExistingDirectory(root, ["readiness"]);
  if (!readinessDirectory) throw new TypeError("certification readiness candidate directory is absent");
  const candidatePath = path.resolve(input.candidatePath);
  if (path.dirname(candidatePath) !== readinessDirectory || !/^readiness-sha256-[0-9a-f]{64}\.json$/.test(path.basename(candidatePath))) throw new TypeError("certification readiness candidate is not a confined Task2C2 artifact");
  const candidateValue = JSON.parse((await readConfinedFile(root, readinessDirectory, path.basename(candidatePath))).toString("utf8"));
  const rawCandidate = object(candidateValue, "certification readiness candidate");
  const selectedScenarios = scenarioList(rawCandidate.scenarios);
  const preflight = await preflightCertification({ workspace: root, ...(selectedScenarios.length === 1 ? { scenario: selectedScenarios[0] } : { all: true }) });
  const candidate = parseCertificationReadinessCandidate(candidateValue, preflight);
  const candidateDigest = authorityDigest(candidate);
  if (path.basename(candidatePath) !== `readiness-${candidateDigest.replace(":", "-")}.json`) throw new TypeError("certification readiness candidate filename digest is invalid");
  const descriptorsValue = JSON.parse((await readUnlinkedFile(input.descriptorsPath)).toString("utf8"));
  if (!Array.isArray(descriptorsValue)) throw new TypeError("authority key descriptors file must contain an array");
  const descriptors = descriptorsValue.map(parseAuthorityKeyDescriptor);
  const descriptorIds = descriptors.map(descriptor => descriptor.keyId);
  const descriptorDigests = descriptors.map(authorityDigest);
  if (new Set(descriptorIds).size !== descriptorIds.length || new Set(descriptorDigests).size !== descriptorDigests.length || descriptors.filter(descriptor => descriptor.role === "human-sponsor").length !== 1) throw new TypeError("authority key descriptors must be unique and contain exactly one human signer");
  assertUniqueDescriptorKeys(descriptors);
  const human = descriptors.find(descriptor => descriptor.role === "human-sponsor" && descriptor.keyId === candidate.identifiers.signerId);
  if (!human) throw new TypeError("pre-existing human signer descriptor is absent");
  const cells = descriptors.filter(descriptor => descriptor.role === "authority-cell");
  const trustEvents = parseTrustEvents(JSON.parse((await readUnlinkedFile(input.trustEventsPath)).toString("utf8")), descriptors);
  const parsedCells = parseCellDescriptors(cells);
  const review = Object.freeze({
    readinessCandidateDigest: candidateDigest,
    configurationRoot: candidate.configDigest,
    selectionDigest: candidate.selectionDigest,
    identifiers: candidate.identifiers,
    scenarios: candidate.scenarios,
    commitments: candidate.commitments,
    cellKeys: Object.freeze(parsedCells.map(descriptor => Object.freeze({ keyId: descriptor.keyId, purpose: descriptor.purpose as CellPurpose, descriptorDigest: authorityDigest(descriptor) })).sort((left, right) => left.descriptorDigest.localeCompare(right.descriptorDigest))),
    trustHistoryDigest: authorityDigest(trustEvents),
    dispatchable: false as const,
  });
  if (await input.confirm(review) !== true) throw new TypeError("human confirmation refused readiness signing");
  const privateKey = createPrivateKey(await readUnlinkedFile(input.privateKeyPath));
  if (privateKey.asymmetricKeyType !== "ed25519") throw new TypeError("human signing key must be Ed25519");
  const signed = createSignedCertificationReadiness({ readinessCandidate: candidate, readinessCandidateDigest: candidateDigest, preflight, humanKeyDescriptor: human, cellKeyDescriptors: parsedCells, trustEvents, humanPrivateKey: privateKey, authorizedAt: input.authorizedAt });
  const signedDigest = authorityDigest(signed);
  const filename = `signed-readiness-${signedDigest.replace(":", "-")}.json`;
  const content = `${JSON.stringify(signed)}\n`;
  const output = await publishPrivateContentAddressed(root, "authorizations", filename, content);
  const publishedInfo = await lstat(output);
  if (!publishedInfo.isFile() || publishedInfo.isSymbolicLink() || publishedInfo.nlink !== 1) throw new TypeError("immutable signed readiness publication is linked or replaced");
  const authorizationDirectory = await confinedExistingDirectory(root, ["authorizations"]);
  if (!authorizationDirectory) throw new TypeError("certification authorization directory is absent after publication");
  const persisted = await readConfinedFile(root, authorizationDirectory, filename);
  if (!persisted.equals(Buffer.from(content, "utf8"))) throw new TypeError("immutable signed readiness publication conflicts with existing bytes");
  const persistedSigned = parseSignedCertificationReadiness(JSON.parse(persisted.toString("utf8")));
  if (authorityDigest(persistedSigned) !== signedDigest || JSON.stringify(persistedSigned) !== JSON.stringify(signed)) throw new TypeError("immutable signed readiness publication digest or identity mismatch");
  return Object.freeze({ signed, digest: signedDigest, path: output });
}

function parseCellDescriptors(values: readonly unknown[]): readonly AuthorityKeyDescriptorV1[] {
  if (values.length === 0) throw new TypeError("at least one activated authority-cell key descriptor is required");
  const cells = values.map(parseAuthorityKeyDescriptor);
  if (cells.some(descriptor => descriptor.role !== "authority-cell" || descriptor.purpose === HUMAN_PURPOSE)) throw new TypeError("Cell key descriptor role or purpose is invalid");
  const ids = cells.map(descriptor => descriptor.keyId);
  const purposes = cells.map(descriptor => descriptor.purpose);
  if (new Set(ids).size !== ids.length || new Set(purposes).size !== purposes.length) throw new TypeError("Cell key descriptors must have unique key IDs and purposes");
  return Object.freeze([...cells].sort((left, right) => authorityDigest(left).localeCompare(authorityDigest(right))));
}

function assertActiveAtAuthorization(human: AuthorityKeyDescriptorV1, cells: readonly AuthorityKeyDescriptorV1[], events: readonly TrustEventV1[], authorizedAt: string): void {
  const authorizationTime = Date.parse(authorizedAt);
  for (const descriptor of [human, ...cells]) {
    const descriptorDigest = authorityDigest(descriptor);
    const lifecycle = events.filter(event => event.keyDescriptorDigest === descriptorDigest);
    const activation = lifecycle.find(event => event.action === "activate");
    if (!activation) throw new TypeError(`${descriptor.role} descriptor is not active`);
    if (Date.parse(activation.occurredAt) > authorizationTime) throw new TypeError(`${descriptor.role} descriptor was activated after the authorization time`);
    if (lifecycle.some(event => event.action === "revoke")) throw new TypeError(`${descriptor.role} descriptor is revoked and not active`);
  }
}

function parseIdentifiers(value: unknown): CertificationIdentifiers {
  const raw = object(value, "certification identifiers");
  closed(raw, ["taskId", "jobCardId", "rootGrantId", "authorityCellId", "signerId"], "certification identifiers");
  const patterns: Record<keyof CertificationIdentifiers, RegExp> = { taskId: /^task_[0-9a-f]{24}$/, jobCardId: /^job_[0-9a-f]{24}$/, rootGrantId: /^grant_[0-9a-f]{24}$/, authorityCellId: /^cell_[0-9a-f]{24}$/, signerId: /^signer_[0-9a-f]{24}$/ };
  for (const [key, pattern] of Object.entries(patterns) as [keyof CertificationIdentifiers, RegExp][]) if (typeof raw[key] !== "string" || !pattern.test(raw[key] as string)) throw new TypeError("certification identifier is invalid");
  return Object.freeze({ taskId: raw.taskId, jobCardId: raw.jobCardId, rootGrantId: raw.rootGrantId, authorityCellId: raw.authorityCellId, signerId: raw.signerId }) as CertificationIdentifiers;
}

function scenarioList(value: unknown): readonly CertificationScenarioId[] {
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== "string" || !(CERTIFICATION_SCENARIO_IDS as readonly string[]).includes(item))) throw new TypeError("certification scenarios are invalid");
  const result = value as CertificationScenarioId[];
  if (new Set(result).size !== result.length || result.some((item, index) => index > 0 && result[index - 1] >= item)) throw new TypeError("certification scenarios must be unique and sorted");
  return Object.freeze([...result]);
}

function digestList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} are invalid`);
  const values = value.map(item => digest(item, label));
  if (new Set(values).size !== values.length || values.some((item, index) => index > 0 && values[index - 1] >= item)) throw new TypeError(`${label} must be unique and sorted`);
  return Object.freeze(values);
}

function publicKey(base64: string): KeyObject {
  let bytes: Buffer;
  try { bytes = Buffer.from(base64, "base64"); } catch { throw new TypeError("authority public key is invalid"); }
  if (!bytes.length || bytes.toString("base64") !== base64) throw new TypeError("authority public key is invalid");
  try { const key = createPublicKey({ key: bytes, format: "der", type: "spki" }); if (key.asymmetricKeyType !== "ed25519") throw new TypeError(); return key; } catch { throw new TypeError("authority public key is not an Ed25519 SPKI key"); }
}
function assertUniqueDescriptorKeys(descriptors: readonly AuthorityKeyDescriptorV1[]): void {
  const fingerprints = descriptors.map(descriptor => `sha256:${createHash("sha256").update(publicKey(descriptor.publicKeySpkiBase64).export({ type: "spki", format: "der" })).digest("hex")}`);
  if (new Set(fingerprints).size !== fingerprints.length) throw new TypeError("authority descriptor SPKI key-material fingerprints must be unique across roles and purposes");
}
function parseCanonicalSignature(value: string): string { if (!/^[A-Za-z0-9+/]{86}==$/.test(value)) throw new TypeError("signed certification readiness signature must be canonical Base64"); const bytes = Buffer.from(value, "base64"); if (bytes.length !== 64 || bytes.toString("base64") !== value) throw new TypeError("signed certification readiness signature must decode to exactly 64 bytes"); return value; }
function digest(value: unknown, label: string): string { if (typeof value !== "string" || !DIGEST.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function timestamp(value: unknown, label: string): string { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) throw new TypeError(`${label} is invalid`); return value; }
function object(value: unknown, label: string): Record<string, any> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Record<string, any>; }
function closed(raw: Record<string, unknown>, keys: readonly string[], label: string): void { if (Object.keys(raw).length !== keys.length || Object.keys(raw).some(key => !keys.includes(key))) throw new TypeError(`${label} is closed`); }
