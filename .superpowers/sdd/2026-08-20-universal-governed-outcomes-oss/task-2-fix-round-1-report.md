Files changed

- `src/authority/host/outcome-kernel.ts`
- `src/authority/host/dispatch.ts`
- `src/authority/host/prepared-dispatch.ts`
- `test/authority/outcome-kernel.test.ts`
- `test/authority/dispatch-coordinator.test.ts`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-2-fix-round-1-report.md`

What changed per file

- `src/authority/host/outcome-kernel.ts`: binds both the coordinator description and the durable ledger projection to `digestToolEffectContractV1(contract)`, and requires exact reservation state and allocation agreement. All execution requests, coordinator projections/results, ledger projections, storage results, stored lifecycle records, and receipt heads are descriptor-read, closed, detached, and frozen before use. A stored terminal Outcome is adopted before verifier or provider work. Its deterministic receipt is first adopted from the durable head; if the head is absent, the exact same receipt is submitted once to the idempotent publication sink and reread. Retries preserve Outcome ID, completion time, receipt ID, and issue time and never reverify or resend. Contracts without readback grade `absent` before the maximum-grade fallback.
- `src/authority/host/dispatch.ts`: closes and detaches provider results before coordinator logic observes them. Accessor-bearing or otherwise invalid provider results cannot execute accessor code and enter the existing ambiguous fault path.
- `src/authority/host/prepared-dispatch.ts`: descriptor-parses and detaches prepared input, description, neutral/HTTP projections, and consequential send results. Hidden out-of-band fields do not survive the produced projection; enumerable unknown fields and accessors refuse without execution.
- `test/authority/outcome-kernel.test.ts`: adds contract-A/handle-B, ledger digest, state, and allocation mismatch probes; terminal retry and lost-head deterministic republish probes; exact no-reverification/no-resend and identity preservation assertions; no-readback `absent` grading; accessor-bearing coordinator, ledger, storage, provider-result, and receipt-head DTO probes; simultaneous different-semantics barrier contention; and exact per-effect/aggregate status assertions.
- `test/authority/dispatch-coordinator.test.ts`: fixes the credential-leak assertion to inspect the produced detached projection and adds accessor-bearing prepared projection/provider result probes.
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-2-fix-round-1-report.md`: records the fix scope, RED/GREEN commits, exact verification, deviations, and remaining risks.

Commits

- `714000aa test(authority): expose outcome kernel retry and DTO gaps` — committed RED. The focused pair had 23 passing and 5 failing tests: prepared projection accessor acceptance, state projection mismatch reaching dispatch, terminal retry reverification, no-readback grading `partial`, and coordinator projection getter execution.
- `dea1967e fix(authority): adopt durable terminal outcomes exactly` — GREEN implementation and complete review-probe regressions.

Deviations from the review plan

- None. The optional revoked/expired handle cancellation was not added because refusal-before-dispatch already preserves the existing coordinator semantics, and the review explicitly made cancellation optional.
- No out-of-scope files, adapters, fixtures, generated contracts, or platform gates were modified.

Test results (verbatim tail)

Commands completed with exit code 0:

```text
npm run build
npx tsc -p tsconfig.test.json --pretty false
node --test dist-test/test/authority/outcome-kernel.test.js dist-test/test/authority/dispatch-coordinator.test.js dist-test/test/authority/prepared-dispatch.test.js dist-test/test/authority/receipt-authority.test.js dist-test/test/authority/receipts.test.js dist-test/test/authority/gate.test.js dist-test/test/authority/ledger.test.js dist-test/test/authority/effect-contract.test.js dist-test/test/authority/package.test.js
npm run check:authority-contract
npm run check:agent-adapter -- conformance/agent-adapter/v0/fixtures/grok-build-observed.json
npm run check:agent-adapter -- conformance/agent-adapter/v0/fixtures/grok-bot-observed.json
npm run check:continuity-adapter -- ./conformance/continuity-adapter/v1/fixtures/core-candidate.mjs
```

