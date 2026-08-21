import { isProxy } from "node:util/types";
import type { AuthorityExecutionContextV1 } from "../types.js";
import { AGENT_TOOL_ABI_DIGEST_V1, parseAgentToolInputV1, parseAgentToolOutputV1, type HarnessCapabilityDescriptorV1 } from "../ingress/agent-tool-contracts.js";

export type AuthorityAgentToolContextV1 = Readonly<{ tenant: string; requester: string; executionContext?: AuthorityExecutionContextV1 }>;
export type AuthorityAgentToolOutcomeV1 = Readonly<{ requestId: string; verdict: "accepted" | "refused"; reasonCode: string; lifecycleState: string; receiptRef?: string }>;
export type AuthorityAgentStatusV1 = AuthorityAgentToolOutcomeV1 & Readonly<{ outcomeRefs: readonly string[]; capability: HarnessCapabilityDescriptorV1 }>;
export type AuthorityOutcomeProposalV1 = AuthorityAgentToolOutcomeV1 & Readonly<{ outcomeRef?: string }>;

export interface AuthorityAgentToolBackendV1 {
  readonly jobsSearch: (input: unknown, context: AuthorityAgentToolContextV1) => Promise<unknown>;
  readonly jobLoad: (input: unknown, context: AuthorityAgentToolContextV1) => Promise<unknown>;
  readonly invoke: (input: unknown, context: AuthorityAgentToolContextV1) => Promise<unknown>;
  readonly status: (input: unknown, context: AuthorityAgentToolContextV1) => Promise<unknown>;
}

export interface AuthorityAgentToolsV1 {
  readonly agentStatus: (input: unknown, context: AuthorityAgentToolContextV1) => Promise<AuthorityAgentStatusV1>;
  readonly outcomeProposal: (input: unknown, context: AuthorityAgentToolContextV1) => Promise<AuthorityOutcomeProposalV1>;
  readonly outcomeRequest: (input: unknown, context: AuthorityAgentToolContextV1) => Promise<AuthorityAgentToolOutcomeV1>;
  readonly outcomeStatus: (input: unknown, context: AuthorityAgentToolContextV1) => Promise<AuthorityAgentToolOutcomeV1>;
}

const neutralCapability: HarnessCapabilityDescriptorV1 = Object.freeze({
  v: "reelier.harness-capability/v1",
  harnessId: null,
  harnessVersion: null,
  abiDigest: AGENT_TOOL_ABI_DIGEST_V1,
  protocolCompatibility: "compatible",
  transports: Object.freeze(["mcp", "http", "openapi"] as const),
  fixtureStatus: "not-passed",
  liveTested: false,
  providerCertification: "not-claimed",
});

