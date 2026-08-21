# Files changed

- `docs/superpowers/plans/2026-08-20-universal-governed-outcomes-oss.md`
- `src/authority/host/effect-transports.ts`
- `src/authority/host/index.ts`
- `src/authority/host/outcome-kernel.ts`
- `test/authority/effect-transports.test.ts`
- `test/authority/fixtures/tool-effect-contracts.ts`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-3-brief.md`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-3-report.md`

## What changed per file

- `docs/superpowers/plans/2026-08-20-universal-governed-outcomes-oss.md`: reconciles Task 3 with the reviewed serialized result-sink boundary and the generic pending-recovery correction.
- `src/authority/host/effect-transports.ts`: implements closed MCP, reviewed HTTP/OpenAPI, and fixed executable/argv/env CLI adapters. Inputs close before host-only binding and credential injection. Provider data crosses a frozen host-owned sink only as bounded serialized JSON. Arbitrary returned roots are ignored without property access; a genuine native Promise is detected by its inert internal slot and gets an intrinsic rejection handler that emits only the fixed boundary failure. HTTP paths and MCP runtime schema digests are exactly bound. Matched projection evidence remains a `sha256:` wire digest but packs a 128-bit canonical actual-projection commitment plus a 128-bit HMAC-SHA256 authenticator over the contract, binding, reservation, semantic identity, model, readback operation, and projection schema. Verification is restart-stable and constant-time.
- `src/authority/host/index.ts`: additively exports the transport surface while preserving prior host exports.
- `src/authority/host/outcome-kernel.ts`: makes only stored `pending` Outcomes in recoverable ledger states continue through reconciliation; terminal adoption remains unchanged.
- `test/authority/effect-transports.test.ts`: covers the three domains, closed inputs, secret-free artifacts and receipts, strict HTTP and MCP bindings, sanitized errors, actual returned-root zero-trap behavior, native Promise rejection without `unhandledRejection`, ambiguity/no resend, conflict, absent/partial grades, contradictory projection values, forged digest refusal with zero port calls, same-key restart acceptance, different-key refusal, and a genuine second kernel instance for durable pending recovery.
- `test/authority/fixtures/tool-effect-contracts.ts`: supplies hermetic Slack-like, Calendar-like, and Slides-like contracts and reviewed bindings.
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-3-brief.md`: records the approved kernel amendment and inert serialized sink boundary.
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-3-report.md`: records complete scope, commits, gates, deviations, risks, and nonclaims.

## Commits

Round 3 RED/GREEN:

- `d4011a26 test(authority): authenticate projection evidence and Promise failures` - RED, 14/17 focused tests passed. The failures proved secret-bearing native rejection, forged matched evidence grading `verified`, and wrong-key evidence grading `verified`.
- `c60055ca fix(authority): authenticate durable projection provenance` - GREEN, 18/18 focused tests passed after adding the strict host key test and true second-kernel restart assertion.

Round 2: `2237ee0d` (RED) and `5cc2ad1b` (GREEN). Round 1: `b7c9ea7a`, `27b93a52`, `a5baeadc`, `e336bd70`, `3798dae5`, `bca92d56`, `44feb3af`, and `e2bbe716`. The approved recovery scope amendment is `f29609bc`; round 3 started from clean `393d4dcd`.

## Deviations from the plan

The orchestrator amended the original scope to permit the minimal `outcome-kernel.ts` correction. An adapter-only change could not make a stored pending Outcome reach `coordinator.reconcile` because the kernel adopted every stored Outcome first. No provider-specific kernel path or further file scope was added.

The port ABI is a host-owned callback/result sink instead of a Promise resolving to a provider DTO. The compiler now also requires a host-owned persistent 256-bit lowercase-hex observation authentication key. This is a source-level addition to the new Task 3 API; the evidence, Outcome, receipt, schema, and digest wire shapes are unchanged. The key is an immutable primitive and is excluded from model input, compiled effect, evidence, Outcome, and receipt.

