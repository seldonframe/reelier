Files changed

- `test/authority/ledger.test.ts`
- `.superpowers/sdd/linux-post-ledger-hang-report.md`

Task 1C files-touched declaration

- Task 1C is explicitly scoped to exactly the two files listed above.
- The repository plan's `Files touched — planned scope` authorizes `test/authority/ledger.test.ts` and Task 1 reports under `.superpowers/sdd/`; this fix touches exactly that declared scope.

What changed per file

- `test/authority/ledger.test.ts`
  - Added a regression proving that aborting a spawned reserve process rejects only after the child has closed and its PID reports dead.
  - Added optional `AbortSignal` ownership to `spawnReserve`; abort sends the child its normal termination signal, and the promise settles from `close`, preserving child reaping.
  - Captures child `error` events without settling while a PID-backed child remains live. A normal spawn failure with no PID rejects directly from `error`, removes abort ownership, and does not depend on a `close` event.
  - Collects every started child in an N100 wave with `Promise.allSettled` semantics before surfacing one failure, so a failed sibling cannot be abandoned.
  - Bound every N100 reserve child to the `node:test` timeout signal so a timed-out stress test cannot leave child processes holding the file worker open.
  - Caps the N100 scheduler at ten simultaneous real child processes while still starting all 100. The deterministic scheduler pin asserts both facts, and the original convergence, reservation, dispatch, timeout, and failure assertions remain exact.
- `.superpowers/sdd/linux-post-ledger-hang-report.md`
  - Records the diagnosis, scoped change, verification evidence, and remaining risks.

Root cause and evidence

- Run `31489093447`, Ubuntu job `93771112968`, did not first become stuck after ledger test 598. Earlier in the same log, top-level test 414 (`100 real processes converge on one committed reservation and one dispatch eligibility`) timed out at 120,054 ms.
- `node:test` correctly continued running later tests, but its timeout did not cancel the timed-out async body. `spawnReserve` had no cancellation input, so roughly 30 reserve children were still live at job cleanup. Test 598 was merely the last output before the worker waited forever for its still-owned child handles.
- An unmodified Node 20 Linux container reproduced the N100 timeout and the listener/process shape. After the initial lifecycle fix, the same forced timeout remained a `testTimeoutFailure`, but the complete targeted worker exited nonzero at 123,460 ms instead of hanging. This measurement preceded Task 1B's bounded-concurrency N100 harness; it is retained as the direct regression evidence for the timeout cleanup path, not a claim about current N100 convergence.
- Run `31497285999`, Ubuntu job `93798088208`, proved the 25-wide harness could still consume the full budget: test 418 timed out at 120,079 ms, then cleanup worked and the next test completed 1.42 seconds later.
- A deterministic CPU-constrained Node 20 Linux reproduction isolated runnable-load contention. At 25-wide with `--cpus=0.5`, the container saturated its allocation, exposed 293 task/thread PIDs, and timed out at 120,057.7 ms. At ten-wide it exposed about 128 task/thread PIDs and the same 100-process convergence passed in 76,971.3 ms (81,092.1 ms for the worker). No production ledger behavior changed.

Deviations from the plan and why

- None. This fixes only the Linux post-timeout lifecycle hang. It does not increase a timeout, force process exit, weaken crash semantics, or turn the underlying N100 convergence failure into a pass.
- The initial full ledger file was not rerun to natural completion in Linux because the then-unbounded N100 stress case deterministically consumed its full 120-second timeout in the available Docker harness. Its exact failure path and worker exit were exercised instead. Task 1B subsequently bounded the N100 harness in commit `1ba1492`; Task 1C preserves its peak-load oracle, all 100 executions, timeout signal, and original convergence assertions.
- The follow-up CI failure required tightening only the test scheduler from 25-wide to ten-wide. This is not a process-count reduction: every one of the 100 real Node children still runs and must return the exact successful convergence result.

Test results (verbatim tails)

RED (`npx tsc -p tsconfig.test.json --pretty false` before implementation):

```text
test/authority/ledger.test.ts(252,46): error TS2554: Expected 2 arguments, but got 3.
test/authority/ledger.test.ts(252,80): error TS7006: Parameter 'pid' implicitly has an 'any' type.
```

Review RED lifecycle pins:

