Files changed

- `src/authority/host/fs-ledger.ts`
- `test/authority/ledger.test.ts`
- `.superpowers/sdd/windows-100proc-convergence-report.md`

Planned files and scope

Task1B was explicitly limited to the three files above. `src/authority/host/fs-ledger.ts` owns the Windows root-mutex classification boundary. `test/authority/ledger.test.ts` owns the real-process convergence fixture and its focused regressions. This report owns the diagnostic record. No other production, test, configuration, timeout, or documentation file was in Task1B scope.

What changed per file

- `src/authority/host/fs-ledger.ts`: a contender that exhausts its existing deadline before acquiring the Windows named-pipe root mutex returns `busy` without classifying an epoch it does not own. Stable corruption classification remains unchanged after mutex ownership, including TCP endpoint-refusal classification.
- `test/authority/ledger.test.ts`: added the Windows mutex-ownership regression; added a deterministic peak-outstanding oracle to N100; and scheduled all 100 real reserve children in four waves of 25. Every child still uses the same root, and the existing all-success, one-reservation, and one-dispatch-eligibility assertions are unchanged. Concurrent Task1C work added abort/error cleanup around the same helper and `collectSpawnBatch`; N100 uses that helper so each wave closes every started child before the next wave or a surfaced failure.
- `.superpowers/sdd/windows-100proc-convergence-report.md`: records declared scope, both root causes, exact commands, verification, and residual risk.

Root cause and evidence

GitHub Actions run `31489093447`, Windows job `93771113015`, failed N100 after 39.304 seconds with 49 `busy` and 7 `corruption` refusals.

There were two independent causes:

1. The seven false `corruption` results came from calling refusal-only filesystem classification after Windows root-mutex acquisition had timed out. The contender did not own a closed filesystem epoch and could observe another owner's multi-step transition. A held-mutex regression failed before the fix with `reason: corruption`; after mutex release, the same unchanged malformed graph still returns corruption, proving the stable check was not weakened.
2. The 49 `busy` results were real 30-second deadline exhaustion caused by the test launching 100 Node processes simultaneously. Each child performs two serialized root operations (`bindIngress`, then `reserve`): roughly 5.8 GB of transient child RSS and 200 root acquisitions compete at once. The governing spec grants no cross-process FIFO/order and requires exhaustion to remain honest `busy`; production retry or a fairness widening would contradict that invariant. Repository measurements had already prescribed bounded spawn concurrency of 25 once the failure reproduced, with all 100 real children and all assertions preserved.

The deadline mechanism reproduced locally by pinning the test and children to one core and adding one same-core CPU hog: the 100-at-once harness took 106.955 seconds and all 100 returned `busy`. The deterministic regression does not depend on ambient load: before the scheduling fix it failed with `the convergence harness started 100 simultaneous reserve children`; after the fix the peak is at most 25 and every original convergence assertion passes.

Deviations from the plan and why

- The first implementation closed only false-corruption classification. Independent review correctly found that relabeling seven results did not make the 49 honest `busy` results converge. Task1B re-entered Phase 1 and added the separately documented bounded-spawn mechanism; no timeout or production authority rule was widened.
- Concurrent Task1C changes touched the same test helper to reap children on timeout and settle every started child after spawn/kill errors. Task1B preserved and verified those commits rather than reverting or duplicating them.

Exact stress and verification commands

Compile the test build and run N100 once:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 --test-name-pattern="100 real processes converge" dist-test/test/authority/ledger.test.js
```

Run three one-core N100 repetitions:

```powershell
$current=[System.Diagnostics.Process]::GetCurrentProcess();$current.ProcessorAffinity=[IntPtr]1
for($attempt=1;$attempt -le 3;$attempt++){
  Write-Output "STRESS ATTEMPT $attempt"
  node --test --test-concurrency=1 --test-name-pattern="100 real processes converge" dist-test/test/authority/ledger.test.js
  if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
}
```

Run the combined lifecycle and convergence focus:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 --test-name-pattern="100 real processes converge|aborting a reserve child|abort-time kill error|failed spawn rejects|child batch waits" dist-test/test/authority/ledger.test.js
```

Run the full ledger suite and build:

```powershell
node --test --test-concurrency=1 dist-test/test/authority/ledger.test.js
npm run build
```

