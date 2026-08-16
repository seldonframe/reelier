import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildAuthorityMcpServer } from "reelier/authority/host";
import { checkCandidate } from "./check.mjs";

const ADAPTER_IDS = Object.freeze({
  codex: "codex",
  "claude-code": "claude-code",
  eve: "eve",
  "grok-build": "xai.grok-build",
  "grok-bot": "xai.grok-bot",
});

const JOB_REF = "job_live_probe_record_state";
const REQUEST_ID = "request_live_probe_1";

function textResult(result, toolName) {
  const text = result?.content?.find(part => part?.type === "text")?.text;
  if (typeof text !== "string") throw new TypeError(`${toolName} returned no JSON text`);
  return JSON.parse(text);
}

function descriptor(harnessId, adapterId) {
  return {
    v: "reelier.agent-adapter-candidate/v0",
    descriptor: {
      adapterId,
      agentHost: harnessId,
      transport: "mcp-stdio",
      execution: "fixture-only",
      identityBinding: "host-authenticated",
      providerCredentialAccess: "none",
      authorityContract: { status: "pending-freeze", digest: null },
      coverage: { supportedModes: ["observed", "enforced"], defaultMode: "observed" },
      operations: [
        "jobs.search",
        "jobs.load",
        "delegations.request",
        "delegations.status",
        "tasks.status",
        "outcomes.invoke",
        "outcomes.status",
      ],
      hardCodedJobRefs: [],
    },
    session: {
      taskId: "task_live_probe_root",
      principalId: `principal_${harnessId.replaceAll("-", "_")}_root`,
      allocationId: "allocation_live_probe_root",
      remainingEffects: 4,
    },
    transcript: [],
    coverageProbes: [
      { mode: "observed", activation: "available", rawWriteReachability: "unknown", topology: "unchecked", completeness: "unchecked" },
      { mode: "enforced", activation: "unavailable", rawWriteReachability: "unknown", topology: "unchecked", completeness: "unchecked" },
    ],
  };
}

export async function runLiveMcpProbe({ harnessId, adapterId = ADAPTER_IDS[harnessId] } = {}) {
  if (!ADAPTER_IDS[harnessId] || adapterId !== ADAPTER_IDS[harnessId]) throw new TypeError("unsupported harness or adapter identity");
  const candidate = descriptor(harnessId, adapterId);
  const toolCalls = [];
  const context = {
    tenant: "tenant_live_probe",
    requester: candidate.session.principalId,
    executionContext: {
      v: "reelier.authority-execution-context/v1",
      taskId: candidate.session.taskId,
      principalId: candidate.session.principalId,
      grantId: "grant_live_probe_root",
      grantDigest: `sha256:${"a".repeat(64)}`,
      allocationId: candidate.session.allocationId,
      runtimeSessionId: "runtime_live_probe",
      jobId: JOB_REF,
      authorityCellId: "cell_live_probe",
    },
  };
  const server = buildAuthorityMcpServer([{ alias: "fixture_record_state_set_v1" }], {
    async outcome() { return { requestId: REQUEST_ID, verdict: "refused", reasonCode: "adapter-contract-pending", lifecycleState: "refused" }; },
    async status() {
      return {
        requestId: REQUEST_ID,
        lifecycleState: "refused",
        pass: false,
        claims: { authorization: "unchecked", dispatch: "absent", providerAcknowledgment: "absent", reconciliation: "absent", topology: "unchecked", completeness: "unchecked" },
      };
    },
    async jobsSearch() { return { jobs: [{ jobRef: JOB_REF, title: "Live probe record state" }] }; },
    async jobLoad() { return { jobRef: JOB_REF, definitionAliases: ["fixture_record_state_set_v1"], requestSchemaDigest: `sha256:${"b".repeat(64)}` }; },
    async delegationRequest() { return { verdict: "accepted", principalId: `${candidate.session.principalId}_child`, allocationId: "allocation_live_probe_child", effects: 1 }; },
    async invoke() { return { requestId: REQUEST_ID, verdict: "refused", reasonCode: "adapter-contract-pending", lifecycleState: "refused" }; },
  }, context);
  const client = new Client({ name: `reelier-${harnessId}-live-probe`, version: "0.32.1" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  let toolInventory;
  let contract;
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const tools = await client.listTools();
    toolInventory = tools.tools.map(tool => tool.name);
    const call = async (name, args) => {
      toolCalls.push(name);
      return textResult(await client.callTool({ name, arguments: args }), name);
    };
    contract = await call("reelier_adapter_contract", {});
    if (contract?.v !== "reelier.adapter-contract/v1" || !/^sha256:[0-9a-f]{64}$/.test(contract.digest)) throw new TypeError("authority adapter contract is not frozen or digest-shaped");
    const searchResponse = await call("reelier_jobs_search", { query: "reversible record state" });
    const search = { operation: "jobs.search", request: { query: "reversible record state" }, response: searchResponse };
    const jobRef = searchResponse.jobs[0].jobRef;
    const loadRequest = { jobRef };
    const loadResponse = await call("reelier_job_load", { jobId: jobRef });
    const load = { operation: "jobs.load", request: loadRequest, response: loadResponse };
    const delegationRequest = { taskId: candidate.session.taskId, parentAllocationId: candidate.session.allocationId, childPrincipalId: `${candidate.session.principalId}_child`, effects: 1 };
    const delegationResponse = await call("reelier_delegation_request", { child: { principalId: delegationRequest.childPrincipalId }, effects: delegationRequest.effects });
    const delegation = { operation: "delegations.request", request: delegationRequest, response: delegationResponse };
    const invokeRequest = { jobRef, requestId: REQUEST_ID, sourceRefs: { record: "opaque_live_probe_ref" }, choices: {} };
    const invokeResponse = await call("reelier_outcome_invoke", invokeRequest);
    const { requestId: _invokeRequestId, ...invokeResponseWithoutRequestId } = invokeResponse;
    void _invokeRequestId;
    const invoke = { operation: "outcomes.invoke", request: invokeRequest, response: invokeResponseWithoutRequestId };
    const statusRequest = { requestId: REQUEST_ID };
    const statusResponse = await call("reelier_outcome_status", statusRequest);
    const { requestId: _statusRequestId, ...statusResponseWithoutRequestId } = statusResponse;
    void _statusRequestId;
    const status = { operation: "outcomes.status", request: statusRequest, response: statusResponseWithoutRequestId };
    candidate.transcript.push(search, load, delegation, invoke, status);
  } finally {
    await client.close();
    await server.close();
  }
  const report = checkCandidate(candidate);
  return Object.freeze({ candidate: structuredClone(candidate), report, contract: Object.freeze({ ...contract }), toolInventory: Object.freeze(toolInventory ?? []), toolCalls: Object.freeze(toolCalls) });
}
