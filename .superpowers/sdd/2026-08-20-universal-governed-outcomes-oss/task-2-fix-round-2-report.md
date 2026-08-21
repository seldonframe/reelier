Files changed

- `src/authority/host/outcome-kernel.ts`
- `src/authority/host/prepared-dispatch.ts`
- `test/authority/outcome-kernel.test.ts`
- `test/authority/dispatch-coordinator.test.ts`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-2-fix-round-2-report.md`

What changed per file

- `src/authority/host/outcome-kernel.ts`: binds a successful `claimMission` return to the submitted mission ID and exact `digestMissionClaimV1` value; binds `loadMission` to its query; binds every loaded/stored effect to the requested mission ID and current reservation ID in addition to the existing mission digest, contract digest, and semantic identity checks. Optional ledger `issuedAt` is accepted only as an enumerable canonical timestamp data property; accessors, hidden properties, invalid strings, and non-strings refuse without fallback. Replaces documentary receipt publication with the explicit atomic `compareAndPublishReceipt(receipt, receiptDigest)` port. Only `published` and `exact-existing` results carrying the exact submitted receipt digest and a valid durable ref are accepted; `conflict` refuses. Existing durable receipt heads are still adopted before entering the atomic port.
- `src/authority/host/prepared-dispatch.ts`: validates HTTP method, origin/path/query/body primitives before normalization, validates the exact body digest without coercion, validates header values as descriptor-read strings, and constrains neutral transport names to a bounded identifier. Both HTTP and neutral produced projections remain closed, frozen, and detached.
- `test/authority/outcome-kernel.test.ts`: adds hostile claim/load identity returns, wrong stored mission/reservation IDs, accessor and invalid optional ledger time probes, a barrier-controlled concurrent post-Outcome retry proving two atomic entrants converge to one durable creation/ref, atomic receipt conflict refusal with an exact provider no-resend assertion, and durable-head/ref mismatch refusal. The durable fixture implements the new compare-and-publish contract and independently counts calls versus durable creates.
- `test/authority/dispatch-coordinator.test.ts`: adds HTTP and neutral primitive/no-coercion probes and verifies the produced HTTP projection remains detached after caller mutation.
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-2-fix-round-2-report.md`: records scope, commits, exact gates, deviations, and risks.

Commits

- `500c0401 test(authority): expose storage binding and receipt CAS gaps` — committed RED. The focused pair had 28 passing and 5 failing tests: invalid HTTP primitives accepted, claim result identity not bound, optional ledger time degraded, atomic port unused under a concurrency barrier, and atomic receipt conflict ignored.
- `1c147243 fix(authority): bind storage reads and atomically publish receipts` — GREEN implementation and fixture migration to the explicit atomic port.
- `c9cba6aa test(authority): reject atomic receipt head drift` — committed follow-up RED; 33 passed and the exact head/ref mismatch probe failed because the mismatch degraded instead of refusing.
- `d30fb7c6 fix(authority): refuse atomic receipt head drift` — GREEN integrity fix.

Deviations from the review plan

- None. All three round-2 blockers and their requested probes were addressed within the Task 2 file scope.
- No adapter, generated contract, platform gate, or out-of-scope production file was changed.

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
✔ storage claim and load results are bound to the submitted and queried identities (2.4839ms)
✔ invalid optional ledger issuedAt refuses without accessor execution or fallback (3.5282ms)
✔ concurrent missing-head retries atomically converge on one durable receipt creation and one ref (3.8478ms)
✔ an atomic receipt identity conflict refuses without provider resend (2.7576ms)
✔ an atomic publication ref that disagrees with the durable head refuses as integrity drift (2.7868ms)
ℹ tests 845
ℹ suites 0
ℹ pass 839
ℹ fail 0
ℹ cancelled 0
ℹ skipped 6
ℹ todo 0
ℹ duration_ms 87101.1312

> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

