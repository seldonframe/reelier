import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  AGENT_MANDATE_CONTRACT_V1,
  AGENT_MANDATE_CONTRACT_V1_DIGEST,
  deriveMandatedMissionV1,
  createMandateLockV1,
  digestAgentMandateV1,
  parseAgentDocumentV1,
  parseMandateLockV1,
  parseReconciledOutcomeV1,
  verifyMandateLockV1,
} from "../../src/authority/agent-mandate.js";
import { authorityDigest } from "../../src/authority/wire.js";

const frontmatter = {
  v: "reelier.agent-mandate/v1",
  agentId: "eve-release-tracer",
  revision: 1,
  rolePack: "github_patch_release_operator_v1",
  harnesses: ["eve"],
  connectors: [{ kind: "github", account: "seldonframe/reelier" }],
  outcomeKinds: ["github.patch-release"],
  destinations: ["github"],
  limits: { maxConcurrentMissions: 1, maxChildFanout: 8, maxChangedFiles: 16, maxChangedBytes: 1048576 },
  humanConfirmation: "creation-only",
  exceptionBehavior: "stop-and-report",
  validFrom: "2026-08-20T12:00:00.000Z",
  validUntil: "2027-08-20T12:00:00.000Z",
  revocationGeneration: 0,
} as const;

const document = `---\n${JSON.stringify(frontmatter)}\n---\n# Eve release tracer\n\nFix and release bounded patches.\n`;

test("the adapter-neutral mandate ABI has one deterministic contract digest", () => {
  assert.equal(AGENT_MANDATE_CONTRACT_V1.v, "reelier.agent-mandate-contract/v1");
  assert.match(AGENT_MANDATE_CONTRACT_V1_DIGEST, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(AGENT_MANDATE_CONTRACT_V1_DIGEST, authorityDigest(AGENT_MANDATE_CONTRACT_V1));
});

test("AGENT.md has one closed canonical mandate and separate non-authorizing prose", () => {
  const parsed = parseAgentDocumentV1(document);
  assert.deepEqual(parsed.mandate, frontmatter);
  assert.equal(parsed.prose, "# Eve release tracer\n\nFix and release bounded patches.\n");
  const digest = digestAgentMandateV1(parsed.mandate);
  assert.equal(digest, digestAgentMandateV1(parseAgentDocumentV1(document.replace("Fix and release", "Carefully fix and release")).mandate));
  assert.notEqual(digest, digestAgentMandateV1(parseAgentDocumentV1(document.replace('"maxChildFanout":8', '"maxChildFanout":7')).mandate));
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.mandate.limits), true);
});

test("AGENT.md is portable across UTF-8 BOM and Windows CRLF without changing its mandate digest", () => {
  const windows = `\uFEFF${document.replaceAll("\n", "\r\n")}`;
  const parsed = parseAgentDocumentV1(windows);
  assert.equal(digestAgentMandateV1(parsed.mandate), digestAgentMandateV1(frontmatter));
  assert.equal(parsed.prose.includes("\r"), false);
});

test("a Markdown horizontal rule in prose is instruction, never a second authority block", () => {
  const withRule = document.replace("Fix and release bounded patches.", "Fix and release bounded patches.\n\n---\n\nThis remains prose.");
  const parsed = parseAgentDocumentV1(withRule);
  assert.equal(parsed.mandate.agentId, frontmatter.agentId);
  assert.match(parsed.prose, /This remains prose/u);
});

test("AGENT.md refuses unknown authority, duplicate entries, noncanonical time, prototypes, accessors, and malformed boundaries", () => {
  const cases = [
    `---\n${JSON.stringify(frontmatter).replace('{"v":', '{"v":"attacker-wins-elsewhere","v":')}\n---\ntext`,
    `---\n${JSON.stringify({ ...frontmatter, surprise: true })}\n---\ntext`,
    `---\n${JSON.stringify({ ...frontmatter, harnesses: ["eve", "eve"] })}\n---\ntext`,
    `---\n${JSON.stringify({ ...frontmatter, validUntil: "2027-02-30T12:00:00.000Z" })}\n---\ntext`,
    `---\n${JSON.stringify(frontmatter)}\n---\n`,
    `---\n${JSON.stringify(frontmatter)}\nnot-closed`,
  ];
  for (const value of cases) assert.throws(() => parseAgentDocumentV1(value));
  const accessor = Object.create(null, { v: { enumerable: true, get() { throw new Error("executed"); } } });
  assert.throws(() => digestAgentMandateV1(accessor));
});