```text
✔ the reviewed contract digest must match both the described handle and durable ledger projection (3.1246ms)
✔ terminal retries adopt the stored Outcome and durable receipt without reverification or provider resend (3.0837ms)
✔ a contract without readback grades absent before its maximum-grade fallback (1.7024ms)
✔ hostile coordinator and storage DTO accessors are rejected without execution (8.4866ms)
✔ concurrent different mission semantics produce one claim and one conflict behind the same barrier (0.4575ms)
ℹ tests 839
ℹ suites 0
ℹ pass 833
ℹ fail 0
ℹ cancelled 0
ℹ skipped 6
ℹ todo 0
ℹ duration_ms 86385.2239

> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

```text
{"v":"reelier.agent-adapter-conformance-report/v0","status":"passed","adapterId":"xai.grok-build","checks":[{"id":"universal-operations","status":"passed","detail":"adapter exposes only the universal semantic operation set"},{"id":"dynamic-job-discovery","status":"passed","detail":"loaded and invoked job references originate in catalog discovery"},{"id":"host-bound-outcome-input","status":"passed","detail":"Outcome input contains no authenticated identity or provider authority"},{"id":"attenuated-child-principal","status":"passed","detail":"child principal and effect allocation are distinct and narrower"},{"id":"pre-freeze-no-dispatch","status":"passed","detail":"pending Adapter Contract refuses without dispatch or a passing receipt"},{"id":"observed-coverage-honesty","status":"passed","detail":"observed mode remains available with unchecked topology and completeness"},{"id":"enforced-mode-unavailable","status":"passed","detail":"enforced mode remains unavailable without verified topology"}]}
{"v":"reelier.agent-adapter-conformance-report/v0","status":"passed","adapterId":"xai.grok-bot","checks":[{"id":"universal-operations","status":"passed","detail":"adapter exposes only the universal semantic operation set"},{"id":"dynamic-job-discovery","status":"passed","detail":"loaded and invoked job references originate in catalog discovery"},{"id":"host-bound-outcome-input","status":"passed","detail":"Outcome input contains no authenticated identity or provider authority"},{"id":"attenuated-child-principal","status":"passed","detail":"child principal and effect allocation are distinct and narrower"},{"id":"pre-freeze-no-dispatch","status":"passed","detail":"pending Adapter Contract refuses without dispatch or a passing receipt"},{"id":"observed-coverage-honesty","status":"passed","detail":"observed mode remains available with unchecked topology and completeness"},{"id":"enforced-mode-unavailable","status":"passed","detail":"enforced mode remains unavailable without verified topology"}]}
{"v":"reelier.continuity-adapter-conformance-report/v1","status":"passed","maturity":"reproduced","adapterId":"core","harnessId":"core","harnessVersion":"1.0.0","reelierCommit":"44d512263b3e77a301b4d875ab03217712b17c37","authorityAdapterContractDigest":"sha256:cd092558b6963e9f414445fe2235c30530f17684bad71f1bfcfa487178ec00d7","checks":[{"id":"host-identity","status":"passed","detail":"identity is host-bound"},{"id":"identity-isolation-refuses","status":"passed","detail":"cross-identity operations refuse without ledger mutation"},{"id":"replacement-projection","status":"passed","detail":"replacement adapter preserves the resume projection"},{"id":"resume-is-read-only","status":"passed","detail":"repeated open is read-only"},{"id":"cursor-contention","status":"passed","detail":"stale cursor refuses"},{"id":"ambiguity-blocks-resend","status":"passed","detail":"ambiguity requires reconciliation without authority effects"},{"id":"status-does-not-dispatch","status":"passed","detail":"status is read-only"},{"id":"semantic-retry-is-idempotent","status":"passed","detail":"exact retry is idempotent and new ID dispatches"},{"id":"request-id-conflict-refuses","status":"passed","detail":"conflicting request ID refuses without effects"},{"id":"uncertainty-is-honest","status":"passed","detail":"unverified lifecycle states remain exact and uncertain"}],"nonClaims":{"contentCorrectness":"not-proved","productionReadiness":"not-proved","safety":"not-proved","topology":"not-proved","trafficCompleteness":"not-proved"}}
```

Open risks

- Receipt publication remains a host port. Exact once-visible behavior during concurrent lost-head recovery depends on the documented idempotent sink keyed by the deterministic receipt ID; the kernel submits the same bytes and never invents a replacement identity.
- Durable storage still must provide atomic mission claim/CAS and detached durable readback in production. The kernel parses every returned value but cannot manufacture durability for a dishonest host implementation.
- Six focused tests remain explicitly skipped by existing Windows platform gates; they are reported as skipped, not passing.
- The repository-wide suite was not rerun in this fix round. The prior Task 2 report records its unrelated Windows/native/Eve/baseline failures; the required focused and contract gates are green here.
