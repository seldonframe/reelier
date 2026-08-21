# Files changed

- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-5-brief.md`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-5-report.md`
- `docs/superpowers/plans/2026-08-20-universal-governed-outcomes-oss.md`
- `src/authority/host/agent-tools.ts`
- `src/authority/host/index.ts`
- `src/authority/host/local.ts`
- `src/authority/ingress/agent-tool-contracts.ts`
- `src/authority/ingress/http.ts`
- `src/authority/ingress/mcp.ts`
- `src/authority/ingress/openapi.ts`
- `conformance/continuity-adapter/v1/eve-fixture/agent/agent.ts`
- `conformance/continuity-adapter/v1/eve-fixture/agent/lib/cell.ts`
- `conformance/continuity-adapter/v1/eve-fixture/agent/lib/governed-outcomes.ts`
- `conformance/continuity-adapter/v1/eve-fixture/agent/tools/reelier_agent_status.ts`
- `conformance/continuity-adapter/v1/eve-fixture/agent/tools/reelier_outcome_proposal.ts`
- `test/authority/agent-tools.test.ts`
- `test/authority/ingress.test.ts`
- `test/authority/local-multi-definition-jobs.test.ts`
- `test/continuity/eve-governed-outcomes.test.ts`

# What changed

- The task brief and tracked OSS plan record the orchestrator-authorized integration-test scope amendment for `test/authority/ingress.test.ts`.
- `agent-tool-contracts.ts` defines the closed provider-neutral quartet once: agent status, Outcome proposal, Outcome request, and Outcome status. It owns the canonical schemas, ABI digest, MCP/HTTP/OpenAPI projections, bounded inert input parser, and honest harness capability descriptor for Eve, Codex, Claude Code, Cursor, Grok, and Hermes.
- `agent-tools.ts` adapts the quartet to the existing host-owned job/invoke/status authority. It accepts only authenticated opaque references, keeps provider identity and authority out of model input, and exposes no raw alias.
- The MCP and HTTP ingresses project the same quartet contract. MCP retains every legacy name and reuses the one pre-existing `reelier_outcome_status` name instead of advertising it twice. OpenAPI is generated from the same canonical contract.
- The local host exposes the quartet and rebuilds it around the admitted runtime so the existing revalidation boundary remains in force. The host barrel exports the supported contract and adapter surface.
- The Eve 0.39 fixture routes its deterministic governed-outcomes mission through the ordinary quartet. Cell projections remain closed and redacted; the old fixture tools remain available for compatibility.
- The hermetic rehearsal uses the production `createAuthorityAgentTools` adapter for one composite GitHub+Linear mission and one Linear-only mission. Fresh identities are used; one ambiguous restart reconciles without resend; the assertions require exactly two Outcomes, one standing activation, zero routine approvals, and one review covering both Outcomes. Durable records/logs are checked for credentials, raw prompts, model reasoning, provider URLs, and provider status identifiers.
- The real Eve process test boots the pinned 0.39.0 fixture. Its bearer is registered to a closed principal/task/workload before boot; a skip remains possible only for a precisely missing Eve/native prerequisite.
- Tests cover one-source transport projection, closed parsing, provider-neutral descriptors, opaque-reference translation, additive/unique MCP inventory, admitted-host behavior, hermetic no-resend/review cardinality, closed Eve projections, and real process loading.

# Deviations from plan

- No implementation-scope deviation. During the first full suite, the required additive quartet made the old exact MCP inventory assertion stale. The orchestrator amended the declared files to permit only `test/authority/ingress.test.ts`; its RED exposed a duplicate `reelier_outcome_status` advertisement, which was fixed in the already-declared `mcp.ts` by using the canonical projection once.
- The initial real-Eve RED timed out because the fixture's auth registry was empty. The fix registers the deterministic bearer hash to the fixture principal/task/workload; no production authentication rule was weakened.
- `npm run check:agent-adapter` was initially invoked without its required candidate argument and returned its documented usage failure. Both intended Grok candidate invocations were then run explicitly and passed.
- No live provider call, external write, push, merge, tag, publication, or provider certification was performed.

# Test results

Focused authority/ingress/host/continuity command:

```text
ℹ tests 17
ℹ suites 0
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 15343.2572
```

Package/authority/bootstrap contract tests:

```text
ℹ tests 14
ℹ suites 0
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3300.0858
```

Pinned Eve fixture runtime tests:

```text
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 274.7744
```

The following gates exited 0: both TypeScript typechecks, `npm run build`, `check:authority-contract`, `check:outcome-profile-contract`, `check:bootstrap-contract`, both explicit Grok agent-adapter fixtures, the core continuity-adapter candidate, and `check:continuity-eve`. The fresh Eve conformance tail was:

```text
{"artifacts":{"ledgerHeadDigest":"sha256:54d771004f690beb293ef39d3e8d8ebe2efb8255d6ebaaeadc0a4d6f696ff772","receiptGraphDigest":"sha256:b55083c991df57c09cd6d45794116dd4ad0ef6cc939f436e3226508126893318","reportDigest":"sha256:c296e1351c1d3fcf5f10f4496a9cf465fde0c1d7b8f83e8a76f3e85036d33656"},"authorityAdapterContractDigest":"sha256:cd092558b6963e9f414445fe2235c30530f17684bad71f1bfcfa487178ec00d7","checks":[{"detail":"public continuity adapter candidate checks passed","id":"generic-candidate","status":"passed"},{"detail":"real Eve kill, resume, stream, control, identity, and model matrix passed","id":"eve-process-matrix","status":"passed"},{"detail":"focused Path C and Continuity suites passed","id":"focused-continuity","status":"passed"}],"eveVersion":"0.39.0","maturity":"reproduced","nodeVersion":"v24.9.0","nonClaims":{"contentCorrectness":"not-proved","grokBot":"not-tested","productionReadiness":"not-proved","safety":"not-proved","topology":"not-proved","trafficCompleteness":"not-proved"},"reelierCommit":"5c5a211be14a52a85cd5487b9b5491c2cefa6466","status":"passed","v":"reelier.continuity-eve-conformance-report/v1"}
```

Fresh whole-repository `npm test` completed with the branch's known non-green baseline classes:

```text
ℹ tests 3740
ℹ suites 0
ℹ pass 3692
ℹ fail 28
ℹ cancelled 0
ℹ skipped 20
ℹ todo 0
ℹ duration_ms 615628.1092
```

The 28 failures were in the existing Windows/Linux Authority Cell runtime and lifecycle tests, release runner/saga tests, two Linux-required common-host tests, and the missing native bootstrap manifest test. The Task 5 quartet inventory, hermetic Eve rehearsal, closed Eve projections, and real Eve fixture load all passed in that same run. This report does not infer causality beyond those observed failure messages and stacks.

`git diff --check` exited 0.

# Open risks and non-claims

- Protocol compatibility is an ABI/transport claim, not live harness or provider certification. Only the Eve fixture is marked passed/live-tested by this task.
- The hermetic rehearsal exercises the real production quartet adapter against a deterministic in-memory provider boundary; no live GitHub or Linear write was attempted.
- Reelier receipts still do not prove traffic completeness, topology, content correctness, safety, or production readiness.
- Legacy job tools intentionally remain public compatibility surface until a separate reviewed removal.
- The whole repository remains non-green on this Windows checkout for the recorded pre-existing platform/native/release classes; Task 5's scoped gates are green.
