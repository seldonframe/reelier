Files changed

- `test/authority/ledger.test.ts`
- `.superpowers/sdd/linux-post-ledger-hang-report.md`

What changed per file

- `test/authority/ledger.test.ts`
  - Added a regression proving that aborting a spawned reserve process rejects only after the child has closed and its PID reports dead.
  - Added optional `AbortSignal` ownership to `spawnReserve`; abort sends the child its normal termination signal, and the promise settles from `close`, preserving child reaping.
  - Bound every N100 reserve child to the `node:test` timeout signal so a timed-out stress test cannot leave child processes holding the file worker open.
  - Raised the listener warning threshold only on that known 100-subscriber test signal. This does not change timeouts or suppress process/test failures.
- `.superpowers/sdd/linux-post-ledger-hang-report.md`
  - Records the diagnosis, scoped change, verification evidence, and remaining risks.

Root cause and evidence

- Run `31489093447`, Ubuntu job `93771112968`, did not first become stuck after ledger test 598. Earlier in the same log, top-level test 414 (`100 real processes converge on one committed reservation and one dispatch eligibility`) timed out at 120,054 ms.
- `node:test` correctly continued running later tests, but its timeout did not cancel the timed-out async body. `spawnReserve` had no cancellation input, so roughly 30 reserve children were still live at job cleanup. Test 598 was merely the last output before the worker waited forever for its still-owned child handles.
- An unmodified Node 20 Linux container reproduced the N100 timeout and the listener/process shape. After the fix, the same forced timeout remained a `testTimeoutFailure`, but the complete targeted worker exited nonzero at 123,460 ms instead of hanging.

Deviations from the plan and why

- None. This fixes only the Linux post-timeout lifecycle hang. It does not increase a timeout, force process exit, weaken crash semantics, or turn the underlying N100 convergence failure into a pass.
- The full ledger file was not rerun to natural completion in Linux because the unbounded N100 stress case deterministically consumed its full 120-second timeout in the available Docker harness. Its exact failure path and worker exit were exercised instead. A separate assigned task owns N100 convergence.

Test results (verbatim tails)

RED (`npx tsc -p tsconfig.test.json --pretty false` before implementation):

```text
test/authority/ledger.test.ts(252,46): error TS2554: Expected 2 arguments, but got 3.
test/authority/ledger.test.ts(252,80): error TS7006: Parameter 'pid' implicitly has an 'any' type.
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

- The original N100 all-success convergence test still times out under the unbounded Linux Docker stress harness. This change ensures that failure terminates cleanly and remains visible; the separately assigned bounded-concurrency work must make the assertion itself pass.
- Cancellation uses the normal `ChildProcess.kill()` signal. The reserve children install no signal handler, and the regression verifies close plus dead-PID evidence before rejection.
