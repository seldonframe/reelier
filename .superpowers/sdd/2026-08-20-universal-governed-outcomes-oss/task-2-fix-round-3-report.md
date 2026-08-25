Files changed

- `src/authority/host/outcome-kernel.ts`
- `test/authority/outcome-kernel.test.ts`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-2-fix-round-3-report.md`

What changed per file

- `src/authority/host/outcome-kernel.ts`: a successful `storeEffect` return is accepted only when its revision is the exact CAS successor and its full lifecycle projection, excluding revision, digests identically to the submitted value. This binds mission ID, reservation ID, mission digest, contract digest, reservation semantic identity, nested reservation contract/ID/time fields, and all attempt/observation/Outcome fields before provider dispatch. The durable receipt-head port now returns `receiptId`, `receiptDigest`, and `receiptRef`; every initial adoption and post-publication reread closes/detaches the head and requires the exact expected receipt ID and `digestGovernedReceiptV1(receipt)`. A bare ref or stale/unrelated/digest-mismatched head refuses.
- `test/authority/outcome-kernel.test.ts`: adds hostile successful-store substitution probes for mission ID, reservation ID, mission digest, contract digest including nested reservation contract digest, and reservation semantic identity, each asserting zero provider sends. Adds correct pre-existing-head convergence without another atomic publication, plus bare-ref, unrelated-ID, and wrong-digest head refusal with exact no-resend assertions. The durable fixture now stores the complete exact receipt-head identity.
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-2-fix-round-3-report.md`: records the final scoped round, commits, verification, deviations, and remaining host-boundary risk.

Commits

- `22eed70e test(authority): expose lifecycle substitution and bare-head adoption` — committed RED. The focused pair had 34 passing and 2 failing tests: substituted successful-store mission digest reached completion, and the new exact pre-existing receipt-head contract was not accepted.
- `82c9b010 fix(authority): bind lifecycle stores and receipt heads exactly` — GREEN implementation and durable fixture migration.

Deviations from the review plan

- None. Both final-round blockers were fixed within the Task 2 declared files.
- No adapters, generated contracts, platform gates, or unrelated files were changed.

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
✔ invalid optional ledger issuedAt refuses without accessor execution or fallback (1.8098ms)
✔ concurrent missing-head retries atomically converge on one durable receipt creation and one ref (2.8158ms)
✔ an atomic receipt identity conflict refuses without provider resend (2.5465ms)
✔ an atomic publication ref that disagrees with the durable head refuses as integrity drift (3.4245ms)
✔ successful lifecycle stores cannot substitute any submitted mission, contract, or nested reservation identity (6.4634ms)
✔ pre-existing receipt heads require the exact receipt ID and digest before adoption (6.5458ms)
ℹ tests 847
ℹ suites 0
ℹ pass 841
ℹ fail 0
ℹ cancelled 0
ℹ skipped 6
ℹ todo 0
ℹ duration_ms 85375.917

> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

```text
{"v":"reelier.agent-adapter-conformance-report/v0","status":"passed","adapterId":"xai.grok-build","checks":[{"id":"universal-operations","status":"passed","detail":"adapter exposes only the universal semantic operation set"},{"id":"dynamic-job-discovery","status":"passed","detail":"loaded and invoked job references originate in catalog discovery"},{"id":"host-bound-outcome-input","status":"passed","detail":"Outcome input contains no authenticated identity or provider authority"},{"id":"attenuated-child-principal","status":"passed","detail":"child principal and effect allocation are distinct and narrower"},{"id":"pre-freeze-no-dispatch","status":"passed","detail":"pending Adapter Contract refuses without dispatch or a passing receipt"},{"id":"observed-coverage-honesty","status":"passed","detail":"observed mode remains available with unchecked topology and completeness"},{"id":"enforced-mode-unavailable","status":"passed","detail":"enforced mode remains unavailable without verified topology"}]}
{"v":"reelier.agent-adapter-conformance-report/v0","status":"passed","adapterId":"xai.grok-bot","checks":[{"id":"universal-operations","status":"passed","detail":"adapter exposes only the universal semantic operation set"},{"id":"dynamic-job-discovery","status":"passed","detail":"loaded and invoked job references originate in catalog discovery"},{"id":"host-bound-outcome-input","status":"passed","detail":"Outcome input contains no authenticated identity or provider authority"},{"id":"attenuated-child-principal","status":"passed","detail":"child principal and effect allocation are distinct and narrower"},{"id":"pre-freeze-no-dispatch","status":"passed","detail":"pending Adapter Contract refuses without dispatch or a passing receipt"},{"id":"observed-coverage-honesty","status":"passed","detail":"observed mode remains available with unchecked topology and completeness"},{"id":"enforced-mode-unavailable","status":"passed","detail":"enforced mode remains unavailable without verified topology"}]}
{"v":"reelier.continuity-adapter-conformance-report/v1","status":"passed","maturity":"reproduced","adapterId":"core","harnessId":"core","harnessVersion":"1.0.0","reelierCommit":"44d512263b3e77a301b4d875ab03217712b17c37","authorityAdapterContractDigest":"sha256:cd092558b6963e9f414445fe2235c30530f17684bad71f1bfcfa487178ec00d7","checks":[{"id":"host-identity","status":"passed","detail":"identity is host-bound"},{"id":"identity-isolation-refuses","status":"passed","detail":"cross-identity operations refuse without ledger mutation"},{"id":"replacement-projection","status":"passed","detail":"replacement adapter preserves the resume projection"},{"id":"resume-is-read-only","status":"passed","detail":"repeated open is read-only"},{"id":"cursor-contention","status":"passed","detail":"stale cursor refuses"},{"id":"ambiguity-blocks-resend","status":"passed","detail":"ambiguity requires reconciliation without authority effects"},{"id":"status-does-not-dispatch","status":"passed","detail":"status is read-only"},{"id":"semantic-retry-is-idempotent","status":"passed","detail":"exact retry is idempotent and new ID dispatches"},{"id":"request-id-conflict-refuses","status":"passed","detail":"conflicting request ID refuses without effects"},{"id":"uncertainty-is-honest","status":"passed","detail":"unverified lifecycle states remain exact and uncertain"}],"nonClaims":{"contentCorrectness":"not-proved","productionReadiness":"not-proved","safety":"not-proved","topology":"not-proved","trafficCompleteness":"not-proved"}}
```

Open risks

- The storage port remains host-owned. Production implementations must atomically persist the exact lifecycle submitted and must return a receipt head whose ID/digest/ref refer to the same durable record. The kernel now independently verifies those returned identities before dispatch or adoption.
- Six focused tests remain explicitly skipped by existing Windows platform gates; they are reported as skipped, not passing.
- The repository-wide suite was not rerun in this final scoped round. Earlier Task 2 reporting records the unrelated Windows/native/Eve/baseline failures; all requested focused and contract gates are green.
