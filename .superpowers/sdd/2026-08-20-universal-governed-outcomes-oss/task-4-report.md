# Files changed

- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-4-report.md`
- `docs/superpowers/plans/2026-08-20-universal-governed-outcomes-oss.md`
- `src/authority/host/dispatch.ts`
- `src/authority/host/effect-transports.ts`
- `src/authority/host/github-release-runner.ts`
- `src/authority/host/linear-outcome-runner.ts`
- `src/authority/host/outcome-kernel.ts`
- `src/authority/pack.ts`
- `src/authority/pack/index.ts`
- `src/authority/packs/github-linear-outcomes.ts`
- `test/authority/effect-transports.test.ts`
- `test/authority/dispatch-coordinator.test.ts`
- `test/authority/github-linear-outcomes.test.ts`
- `test/authority/github-release-runner.test.ts`
- `test/authority/outcome-kernel.test.ts`
- `test/authority/package.test.ts`

# What changed

- `docs/superpowers/plans/2026-08-20-universal-governed-outcomes-oss.md`: records the reviewed scope amendments for the generic host-authenticated predecessor policy/callback-only Linear executor, the Task 3 compiler-owned executor authority envelope, and the exact coordinator-call binding.
- `dispatch.ts`: mints one opaque, transient coordinator-call capability around the exact legacy adapter dispatch invocation. It binds the exact state object, reservation, and effect digest, permits one downstream authority-object delegate, and revokes both call and delegate in `finally`. Existing one-argument adapters remain compatible because the new parameter is optional; the prepared path is unchanged.
- `effect-transports.ts`: passes a frozen internal `{contractDigest,bindingDigest,reservationId}` envelope on every trusted executor dispatch and readback. Its values come only from the compiled contract/binding and dispatch state, never model input or a host resolver. During dispatch only, that unchanged authority object becomes the one-shot delegate of the exact coordinator call; direct adapter calls and readback have no delegate.
- `github-linear-outcomes.ts`: defines the five reviewed GitHub/Linear ToolEffect instances and closed branded authority parser. GitHub authority binds repository/base/head/candidate, workflow path/digest, required checks, candidate digest, squash merge, and commit/tree readback. Linear authority binds workspace/team/project/issue, pre/target status, marker, evidence URL/content digest, and exact readback. Reviewed GitHub model fields contain only authorization handle and request ID; `semanticsDigest` is not model authority. The parser is brand-first and rejects proxies, accessors, non-enumerable fields, symbols, sparse arrays, and unknown array keys inertly.
- `pack/index.ts` and `pack.ts`: expose only reviewed constructors/validators through the static allowlist while preserving the legacy ABI. Host-only executor helpers remain internal.
- `outcome-kernel.ts`: adds an opaque host-minted predecessor policy binding exact predecessor/successor contract digests. The kernel requires an earlier verified Outcome and exact durable receipt head, transiently arms only the exact reservation/successor around coordinator dispatch, and clears the arm in `finally`. Status authorization jointly consumes the exact live coordinator-call delegate before consuming the arm, so a concurrent direct call cannot steal it. The policy parser rejects hidden, symbol, accessor, proxy, and unknown fields. No new durable state, journal, receipt, retry, or budget machine was added.
- `linear-outcome-runner.ts`: adds a callback-only Task 3B executor. Comment/status dispatch and readback exact-bind compiler-owned contract/binding authority. Status additionally consumes both the exact coordinator-call delegate and kernel predecessor arm, so direct adapter invocation refuses before the provider even during the authorized window. Ambiguity reconciles read-only without resend. No SDK, OAuth, token, credential storage, or persistence was added.
- `github-release-runner.ts`: adapts reviewed GitHub operations to the existing signed exact-SHA saga. The reviewed path consumes compiler-owned contract digest, binding digest, and reservation identity; it never accepts model-authored semantics. The signed pack commitment binds the exact compiled contract and reviewed policy before journal/provider activity.
- `effect-transports.test.ts`: proves dispatch and readback receive the same exact frozen compiler authority envelope across MCP, HTTP, and CLI transports.
- `dispatch-coordinator.test.ts`: proves an exact coordinator-call delegate is single-use, cannot be duplicated, and is unusable after the adapter call returns.
- `github-linear-outcomes.test.ts`: exercises real compiled executors/kernel/provider counters for exact duplicates/conflicts, wrong Linear identity, ambiguity without resend, mandatory armed comment-to-status ordering, direct status refusal with zero writes, separate allocations, honest pending/partial composition, Linear-only zero GitHub calls, and hostile DTOs.
- `github-release-runner.test.ts`: proves real contract-policy substitution and unsigned PR/merge/unreviewed-tag refusal with zero calls, then positively executes separately signed reviewed PR and exact-head merge through the generic adapter with exact provider/readback counters.
- `outcome-kernel.test.ts`: proves absent, pending, partial, failed, forged/wrong-digest, and wrong-policy predecessors cannot dispatch; verified durable predecessors survive restart; only the kernel transiently arms exact successor dispatch.
- `package.test.ts`: pins the revised public pack runtime allowlist and absence of the unauthenticated caller-shaped predecessor helper.

# Deviations from plan

- The initial Task 4 file list could not authenticate a durable predecessor inside the host. Amendment `e21de464` authorized only the kernel, its test, and the Linear executor before those edits.
- Round 2 required the Task 3 compiler to carry actual internal authority to trusted executors. Amendment `33524d03` authorized only `effect-transports.ts` and its test before those edits.
- Round 3 found that a same-reservation direct adapter call could consume the transient arm while the intended coordinator call was in flight. Amendment `4f368bd5` authorized only `dispatch.ts` and its test before those edits. The fix uses transient WeakMap capabilities and does not change prepared dispatch or durable state.
- The caller-shaped `assertLinearStatusPredecessorV1` helper was removed because parsing a receipt-like DTO cannot establish host authority. The successor executor now consumes only the kernel's transient authorization derived from verified durable history.
- The legacy release authorization `policyDigest` is already the release-policy ABI. Exact reviewed contract and pack policy are domain-separated inside the existing signed `packDigest`, avoiding an ABI break.
- The legacy tag alias remains available to the legacy saga but is not granted by the reviewed Task 4 pack.

# Test results

Production and test TypeScript graphs:

```text
npx tsc -p tsconfig.json --noEmit
npx tsc -p tsconfig.test.json
exit 0
```

Focused coordinator, transports, pack, complete kernel, and package gate:

```text
tests 80
suites 0
pass 80
fail 0
duration_ms 3751.6518
```

The deterministic barrier regression pauses the intended status adapter after the kernel arms its predecessor policy, invokes the same compiled adapter directly with the same reservation, then releases the intended call. The direct call is refused with zero writes; the exact coordinator call succeeds and produces the single status write.

Selected real runner cases (candidate contract-policy, PR/merge/tag refusal, positive separately signed PR/merge, and ambiguous merge no-resend):

```text
tests 4
suites 0
pass 4
fail 0
duration_ms 2135.0867
```

Positive reviewed operation counters after predecessor seeding:

```text
PR:    { find: 4, create: 1, ready: 1, read: 3, checks: 0, merge: 0, commit: 0 }
merge: { find: 1, create: 0, ready: 0, read: 3, checks: 3, merge: 1, commit: 1 }
```

Build and authority contract:

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, github_release, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment

> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

Fresh complete release-runner file:

```text
tests 65
suites 0
pass 44
fail 21
duration_ms 23126.1378
```

The same 21 inherited runner failures remain. All generic candidate/refusal/positive PR/merge cases pass.

Adapter contracts:

```text
{"v":"reelier.agent-adapter-conformance-report/v0","status":"passed","adapterId":"xai.grok-build",...7 passed checks...}
{"v":"reelier.agent-adapter-conformance-report/v0","status":"passed","adapterId":"xai.grok-bot",...7 passed checks...}
{"v":"reelier.continuity-adapter-conformance-report/v1","status":"passed","maturity":"reproduced","adapterId":"core",...10 passed checks...}
```

`npm test` was run to completion after Round 3. It exited 1 on the known out-of-scope baseline; all Task 4 tests, including the deterministic race, passed in its stream. Representative inherited/environment failures remain Linux-only host tests on Windows, the 21 legacy runner expectations, the absent native bootstrap manifest, and absent Eve fixture dependency.

# Open risks

- Provider behavior is hermetically tested, not exercised against live GitHub or Linear accounts.
- Linear remains a host-configured trusted callback port; the same opaque policy capability must be supplied to the executor and kernel. A mismatched or forged capability is fail-closed and cannot dispatch status.
- Repository-wide green remains blocked by the documented legacy and environment-dependent failures outside Task 4 scope.
