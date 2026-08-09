import { authorityDigest } from "../authority/wire.js";

export type ObservationCoverage = "observed" | "partially_observed" | "uncovered" | "unknown";
export type ObservationEffect = "read" | "idempotent-write" | "destructive" | "unknown";

export interface ObservedActionV1 {
  readonly v: "reelier.observed-action/v1";
  readonly adapterId: string;
  readonly sessionId: string;
  readonly actionId: string;
  readonly tool: string;
  readonly fieldNames: readonly string[];
  readonly sourceKinds: readonly string[];
  readonly destinationKinds: readonly string[];
  readonly effect: ObservationEffect;
  readonly coverage: ObservationCoverage;
  readonly readBackTools: readonly string[];
  readonly observedAt: string;
}

export interface BoundableTaskCandidateV1 {
  readonly v: "reelier.boundable-task-candidate/v1";
  readonly candidateId: string;
  readonly shapeDigest: string;
  readonly occurrences: number;
  readonly actions: readonly ObservedActionV1[];
  readonly transitions: readonly { readonly from: string; readonly to: string; readonly effect: ObservationEffect }[];
  readonly unresolvedActions: readonly string[];
  readonly compatiblePacks: readonly string[];
  readonly coverage: ObservationCoverage;
  readonly limitations: readonly string[];
}

export interface ShadowReportV1 {
  readonly v: "reelier.shadow-report/v1";
  readonly candidateId: string;
  readonly status: "ready" | "needs_human_definition" | "unsupported";
  readonly reasonCodes: readonly string[];
  readonly proposedAliases: readonly string[];
  readonly observedCoverage: ObservationCoverage;
  readonly reportDigest: string;
}

export interface ObservationAdapterV1 {
  readonly id: string;
  readonly host: "mcp" | "codex" | "claude-code" | "cursor" | "openclaw" | "eve" | "hermes" | "herdr";
  observe(input: unknown): readonly ObservedActionV1[];
}

export function normalizeObservedAction(value: unknown): ObservedActionV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("observed action must be an object");
  const raw = value as Record<string, unknown>;
  const strings = (name: string): readonly string[] => {
    const v = raw[name];
    if (!Array.isArray(v) || v.some(item => typeof item !== "string")) throw new TypeError(`${name} must be a string array`);
    return Object.freeze([...new Set(v)].sort());
  };
  const coverage = raw.coverage;
  const effect = raw.effect;
  if (raw.v !== "reelier.observed-action/v1" || typeof raw.adapterId !== "string" || typeof raw.sessionId !== "string" || typeof raw.actionId !== "string" || typeof raw.tool !== "string" || typeof raw.observedAt !== "string") throw new TypeError("observed action fields are invalid");
  if (!["observed", "partially_observed", "uncovered", "unknown"].includes(String(coverage))) throw new TypeError("invalid observation coverage");
  if (!["read", "idempotent-write", "destructive", "unknown"].includes(String(effect))) throw new TypeError("invalid observation effect");
  return Object.freeze({ v: raw.v, adapterId: raw.adapterId, sessionId: raw.sessionId, actionId: raw.actionId, tool: raw.tool, fieldNames: strings("fieldNames"), sourceKinds: strings("sourceKinds"), destinationKinds: strings("destinationKinds"), effect: effect as ObservationEffect, coverage: coverage as ObservationCoverage, readBackTools: strings("readBackTools"), observedAt: raw.observedAt });
}

export function clusterObservedActions(actions: readonly ObservedActionV1[], candidateId: string, occurrences = 1, compatiblePacks: readonly string[] = []): BoundableTaskCandidateV1 {
  if (!candidateId || !Number.isSafeInteger(occurrences) || occurrences < 1) throw new TypeError("candidate identity is invalid");
  const normalized = actions.map(normalizeObservedAction).sort((a, b) => a.tool.localeCompare(b.tool) || a.actionId.localeCompare(b.actionId));
  const shape = normalized.map(a => ({ tool: a.tool, fieldNames: a.fieldNames, sourceKinds: a.sourceKinds, destinationKinds: a.destinationKinds, effect: a.effect, readBackTools: a.readBackTools }));
  const unresolved = normalized.filter(a => a.effect === "unknown" || a.coverage !== "observed").map(a => a.tool);
  const compatible = [...new Set(compatiblePacks)].sort();
  const coverage: ObservationCoverage = normalized.some(a => a.coverage === "uncovered" || a.coverage === "unknown") ? "unknown" : normalized.some(a => a.coverage === "partially_observed") ? "partially_observed" : "observed";
  return Object.freeze({ v: "reelier.boundable-task-candidate/v1", candidateId, shapeDigest: authorityDigest({ v: "reelier.observation-shape/v1", shape }), occurrences, actions: Object.freeze(normalized), transitions: Object.freeze(normalized.map(a => Object.freeze({ from: a.sourceKinds[0] ?? "unknown", to: a.destinationKinds[0] ?? "unknown", effect: a.effect }))), unresolvedActions: Object.freeze([...new Set(unresolved)]), compatiblePacks: Object.freeze(compatible), coverage, limitations: Object.freeze(unresolved.length ? ["unresolved-actions"] : []) });
}

export function createShadowReport(candidate: BoundableTaskCandidateV1, proposedAliases: readonly string[] = []): ShadowReportV1 {
  const status: ShadowReportV1["status"] = candidate.coverage === "unknown" || candidate.unresolvedActions.length > 0 ? (candidate.compatiblePacks.length ? "needs_human_definition" : "unsupported") : candidate.compatiblePacks.length ? "ready" : "unsupported";
  const base = { v: "reelier.shadow-report/v1" as const, candidateId: candidate.candidateId, status, reasonCodes: candidate.unresolvedActions.length ? ["unresolved-actions"] : candidate.compatiblePacks.length ? [] : ["no-reviewed-pack"], proposedAliases: Object.freeze([...proposedAliases]), observedCoverage: candidate.coverage };
  return Object.freeze({ ...base, reportDigest: authorityDigest(base) });
}

export type { ObservationHost, ObservationEnvelopeV1, ObservationService } from "./live.js";
export { createObservationAdapter, createObservationService, matchInstalledPacks, parseObservationEnvelope } from "./live.js";
