// Demonstrates that bindIngress RETURNS {ok:false, reason:"busy"} when the lock budget is exhausted.
//
// READ THE RETRACTION FIRST: 2026-08-07-bindingress-lock-busy-rootcause.md.
//
// This script was written to prove a defect. It does not prove one. The behaviour it shows is the
// CONTRACT: "busy" is a declared member of BindIngressResult (src/authority/ledger.ts:128), and the
// same three lock reasons appear in ReserveReason, TransitionReason, and RecoverResult — whose
// failure member is exactly the lock union and nothing else. Reporting a lock the call could not
// take as a result reason is a deliberate API decision, repeated in four places.
//
// It is kept because the behaviour is still worth being able to reproduce on demand: it is the
// reason test/authority/fuzz.test.ts must not assert `ok === true` on these results. The K1
// operation fence budgets acquisition against REAL monotonic time (monotonicNow() + lockTimeoutMs,
// default 30s), so on a loaded machine a legal `busy` appears and any test asserting it cannot
// happen will rotate red against an identical fixed seed.
//
// Forcing method: lockTimeoutMs: 0 makes the K1 fence deadline already elapsed at entry.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FsAuthorityLedger } from "../../../dist/authority/host/fs-ledger.js";
import { authenticateOutcomeRequest } from "../../../dist/authority/keys.js";

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

const healthy = await bindWith({}, "CONTROL (default 30s budget)");
const starved = await bindWith({ lockTimeoutMs: 0 }, "STARVED (lockTimeoutMs: 0)");

console.log("\n--- what this shows ---");
if (starved?.ok === false && starved.reason === "busy" && healthy?.ok === true) {
  console.log('An exhausted budget yields {ok:false, reason:"busy"} — a DECLARED BindIngressResult');
  console.log("member, not an error. Any test asserting binding.ok === true is asserting something");
  console.log("the contract explicitly permits to fail, and will rotate red under machine load.");
} else {
  console.log(`unexpected: control=${JSON.stringify(healthy)} starved=${JSON.stringify(starved)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = 0;
