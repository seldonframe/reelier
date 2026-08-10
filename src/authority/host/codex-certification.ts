import { authorityDigest } from "../wire.js";
import type { TaskReceiptGraphV1 } from "../types.js";
import type { CodexDogfoodPlan, CodexDogfoodProfileConfig } from "./codex-dogfood.js";

export interface CodexCertificationEvent {
  readonly kind: "outcome";
  readonly principalId: string;
  readonly identitySource: "hook" | "body";
  readonly outcomeKey: string;
  readonly status: "dispatched" | "duplicate" | "conflict" | "partial";
  readonly digest: string;
}

export interface CodexCertificationOperations {
  readonly startProfile: (profile: CodexDogfoodProfileConfig) => Promise<Readonly<{ principalId: string; runtimeSessionId: string; providerCredentials: "absent" }>>;
  readonly stopProfile: (profile: CodexDogfoodProfileConfig) => Promise<void>;
  readonly readEvents: () => Promise<readonly CodexCertificationEvent[]>;
  readonly revokeRoot: () => Promise<boolean>;
}

export interface CodexCertificationResult {
  readonly graph: TaskReceiptGraphV1;
  readonly rootRevoked: boolean;
}

export async function runCodexCertification(input: Readonly<{ plan: CodexDogfoodPlan; operations: CodexCertificationOperations }>): Promise<CodexCertificationResult> {
  const started: CodexDogfoodProfileConfig[] = [];
  for (const profile of input.plan.profiles) {
    const session = await input.operations.startProfile(profile);
    if (session.principalId !== profile.principalId || session.runtimeSessionId !== profile.runtimeSessionId || session.providerCredentials !== "absent") throw new TypeError("Codex profile identity or credential isolation failed");
    started.push(profile);
  }
  let events: readonly CodexCertificationEvent[];
  try { events = await input.operations.readEvents(); } finally { await Promise.all(started.map(profile => input.operations.stopProfile(profile))); }
  for (const event of events) {
    if (event.identitySource !== "hook") throw new TypeError("model-supplied identity is prohibited");
    if (!input.plan.profiles.some(profile => profile.principalId === event.principalId)) throw new TypeError("Codex event principal is outside the dogfood plan");
    if (!/^sha256:[0-9a-f]{64}$/.test(event.digest)) throw new TypeError("Codex event digest is invalid");
  }
  const rootRevoked = await input.operations.revokeRoot();
  if (!rootRevoked) throw new TypeError("root revocation was not confirmed");
  const outcomes = new Map<string, string>();
  const exceptions: string[] = [];
  for (const event of events) {
    if (event.status === "dispatched" || event.status === "partial") outcomes.set(event.outcomeKey, event.digest);
    if (event.status === "conflict" || event.status === "partial") exceptions.push(event.digest);
  }
  const principals = input.plan.profiles.map(profile => profile.principalId);
  const graph: TaskReceiptGraphV1 = Object.freeze({
    v: "reelier.task-receipt-graph/v1",
    taskId: input.plan.taskId,
    rootGrantDigest: authorityDigest({ taskId: input.plan.taskId, mayDelegate: input.plan.rootMayDelegate, maxDepth: input.plan.maxDepth, maxFanOut: input.plan.maxFanOut }),
    grants: Object.freeze(input.plan.profiles.map(profile => authorityDigest({ taskId: input.plan.taskId, principalId: profile.principalId, runtimeSessionId: profile.runtimeSessionId }))),
    principals: Object.freeze(principals),
    allocations: Object.freeze(input.plan.profiles.map(profile => authorityDigest({ taskId: input.plan.taskId, principalId: profile.principalId, effects: profile.profile === "coordinator" ? 1 : 0 }))),
    budgetEvents: Object.freeze([authorityDigest({ taskId: input.plan.taskId, event: "root-revoked" })]),
    outcomes: Object.freeze([...outcomes.values()]),
    exceptions: Object.freeze(exceptions),
    topologyEvidence: Object.freeze([]),
    leases: Object.freeze([]),
    receipts: Object.freeze([...outcomes.values()]),
    priorReceiptLinks: Object.freeze([]),
  });
  return Object.freeze({ graph, rootRevoked });
}
