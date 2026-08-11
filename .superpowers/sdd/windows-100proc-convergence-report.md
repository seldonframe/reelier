Files changed

- `src/authority/host/fs-ledger.ts`
- `test/authority/ledger.test.ts`
- `.superpowers/sdd/windows-100proc-convergence-report.md`

What changed per file

- `src/authority/host/fs-ledger.ts`: when Windows named-pipe root-mutex acquisition exhausts its existing deadline, the contender now returns `busy` without reading the filesystem. Durable corruption classification is unchanged after mutex ownership, including TCP endpoint-refusal classification.
- `test/authority/ledger.test.ts`: added a Windows-only regression that holds the exact root mutex over a malformed/intermediate K1 graph, proves the non-owner returns `busy` without filesystem hooks, then releases the mutex and proves the unchanged stable graph is still `corruption`.
- `.superpowers/sdd/windows-100proc-convergence-report.md`: records scope, evidence, verification, and residual risk.

Root cause and evidence

GitHub Actions run `31489093447`, Windows job `93771113015`, failed the 100-real-process convergence test after 39.304 seconds with 49 `busy` and 7 `corruption` refusals. The test passed locally once normally, three times at two-core affinity, and five times at one-core affinity before editing, so the hosted failure was intermittent contention rather than invalid reservation input.

The trace reached `withK1OperationFence`: on Windows, contenders first wait for the root's named-pipe mutex. When that wait exhausted, the code called `refuseOnlyK1FenceClassification()` without mutex ownership. That classifier could observe another owner's multi-step filesystem transition as if it were a closed durable epoch and report false corruption. A one-off held-mutex probe returned `corruption` both while the mutex was held and after release, confirming the missing ownership distinction. The committed regression failed on the same distinction before the production change:

```text
AssertionError [ERR_ASSERTION]: without the root mutex, an observed graph may be the active owner's transient epoch
+ actual - expected
  {
    ok: false,
+   reason: 'corruption'
-   reason: 'busy'
  }
```

Deviations from the plan and why

- None. The fix changes one Windows timeout branch and does not widen authority, weaken stable corruption checks, or increase any timeout.

Test results (verbatim tail)

Focused regression after the fix:

```text
✔ a timed-out Windows root-mutex contender never classifies the active owner's filesystem epoch (64.846ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 207.0982
```

One-core Windows 100-process stress, three consecutive attempts (tail):

```text
STRESS ATTEMPT 3
✔ 100 real processes converge on one committed reservation and one dispatch eligibility (35119.7211ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 35301.3536
```

Full ledger suite:

```text
ℹ tests 712
ℹ suites 0
ℹ pass 712
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 96422.3858
```

Build:

```text
> reelier@0.32.1 build
> tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Open risks

- The original hosted runner failure was stochastic and has not been rerun on GitHub Actions from these local commits. The deterministic mutex-ownership regression covers the false-corruption branch, while repeated constrained local stress covers the reported workload shape.
- Contenders may still honestly return `busy` when the existing 30-second coordination budget is exhausted; this change only prevents an unowned transient epoch from being mislabeled as durable corruption.