```text
{"v":"reelier.agent-adapter-conformance-report/v0","status":"passed","adapterId":"xai.grok-build","checks":[{"id":"universal-operations","status":"passed","detail":"adapter exposes only the universal semantic operation set"},{"id":"dynamic-job-discovery","status":"passed","detail":"loaded and invoked job references originate in catalog discovery"},{"id":"host-bound-outcome-input","status":"passed","detail":"Outcome input contains no authenticated identity or provider authority"},{"id":"attenuated-child-principal","status":"passed","detail":"child principal and effect allocation are distinct and narrower"},{"id":"pre-freeze-no-dispatch","status":"passed","detail":"pending Adapter Contract refuses without dispatch or a passing receipt"},{"id":"observed-coverage-honesty","status":"passed","detail":"observed mode remains available with unchecked topology and completeness"},{"id":"enforced-mode-unavailable","status":"passed","detail":"enforced mode remains unavailable without verified topology"}]}
{"v":"reelier.agent-adapter-conformance-report/v0","status":"passed","adapterId":"xai.grok-bot","checks":[{"id":"universal-operations","status":"passed","detail":"adapter exposes only the universal semantic operation set"},{"id":"dynamic-job-discovery","status":"passed","detail":"loaded and invoked job references originate in catalog discovery"},{"id":"host-bound-outcome-input","status":"passed","detail":"Outcome input contains no authenticated identity or provider authority"},{"id":"attenuated-child-principal","status":"passed","detail":"child principal and effect allocation are distinct and narrower"},{"id":"pre-freeze-no-dispatch","status":"passed","detail":"pending Adapter Contract refuses without dispatch or a passing receipt"},{"id":"observed-coverage-honesty","status":"passed","detail":"observed mode remains available with unchecked topology and completeness"},{"id":"enforced-mode-unavailable","status":"passed","detail":"enforced mode remains unavailable without verified topology"}]}
{"v":"reelier.continuity-adapter-conformance-report/v1","status":"passed","maturity":"reproduced","adapterId":"core","harnessId":"core","harnessVersion":"1.0.0","reelierCommit":"44d512263b3e77a301b4d875ab03217712b17c37","authorityAdapterContractDigest":"sha256:cd092558b6963e9f414445fe2235c30530f17684bad71f1bfcfa487178ec00d7","checks":[{"id":"host-identity","status":"passed","detail":"identity is host-bound"},{"id":"identity-isolation-refuses","status":"passed","detail":"cross-identity operations refuse without ledger mutation"},{"id":"replacement-projection","status":"passed","detail":"replacement adapter preserves the resume projection"},{"id":"resume-is-read-only","status":"passed","detail":"repeated open is read-only"},{"id":"cursor-contention","status":"passed","detail":"stale cursor refuses"},{"id":"ambiguity-blocks-resend","status":"passed","detail":"ambiguity requires reconciliation without authority effects"},{"id":"status-does-not-dispatch","status":"passed","detail":"status is read-only"},{"id":"semantic-retry-is-idempotent","status":"passed","detail":"exact retry is idempotent and new ID dispatches"},{"id":"request-id-conflict-refuses","status":"passed","detail":"conflicting request ID refuses without effects"},{"id":"uncertainty-is-honest","status":"passed","detail":"unverified lifecycle states remain exact and uncertain"}],"nonClaims":{"contentCorrectness":"not-proved","productionReadiness":"not-proved","safety":"not-proved","topology":"not-proved","trafficCompleteness":"not-proved"}}
```

Open risks

- `compareAndPublishReceipt` is an explicit host durability boundary. A production implementation must perform the receipt-ID/digest comparison and durable creation atomically; the kernel now verifies its returned digest/ref and refuses conflicts but cannot make a dishonest host atomic.
- Six focused tests remain explicitly skipped by existing Windows platform gates; they are reported as skipped, not passing.
- The repository-wide suite was not rerun in this fix round. Earlier Task 2 reporting records the unrelated Windows/native/Eve/baseline failures; all requested focused and contract gates are green.
