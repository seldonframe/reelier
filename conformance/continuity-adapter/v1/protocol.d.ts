import type { ContinuityEventV1, ContinuityRuntimeAdapterV1 } from "reelier/continuity";

export interface CandidateBindingV1 { readonly taskId: string; readonly principalId: string; readonly workloadId: string; readonly runtimeSessionId: string; readonly harnessId: string; }
export interface CandidateCountersV1 { readonly outcomeRequests: number; readonly statusReads: number; readonly providerDispatches: number; readonly reservations: number; }
export interface ContinuityAdapterCandidateV1 {
  readonly descriptor: { readonly v: "reelier.continuity-adapter-candidate/v1"; readonly adapterId: string; readonly harnessId: string; readonly harnessVersion: string; readonly reelierCommit: string; readonly authorityAdapterContractDigest: string; };
  provision(events: readonly ContinuityEventV1[]): Promise<void>;
  adapter(binding: CandidateBindingV1): Promise<ContinuityRuntimeAdapterV1>;
  counters(): Promise<CandidateCountersV1>;
  close(): Promise<void>;
}
export function createCandidate(input: Readonly<{ scenarioId: string; mutation?: "dispatch-on-open" | "identity-from-input" | "unchecked-as-verified" | "replacement-state-loss" | "reserve-on-repeat-open" | "ambiguous-open-resend" | "status-side-effects" | "mutate-then-throw" | "missing-close" | "rejecting-close" | "zero-digest" | "malformed-semver"; }>): Promise<ContinuityAdapterCandidateV1>;
