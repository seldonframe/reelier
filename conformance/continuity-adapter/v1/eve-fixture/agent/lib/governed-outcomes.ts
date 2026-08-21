import type { AuthorityAgentToolOutcomeV1, AuthorityAgentToolsV1 } from "../../../../../../src/authority/host/agent-tools.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const OPAQUE_REF = /^(?:jobref|outcomeref)_[0-9a-f]{64}$/;

export interface EveGovernedMissionV1 {
  readonly kind: "github-linear-composite" | "linear-only";
  readonly missionId: string;
  readonly grantId: string;
  readonly allocationId: string;
  readonly runtimeSessionId: string;
  readonly authorityCellId: string;
  readonly outcomeRef: string;
  readonly requestId: string;
  readonly promptDigest: string;
}

export interface EveGovernedOutcomeRecordV1 {
  readonly kind: EveGovernedMissionV1["kind"];
  readonly missionId: string;
  readonly grantId: string;
  readonly allocationId: string;
  readonly runtimeSessionId: string;
  readonly authorityCellId: string;
  readonly requestId: string;
  readonly promptDigest: string;
  readonly lifecycleState: "reconciled";
  readonly receiptRef: string;
}

export interface EveGovernedOutcomesReportV1 {
  readonly v: "reelier.eve-governed-outcomes-rehearsal/v1";
  readonly harness: Readonly<{ id: "eve"; version: "0.39.0"; fixturePassed: true; providerCertification: "not-claimed" }>;
  readonly activationConfirmations: 1;
  readonly routineApprovals: 0;
  readonly processRestarts: 1;
  readonly reconciledOutcomes: 2;
  readonly postRunReviews: 1;
  readonly outcomesPerReview: 2;
  readonly durableRecords: readonly EveGovernedOutcomeRecordV1[];
  readonly logs: readonly string[];
}

/** Deterministic Eve rehearsal over the public quartet. Provider identity, credentials, destination,
 * status IDs, merge policy, and signing authority cannot enter this input. The only prompt-derived
 * durable field is its digest. */
export async function runEveGovernedOutcomeRehearsalV1(input: Readonly<{
  missions: readonly EveGovernedMissionV1[];
  tools: AuthorityAgentToolsV1;
  restart: () => Promise<AuthorityAgentToolsV1>;
  confirmStandingActivation: () => Promise<void>;
  reviewOutcomes: (outcomes: readonly EveGovernedOutcomeRecordV1[]) => Promise<void>;
}>): Promise<EveGovernedOutcomesReportV1> {
  const missions = parseMissions(input.missions);
  assertTools(input.tools);
  if (typeof input.restart !== "function" || typeof input.confirmStandingActivation !== "function" || typeof input.reviewOutcomes !== "function") throw new TypeError("Eve governed-outcomes ports are invalid");

  await input.confirmStandingActivation();
  let tools = input.tools;
  const status = await tools.agentStatus({}, emptyContext());
  if (status.verdict !== "accepted" || status.capability.harnessId !== "eve" || status.capability.harnessVersion !== "0.39.0" || !status.capability.liveTested) throw new TypeError("Eve quartet capability is not fixture-bound");
  if (missions.some(mission => !status.outcomeRefs.includes(mission.outcomeRef))) throw new TypeError("Eve mission Outcome reference is unavailable");

  const durableRecords: EveGovernedOutcomeRecordV1[] = [];
  const logs: string[] = [];
  let restarted = false;
  for (const mission of missions) {
    const proposal = await tools.outcomeProposal({ outcomeRef: mission.outcomeRef }, emptyContext());
    if (proposal.verdict !== "accepted" || proposal.outcomeRef !== mission.outcomeRef) throw new TypeError("Eve Outcome proposal was refused");
    const requested = await tools.outcomeRequest({ outcomeRef: mission.outcomeRef, requestId: mission.requestId, sourceRefs: {}, choices: {} }, emptyContext());
    if (requested.verdict !== "accepted") throw new TypeError("Eve Outcome request was refused");
    if (requested.lifecycleState === "ambiguous" || requested.lifecycleState === "pending") {
      if (restarted) throw new TypeError("Eve rehearsal permits exactly one ambiguity restart");
      tools = await input.restart();
      assertTools(tools);
      restarted = true;
    }
    const reconciled = await tools.outcomeStatus({ requestId: mission.requestId }, emptyContext());
    assertReconciled(reconciled, mission.requestId);
    const record = Object.freeze({
      kind: mission.kind,
      missionId: mission.missionId,
      grantId: mission.grantId,
      allocationId: mission.allocationId,
      runtimeSessionId: mission.runtimeSessionId,
      authorityCellId: mission.authorityCellId,
      requestId: mission.requestId,
      promptDigest: mission.promptDigest,
      lifecycleState: "reconciled" as const,
      receiptRef: reconciled.receiptRef!,
    });
    durableRecords.push(record);
    logs.push(`${mission.missionId}:reconciled`);
  }
  if (!restarted) throw new TypeError("Eve rehearsal did not exercise process restart after ambiguity");
  const frozenRecords = Object.freeze(durableRecords);
  await input.reviewOutcomes(frozenRecords);
  return Object.freeze({
    v: "reelier.eve-governed-outcomes-rehearsal/v1",
    harness: Object.freeze({ id: "eve", version: "0.39.0", fixturePassed: true, providerCertification: "not-claimed" }),
    activationConfirmations: 1,
    routineApprovals: 0,
    processRestarts: 1,
    reconciledOutcomes: 2,
    postRunReviews: 1,
    outcomesPerReview: 2,
    durableRecords: frozenRecords,
    logs: Object.freeze(logs),
  });
}

