import type { RouteCoverageV1 } from "../routes/types.js";
import type { RuntimeDescriptorV1 } from "../runtime/types.js";

export type { RouteCoverageV1, RuntimeDescriptorV1 };

export interface AgentProjectV1 {
  readonly v: "reelier.agent-project/v1";
  readonly agentName: string;
  readonly projectId: string;
  readonly tenant: string | null;
  readonly reelierVersion: string;
  readonly installedBuildDigest: string;
  readonly packageTarballIntegrityDigest: string | null;
  readonly authorityContractDigest: string;
  readonly continuityContractDigest: string;
  readonly outcomeProfileContractDigest: string;
  readonly bootstrapContractDigest: string;
  readonly initializationReportDigest: string;
  readonly runtimeDescriptorDigest: string;
  readonly routeCoverageDigest: string;
  readonly profileGovernanceRef: string | null;
  readonly profileGovernanceManifestDigest: string | null;
  readonly profileTrustHeadDigest: string | null;
  readonly authorityMode: "unconfigured" | "managed-cell" | "self-hosted-linux-cell";
}

export interface BootstrapReportV1 {
  readonly v: "reelier.bootstrap-report/v1";
  readonly projectDigest: string;
  readonly runtimeDescriptorDigest: string;
  readonly routeCoverageDigest: string;
  readonly initializedAt: string;
  readonly canary: "verified" | "failed" | "unchecked" | "absent";
  readonly authority: "activated" | "unavailable";
  readonly recoveryCommand: string;
  readonly completeness: "not-proved";
}

export interface SupervisorStatusV1 {
  readonly v: "reelier.supervisor-status/v1";
  readonly observedAt: string;
  readonly observedRoutes: number;
  readonly partialRoutes: number;
  readonly uncoveredRoutes: number;
  readonly unknownRoutes: number;
  readonly replayAvailable: number;
  readonly replayCandidates: number;
  readonly outcomesActivated: number;
  readonly outcomesUnavailable: number;
  readonly outcomesEnforced: number;
  readonly runtime: "local-process" | "externally-managed";
  readonly completeness: "not-proved";
}

export interface AuthorityCellSessionBindingV1 {
  readonly v: "reelier.authority-cell-session-binding/v1";
  readonly cellId: string;
  readonly adapterContractDigest: string;
  readonly authorityContractDigest: string;
  readonly tenant: string;
  readonly principalId: string;
  readonly taskId: string;
  readonly runtimeSessionId: string;
  readonly jobId: string;
  readonly jobCardDigest: string;
  readonly grantId: string;
  readonly grantDigest: string;
  readonly allocationId: string;
  readonly profileDigest: string;
  readonly activationDigest: string;
  readonly profileTrustHeadDigest: string;
  readonly expiresAt: string;
  readonly bindingObservedAt: string;
  readonly bindingFreshUntil: string;
  readonly topologyEvidenceDigest: string | null;
  readonly topologyFreshUntil: string | null;
}

export interface AuthorityCellSessionBindingVerificationV1 {
  readonly observationTime: string;
  readonly cellId: string;
  readonly adapterContractDigest: string;
  readonly authorityContractDigest: string;
  readonly tenant: string;
  readonly principalId: string;
  readonly taskId: string;
  readonly runtimeSessionId: string;
  readonly jobId: string;
  readonly jobCardDigest: string;
  readonly grantId: string;
  readonly grantDigest: string;
  readonly allocationId: string;
  readonly profileDigest: string;
  readonly activationDigest: string;
  readonly profileTrustHeadDigest: string;
  readonly principalSession: Readonly<{ tenant: string; principalId: string; grantId: string; expiresAt: string }>;
}
