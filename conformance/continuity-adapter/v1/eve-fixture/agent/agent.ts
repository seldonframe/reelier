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

export default defineAgent({
  modelContextWindowTokens: 128_000,
  model: mockModel(({ lastUserMessage, messages, toolResults }) => {
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