function parseMissions(value: readonly EveGovernedMissionV1[]): readonly EveGovernedMissionV1[] {
  if (!Array.isArray(value) || value.length !== 2 || Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError("Eve rehearsal requires exactly two missions");
  const parsed = value.map((mission, index) => {
    if (!mission || typeof mission !== "object" || Array.isArray(mission) || Object.getPrototypeOf(mission) !== Object.prototype) throw new TypeError("Eve mission must be an inert record");
    const allowed = ["kind", "missionId", "grantId", "allocationId", "runtimeSessionId", "authorityCellId", "outcomeRef", "requestId", "promptDigest"];
    const descriptors = Object.getOwnPropertyDescriptors(mission);
    if (Reflect.ownKeys(mission).length !== allowed.length || Reflect.ownKeys(mission).some(key => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) throw new TypeError("Eve mission contract is closed and inert");
    if (mission.kind !== (index === 0 ? "github-linear-composite" : "linear-only")) throw new TypeError("Eve mission kinds or order are invalid");
    for (const key of ["missionId", "grantId", "allocationId", "runtimeSessionId", "authorityCellId", "requestId"] as const) if (typeof mission[key] !== "string" || mission[key].length < 1 || mission[key].length > 128) throw new TypeError(`Eve mission ${key} is invalid`);
    if (!OPAQUE_REF.test(mission.outcomeRef) || !DIGEST.test(mission.promptDigest)) throw new TypeError("Eve mission commitments are invalid");
    return Object.freeze({ ...mission });
  });
  for (const key of ["missionId", "grantId", "allocationId", "runtimeSessionId", "authorityCellId", "outcomeRef", "requestId"] as const) if (new Set(parsed.map(mission => mission[key])).size !== parsed.length) throw new TypeError(`Eve missions must carry fresh ${key} values`);
  return Object.freeze(parsed);
}

function assertTools(value: AuthorityAgentToolsV1): void {
  if (!value || typeof value !== "object" || typeof value.agentStatus !== "function" || typeof value.outcomeProposal !== "function" || typeof value.outcomeRequest !== "function" || typeof value.outcomeStatus !== "function") throw new TypeError("Eve quartet is unavailable");
}

function assertReconciled(value: AuthorityAgentToolOutcomeV1, requestId: string): void {
  if (value.requestId !== requestId || value.verdict !== "accepted" || value.lifecycleState !== "reconciled" || typeof value.receiptRef !== "string" || value.receiptRef.length < 1) throw new TypeError("Eve Outcome did not reconcile with a receipt");
}

function emptyContext() {
  return Object.freeze({ tenant: "fixture-host-owned", requester: "fixture-host-owned" });
}
