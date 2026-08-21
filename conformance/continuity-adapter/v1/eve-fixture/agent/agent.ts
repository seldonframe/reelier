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

/** The ONE message that drives the remote-Cell smoke (`scripts/eve-remote-smoke.mjs`). It is a
 * separate branch, ahead of the generic tool-result echo, so every loopback scenario the continuity
 * matrix drives keeps its exact previous behaviour. */
const REMOTE_CELL_TASK = "search and load one job";
const GOVERNED = /^governed (run|resume) (composite|linear-only) (request_[a-z0-9_]+)$/u;

function cellRecord(output: unknown): Record<string, unknown> | null {
  return output && typeof output === "object" && !Array.isArray(output) ? output as Record<string, unknown> : null;
}

function cellString(output: unknown, key: string): string | null {
  const value = cellRecord(output)?.[key];
  return typeof value === "string" ? value : null;
}

function cellJobRefs(output: unknown): string[] {
  const jobs = cellRecord(output)?.jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs.flatMap((job) => {
    const jobRef = cellString(job, "jobRef");
    return jobRef === null ? [] : [jobRef];
  });
}

function cellOutcomeRefs(output: unknown): string[] {
  const outcomeRefs = cellRecord(output)?.outcomeRefs;
  return Array.isArray(outcomeRefs) ? outcomeRefs.filter((value): value is string => typeof value === "string") : [];
}

export default defineAgent({
  modelContextWindowTokens: 128_000,
  model: mockModel(({ lastUserMessage, messages, toolResults }) => {
    const governed = GOVERNED.exec(lastUserMessage ?? "");
    if (governed) {
      const [, phase, kind, requestId] = governed;
      if (phase === "resume") {
        const status = toolResults.filter(result => result.name === "reelier_outcome_status").at(-1);
        if (!status) return { toolCalls: [{ name: "reelier_outcome_status", input: { requestId } }] };
        return { text: JSON.stringify({ v:"reelier.eve-governed-mission/v1",kind,requestId,lifecycleState:cellString(status.output,"lifecycleState"),receiptRef:cellString(status.output,"receiptRef") }) };
      }
      const status = toolResults.filter(result => result.name === "reelier_agent_status").at(-1);
      if (!status) return { toolCalls: [{ name: "reelier_agent_status", input: {} }] };
      const refs = cellOutcomeRefs(status.output), outcomeRef = refs[kind === "composite" ? 0 : 1];
      const proposal = toolResults.filter(result => result.name === "reelier_outcome_proposal").at(-1);
      if (!proposal && outcomeRef) return { toolCalls: [{ name:"reelier_outcome_proposal",input:{outcomeRef} }] };
      const requested = toolResults.filter(result => result.name === "reelier_outcome_request").at(-1);
      if (!requested && outcomeRef) return { toolCalls: [{name:"reelier_outcome_request",input:{outcomeRef,requestId,sourceRefs:{authorization:process.env.REELIER_AUTHORIZATION_HANDLE},choices:{}}}] };
      return { text: JSON.stringify({v:"reelier.eve-governed-restart-boundary/v1",kind,requestId,lifecycleState:requested?cellString(requested.output,"lifecycleState"):null}) };
    }
    if (lastUserMessage === REMOTE_CELL_TASK) {
      const searched = toolResults.filter((result) => result.name === "reelier_agent_status").at(-1);
      if (!searched) return { toolCalls: [{ name: "reelier_agent_status", input: {} }] };
      const loaded = toolResults.filter((result) => result.name === "reelier_outcome_proposal").at(-1);
      const jobRefs = searched.isError ? [] : cellOutcomeRefs(searched.output);
      if (!loaded && jobRefs.length > 0) return { toolCalls: [{ name: "reelier_outcome_proposal", input: { outcomeRef: jobRefs[0] } }] };
      return {
        text: JSON.stringify({
          v: "reelier.eve-remote-cell-smoke/v1",
          jobRefCount: jobRefs.length,
          searchVerdict: searched.isError ? null : cellString(searched.output, "verdict"),
          loadedJobRef: loaded && !loaded.isError ? cellString(loaded.output, "outcomeRef") : null,
          loadedAlias: null,
          loadVerdict: loaded && !loaded.isError ? cellString(loaded.output, "verdict") : null,
          toolError: searched.isError ? "reelier_jobs_search" : loaded?.isError ? "reelier_job_load" : null,
        }),
      };
    }
    if (toolResults.length > 0 && messages.at(-1)?.role === "tool") {
      return { text: JSON.stringify(toolResults.at(-1)?.output) };
    }
    if (lastUserMessage === "checkpoint") return { toolCalls: [{ name: "continuity_checkpoint", input: checkpointInput }] };
    if (lastUserMessage === "request outcome") return { toolCalls: [{ name: "reelier_outcome_request", input: outcomeInput }] };
    if (lastUserMessage === "read status") return { toolCalls: [{ name: "reelier_outcome_status", input: { requestId: "request_eve_1" } }] };
    if (lastUserMessage === "inspect resume") {
      const hasResume = messages.some((message) => message.role === "system" && message.text.includes("Eve checkpoint outcome"));
      return { text: hasResume ? "resume context present" : "resume context missing" };
    }
    return { text: "continuity ready" };
  }),
});
