Files changed

- `docs/specs/compiled-authority-v1.md`
- `test/authority/ledger.test.ts`
- `.superpowers/sdd/universal-compiled-authority/task-3b2-backoff-red-fix-report.md`

What changed per file

- `docs/specs/compiled-authority-v1.md`: specified positive remaining-time clamping, bounded requested sleep totals, completed full-generation reset, and retained-contender reset after a classified live active lock clears.
- `test/authority/ledger.test.ts`: added deterministic virtual-monotonic delay recording; strengthened the exact predecessor identity replacement deadline; added short-budget active-lock and stable-predecessor clamp REDs; retained the completed membership re-election control; and added exact active-lock-clearance and finalNames-membership-invalidation reset REDs.
- `.superpowers/sdd/universal-compiled-authority/task-3b2-backoff-red-fix-report.md`: records scope, verification, and open RED state.

Deviations from the plan and why

- None. Production remained frozen at `bc40709`; only the assigned specification, tests, and required report changed.
- The delay recorder advances a test-local monotonic clock by each requested sleep and schedules the continuation immediately. This removes filesystem and scheduler jitter while preserving the exact acquisition-budget arithmetic under test.

Test results (verbatim tail)

`npx tsc -p tsconfig.test.json` completed successfully with exit code 0 and no output.

Focused command:

```text
node --test --test-concurrency=1 --test-name-pattern "(exact predecessor identity changes|clamps deterministic backoff|completed membership re-election|classified live active lock clears|final-name membership invalidation)" dist-test/test/authority/ledger.test.js
ℹ tests 6
ℹ suites 0
ℹ pass 2
ℹ fail 4
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 895.3449
```

Passing controls:

```text
✔ a non-head contender re-elects when its exact predecessor identity changes
✔ a completed membership re-election resets capped predecessor backoff to 5ms
```

Intentional RED failures against `bc40709`:

```text
✖ stable non-head predecessor polling clamps deterministic backoff to the monotonic acquisition budget
  the final sleep is clamped below the next 50ms sequence value
✖ valid live active-lock waiting clamps deterministic backoff to the monotonic acquisition budget
  the final sleep is clamped below the next 50ms sequence value
✖ a retained contender resets capped backoff after a classified live active lock clears
  actual [5,10,20,40,50,50], expected [5,10,20,40,50,5]
✖ final-name membership invalidation resets capped backoff after full re-election
  actual [5,10,20,40,50,50], expected [5,10,20,40,50,5]
```

Open risks

- The four focused failures are intentional RED. Production must clamp each wait to positive remaining monotonic time and reset backoff on the two reviewed settlement paths.
- The test-local global timer and `process.hrtime.bigint` replacements require serial execution; the focused command and repository authority suite use `--test-concurrency=1`, and both globals restore in `finally`.
