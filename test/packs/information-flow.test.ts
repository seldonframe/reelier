import test from "node:test";
import assert from "node:assert/strict";
import { compileInformationFlowCommit, parseInformationFlowPolicy, reconcileInformationFlowCommit, validateInformationFlowChoices, type InformationFlowProjection } from "reelier/packs";

const source: InformationFlowProjection = { hubspotAccountId: "hs_acct", ticketId: "ticket_1", contactId: "contact_1", customerEmail: "customer@example.com", subject: "Refund request", status: "open", priority: "high" };
const policyInput = { hubspotAccountId: "hs_acct", slackTeamId: "T1", slackChannelId: "C_PRIVATE", authorizedFields: ["ticketId", "subject", "status", "priority"], transformation: "selected_fields_only", stagedText: "Ticket ticket_1: Refund request (open, high)" };

test("information-flow commit binds selected HubSpot fields and one Slack destination", () => {
  assert.throws(() => validateInformationFlowChoices({ channelId: "attacker" }));
  const policy = parseInformationFlowPolicy(policyInput);
  const effect = compileInformationFlowCommit({ source, policy });
  assert.equal(effect.endpointId, "slack.chat.postMessage");
  assert.equal(effect.method, "POST");
  assert.equal(effect.path, "/api/chat.postMessage");
  assert.deepEqual(JSON.parse(Buffer.from(effect.bodyBase64, "base64").toString("utf8")), { channel: "C_PRIVATE", text: policyInput.stagedText });
  assert.equal(effect.reconciliation.recipeId, "information_flow_commit_readback_v1");
  assert.equal(effect.preconditions[0].kind, "hubspot-authorized-field-projection");
});

test("information-flow commit refuses unauthorized fields, destinations, and ambiguous read-back", () => {
  assert.throws(() => parseInformationFlowPolicy({ ...policyInput, authorizedFields: ["customerEmail"] }));
  const policy = parseInformationFlowPolicy(policyInput);
  assert.throws(() => compileInformationFlowCommit({ source: { ...source, hubspotAccountId: "attacker" }, policy }));
  const response = { status: 200, body: { ok: true, teamId: "T1", channelId: "C_PRIVATE", messageId: "m_1", text: policyInput.stagedText } };
  assert.equal(reconcileInformationFlowCommit({ expected: source, policy, response }).status, "matched");
  assert.equal(reconcileInformationFlowCommit({ expected: source, policy, response: { status: 200, body: { ok: true, teamId: "T1", channelId: "C_OTHER", messageId: "m_1", text: policyInput.stagedText } } }).status, "conflict");
  assert.equal(reconcileInformationFlowCommit({ expected: source, policy, response: { status: 503, body: {} } }).status, "unavailable");
});
