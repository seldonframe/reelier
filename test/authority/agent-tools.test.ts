import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
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
import { authorityAgentToolOpenApiV1 } from "../../src/authority/ingress/openapi.js";
import { createAuthorityAgentTools } from "../../src/authority/host/agent-tools.js";
import { buildAuthorityMcpServer, type AuthorityMcpHandler } from "../../src/authority/ingress/mcp.js";
import { handleAuthorityHttp } from "../../src/authority/ingress/http.js";

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

test("production MCP adds the quartet from the canonical projection without removing legacy tools", async () => {
  const ref = `jobref_${"3".repeat(64)}`;
  const invoked: unknown[] = [];
  const handler: AuthorityMcpHandler = {
    async outcome() { return { requestId: "legacy", verdict: "refused", reasonCode: "legacy", lifecycleState: "refused" }; },
    async status(input) { return { requestId: String((input as Record<string, unknown>).requestId ?? ""), verdict: "accepted", reasonCode: "reconciled", lifecycleState: "reconciled" }; },
    async jobsSearch() { return { requestId: "", verdict: "accepted", reasonCode: "agent-ready", lifecycleState: "ready", jobs: [{ jobRef: ref }] }; },
    async jobLoad(input) { return { requestId: "", verdict: "accepted", reasonCode: "outcome-proposed", lifecycleState: "proposed", jobRef: (input as Record<string, unknown>).jobId }; },
    async invoke(input) { invoked.push(input); return { requestId: "request_mcp", verdict: "accepted", reasonCode: "accepted", lifecycleState: "pending" }; },
  };
  const server = buildAuthorityMcpServer([{ alias: "legacy_alias" }], handler, context);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "agent-quartet-test", version: "1" }, { capabilities: {} });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const names = (await client.listTools()).tools.map(tool => tool.name);
    for (const name of AGENT_TOOL_NAMES_V1) assert.equal(names.includes(name), true, name);
    for (const legacy of ["reelier_jobs_search", "reelier_job_load", "reelier_outcome_invoke", "reelier_outcome_legacy_alias"]) assert.equal(names.includes(legacy), true, legacy);
    const result = await client.callTool({ name: "reelier_outcome_request", arguments: { outcomeRef: ref, requestId: "request_mcp", sourceRefs: { issue: "issue_1" }, choices: {} } });
    assert.equal(result.isError, undefined);
    assert.deepEqual(invoked, [{ v: "reelier.outcome-request/v1", jobRef: ref, requestId: "request_mcp", sourceRefs: { issue: "issue_1" }, choices: {} }]);
  } finally {
    await client.close();
    await server.close();
  }
});

test("production HTTP serves the same quartet paths and canonical OpenAPI document", async () => {
  const ref = `jobref_${"4".repeat(64)}`;
  const handler: AuthorityMcpHandler = {
    async outcome() { return { requestId: "legacy", verdict: "refused", reasonCode: "legacy", lifecycleState: "refused" }; },
    async status(input) { return { requestId: String((input as Record<string, unknown>).requestId ?? ""), verdict: "accepted", reasonCode: "reconciled", lifecycleState: "reconciled" }; },
    async jobsSearch() { return { requestId: "", verdict: "accepted", reasonCode: "agent-ready", lifecycleState: "ready", jobs: [{ jobRef: ref }] }; },
    async jobLoad(input) { return { requestId: "", verdict: "accepted", reasonCode: "outcome-proposed", lifecycleState: "proposed", jobRef: (input as Record<string, unknown>).jobId }; },
    async invoke(input) { return { requestId: String((input as Record<string, unknown>).requestId), verdict: "accepted", reasonCode: "accepted", lifecycleState: "pending" }; },
  };
  const server = createServer((request, response) => {
    void handleAuthorityHttp(request, response, handler, {
      tenant: "tenant_1",
      requester: "agent_1",
      resolvePrincipal: async () => context,
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const port = (server.address() as AddressInfo).port;
    const call = async (path: string, init: RequestInit = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { authorization: "Bearer fixture", ...(init.headers ?? {}) } });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    const agentStatus = await call("/v1/agent/status");
    assert.equal(agentStatus.status, 200);
    assert.deepEqual(agentStatus.body.outcomeRefs, [ref]);
    const proposal = await call("/v1/outcome-proposals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ outcomeRef: ref }) });
    assert.equal(proposal.body.outcomeRef, ref);
    const requested = await call("/v1/outcome-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ outcomeRef: ref, requestId: "request_http", sourceRefs: { issue: "issue_1" }, choices: {} }) });
    assert.equal(requested.status, 202);
    const status = await call("/v1/outcome-status/request_http");
    assert.equal(status.body.lifecycleState, "reconciled");
    assert.deepEqual(authorityAgentToolOpenApiV1, buildAgentToolOpenApiV1());
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
