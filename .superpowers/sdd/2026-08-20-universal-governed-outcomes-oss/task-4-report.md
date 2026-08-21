# Files changed

- `src/authority/packs/github-linear-outcomes.ts`
- `src/authority/pack/index.ts`
- `src/authority/pack.ts`
- `src/authority/host/github-release-runner.ts`
- `test/authority/github-linear-outcomes.test.ts`
- `test/authority/github-release-runner.test.ts`
- `test/authority/package.test.ts`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-4-report.md`

# What changed

- `github-linear-outcomes.ts`: added an inert, closed reviewed-authority parser and five frozen ToolEffect pack instances for candidate publication, PR ensure, exact-head squash merge, Linear evidence comment, and Linear status transition. The pack fixes GitHub repository/base/head/candidate/workflow/check/merge/readback identity and Linear workspace/team/project/issue/status/comment identity; exposes ordered composite and Linear-only operation lists; validates exact provider readback; and requires the verified comment receipt as the status predecessor. Host references remain opaque and credentials never enter contracts or model fields.
- `pack/index.ts` and `pack.ts`: exposed only the reviewed Task 4 constructors and validators through the existing static authority-pack allowlist, preserving prior exports.
- `github-release-runner.ts`: added a blank trusted generic-pack executor that maps only candidate, PR, and merge tools into the existing signed GitHub release saga. It reuses the existing journal, allocations, ambiguity reconciliation, and provider controllers; it does not expose tag through the new pack. Resolved host account/destination/policy are checked against the signed release plan before journal or provider activity.
- `github-linear-outcomes.test.ts`: covers exact contracts and ordering, Linear-only isolation, wrong authority refusal, hostile/inert DTO handling, exact duplicate comment convergence/conflict, exact GitHub and Linear readback, ambiguous Linear readback without resend, honest pending composite state, and exact receipt predecessor binding.
- `github-release-runner.test.ts`: proves the reviewed candidate operation delegates into the existing saga, rejects a mismatched pack policy with zero provider calls, and accepts the exact signed-plan policy.
- `package.test.ts`: pins the public pack runtime allowlist.

# Deviations from plan

- No scope expansion. The legacy tag alias remains in the runner ABI but is deliberately absent from the reviewed Task 4 executor.
- `ToolEffectContractV1` requires at least one model field. Linear status therefore uses an opaque `requestId`; it carries no Linear identity or credential.
- The full repository suite remains non-green for pre-existing/environmental failures. Task 4 did not change out-of-scope legacy assertions or missing host fixtures/dependencies.

# Test results

Typechecks, focused Task 4/kernel/transport/package tests, and selected saga safety tests:

```text
ℹ tests 59
ℹ suites 0
ℹ pass 59
ℹ fail 0
ℹ duration_ms 2501.7393

ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ duration_ms 1987.703
```

Build and contract gate:

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, github_release, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment

> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

Fresh complete release-runner file (baseline failures retained):

```text
ℹ tests 63
ℹ suites 0
ℹ pass 42
ℹ fail 21
```

The full `npm test` was also run and exited 1. Task 4's eight pack tests passed in that run. Visible inherited/environmental failures included the same 21 legacy runner expectations, authority runtime/lifecycle expectations, Windows Linux-host cases, a missing `native/bootstrap-helper/manifest.json`, and a missing Eve 0.39 installation.

Correct authority-contract conformance fixtures were run earlier in the task: both agent adapters passed 7/7 and continuity passed 10/10. `git diff --check` was clean.

# Open risks

- Linear execution remains a host-supplied trusted executor port by design; OSS contains no Linear SDK, OAuth, token, credential storage, or second delivery state machine.
- Provider behavior is covered hermetically, not against live GitHub or Linear accounts.
- The repository-wide suite cannot be claimed green until the documented baseline/environment failures are resolved outside Task 4 scope.
