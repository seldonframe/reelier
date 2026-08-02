import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authenticateOutcomeRequest,
  authenticatedOutcomeRequestState,
  deriveAuthorityRequestKey,
  deriveContractWindowLimitKey,
  deriveProviderSourceTriggerLimitKey,
  digestOutcomeRequest,
} from "../../src/authority/keys.js";

function outcomeRequest() { return {
  v: "reelier.outcome-request/v1" as const,
  requestId: "request_1",
  sourceRefs: { appointment: "ref_1" },
  choices: {},
}; }

test("authenticated requests seal exact detached wire bytes, digest, tuple key, and route alias", () => {
  const request = outcomeRequest();
  const authenticated = authenticateOutcomeRequest({
    tenant: "ténant",
    requester: "requester|1",
    definitionAlias: "definition_1",
    request,
  });
  request.sourceRefs.appointment = "mutated";

  const state = authenticatedOutcomeRequestState(authenticated);
  assert.equal(state.request.requestId, "request_1");
  assert.equal(state.request.sourceRefs.appointment, "ref_1");
  assert.equal(state.definitionAlias, "definition_1");
  assert.equal(state.canonicalRequestBase64, Buffer.from('{"choices":{},"requestId":"request_1","sourceRefs":{"appointment":"ref_1"},"v":"reelier.outcome-request/v1"}').toString("base64"));
  assert.equal(state.requestDigest, "sha256:b0627231c94f6e288b46bae793b7c64e90429f7e3fc27bc3e870ec23ee0b4245");
  assert.equal(state.requestKey, "sha256:bae96dac3066021e685a9f48c205a4bd9a367ef646c4637d1e36e1200bb44004");
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.request.sourceRefs), true);
  assert.throws(() => authenticatedOutcomeRequestState({ ...authenticated }), /unrecognized authenticated request/i);
});

test("request digest and global key reject alias/body confusion and delimiter collisions", () => {
  const request = outcomeRequest();
  assert.equal(digestOutcomeRequest(request), "sha256:b0627231c94f6e288b46bae793b7c64e90429f7e3fc27bc3e870ec23ee0b4245");
  assert.equal(
    deriveAuthorityRequestKey({ tenant: "ténant", requester: "requester|1", requestId: "request_1" }),
    "sha256:bae96dac3066021e685a9f48c205a4bd9a367ef646c4637d1e36e1200bb44004",
  );
  assert.notEqual(
    deriveAuthorityRequestKey({ tenant: "a", requester: "bc", requestId: "d" }),
    deriveAuthorityRequestKey({ tenant: "ab", requester: "c", requestId: "d" }),
  );
  assert.throws(() => authenticateOutcomeRequest({ tenant: "tenant_1", requester: "requester_1", definitionAlias: "definition_1", request: { ...request, choices: { connectorId: "evil" } } }), /forbidden/i);
});

test("contract-window and provider-trigger limit keys bind exact closed preimages", () => {
  assert.deepEqual(deriveContractWindowLimitKey({
    tenant: "tenant_1",
    contractDigest: `sha256:${"a".repeat(64)}`,
    issuedAt: "2026-01-01T00:00:00.000Z",
    windowSeconds: 60,
  }), {
    key: "sha256:548027a37596dde171ff7563b6c0a07d7e6b57fdbb8839166c736b4f6edec642",
    windowStartEpochMs: 1_767_225_600_000,
    windowEndEpochMs: 1_767_225_660_000,
  });
  assert.equal(
    deriveProviderSourceTriggerLimitKey({ tenant: "tenant_1", connectorId: "connector_1", providerAccountIdentity: "provider:acct", resolverId: "resolver_1", sourceIdentity: "source|1", triggerIdentity: "trigger_1" }),
    "sha256:c3fb7ac52e451a2e34f92989a7fa1efab02c2e566fbaec0d5b3bd084d56209a3",
  );
  assert.notEqual(
    deriveProviderSourceTriggerLimitKey({ tenant: "a", connectorId: "bc", providerAccountIdentity: "d", resolverId: "e", sourceIdentity: "f", triggerIdentity: "g" }),
    deriveProviderSourceTriggerLimitKey({ tenant: "ab", connectorId: "c", providerAccountIdentity: "d", resolverId: "e", sourceIdentity: "f", triggerIdentity: "g" }),
  );
  for (const windowSeconds of [0, 31_536_001, 1.5]) assert.throws(() => deriveContractWindowLimitKey({ tenant: "tenant_1", contractDigest: `sha256:${"a".repeat(64)}`, issuedAt: "2026-01-01T00:00:00.000Z", windowSeconds }), /window/i);
  assert.throws(() => deriveContractWindowLimitKey({ tenant: "tenant_1", contractDigest: `sha256:${"a".repeat(64)}`, issuedAt: "not-an-instant", windowSeconds: 60 }), /instant/i);
});