```text
test/authority/ledger.test.ts(269,17): error TS2304: Cannot find name 'collectSpawnedJson'.
test/authority/ledger.test.ts(279,19): error TS2304: Cannot find name 'collectSpawnedJson'.
test/authority/ledger.test.ts(293,19): error TS2304: Cannot find name 'collectSpawnBatch'.
```

Focused regression, Windows host:

```text
✔ aborting a reserve child waits until the process is reaped (175.9046ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 399.0829
```

Focused regression, Node 20 Linux container:

```text
1..191
# tests 191
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 190
# todo 0
# duration_ms 2536.012062
```

Review lifecycle regressions, Windows host:

```text
âœ” aborting a reserve child waits until the process is reaped (95.5458ms)
âœ” an abort-time kill error settles only after the live child closes (9.9434ms)
âœ” a failed spawn rejects and removes abort ownership without waiting for a nonexistent process (4.3981ms)
âœ” a child batch waits for every started process to close before surfacing one failure (13.8869ms)
â„¹ tests 4
â„¹ suites 0
â„¹ pass 4
â„¹ fail 0
â„¹ cancelled 0
â„¹ skipped 0
â„¹ todo 0
â„¹ duration_ms 267.0982
```

Review lifecycle regressions, Node 20 Linux container:

```text
1..194
# tests 194
# suites 0
# pass 4
# fail 0
# cancelled 0
# skipped 190
# todo 0
# duration_ms 2634.612879
```

Combined bounded N100 regression, Node 20 Linux container:

```text
# Subtest: 100 real processes converge on one committed reservation and one dispatch eligibility
ok 9 - 100 real processes converge on one committed reservation and one dispatch eligibility
  ---
  duration_ms: 35365.051877
  ...
1..194
# tests 194
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 193
# todo 0
# duration_ms 37975.478791
```

Follow-up scheduler RED and constrained Linux measurement:

```text
test/authority/ledger.test.ts(308,23): error TS2304: Cannot find name 'collectN100Waves'.

# 25-wide, Node 20 Linux --cpus=0.5
not ok 9 - 100 real processes converge on one committed reservation and one dispatch eligibility
  ---
  duration_ms: 120057.735044
  failureType: 'testTimeoutFailure'
  error: 'test timed out after 120000ms'

# ten-wide, Node 20 Linux --cpus=0.5
ok 10 - 100 real processes converge on one committed reservation and one dispatch eligibility
  ---
  duration_ms: 76971.31203
1..195
# pass 1
# fail 0
# cancelled 0
# duration_ms 81092.084202
```

Follow-up focused verification, Windows host:

```text
âœ” the N100 wave scheduler starts all work while capping live children at ten (5.0928ms)
âœ” 100 real processes converge on one committed reservation and one dispatch eligibility (14727.6325ms)
â„¹ tests 2
â„¹ pass 2
â„¹ fail 0
â„¹ cancelled 0
â„¹ duration_ms 14876.9462
```

Follow-up focused verification, Node 20 Linux:

```text
1..195
# tests 195
# suites 0
# pass 2
# fail 0
# cancelled 0
# skipped 193
# todo 0
# duration_ms 28106.68123
```

Forced Linux N100 timeout after lifecycle fix:

```text
# Subtest: 100 real processes converge on one committed reservation and one dispatch eligibility
not ok 6 - 100 real processes converge on one committed reservation and one dispatch eligibility
  ---
  duration_ms: 120075.410119
  location: '/work/dist-test/test/authority/ledger.test.js:306:1'
  failureType: 'testTimeoutFailure'
  error: 'test timed out after 120000ms'
  code: 'ERR_TEST_FAILURE'
  ...
1..191
# tests 191
# suites 0
# pass 0
# fail 0
# cancelled 1
# skipped 190
# todo 0
# duration_ms 123460.690977
```

TypeScript test build and package build:

```text
> reelier@0.32.1 build
> tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Open risks

- Cancellation uses the normal `ChildProcess.kill()` signal. The reserve children install no signal handler; regressions now cover successful abort/reap, abort-time kill error ordering, no-PID spawn failure, abort-listener removal, and sibling cleanup before batch rejection.
- A PID-backed child that cannot be signalled remains owned rather than being falsely reported as reaped. This is deliberate: no timeout or force-exit fallback can honestly prove OS-level child cleanup.