No external provider writes, pushes, merges, tags, releases, package publication, or secret reads occurred.

## Test results

### Focused TypeScript and authority/package gate

```text
npx tsc -p tsconfig.json --pretty false
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/authority/effect-transports.test.js dist-test/test/authority/effect-contract.test.js dist-test/test/authority/outcome-kernel.test.js dist-test/test/authority/dispatch-coordinator.test.js dist-test/test/authority/package.test.js
```

Exit `0`. Verbatim tail:

```text
✔ public production export parses DecisionContext and its portable evidence against packaged schemas (749.7266ms)
ℹ tests 72
ℹ suites 0
ℹ pass 72
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 4994.5881
```

The transport file contributed 18/18 passing tests. The actual returned-root proxy reached the port once with zero get/then traps. A native Promise rejecting with a secret settled as the fixed sanitized boundary failure and emitted no `unhandledRejection`.

### Build and contract gates

```text
npm run build
npm run check:authority-contract
npm run check:agent-adapter -- conformance/agent-adapter/v0/fixtures/grok-build-observed.json
npm run check:agent-adapter -- conformance/agent-adapter/v0/fixtures/grok-bot-observed.json
npm run check:continuity-adapter -- conformance/continuity-adapter/v1/fixtures/core-candidate.mjs
```

Exit `0`. Verbatim build tail:

```text
built cloudflare_api_token, cloudflare_dns, github_issue_labels, github_release, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Both agent-adapter reports and the continuity report returned `"status":"passed"`; all ten continuity checks passed.

### Full repository suite

```text
npm test 2>&1 | Select-Object -Last 100; exit $LASTEXITCODE
```

Exit `1`. The retained tail showed observed failures in `github-release-runner.test.js`, two Linux-required `host-server.test.js` cases on Windows, missing `native/bootstrap-helper/manifest.json`, and a missing Eve fixture dependency. These failures are outside the files changed in round 3. This report neither claims they predated the round nor assigns a causal relationship. The focused Task 3 transport tests passed 18/18.

Verbatim tail excerpts:

```text
✖ deterministic tag-conflict refuses without semantic widening (625.7107ms)
AssertionError [ERR_ASSERTION]: Missing expected rejection.

✖ common host serves the same closed outcome over HTTP (206.0565ms)
Error [AuthorityCellLinuxRequiredError]: Authority Cell hosting requires Linux.

✖ installed build digest covers this package's shipped files contract (38.9834ms)
Error: ENOENT: no such file or directory, lstat 'C:\Users\maxim\CascadeProjects\.worktrees\reelier-universal-governed-outcomes\native\bootstrap-helper\manifest.json'

✖ real Eve 0.39.0 preserves Reelier continuity across process and session boundaries (1291.0035ms)
Error: Cannot find module 'C:\Users\maxim\CascadeProjects\.worktrees\reelier-universal-governed-outcomes\conformance\continuity-adapter\v1\eve-fixture\node_modules\eve\bin\eve.js'
```

## Open risks

- These are hermetic ports and contracts; no live provider was contacted or certified.
- The host must durably retain the observation authentication key to verify evidence after restart. Rotating or losing it makes prior markers unverifiable unless the old key remains available to the compiler/verifier.
- A trusted port must serialize and bound its DTO before calling the sink. The host prevents execution through arbitrary returned roots but cannot prevent code intentionally executed inside trusted port code.
- The marker commits 128 bits of the actual projection and authenticates it with a 128-bit truncated HMAC. It does not store raw values or prove content correctness.
- The full Windows repository suite is not green for the observed groups above. Focused authority, build, and conformance gates are green.

## Honest nonclaims

- `verified` does not mean safe, semantically correct, complete, or free of bypass writes.
- The fixtures demonstrate transport neutrality and generic kernel composition, not production provider support.
- Runtime MCP digest equality trusts the inspection port's claimed server provenance.
- Credentials and the observation authentication key are absent from compiled effects, evidence, Outcomes, and final receipts. Final trusted transport requests necessarily contain their injected provider credential.
