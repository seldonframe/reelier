Files changed

- `test/authority/ledger.test.ts`
- `.superpowers/sdd/diagnose_n100_ack-report.md`

What changed per file

- `test/authority/ledger.test.ts`: Added a lazy, deterministic N100 transition failure diagnostic. It reports only the transition result discriminants (`ok`, `reason`, and `status`) and sorted root entry names. The existing dispatch and acknowledge success assertions now attach that diagnostic only if their result is not OK.
- `.superpowers/sdd/diagnose_n100_ack-report.md`: Records this scoped diagnostic-only change and its verification evidence.

Deviations from the plan and why

- None. Journal event summaries were intentionally omitted because the result discriminants and sorted root names are sufficient to distinguish the requested busy, corruption, and state-conflict classes without exposing journal content.

Test results (verbatim tail)

`npx tsc -p tsconfig.test.json`

```text
Exit code: 0
```

`node --test --test-concurrency=1 --test-name-pattern "N100 authority convergence" dist-test/test/authority/ledger.test.js`

```text
﹣ N100 authority convergence: one committed reservation, exact-existing outcomes, and acknowledged recovery (9.1247ms) # SKIP
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 732.8441
```

Open risks

- The hosted Ubuntu reproduction was not run from this Windows worktree. The next Linux failure will include the redacted transition result and sorted root entries in the failed dispatch or acknowledge assertion.
