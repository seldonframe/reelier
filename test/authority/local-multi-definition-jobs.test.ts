import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authorityDigest, signJobCard, signedJobCardDigest } from "../../src/authority/index.js";
import { connectionAdoptionCommitmentDigest, connectionDescriptorDigest, digestNormalizedMcpToolSchemas } from "../../src/connections.js";
import { buildAuthorityDeployment } from "../../src/authority/host/deploy.js";
import { createLocalAuthorityRuntime } from "../../src/authority/host/local.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";
import { gmailPackDigest, gmailReadEndpointId, gmailReplyWriteEndpointId } from "../../src/packs/gmail/index.js";
import { slackChannelTopicPackDigest } from "../../src/packs/slack-topic/index.js";
import { jobCardTrustPinFixture } from "./job-card-trust-pin-fixture.js";
import type { AuthorityExecutionContextV1 } from "../../src/authority/types.js";

const GMAIL = "gmail_reply_send_v1";
const SLACK = "slack_channel_topic_set_v1";
const sha = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;

let restorePlatform: (() => void) | undefined;
test.before(() => { restorePlatform = __testSetAuthorityCellHostPlatform("linux"); });
test.after(() => { restorePlatform?.(); });

async function multiDefinitionFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-local-multi-jobs-"));
  const candidateRoot = path.join(root, "candidate");
  await mkdir(path.join(candidateRoot, "keys"), { recursive: true });
  await mkdir(path.join(candidateRoot, "sources"), { recursive: true });
  const operator = generateKeyPairSync("ed25519");
  const sponsor = generateKeyPairSync("ed25519");
  await writeFile(path.join(candidateRoot, "keys", "operator.pem"), operator.publicKey.export({ type: "spki", format: "pem" }));
  const tools = [{ name: gmailReadEndpointId, inputSchema: {} }, { name: gmailReplyWriteEndpointId, inputSchema: {} }];
  const descriptor = {
    v: "reelier.connection-descriptor/v1" as const,
    connectionId: "gmail",
    kind: "adopted-mcp-stdio" as const,
    provider: { id: "gmail", toolServerName: "gmail-mcp" },
    callableRoute: { kind: "mcp-stdio" as const, routeId: "route.gmail", endpointIds: [gmailReadEndpointId, gmailReplyWriteEndpointId] },
    account: { status: "verified" as const, identity: "gmail-owner-example-test" },
    toolSchemas: digestNormalizedMcpToolSchemas(tools),
    secretOwner: "host" as const,
    coverage: { v: "reelier.host-coverage/v1" as const, host: "codex", observation: "observed" as const, outcomeInvocation: "supported" as const, exclusiveEnforcement: "unknown" as const, limitations: ["raw-write-reachability-unmeasured"] },
  };
  const adoptionBody = { v: "reelier.connection-adoption/v1" as const, adoptionId: "adopt_gmail", descriptorDigest: connectionDescriptorDigest(descriptor), selectedAccountIdentity: descriptor.account.identity, mode: "existing" as const, sidecarRouteId: descriptor.callableRoute.routeId, rawWriteReachability: "reachable" as const, activationState: "active" as const, secureConnectionCommitment: null };
  const jobCard = signJobCard({
    v: "reelier.signed-job-card/v1", jobId: "production_release", title: "Production release", taskShapeDigest: sha("a"),
    semanticClasses: ["communication_commit_v1", "record_state_set_v1"], definitionAliases: [GMAIL, SLACK], connectorIds: ["gmail"],
    accountIdentities: [descriptor.account.identity], connectionDescriptorDigests: [connectionDescriptorDigest(descriptor)], adoptionCommitmentDigests: [connectionAdoptionCommitmentDigest(adoptionBody)],
    sourceRefs: ["source"], audiences: ["agent_1"], limitsDigest: sha("b"), instructionsDigest: sha("c"), packDigests: [gmailPackDigest, slackChannelTopicPackDigest],
    exceptionPolicy: ["ambiguous-reconcile"], coverage: "declared-surface",
  }, "job_sponsor", sponsor.privateKey);
  const trustPin = jobCardTrustPinFixture(sponsor.publicKey, "job_sponsor", "cell_receipt_key");
  const candidate = {
    v: "reelier.authority-deployment-candidate/v1", jobCard, connectionDescriptors: [descriptor], connectionAdoptions: [{ ...adoptionBody, signedDeploymentBinding: signedJobCardDigest(jobCard) }],
    state: { tenant: "tenant_1", definitionAlias: GMAIL, stateVersion: 1, candidates: [] },
    connectors: [{ tenant: "tenant_1", connectorId: "gmail", accountId: "account_1", providerAccountIdentity: descriptor.account.identity, allowedReadEndpointIds: [gmailReadEndpointId], allowedWriteEndpointIds: [gmailReplyWriteEndpointId], riskClasses: ["gmail_send"], operatorConfigurationDigest: sha("d") }],
    trust: [{ signerId: "operator", principalId: "operator", publicKeyFile: "keys/operator.pem", purposes: ["delegation-grant"] }], sourceDirectory: "sources",
  };
  const candidateFile = path.join(candidateRoot, "candidate.json");
  await writeFile(candidateFile, `${JSON.stringify(candidate)}\n`);
  const authorityRoot = path.join(root, "authority");
  const built = await buildAuthorityDeployment(candidateFile, path.join(authorityRoot, "deployment"), trustPin);
  const manifest = JSON.parse(await readFile(built.deploymentFile, "utf8"));
  manifest.states.push({ tenant: "tenant_1", definitionAlias: SLACK, stateVersion: 1, candidates: [] });
  await writeFile(built.deploymentFile, `${JSON.stringify(manifest)}\n`);
  const hostPin = path.join(authorityRoot, "trust", "job-card.json");
  await mkdir(path.dirname(hostPin), { recursive: true });
  await copyFile(built.jobCardTrustEvidenceFile, hostPin);
  const config = { version: 1 as const, tenant: "tenant_1", requester: "agent_1", definitions: [GMAIL, SLACK], ledgerDir: path.join(authorityRoot, "ledger"), decisionDir: path.join(authorityRoot, "decisions"), receiptDir: path.join(authorityRoot, "receipts"), gateKeyFile: path.join(authorityRoot, "keys", "gate.pem"), endpoints: [], deploymentPath: built.deploymentFile, jobCardTrustPinPath: hostPin };
  const context: { tenant: string; requester: string; executionContext: AuthorityExecutionContextV1 } = { tenant: "tenant_1", requester: "agent_1", executionContext: { v: "reelier.authority-execution-context/v1", taskId: "task_1", principalId: "agent_1", grantId: "grant_1", grantDigest: authorityDigest({ grant: 1 }), allocationId: "allocation_1", runtimeSessionId: "session_1", jobId: jobCard.jobId, authorityCellId: "cell_1" } };
  return { root, config, context, trustPin };
}

