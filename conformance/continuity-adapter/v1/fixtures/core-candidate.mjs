import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authorityCanonicalBytes, AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST } from "reelier/authority";
import { FsContinuityLedger, createContinuityRuntimeAdapter } from "reelier/continuity";

const digest = (letter) => `sha256:${letter.repeat(64)}`;

export async function createCandidate({ scenarioId, mutation }) {
  const root = await mkdtemp(join(tmpdir(), "reelier-continuity-conformance-"));
  const outcomes = new Map();
  const counters = { outcomeRequests: 0, statusReads: 0, providerDispatches: 0, reservations: 0 };
  const host = { v: "reelier.authenticated-workload/v1", taskId: "task_1", principalId: "principal_1", workloadId: "workload_1", runtimeSessionId: "session_1", harnessId: "core" };
  let events = [];
  let adapterCalls = 0;
  const requestOutcome = async (_actor, input) => {
    counters.outcomeRequests += 1;
    const existing = outcomes.get(input.requestId);
    const requestBytes = authorityCanonicalBytes(input);
    if (existing && !existing.requestBytes.equals(requestBytes)) return Object.freeze({ requestId: input.requestId, verdict: "refused", reasonCode: "request-id-conflict", lifecycleState: "refused" });
    if (existing) return existing.outcome;
    counters.reservations += 1;
    counters.providerDispatches += 1;
    const created = Object.freeze({ requestId: input.requestId, verdict: "accepted", reasonCode: "accepted", lifecycleState: "ambiguous" });
    outcomes.set(input.requestId, { requestBytes, outcome: created });
    return created;
  };
  const statusOutcome = async (_actor, input) => {
    counters.statusReads += 1;
    if (mutation === "status-side-effects") { counters.outcomeRequests += 1; counters.reservations += 1; counters.providerDispatches += 1; }
    return outcomes.get(input.requestId)?.outcome ?? Object.freeze({ requestId: input.requestId, verdict: "refused", reasonCode: "status-absent", lifecycleState: "absent" });
  };
  return Object.freeze({
    descriptor: Object.freeze({ v: "reelier.continuity-adapter-candidate/v1", adapterId: "core", harnessId: "core", harnessVersion: mutation === "malformed-semver" ? "1.2.3-." : "1.0.0", reelierCommit: "44d512263b3e77a301b4d875ab03217712b17c37", authorityAdapterContractDigest: mutation === "zero-digest" ? digest("0") : AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST }),
    async provision(next) { events = [...next]; },
    async adapter(binding) {
      adapterCalls += 1;
      const actor = mutation === "identity-from-input" ? { ...host, taskId: `${binding.taskId}_other` } : host;
      const ledgerRoot = mutation === "replacement-state-loss" && adapterCalls > 1 ? join(root, "replacement-lost") : root;
      const base = createContinuityRuntimeAdapter({ ledger: new FsContinuityLedger(ledgerRoot), identify: async () => actor, requestOutcome, statusOutcome });
      const originalOpen = base.open.bind(base);
      const originalCheckpoint = base.checkpoint.bind(base);
      return Object.freeze({ ...base,
        async open(taskId) {
          if (mutation === "dispatch-on-open" || (mutation === "reserve-on-repeat-open" && adapterCalls > 0)) counters.providerDispatches += 1;
          if (mutation === "reserve-on-repeat-open" || (mutation === "ambiguous-open-resend" && scenarioId === "ambiguity-blocks-resend")) counters.reservations += 1;
          const projection = await originalOpen(taskId);
          if (mutation === "unchecked-as-verified") return Object.freeze({ ...projection, sections: { ...projection.sections, evidenceAndUncertainty: { ...projection.sections.evidenceAndUncertainty, uncertainClaims: [], uncertainConsequences: [] } } });
          return projection;
        },
        async checkpoint(input) {
          if (mutation === "mutate-then-throw" && (input.taskId !== host.taskId || input.actorPrincipalId !== host.principalId || input.workloadId !== host.workloadId)) { await originalCheckpoint({ ...input, taskId: host.taskId, actorPrincipalId: host.principalId, workloadId: host.workloadId, proposedEvents: [{ type: "claim.recorded", eventId: "mutation_1", claimId: "mutation_1", statement: "mutated", status: "unchecked", evidenceDigest: null }] }); throw new Error("refused after mutation"); }
          return originalCheckpoint(input);
        },
      });
    },
    async counters() { return Object.freeze({ ...counters }); },
    ...(mutation === "missing-close" ? {} : { async close() { await rm(root, { recursive: true, force: true }); if (mutation === "rejecting-close") throw new Error("cleanup refused"); } }),
  });
}
