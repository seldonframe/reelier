import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_TOOL_ABI_DIGEST_V1,
  AGENT_TOOL_CONTRACTS_V1,
  AGENT_TOOL_NAMES_V1,
  CERTIFIABLE_HARNESSES_V1,
  agentToolHttpRoutesV1,
  agentToolMcpDefinitionsV1,
  buildAgentToolOpenApiV1,
  createHarnessCapabilityDescriptorV1,
  parseAgentToolInputV1,
} from "../../src/authority/ingress/agent-tool-contracts.js";
import { createAuthorityAgentTools } from "../../src/authority/host/agent-tools.js";

const context = Object.freeze({
  tenant: "tenant_1",
  requester: "agent_1",
  executionContext: Object.freeze({
    v: "reelier.authority-execution-context/v1" as const,
    taskId: "task_1",
    principalId: "agent_1",
    grantId: "grant_1",
    grantDigest: `sha256:${"a".repeat(64)}` as const,
    allocationId: "allocation_1",
    runtimeSessionId: "session_1",
    jobId: "job_1",
    authorityCellId: "cell_1",
  }),
});

test("one closed quartet projects byte-equivalent request semantics to MCP, HTTP, and OpenAPI", () => {
  assert.deepEqual(AGENT_TOOL_NAMES_V1, [
    "reelier_agent_status",
    "reelier_outcome_proposal",
    "reelier_outcome_request",
    "reelier_outcome_status",
  ]);
  assert.equal(Object.isFrozen(AGENT_TOOL_CONTRACTS_V1), true);

  const mcp = agentToolMcpDefinitionsV1();
  const http = agentToolHttpRoutesV1();
  const openapi = buildAgentToolOpenApiV1();
  assert.deepEqual(mcp.map(item => item.name), AGENT_TOOL_NAMES_V1);
  assert.deepEqual(http.map(item => item.operationId), AGENT_TOOL_NAMES_V1);

  for (const contract of AGENT_TOOL_CONTRACTS_V1) {
    const mcpProjection = mcp.find(item => item.name === contract.name)!;
    const httpProjection = http.find(item => item.operationId === contract.name)!;
    const openApiOperation = (openapi.paths[contract.http.path] as Record<string, unknown>)[contract.http.method.toLowerCase()] as Record<string, unknown>;
    assert.deepEqual(mcpProjection.inputSchema, contract.inputSchema);
    assert.deepEqual(httpProjection.inputSchema, contract.inputSchema);
    assert.deepEqual(httpProjection.outputSchema, contract.outputSchema);
    assert.equal(openApiOperation.operationId, contract.name);
    const openApiRequest = openApiOperation.requestBody as { content: { "application/json": { schema: unknown } } } | undefined;
    if (contract.http.method === "POST") assert.deepEqual(openApiRequest?.content["application/json"].schema, contract.inputSchema);
    assert.deepEqual((openApiOperation.responses as Record<string, { content: { "application/json": { schema: unknown } } }>)["200"]!.content["application/json"].schema, contract.outputSchema);
  }
  assert.match(AGENT_TOOL_ABI_DIGEST_V1, /^sha256:[0-9a-f]{64}$/);
});

test("canonical input parsing is closed, inert, bounded, detached, and excludes host-owned identity", () => {
  const request = {
    outcomeRef: `outcomeref_${"1".repeat(64)}`,
    requestId: "request_1",
    sourceRefs: { issue: "issue_1" },
    choices: { resolution: "complete" },
  };
  const parsed = parseAgentToolInputV1("reelier_outcome_request", request) as typeof request;
  request.sourceRefs.issue = "changed";
  assert.equal(parsed.sourceRefs.issue, "issue_1");
  assert.equal(Object.isFrozen(parsed), true);

  for (const forbidden of ["tenant", "accountId", "destinationId", "providerStatusId", "mergePolicy", "credential", "signingKey"]) {
    assert.throws(() => parseAgentToolInputV1("reelier_outcome_request", { ...request, [forbidden]: "attacker" }), /closed|field|invalid/i);
  }
  const accessor = Object.create(Object.prototype, {
    outcomeRef: { enumerable: true, value: request.outcomeRef },
    requestId: { enumerable: true, value: request.requestId },
    sourceRefs: { enumerable: true, get: () => { throw new Error("accessor executed"); } },
    choices: { enumerable: true, value: {} },
  });
  assert.throws(() => parseAgentToolInputV1("reelier_outcome_request", accessor), /inert|plain|data/i);
  assert.throws(() => parseAgentToolInputV1("reelier_outcome_status", { requestId: "x".repeat(257) }), /bounded|length|invalid/i);
});

