import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  constructAuthorityReceiptBundle,
  validateAuthorityReceiptSigningAuthority,
  type AuthorityReceiptSigningAuthorityV1,
  type ProducedReceiptKindV1,
} from "../../src/authority/host/receipt-authority.js";
import { profileGovernanceFixture } from "./profile-governance-fixture.js";
import { authorityDigest } from "../../src/authority/wire.js";
import { createCertificationArtifactKeyBinding, createCertificationLifecycleAuthorityCeremony, verifyCertificationArtifactKeyBinding } from "../../src/authority/certification/lifecycle-authority.js";
import { createGitHubIssueLabelsHermeticComposition } from "../../src/authority/certification/github-issue-labels-runner.js";
import { createGitHubIssueLabelsFixture } from "./fixtures/github-issue-labels.js";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const phases = ["reservation", "dispatch", "cancelled", "ambiguous", "reconcile"] as const;
const purposes = ["source-bundle", "compiled-capability", "transport-effect", "authority-evidence", "authority-receipt", "pack-manifest"] as const;
const producedProperties = ["sourceBundle", "compiledCapability", "transportEffect", "evidence", "receipt", "packManifest"] as const;

test("produced receipt kinds name the six generated bundle properties, not wire purposes", () => {
  profileGovernanceFixture();
  const kinds: readonly ProducedReceiptKindV1[] = producedProperties;
  assert.deepEqual(kinds, producedProperties);
});

test("real lifecycle construction preserves reservation, dispatch, ambiguity, and reconciliation byte/prior semantics", async () => {
  const normal = await createGitHubIssueLabelsFixture("normal");
  try {
    await normal.runner.run({ bearerToken: normal.credential.token, requestId: "receipt_phase_normal" });
    const graph: any = await normal.runner.exportGraph({ bearerToken: normal.credential.token });
    const [reservation, dispatch, reconcile] = graph.receipts;
    assert.deepEqual(reservation.evidence.value.timeline.map((item: any) => item.state), ["reserved"]);
    assert.equal(reservation.receipt.value.claims.dispatch, "absent");
    assert.equal(reservation.receipt.value.priorReceiptDigest, null);
    assert.equal(dispatch.receipt.value.priorReceiptDigest, authorityDigest(reservation.receipt.value));
    assert.equal(reconcile.receipt.value.priorReceiptDigest, authorityDigest(dispatch.receipt.value));
    assert.deepEqual(reconcile.evidence.value.timeline.map((item: any) => item.state), ["reserved", "dispatched", "acknowledged", "reconciled"]);
    for (const bundle of graph.receipts) {
      assert.equal(bundle.signatures.length, 10);
      assert.equal(bundle.receipt.value.decisionContextDigest, reservation.receipt.value.decisionContextDigest);
      assert.equal(bundle.contract.digest, reservation.contract.digest);
      assert.equal(bundle.gateEvent.digest, reservation.gateEvent.digest);
    }
  } finally { await normal.close(); }

  const cancelled = await createGitHubIssueLabelsFixture("source-drift");
  try {
    await cancelled.runner.run({ bearerToken: cancelled.credential.token, requestId: "receipt_phase_cancelled" });
    const directory = path.join(cancelled.initialized.workspace, "authority", "github-label-runner", "receipts", "portable");
    const names = await readdir(directory);
    assert.equal(names.length, 1);
    const bundle: any = JSON.parse(await readFile(path.join(directory, names[0]!), "utf8"));
    assert.deepEqual(bundle.evidence.value.timeline.map((item: any) => item.state), ["reserved", "cancelled"]);
    assert.equal(bundle.receipt.value.priorReceiptDigest, null);
    assert.equal(bundle.receipt.value.claims.dispatch, "absent");
  } finally { await cancelled.close(); }

  const ambiguous = await createGitHubIssueLabelsFixture("provider-503");
  try {
    await ambiguous.runner.run({ bearerToken: ambiguous.credential.token, requestId: "receipt_phase_ambiguous" });
    const restarted = await createGitHubIssueLabelsHermeticComposition(ambiguous.cell);
    await restarted.recover();
    const graph: any = await restarted.exportGraph({ bearerToken: ambiguous.credential.token });
    assert.deepEqual(graph.receipts[1].evidence.value.timeline.map((item: any) => item.state), ["reserved", "dispatched", "ambiguous"]);
    assert.equal(graph.receipts[1].receipt.value.priorReceiptDigest, authorityDigest(graph.receipts[0].receipt.value));
  } finally { await ambiguous.close(); }
});

