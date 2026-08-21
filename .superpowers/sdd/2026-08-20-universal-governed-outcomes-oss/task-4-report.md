# Files changed

- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-4-report.md`
- `docs/superpowers/plans/2026-08-20-universal-governed-outcomes-oss.md`
- `src/authority/host/github-release-runner.ts`
- `src/authority/host/linear-outcome-runner.ts`
- `src/authority/host/outcome-kernel.ts`
- `src/authority/pack.ts`
- `src/authority/pack/index.ts`
- `src/authority/packs/github-linear-outcomes.ts`
- `test/authority/github-linear-outcomes.test.ts`
- `test/authority/github-release-runner.test.ts`
- `test/authority/outcome-kernel.test.ts`
- `test/authority/package.test.ts`

# What changed

- `docs/superpowers/plans/2026-08-20-universal-governed-outcomes-oss.md`: records the reviewed scope amendment for a generic host-authenticated predecessor policy and the callback-only Linear executor.
- `github-linear-outcomes.ts`: defines the five reviewed GitHub/Linear ToolEffect pack instances and closed branded authority parser. GitHub identity binds repository, base/head/candidate, workflow path/digest, required checks, candidate digest, squash merge, and merge commit/tree readback. Linear identity binds workspace/team/project/issue, pre/target status, comment marker, evidence URL/content digest, and exact readback. The parser checks the pack brand before property reads and rejects proxies, accessors, non-enumerable fields, symbols, sparse arrays, and unknown array keys inertly.
- `pack/index.ts` and `pack.ts`: expose only the reviewed pack constructors and validators through the existing static package allowlist while preserving the legacy ABI. Host-only dispatch validators remain internal.
- `outcome-kernel.ts`: adds an opaque host-minted predecessor policy binding exact predecessor and successor contract digests. Before successor dispatch, the kernel requires an earlier verified Outcome and the exact authoritative durable receipt head from the existing store. Restart uses the same receipt chain; no new state, journal, receipt, retry, or budget machine was added.
- `linear-outcome-runner.ts`: adds a trusted callback-only Task 3B executor. Comment/status dispatch and readback are schema-pinned and exact; provider ambiguity becomes uncertain and is reconciled read-only without resend. The module contains no SDK, OAuth, token, credential storage, or persistence.
- `github-release-runner.ts`: adapts the reviewed generic GitHub operations to the existing signed exact-SHA saga. The signed pack commitment now binds the compiled contract digest and exact reviewed policy digest; substitution refuses before journal/provider activity. PR, merge, and tag remain unavailable unless represented by the exact signed reviewed commitment.
- `github-linear-outcomes.test.ts`: exercises compiled executors, the real kernel, and provider counters for exact duplicate/conflict, wrong Linear identity, ambiguity without resend, authenticated comment-to-status ordering, separate allocations, honest pending/partial composition, Linear-only zero GitHub calls, and hostile inert DTOs.
- `github-release-runner.test.ts`: proves real contract-policy substitution and unsigned PR/merge/unreviewed-tag refusal with zero provider calls, while retaining ambiguity/no-resend saga coverage.
- `outcome-kernel.test.ts`: proves absent, pending, partial, failed, forged/wrong-digest, and wrong-policy predecessors cannot dispatch; a verified predecessor plus exact durable head succeeds across restart.
- `package.test.ts`: pins the revised public pack allowlist and removal of the unauthenticated caller-shaped predecessor helper.

# Deviations from plan

- The initial Task 4 file list could not honestly authenticate a durable predecessor inside the host. The reviewed amendment was committed as `e21de464` before implementation and added only the kernel, its test, and the Linear executor.
- The original caller-shaped `assertLinearStatusPredecessorV1` helper was removed: parsing a receipt-like DTO cannot establish host authority. The successor gate now consumes only the opaque host-minted policy plus the kernel's verified Outcome/receipt history.
- The legacy release authorization's `policyDigest` is already the release policy ABI. Exact reviewed contract and pack policy are therefore domain-separated inside the existing signed `packDigest`, avoiding an ABI break.
- The legacy tag alias remains available to the legacy release saga but is not granted by the reviewed Task 4 pack.

# Test results

Focused pack and complete kernel file:

```text
ℹ tests 28
ℹ pass 28
ℹ fail 0
```

Selected real runner safety cases (exact candidate contract-policy, PR/merge/tag refusal, actual coordinator, ambiguous merge no-resend, and lost merge response):

```text
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

Wider transports, pack, kernel, and package gate:

```text
ℹ tests 59
ℹ pass 59
ℹ fail 0
```

Build and authority contract:

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, github_release, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment

> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

Fresh complete release-runner file, including the two new passing tests:

```text
ℹ tests 64
ℹ pass 43
ℹ fail 21
```

The same 21 inherited runner failures remain. The Task 4 exact contract-policy and real PR/merge/tag refusal tests pass.

Adapter contracts, using the repository's current fixture paths:

```text
{"v":"reelier.agent-adapter-conformance-report/v0","status":"passed","adapterId":"xai.grok-build",...7 passed checks...}
{"v":"reelier.agent-adapter-conformance-report/v0","status":"passed","adapterId":"xai.grok-bot",...7 passed checks...}
{"v":"reelier.continuity-adapter-conformance-report/v1","status":"passed","maturity":"reproduced","adapterId":"core",...10 passed checks...}
```

`npm test` ran to completion and exited 1. All Task 4 tests passed in its stream. The failure tail remained outside Task 4 scope:

```text
✖ common host serves the same closed outcome over HTTP
Error [AuthorityCellLinuxRequiredError]: Authority Cell hosting requires Linux.

✖ installed build digest covers this package's shipped files contract
Error: ENOENT: no such file or directory, lstat '...\\native\\bootstrap-helper\\manifest.json'

✖ real Eve 0.39.0 preserves Reelier continuity across process and session boundaries
Error: Cannot find module '...\\conformance\\continuity-adapter\\v1\\eve-fixture\\node_modules\\eve\\bin\\eve.js'
```

The full run also retained the known legacy release-runner/runtime failures. No new Task 4 failure appeared.

# Open risks

- Provider behavior is hermetically tested, not exercised against live GitHub or Linear accounts.
- Linear execution remains a host-configured trusted callback port; integrators must preserve the reviewed callback semantics and compose status with the kernel predecessor policy.
- The repository-wide suite cannot be claimed green until the documented legacy and environment-dependent failures are resolved outside Task 4 scope.