test("host agent tools translate only authenticated opaque references and never expose aliases", async () => {
  const ref = `outcomeref_${"2".repeat(64)}`;
  const calls: Array<readonly [string, unknown, unknown]> = [];
  const tools = createAuthorityAgentTools({
    async jobsSearch(input, receivedContext) {
      calls.push(["status", input, receivedContext]);
      return { requestId: "", verdict: "accepted", reasonCode: "agent-ready", lifecycleState: "ready", jobs: [{ jobRef: ref }] };
    },
    async jobLoad(input, receivedContext) {
      calls.push(["proposal", input, receivedContext]);
      return { requestId: "", verdict: "accepted", reasonCode: "outcome-proposed", lifecycleState: "proposed", jobRef: ref };
    },
    async invoke(input, receivedContext) {
      calls.push(["request", input, receivedContext]);
      return { requestId: "request_1", verdict: "accepted", reasonCode: "accepted", lifecycleState: "pending" };
    },
    async status(input, receivedContext) {
      calls.push(["outcome-status", input, receivedContext]);
      return { requestId: "request_1", verdict: "accepted", reasonCode: "reconciled", lifecycleState: "reconciled", receiptRef: "receipt_1" };
    },
  });

  const agentStatus = await tools.agentStatus({}, context);
  const proposal = await tools.outcomeProposal({ outcomeRef: ref }, context);
  const requested = await tools.outcomeRequest({ outcomeRef: ref, requestId: "request_1", sourceRefs: { issue: "issue_1" }, choices: {} }, context);
  const status = await tools.outcomeStatus({ requestId: "request_1" }, context);
  assert.deepEqual(agentStatus.outcomeRefs, [ref]);
  assert.equal(proposal.outcomeRef, ref);
  assert.equal(requested.lifecycleState, "pending");
  assert.equal(status.receiptRef, "receipt_1");
  assert.deepEqual(calls.map(item => item[0]), ["status", "proposal", "request", "outcome-status"]);
  assert.deepEqual(calls[1]![1], { jobId: ref });
  assert.deepEqual(calls[2]![1], { v: "reelier.outcome-request/v1", jobRef: ref, requestId: "request_1", sourceRefs: { issue: "issue_1" }, choices: {} });
  assert.equal(calls.every(item => item[2] === context), true);

  const rawAliasTools = createAuthorityAgentTools({
    async jobsSearch() { return { requestId: "", verdict: "accepted", reasonCode: "jobs-found", lifecycleState: "catalog", jobs: [{ jobId: "github_merge", alias: "github_merge" }] }; },
    async jobLoad() { throw new Error("not reached"); },
    async invoke() { throw new Error("not reached"); },
    async status() { throw new Error("not reached"); },
  });
  const refused = await rawAliasTools.agentStatus({}, context);
  assert.deepEqual(refused.outcomeRefs, []);
  assert.equal(JSON.stringify(refused).includes("github_merge"), false);
});

test("capability descriptors share one ABI and distinguish compatibility from a passed harness fixture", () => {
  assert.deepEqual(CERTIFIABLE_HARNESSES_V1, ["eve", "codex", "claude-code", "cursor", "grok", "hermes"]);
  for (const harnessId of CERTIFIABLE_HARNESSES_V1) {
    const descriptor = createHarnessCapabilityDescriptorV1({ harnessId, harnessVersion: "test-version", fixturePassed: false });
    assert.equal(descriptor.abiDigest, AGENT_TOOL_ABI_DIGEST_V1);
    assert.equal(descriptor.protocolCompatibility, "compatible");
    assert.equal(descriptor.fixtureStatus, "not-passed");
    assert.equal(descriptor.liveTested, false);
  }
  const eve = createHarnessCapabilityDescriptorV1({ harnessId: "eve", harnessVersion: "0.39.0", fixturePassed: true });
  assert.equal(eve.protocolCompatibility, "compatible");
  assert.equal(eve.fixtureStatus, "passed");
  assert.equal(eve.liveTested, true);
  assert.equal(eve.providerCertification, "not-claimed");
});