test("environment lock verifies exact mandate, environment, authority, validity, revocation, and external proof", () => {
  const mandateDigest = digestAgentMandateV1(parseAgentDocumentV1(document).mandate);
  const lock = createMandateLockV1({
    mandate: frontmatter,
    environmentId: "env-production-1", trustDomainDigest: `sha256:${"1".repeat(64)}`,
    standingAuthorityDigest: `sha256:${"2".repeat(64)}`, activationProofDigest: `sha256:${"3".repeat(64)}`,
    validFrom: frontmatter.validFrom, validUntil: frontmatter.validUntil, revocationGeneration: 0,
  });
  assert.deepEqual(parseMandateLockV1(lock), lock);
  assert.doesNotMatch(JSON.stringify(lock), /credential|secret|signature|private/u);
  const verified = verifyMandateLockV1({ mandate: frontmatter, lock, environmentId: "env-production-1", trustDomainDigest: lock.trustDomainDigest, standingAuthorityDigest: lock.standingAuthorityDigest, revocationGeneration: 0, now: new Date("2026-08-20T13:00:00.000Z"), verifyActivationProof: digest => digest === lock.activationProofDigest });
  assert.equal(verified.mandateDigest, mandateDigest);
  assert.throws(() => verifyMandateLockV1({ mandate: frontmatter, lock, environmentId: "env-other", trustDomainDigest: lock.trustDomainDigest, standingAuthorityDigest: lock.standingAuthorityDigest, revocationGeneration: 0, now: new Date("2026-08-20T13:00:00.000Z"), verifyActivationProof: () => true }));
  assert.throws(() => verifyMandateLockV1({ mandate: frontmatter, lock, environmentId: lock.environmentId, trustDomainDigest: lock.trustDomainDigest, standingAuthorityDigest: lock.standingAuthorityDigest, revocationGeneration: 0, now: new Date(frontmatter.validUntil), verifyActivationProof: () => true }));
  assert.throws(() => verifyMandateLockV1({ mandate: frontmatter, lock, environmentId: lock.environmentId, trustDomainDigest: lock.trustDomainDigest, standingAuthorityDigest: lock.standingAuthorityDigest, revocationGeneration: 0, now: new Date("2026-08-20T13:00:00.000Z"), verifyActivationProof: () => false }));
});

test("mission derivation attenuates the mandate and mints fresh non-human child authority", () => {
  const parsed = parseAgentDocumentV1(document);
  const first = deriveMandatedMissionV1({ mandate: parsed.mandate, promptDigest: `sha256:${"4".repeat(64)}`, outcomeKind: "github.patch-release", harness: "eve", connector: { kind: "github", account: "seldonframe/reelier" }, destination: "github", requestedChildFanout: 5, requestedChangedFiles: 3, requestedChangedBytes: 64000, now: new Date("2026-08-20T13:00:00.000Z") });
  const second = deriveMandatedMissionV1({ mandate: parsed.mandate, promptDigest: `sha256:${"4".repeat(64)}`, outcomeKind: "github.patch-release", harness: "eve", connector: { kind: "github", account: "seldonframe/reelier" }, destination: "github", requestedChildFanout: 5, requestedChangedFiles: 3, requestedChangedBytes: 64000, now: new Date("2026-08-20T13:00:00.000Z") });
  assert.equal(first.humanConfirmation, "not-required");
  assert.notEqual(first.missionId, second.missionId);
  assert.notEqual(first.grantId, second.grantId);
  assert.equal(first.childFanout, 5);
  assert.throws(() => deriveMandatedMissionV1({ mandate: parsed.mandate, promptDigest: `sha256:${"4".repeat(64)}`, outcomeKind: "github.delete-repository", harness: "eve", connector: { kind: "github", account: "seldonframe/reelier" }, destination: "github", requestedChildFanout: 1, requestedChangedFiles: 0, requestedChangedBytes: 0, now: new Date("2026-08-20T13:00:00.000Z") }));
  assert.throws(() => deriveMandatedMissionV1({ mandate: parsed.mandate, promptDigest: `sha256:${"4".repeat(64)}`, outcomeKind: "github.patch-release", harness: "eve", connector: { kind: "github", account: "seldonframe/reelier" }, destination: "github", requestedChildFanout: 9, requestedChangedFiles: 3, requestedChangedBytes: 64000, now: new Date("2026-08-20T13:00:00.000Z") }));
});

test("ReconciledOutcome keeps four-state honesty and verified evidence binding", () => {
  const base = { v: "reelier.reconciled-outcome/v1", outcomeId: "outcome-1", agentId: frontmatter.agentId, mandateDigest: digestAgentMandateV1(frontmatter), missionId: "mission-1", completedAt: "2026-08-20T14:00:00.000Z" } as const;
  const verified = parseReconciledOutcomeV1({ ...base, status: "verified", receiptGraphDigest: `sha256:${"5".repeat(64)}`, exception: null });
  assert.equal(verified.status, "verified");
  for (const status of ["failed", "unchecked", "absent"] as const) assert.equal(parseReconciledOutcomeV1({ ...base, status, receiptGraphDigest: null, exception: status === "failed" ? { code: "provider-refused", message: "provider refused the bounded transition" } : null }).status, status);
  assert.throws(() => parseReconciledOutcomeV1({ ...base, status: "verified", receiptGraphDigest: null, exception: null }));
  assert.throws(() => parseReconciledOutcomeV1({ ...base, status: "unchecked", receiptGraphDigest: `sha256:${"5".repeat(64)}`, exception: null }));
});

test("the shipped Eve release tracer is a real portable AGENT.md, not an invented test-only mandate", () => {
  const artifact = readFileSync(path.join(process.cwd(), "examples", "agents", "eve-release-tracer", "AGENT.md"), "utf8");
  const parsed = parseAgentDocumentV1(artifact);
  assert.equal(parsed.mandate.agentId, "eve-release-tracer");
  assert.equal(parsed.mandate.rolePack, "github_patch_release_operator_v1");
  assert.deepEqual(parsed.mandate.harnesses, ["eve"]);
  assert.match(parsed.prose, /No routine human approval/u);
});