Test results (verbatim tails)

Deterministic RED before bounded scheduling:

```text
AssertionError [ERR_ASSERTION]: the convergence harness started 100 simultaneous reserve children

false !== true
```

Three one-core N100 repetitions after bounded scheduling:

```text
STRESS ATTEMPT 3
✔ 100 real processes converge on one committed reservation and one dispatch eligibility (32042.1045ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 32226.513
```

Combined lifecycle and convergence focus after Task1C integration:

```text
✔ 100 real processes converge on one committed reservation and one dispatch eligibility (18033.9127ms)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 18290.0296
```

Full ledger suite:

```text
ℹ tests 716
ℹ suites 0
ℹ pass 716
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 113176.3367
```

Build:

```text
> reelier@0.32.1 build
> tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Open risks

- The original hosted Windows job has not been rerun from these commits. The deterministic peak oracle, three constrained Windows repetitions, full ledger suite, and Task1C's separate Docker Node 20 N100 run cover the local regression surface.
- The deliberately maximal one-core plus continuous busy-loop diagnostic exceeded N100's unchanged 120-second outer test limit even after batching. That environment leaves too little CPU for the entire four-wave test and is not treated as a product availability guarantee.
- Production callers can still honestly receive `busy` when the existing 30-second coordination budget truly expires. The test harness fix prevents its own 100-process startup burst from manufacturing that condition; it does not hide or retry a production refusal.
Files changed

- `test/authority/ledger.test.ts`
- `.superpowers/sdd/windows-100proc-convergence-report.md`

## 2026-08-12 hosted Windows follow-up

### What changed per file

- `test/authority/ledger.test.ts`: the dead-owner liveness-loss fixture now explicitly requests an exact-root-bound K1 fence. Its shared `execute` helper derives the binding from the real test root and injects the existing private deterministic fence runtime for that case. The unchanged 20 ms budget therefore measures the housekeeping/liveness route instead of real Windows named-pipe and loopback acquisition latency.
- `.superpowers/sdd/windows-100proc-convergence-report.md`: records this deterministic fixture correction, the hosted N100 evidence, the fairness redesign boundary, and fresh verification.

### Deviations from the plan and why

No production mutex change was made. Hosted run `31596294603`, Windows job `94117665864`, completed 99 of 100 children and returned exactly one `{ok:false,reason:"busy"}` after 38.558 seconds. The current Windows mutex admits contenders by repeatedly racing `listen()` with exponential delay. Waiting on the current owner's pipe close would remove blind polling but would wake all connected contenders into the same bind race; it cannot guarantee fair admission.

A valid fairness change requires a cross-process protocol, not a bounded retry edit. At minimum it must provide: a total ticket/FIFO order rooted in the exact ledger binding; one-successor handoff with no newcomer barging; acknowledgement that the designated successor actually acquired before the predecessor relinquishes authority; deterministic recovery when either predecessor or designated successor crashes; deadline cancellation that removes timed-out waiters without wedging the queue; and preservation of exclusive serialization and corruption-closed classification throughout handoff. A retained-socket wake-all scheme and deterministic polling satisfy none of the single-successor, no-barging, or crash-handoff properties. Per the task's stop condition, production remained unchanged and hosted Windows convergence is not claimed.

### Test results (verbatim tail)

RED (`npx tsc -p tsconfig.test.json --pretty false`):

```text
test/authority/ledger.test.ts(1385,670): error TS2554: Expected 1-3 arguments, but got 4.
```

Focused parent:

```text
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1816.3878
```

One N100 sanity run:

```text
✔ 100 real processes converge on one committed reservation and one dispatch eligibility (16873.0421ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 17050.8022
```

Typecheck, contract, and build (`npx tsc --noEmit --pretty false; npm run check:authority-contract; npm run build`):

```text
> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check

> reelier@0.32.1 build
> tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

### Open risks

- The deterministic liveness fixture no longer depends on Windows fence acquisition timing, but it does not fix or mask the hosted named-pipe admission starvation.
- One local N100 repetition passed; the task required no five-run convergence claim after the fairness work crossed the protocol-redesign boundary.
- The existing 30-second coordination deadline remains unchanged and an honestly starved contender can still return `busy` on hosted Windows.

---
