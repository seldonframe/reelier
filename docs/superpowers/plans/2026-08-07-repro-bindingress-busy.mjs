// Minimal repro: does a transient lock-busy escape bindIngress as a BindIngressResult?
//
// Hypothesis: withLock's failure member is {ok:false, reason:"busy"|...}. bindIngress returns
// withLock's result through `as Promise<BindIngressResult>` with no isLockFailure guard, unlike
// lookupIngress / lookupIngressClaimLinkage which both throw on it. So a busy lock should surface
// to the caller as ok:false with a `reason` that is NOT in BindIngressResult's union
// ("integrity-failure" | "conflict"), i.e. indistinguishable from a durable authority refusal.
//
// Forcing method: lockTimeoutMs: 0 makes the K1 fence deadline already elapsed at entry.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { FsAuthorityLedger } from "file:///C:/Users/maxim/CascadeProjects/reelier/.worktrees/universal-compiled-authority/dist/authority/host/fs-ledger.js";
import { authenticateOutcomeRequest } from "file:///C:/Users/maxim/CascadeProjects/reelier/.worktrees/universal-compiled-authority/dist/authority/keys.js";

const at = Date.parse("2026-08-02T12:00:00.000Z");

const authenticated = authenticateOutcomeRequest({
  tenant: "tenant", requester: "requester", definitionAlias: "definition",
  request: { v: "reelier.outcome-request/v1", requestId: "request_1", sourceRefs: { source: "ref_1" }, choices: {} },
});

async function bindWith(options, label) {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-repro-"));
  try {
    const ledger = new FsAuthorityLedger(root, { now: () => at, ...options });
    const result = await ledger.bindIngress(authenticated);
    console.log(`${label}: ${JSON.stringify(result)}`);
    return result;
  } finally { await rm(root, { recursive: true, force: true }); }
}

// Control: a healthy budget must claim the ingress.
const healthy = await bindWith({}, "CONTROL  (default 30s budget)");

// Test: an exhausted budget. If the hypothesis holds this returns ok:false with reason "busy".
const starved = await bindWith({ lockTimeoutMs: 0 }, "STARVED  (lockTimeoutMs: 0)");

console.log("\n--- verdict ---");
const BIND_REASONS = new Set(["integrity-failure", "conflict"]);
if (starved?.ok === false && !BIND_REASONS.has(starved.reason)) {
  console.log(`CONFIRMED: bindIngress returned ok:false with reason="${starved.reason}",`);
  console.log(`which is NOT a BindIngressResult reason. A caller asserting binding.ok, or treating`);
  console.log(`ok:false as a durable refusal, cannot tell this from a real ingress conflict.`);
} else if (starved?.ok === true) {
  console.log("REFUTED: a zero budget still claimed the ingress. The busy path is not reachable this way.");
} else {
  console.log(`INCONCLUSIVE: ${JSON.stringify(starved)}`);
}
console.log(`control ok=${healthy?.ok} status=${healthy?.status ?? "-"}`);