test("multi-definition signed Job Card returns deterministic opaque references instead of job IDs or aliases", async () => {
  const fixture = await multiDefinitionFixture();
  try {
    const runtime = await createLocalAuthorityRuntime(fixture.config, { jobCardTrustPin: fixture.trustPin });
    const found = await runtime.jobsSearch!({ query: "" }, fixture.context) as { jobs: Array<Record<string, string>> };
    assert.equal(found.jobs.length, 2);
    assert.deepEqual(found.jobs.map(job => Object.keys(job)), [["jobRef"], ["jobRef"]]);
    const refs = found.jobs.map(job => job.jobRef);
    assert.equal(new Set(refs).size, 2);
    for (const ref of refs) {
      assert.match(ref, /^jobref_[0-9a-f]{64}$/);
      assert.equal(ref.includes("production_release"), false);
      assert.equal(ref.includes("gmail"), false);
      assert.equal(ref.includes("slack"), false);
    }
    const restarted = await createLocalAuthorityRuntime(fixture.config, { jobCardTrustPin: fixture.trustPin });
    const recovered = await restarted.jobsSearch!({ query: "ignored" }, fixture.context) as { jobs: Array<{ jobRef: string }> };
    assert.deepEqual(recovered.jobs.map(job => job.jobRef), refs);
    const loaded = await restarted.jobLoad!({ jobId: refs[0] }, fixture.context) as { verdict: string; jobRef: string };
    assert.equal(loaded.verdict, "accepted");
    assert.equal(loaded.jobRef, refs[0]);
    assert.equal((await restarted.jobLoad!({ jobId: "production_release" }, fixture.context) as { verdict: string }).verdict, "refused");
    assert.equal((await restarted.jobLoad!({ jobId: GMAIL }, fixture.context) as { verdict: string }).verdict, "refused");
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});
