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
    return outcomes.get(input.requestId)?.outcome ?? Object.freeze({ requestId: input.requestId, verdict: "refused", reasonCode: "status-absent", lifecycleState: "absent" });
  };
  return Object.freeze({
    descriptor: Object.freeze({ v: "reelier.continuity-adapter-candidate/v1", adapterId: "core", harnessId: "core", harnessVersion: "1.0.0", reelierCommit: "44d512263b3e77a301b4d875ab03217712b17c37", authorityAdapterContractDigest: AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST }),
    async provision(next) { events = [...next]; },
    async adapter(binding) {
      const actor = mutation === "identity-from-input" ? { ...host, taskId: `${binding.taskId}_other` } : host;
      const base = createContinuityRuntimeAdapter({ ledger: new FsContinuityLedger(root), identify: async () => actor, requestOutcome, statusOutcome });
      const originalOpen = base.open.bind(base);
      const originalCheckpoint = base.checkpoint.bind(base);
      return Object.freeze({ ...base,
        async open(taskId) { if (mutation === "dispatch-on-open") counters.providerDispatches += 1; return originalOpen(taskId); },
        async checkpoint(input) {
          if (mutation === "unchecked-as-verified" && input.proposedEvents.some((event) => event.type === "claim.recorded" && event.status === "verified")) return Object.freeze({ ok: true, cursor: 0, segmentDigest: digest("f"), state: {} });
          return originalCheckpoint(input);
        },
      });
    },
    async counters() { return Object.freeze({ ...counters }); },
    async close() { await rm(root, { recursive: true, force: true }); },
  });
}
