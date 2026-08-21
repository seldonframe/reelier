# Files changed

- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-5-brief.md`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-5-report.md`
- `docs/superpowers/plans/2026-08-20-universal-governed-outcomes-oss.md`
- `scripts/build-packs.mjs`
- `src/authority/host/agent-tools.ts`
- `src/authority/host/github-linear-mission-runtime.ts`
- `src/authority/host/linear-outcome-runner.ts`
- `src/authority/ingress/http.ts`
- `src/authority/ingress/mcp.ts`
- `src/authority/packs/github-linear-outcomes.ts`
- `src/packs/conformance.ts`
- `src/packs/linear-outcomes/compile.ts`
- `src/packs/linear-outcomes/index.ts`
- `src/packs/linear-outcomes/manifest.ts`
- `conformance/continuity-adapter/v1/eve-fixture/agent/agent.ts`
- `conformance/continuity-adapter/v1/eve-fixture/agent/lib/governed-outcomes.ts` (deleted)
- `conformance/continuity-adapter/v1/eve-fixture/scripts/eve-governed-outcomes.mjs`
- `conformance/continuity-adapter/v1/eve-fixture/scripts/eve-process.mjs`
- `test/acceleration-preflight.test.ts`
- `test/authority/agent-tools.test.ts`
- `test/authority/github-linear-mission-runtime.test.ts`
- `test/authority/github-linear-outcomes.test.ts`
- `test/authority/linear-outcomes-pack.test.ts`
- `test/continuity/eve-binding-static.test.ts`
- `test/continuity/eve-governed-outcomes.test.ts`
- `test/continuity/eve-kill-resume.test.ts`
- `test/continuity/support/genuine-governed-eve.ts` (created)
- `test/packs/conformance.test.ts`

# What changed

- The provider-neutral canonical quartet remains one contract projected to MCP, HTTP/OpenAPI, and Eve. Inputs and backend outputs are bounded, closed, detached, proxy/accessor-safe values. HTTP/MCP resolve the current runtime on every call, so runtime B is used after a crash instead of a captured runtime A.
- The reviewed composition now has seven internal definitions under one signed standing Job Card: three GitHub operations, composite Linear comment/status fixed to `REEL-TEST-1`, and Linear-only comment/status fixed to `REEL-TEST-2`. The model cannot supply an issue, source selector, or target choice. The two Linear pairs carry distinct policy, contract, semantic-identity, and idempotency digests and exact independent predecessor policies.
- Both missions execute Task4C production components: the genuine gate and file ledger, `compileGovernedEffectTransportV1`, `DispatchCoordinator`, `OutcomeKernel`, signed-journal lifecycle storage, file receipt publication, reviewed GitHub runner, and reviewed Linear executors. There is no Task5 Map lifecycle or raw generic provider runtime.
- Runtime evidence is folded rather than labeled: one activation requires the verified signed Job Card's exact seven aliases and a non-revoked signed activation event for every state; routine approvals are enumerated from signed journal events; reviews require reconciled durable receipt-bearing requests.
- Eve 0.39 sends real run/resume prompts through all four remote Cell tools. The composite hits exact-head ambiguity, runtime A is replaced by B on the same durable root, and B reconciles without merge resend. Linear-only then selects the second host-owned target. Four native Eve sessions are distinct; two runtime execution sessions and all seven reservations are distinct.
- The kill/resume matrix now uses the same genuine signed fixture. It kills the actual Eve process tree after durable ambiguity, reopens runtime B, starts a different Eve session, and reconciles the five-operation composite. Driver and matrix waits have bounded polling; the matrix child has a 240-second kill guard and the test a 300-second timeout.
- The unused synthetic `runEveGovernedOutcomeRehearsalV1` implementation was deleted. Search found no production/package export capable of emitting hard-coded rehearsal success. The fixture's four model-facing tools statically import only the remote Cell binding.
- First-party inventory remains twelve packs and grows from sixteen to eighteen aliases; the Linear pack contains exactly four definitions.

# Deviations from plan

- No scope expansion. The two-target and genuine-Eve amendments explicitly authorized every changed implementation/test/build file above.
- The staged Eve application sets `NODE_PATH` to the already-installed worktree-root `node_modules`. This is a fixture packaging prerequisite for Eve's relocated snapshot, not production Reelier behavior.
- The full-suite invocation began before the request for an external timeout wrapper, so it was not externally wrapped. It completed within the 15-minute monitoring cap and was not rerun. Tool output truncation did not retain the final aggregate line; no aggregate count is claimed.
- No external provider write, live credential, push, merge, tag, publication, or live-provider certification occurred.

# Test results

TypeScript and build gates exited 0:

```text
> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs
built cloudflare_api_token, cloudflare_dns, github_issue_labels, github_release, gmail, gmail_labels, hubspot_slack_information_flow, linear_outcomes, neon_database, slack_channel_topic, stripe, vercel_deployment
```

`npx tsc -p tsconfig.json --pretty false` and `npx tsc -p tsconfig.test.json --pretty false` exited 0.

Focused canonical/pack/runtime/Eve gate:

```text
tests 34
suites 0
pass 34
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 54769.7904
```

Pack inventory/conformance/preflight gate:

```text
tests 12
suites 0
pass 12
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 11629.0785
```

Real Eve governed missions:

```text
real Eve 0.39 drives both reviewed missions through the remote quartet and durable recovery (51239.3397ms)
tests 2
pass 2
fail 0
duration_ms 51531.3293
```

Real Eve kill/resume matrix:

```text
real Eve 0.39.0 preserves Reelier continuity across process and session boundaries (77436.8191ms)
tests 10
pass 10
fail 0
duration_ms 77586.0923
```

Contract/package/fixture compatibility gates exited 0: authority, bootstrap, and Outcome-profile contract checks; public package/export tests 9/9 (`duration_ms 2454.3011`); Eve fixture typecheck; Eve Cell/runtime tests 13/13 (`duration_ms 253.8292`).

The full serial `npm test` completed but exited 1. All Task5 canonical ingress, pack, runtime, real Eve, and kill/resume tests passed in that run. At least these unrelated baseline/platform failures were observed in the streamed output:

- `pre-readiness lifecycle ceremony exposes only activated public descriptors and an opaque process-local handle`
- a `native-https-route-join` prepared-authority revalidation failure
- `child replacement before, during, and after open is refused without a mixed generation`
- `installed build digest covers this package's shipped files contract` because `native/bootstrap-helper/manifest.json` is absent

The output transport truncated the final aggregate, so exact full-suite totals are not reported. `git diff --check` exited 0.

# Open risks and non-claims

- The deterministic local providers prove genuine production composition and crash/reopen no-resend behavior, not live GitHub/Linear behavior, provider certification, content correctness, or semantic safety.
- Harness capability remains `fixtureStatus: not-passed` and `liveTested: false`; real Eve process evidence is not an immutable independently verified capability credential.
- Signed authorization handles and provider/resource identities correctly remain in host-owned authority and receipt artifacts for answerability. Actual Cell/Eve bearer tokens and fixture credential values are absent from model-facing actions/results and genuine ledger/journal/receipt roots. Raw Eve prompts/reasoning are absent from Reelier durable roots; Eve's own harness transcript remains harness-owned.
- Receipts do not prove traffic completeness, topology, exclusive enforcement, or production readiness. Legacy job tools remain additive compatibility surface.