test("raw callbacks and structural validation handles cannot construct authority receipts", async () => {
  const key = generateKeyPairSync("ed25519");
  let signs = 0;
  const signer = (purpose: typeof purposes[number], signerId: string) => ({ purpose, signerId, publicKey: key.publicKey, async sign() { signs += 1; throw new Error("must not sign"); } });
  const raw = {
    artifactAuthorization: { binding: {}, commitment: {} },
    sourceBundle: signer("source-bundle", "source"),
    compiledCapability: signer("compiled-capability", "compiled"),
    transportEffect: signer("transport-effect", "transport"),
    evidence: signer("authority-evidence", "evidence"),
    receipt: signer("authority-receipt", "receipt"),
    packManifest: signer("pack-manifest", "manifest"),
  } as unknown as AuthorityReceiptSigningAuthorityV1;
  assert.throws(() => validateAuthorityReceiptSigningAuthority({ trustView: Object.freeze({}), signingAuthority: raw, segregation: Object.freeze({ mode: "governed" }) } as never), /trust view|validated|admitted/i);
  for (const phase of phases) for (const forged of [raw, { ...raw }, Object.freeze({ ...raw }), new Proxy(raw, {})]) await assert.rejects(
    () => constructAuthorityReceiptBundle({ phase, signingAuthority: forged } as never),
    /validated signing authority/i,
    `${phase} must enter the production constructor and reject an unvalidated authority before signing`,
  );
  assert.equal(signs, 0);
});

test("artifact subkeys are authorized only by the active evidence descriptor that signs the receipt", () => {
  const ceremony = createCertificationLifecycleAuthorityCeremony();
  const humanKey = generateKeyPairSync("ed25519");
  const human: any = { v: "reelier.authority-key-descriptor/v1", keyId: "human_ready", role: "human-sponsor", purpose: "certification-readiness", algorithm: "ed25519", publicKeySpkiBase64: humanKey.publicKey.export({ type: "spki", format: "der" }).toString("base64") };
  const signedReadiness = { fixture: "readiness" };
  const authorization = createCertificationArtifactKeyBinding(ceremony.opaqueHandle, { authorityCellId: "cell_1", taskId: "task_1", readinessDigest: authorityDigest(signedReadiness), humanDescriptor: human, humanPrivateKey: humanKey.privateKey, issuedAt: "2026-08-14T10:00:00.000Z", expiresAt: "2026-08-14T14:00:00.000Z" });
  const actualParent = ceremony.publicDescriptors.find(item => authorityDigest(item) === authorization.binding.parentEvidenceDescriptorDigest)!;
  const alternateKey = generateKeyPairSync("ed25519");
  const alternate: any = { v: "reelier.authority-key-descriptor/v1", keyId: "alternate_evidence", role: "authority-cell", purpose: "authority-evidence", algorithm: "ed25519", publicKeySpkiBase64: alternateKey.publicKey.export({ type: "spki", format: "der" }).toString("base64") };
  const verify = verifyCertificationArtifactKeyBinding as any;
  assert.throws(() => verify(authorization.binding, authorization.humanCommitment, { descriptors: [...ceremony.publicDescriptors, alternate, human], signedReadiness, now: new Date("2026-08-14T12:00:00.000Z"), expectedParentEvidenceDescriptor: alternate, activeDescriptorDigests: new Set([authorityDigest(alternate)]) }), /parent|evidence|active|revoked/i);
  assert.notEqual(authorityDigest(actualParent), authorityDigest(alternate));
});
