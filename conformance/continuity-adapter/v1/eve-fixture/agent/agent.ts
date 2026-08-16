import { defineAgent } from "eve";
import { mockModel } from "eve/evals";

const checkpointInput = {
  events: [{
    type: "task.opened",
    eventId: "event_eve_opened",
    outcome: "Eve checkpoint outcome",
    completionProjection: "The deterministic Eve conformance run completes without a failed action.",
    nonGoals: ["external model calls"],
  }],
  evidenceRefs: [],
  expectedCursor: 0,
  agentMemo: "Recorded by the deterministic Eve fixture.",
};

const outcomeInput = {
  choices: { label: "ready" },
  requestId: "request_eve_1",
  sourceRefs: { issue: "issue_1" },
};

const adapterV0Suffix = process.env.REELIER_EVE_AGENT_ADAPTER_V0_SUFFIX ?? "";
const adapterV0TaskId = `task_eve_process${adapterV0Suffix}`;
const adapterV0ChildPrincipalId = `principal_eve_1_child${adapterV0Suffix}`;
const adapterV0GrantId = `grant_eve_process_root_child${adapterV0Suffix}`;

const contractRequestInput = {
  sourceRefs: { issue: "issue_1" },
  choices: { label: "ready" },
  requestId: `request_eve_contract_1${adapterV0Suffix}`,
};

function previousToolOutput(messages: readonly { role: string; text?: string }[]): Record<string, any> | undefined {
  const message = [...messages].reverse().find(item => item.role === "tool");
  if (!message?.text) return undefined;
  try {
    const value = JSON.parse(message.text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined;
  } catch {
    return undefined;
  }
}

function previousToolOutputWithJobRef(messages: readonly { role: string; text?: string }[]): Record<string, any> | undefined {
  for (const message of [...messages].reverse()) {
    if (message.role !== "tool" || !message.text) continue;
    try {
      const value = JSON.parse(message.text) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).jobRef === "string") return value as Record<string, any>;
    } catch {}
  }
  return undefined;
}

export default defineAgent({
  modelContextWindowTokens: 128_000,
  model: mockModel(({ lastUserMessage, messages, toolResults }) => {
    if (toolResults.length > 0 && messages.at(-1)?.role === "tool") {
      return { text: JSON.stringify(toolResults.at(-1)?.output) };
    }
    if (lastUserMessage === "checkpoint") return { toolCalls: [{ name: "continuity_checkpoint", input: checkpointInput }] };
    if (lastUserMessage === "request outcome") return { toolCalls: [{ name: "reelier_outcome_request", input: outcomeInput }] };
    if (lastUserMessage === "read status") return { toolCalls: [{ name: "reelier_outcome_status", input: { requestId: "request_eve_1" } }] };
    if (lastUserMessage === "adapter contract") return { toolCalls: [{ name: "reelier_adapter_contract", input: {} }] };
    if (lastUserMessage === "adapter catalog") return { toolCalls: [{ name: "reelier_jobs_search", input: { query: "reversible record state" } }] };
    if (lastUserMessage === "adapter load") {
      const jobRef = previousToolOutput(messages)?.jobs?.[0]?.jobRef;
      if (typeof jobRef !== "string") return { text: "catalog discovery missing" };
      return { toolCalls: [{ name: "reelier_job_load", input: { jobId: jobRef } }] };
    }
    if (lastUserMessage === "adapter delegation") return { toolCalls: [{ name: "reelier_delegation_request", input: { child: { principalId: adapterV0ChildPrincipalId }, effects: 1 } }] };
    if (lastUserMessage === "adapter delegation status") return { toolCalls: [{ name: "reelier_delegation_status", input: { grantId: adapterV0GrantId } }] };
    if (lastUserMessage === "adapter task status") return { toolCalls: [{ name: "reelier_task_status", input: { taskId: adapterV0TaskId } }] };
    if (lastUserMessage === "adapter invoke v0") {
      const jobRef = previousToolOutputWithJobRef(messages)?.jobRef;
      if (typeof jobRef !== "string") return { text: "job load missing" };
      return { toolCalls: [{ name: "reelier_agent_adapter_v0_outcome_invoke", input: { ...contractRequestInput, jobRef } }] };
    }
    if (lastUserMessage === "adapter status v0") {
      return { toolCalls: [{ name: "reelier_agent_adapter_v0_outcome_status", input: { requestId: contractRequestInput.requestId } }] };
    }
    if (lastUserMessage === "adapter invoke") {
      const jobRef = previousToolOutputWithJobRef(messages)?.jobRef;
      if (typeof jobRef !== "string") return { text: "job load missing" };
      return { toolCalls: [{ name: "reelier_outcome_invoke", input: { ...contractRequestInput, jobRef } }] };
    }
    if (lastUserMessage === "adapter status") return { toolCalls: [{ name: "reelier_outcome_status", input: { requestId: contractRequestInput.requestId } }] };
    if (lastUserMessage === "inspect resume") {
      const hasResume = messages.some((message) => message.role === "system" && message.text.includes("Eve checkpoint outcome"));
      return { text: hasResume ? "resume context present" : "resume context missing" };
    }
    return { text: "continuity ready" };
  }),
});
