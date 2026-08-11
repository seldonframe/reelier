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
