import { appendFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildAuthorityMcpServer } from "reelier/authority/host";

const harnessId = process.argv[2] === "--harness" ? process.argv[3] : "";
if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(harnessId)) throw new TypeError("usage: serve-agent-adapter-contract.mjs --harness <id>");

const capturePath = process.env.REELIER_ADAPTER_CAPTURE;
const session = Object.freeze({
  taskId: process.env.REELIER_TASK_ID ?? `task_${harnessId}_process`,
  principalId: process.env.REELIER_PRINCIPAL_ID ?? `principal_${harnessId}_process`,
  allocationId: process.env.REELIER_ALLOCATION_ID ?? `allocation_${harnessId}_root`,
  runtimeSessionId: process.env.REELIER_RUNTIME_SESSION_ID ?? `runtime_${harnessId}_process`,
  grantId: process.env.REELIER_GRANT_ID ?? `grant_${harnessId}_root`,
  grantDigest: process.env.REELIER_GRANT_DIGEST ?? `sha256:${"a".repeat(64)}`,
  jobId: "job_process_record_state",
  authorityCellId: process.env.REELIER_AUTHORITY_CELL_ID ?? `cell_${harnessId}_process`,
});
const requestId = `request_${harnessId}_process_1`;
const jobRef = session.jobId;

async function record(event) {
  if (capturePath) await appendFile(capturePath, `${JSON.stringify({ observedAt: new Date().toISOString(), ...event })}\n`, "utf8");
}

const context = {
  tenant: process.env.REELIER_TENANT ?? "tenant_process_probe",
  requester: session.principalId,
  executionContext: Object.freeze({ v: "reelier.authority-execution-context/v1", ...session }),
};

const server = buildAuthorityMcpServer([{ alias: "fixture_record_state_set_v1" }], {
  async jobsSearch(input) {
    await record({ operation: "jobs.search", input });
    return { jobs: [{ jobRef, title: "Process-boundary record state" }] };
  },
  async jobLoad(input) {
    await record({ operation: "jobs.load", input });
    return { jobRef, definitionAliases: ["fixture_record_state_set_v1"], requestSchemaDigest: `sha256:${"b".repeat(64)}` };
  },
  async delegationRequest(input) {
    await record({ operation: "delegations.request", input });
    const effects = Number(input?.effects);
    const childPrincipalId = input?.child?.principalId;
    return { verdict: "accepted", principalId: childPrincipalId, allocationId: `${session.allocationId}_child`, effects };
  },
  async delegationStatus(input) {
    await record({ operation: "delegations.status", input });
    return { grantId: input?.grantId, state: "active", principalId: `${session.principalId}_child`, allocationId: `${session.allocationId}_child`, effects: 1 };
  },
  async taskStatus(input) {
    await record({ operation: "tasks.status", input });
    return { taskId: input?.taskId, state: "active" };
  },
  async invoke(input) {
    await record({ operation: "outcomes.invoke", input });
    return { requestId: input?.requestId ?? requestId, verdict: "refused", reasonCode: "adapter-contract-pending", lifecycleState: "refused" };
  },
  async status(input) {
    await record({ operation: "outcomes.status", input });
    return {
      requestId: input?.requestId ?? requestId,
      lifecycleState: "refused",
      pass: false,
      claims: { authorization: "unchecked", dispatch: "absent", providerAcknowledgment: "absent", reconciliation: "absent", topology: "unchecked", completeness: "unchecked" },
    };
  },
}, context);

await server.connect(new StdioServerTransport());
