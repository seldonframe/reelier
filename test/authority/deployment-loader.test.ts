import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadAuthorityDeployment } from "../../src/authority/host/deployment.js";

test("deployment loader reads closed signed-state metadata and trust roots without accepting traversal", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-deployment-"));
  try {
    const { publicKey } = generateKeyPairSync("ed25519");
    await writeFile(path.join(root, "operator.pub.pem"), publicKey.export({ type: "spki", format: "pem" }));
    const manifest = {
      v: "reelier.authority-deployment/v1",
      tenant: "tenant_1",
      states: [
        { tenant: "tenant_1", definitionAlias: "gmail_reply_send_v1", stateVersion: 1, candidates: [] },
        { tenant: "tenant_1", definitionAlias: "slack_channel_topic_set_v1", stateVersion: 1, candidates: [] },
      ],
      connectors: [{ tenant: "tenant_1", connectorId: "gmail", accountId: "acct_1", providerAccountIdentity: "gmail:acct_1", allowedReadEndpointIds: ["gmail.threads.get"], allowedWriteEndpointIds: ["gmail.users.messages.send"], riskClasses: ["gmail_send"], operatorConfigurationDigest: `sha256:${"1".repeat(64)}` }],
      trust: [{ signerId: "operator", principalId: "operator", publicKeyFile: "operator.pub.pem", purposes: ["outcome-contract", "delegation-grant"] }],
      sourceDirectory: "sources",
    };
    const file = path.join(root, "deployment.json");
    await writeFile(file, JSON.stringify(manifest));
    const loaded = await loadAuthorityDeployment(file);
    assert.equal(loaded.tenant, "tenant_1");
    assert.deepEqual(loaded.states.map(state => state.definitionAlias), ["gmail_reply_send_v1", "slack_channel_topic_set_v1"]);
    assert.equal(loaded.connectors[0]?.accountId, "acct_1");
    assert.equal(loaded.sourceDirectory, path.join(root, "sources"));
    await writeFile(file, JSON.stringify({ ...manifest, trust: [{ ...manifest.trust[0], publicKeyFile: "../operator.pub.pem" }] }));
    await assert.rejects(() => loadAuthorityDeployment(file), /trust key path|relative|inside deployment/i);
    await writeFile(file, JSON.stringify({ ...manifest, states: [manifest.states[0], manifest.states[0]] }));
    await assert.rejects(() => loadAuthorityDeployment(file), /duplicate.*definition/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("deployment loader keeps the singular state field as a legacy input only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-deployment-legacy-"));
  try {
    const { publicKey } = generateKeyPairSync("ed25519");
    await writeFile(path.join(root, "operator.pub.pem"), publicKey.export({ type: "spki", format: "pem" }));
    const file = path.join(root, "deployment.json");
    await writeFile(file, JSON.stringify({ v: "reelier.authority-deployment/v1", tenant: "tenant_1", state: { tenant: "tenant_1", definitionAlias: "gmail_reply_send_v1", stateVersion: 1, candidates: [] }, connectors: [], trust: [{ signerId: "operator", principalId: "operator", publicKeyFile: "operator.pub.pem", purposes: ["outcome-contract"] }], sourceDirectory: "sources" }));
    const loaded = await loadAuthorityDeployment(file);
    assert.deepEqual(loaded.states.map(state => state.definitionAlias), ["gmail_reply_send_v1"]);
    assert.equal("state" in loaded, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