export function createAuthorityAgentTools(backend: AuthorityAgentToolBackendV1, _capability: HarnessCapabilityDescriptorV1 = neutralCapability): AuthorityAgentToolsV1 {
  const safeBackend = inertBackend(backend);
  const tools: AuthorityAgentToolsV1 = {
    async agentStatus(input, context) {
      parseAgentToolInputV1("reelier_agent_status", input);
      try {
        const result = record(await safeBackend.jobsSearch({}, context));
        const base = outcome(result);
        const outcomeRefs = Object.freeze(jobEntries(result.jobs).flatMap(item => {
          try {
            const entry = record(item);
            return typeof entry.jobRef === "string" && /^(?:jobref|outcomeref)_[0-9a-f]{64}$/.test(entry.jobRef) ? [entry.jobRef] : [];
          } catch { return []; }
        }).slice(0, 256));
        return parseAgentToolOutputV1("reelier_agent_status", { ...base, outcomeRefs, capability: neutralCapability }) as AuthorityAgentStatusV1;
      } catch { return parseAgentToolOutputV1("reelier_agent_status", { requestId: "", verdict: "refused", reasonCode: "agent-status-unavailable", lifecycleState: "unavailable", outcomeRefs: Object.freeze([]), capability: neutralCapability }) as AuthorityAgentStatusV1; }
    },
    async outcomeProposal(input, context) {
      const parsed = parseAgentToolInputV1("reelier_outcome_proposal", input);
      try {
        const result = record(await safeBackend.jobLoad({ jobId: parsed.outcomeRef }, context));
        const base = outcome(result);
        const outcomeRef = typeof result.jobRef === "string" && result.jobRef === parsed.outcomeRef ? result.jobRef : undefined;
        return parseAgentToolOutputV1("reelier_outcome_proposal", { ...base, ...(outcomeRef ? { outcomeRef } : {}) }) as AuthorityOutcomeProposalV1;
      } catch { return parseAgentToolOutputV1("reelier_outcome_proposal", { requestId: "", verdict: "refused", reasonCode: "outcome-proposal-unavailable", lifecycleState: "unavailable" }) as AuthorityOutcomeProposalV1; }
    },
    async outcomeRequest(input, context) {
      const parsed = parseAgentToolInputV1("reelier_outcome_request", input);
      try {
        return parseAgentToolOutputV1("reelier_outcome_request", outcome(record(await safeBackend.invoke({ v: "reelier.outcome-request/v1", jobRef: parsed.outcomeRef, requestId: parsed.requestId, sourceRefs: parsed.sourceRefs, choices: parsed.choices }, context)))) as AuthorityAgentToolOutcomeV1;
      } catch { return Object.freeze({ requestId: String(parsed.requestId), verdict: "refused", reasonCode: "outcome-request-unavailable", lifecycleState: "unavailable" }); }
    },
    async outcomeStatus(input, context) {
      const parsed = parseAgentToolInputV1("reelier_outcome_status", input);
      try { return parseAgentToolOutputV1("reelier_outcome_status", outcome(record(await safeBackend.status({ requestId: parsed.requestId }, context)))) as AuthorityAgentToolOutcomeV1; }
      catch { return Object.freeze({ requestId: String(parsed.requestId), verdict: "refused", reasonCode: "outcome-status-unavailable", lifecycleState: "unavailable" }); }
    },
  };
  return Object.freeze(tools);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("agent tool backend response is not an inert record");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = descriptors[key as keyof typeof descriptors];
    if (typeof key !== "string" || !descriptor || !("value" in descriptor) || descriptor.get || descriptor.set || !descriptor.enumerable) throw new TypeError("agent tool backend response is not an inert data record");
  }
  return value as Record<string, unknown>;
}

function inertBackend(value: unknown): AuthorityAgentToolBackendV1 {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("agent tool backend is not an inert record or is a proxy");
  const descriptors = Object.getOwnPropertyDescriptors(value), methods = ["jobsSearch", "jobLoad", "invoke", "status"] as const;
  for (const method of methods) if (!descriptors[method]?.enumerable || !("value" in descriptors[method]!) || typeof descriptors[method]!.value !== "function") throw new TypeError("agent tool backend method is invalid");
  return Object.freeze(Object.fromEntries(methods.map(method => [method, descriptors[method]!.value])) as unknown as AuthorityAgentToolBackendV1);
}

function jobEntries(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  if (isProxy(value) || value.length > 256) throw new TypeError("agent tool backend jobs are hostile or exceed the bound");
  const descriptors = Object.getOwnPropertyDescriptors(value), output: unknown[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError("agent tool backend jobs must contain inert data entries");
    output.push(descriptor.value);
  }
  return Object.freeze(output);
}

function outcome(value: Record<string, unknown>): AuthorityAgentToolOutcomeV1 {
  if (typeof value.requestId !== "string" || value.requestId.length > 256 || (value.verdict !== "accepted" && value.verdict !== "refused") || typeof value.reasonCode !== "string" || typeof value.lifecycleState !== "string" || (value.receiptRef !== undefined && typeof value.receiptRef !== "string")) throw new TypeError("agent tool backend outcome is invalid");
  return Object.freeze({ requestId: value.requestId, verdict: value.verdict, reasonCode: value.reasonCode, lifecycleState: value.lifecycleState, ...(typeof value.receiptRef === "string" ? { receiptRef: value.receiptRef } : {}) });
}
