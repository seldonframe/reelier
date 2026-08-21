Files changed

- `src/authority/host/outcome-kernel.ts`
- `src/authority/host/dispatch.ts`
- `src/authority/host/prepared-dispatch.ts`
- `src/authority/host/receipt-authority.ts`
- `src/authority/evidence.ts`
- `src/authority/host/index.ts`
- `test/authority/outcome-kernel.test.ts`
- `test/authority/dispatch-coordinator.test.ts`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-2-report.md`

What changed per file

- `src/authority/host/outcome-kernel.ts`: adds the provider-neutral composition kernel. `AuthorityLedger` remains the only reservation/CAS authority and `DispatchCoordinator` remains the only send/reconcile authority. The new storage port persists only mission, effect-lifecycle, Outcome, and neutral receipt projections. Durable mode refuses absent/non-durable storage; explicit hermetic mode cannot return a verified aggregate. Mission claim is atomic exact-existing-or-conflict. Restart accepts a reservation ID without reconstructing the consumed gate handle; reserved restart recovery closes the undispatched effect, dispatched/ambiguous work uses coordinator recovery/readback, and terminal work is never resent. Host-minted observation verifier capabilities are exact-contract bound and invoked once. Multi-effect aggregation requires every effect verified plus durable receipt-head readback before returning verified.
- `src/authority/host/dispatch.ts`: exposes the minimum detached `describe(handle)` projection needed by the kernel. It contains reservation ID/state, effect digest, and allocation ID only; the coordinator privately retains the consumed handle state for its later dispatch/cancel call. Existing coordinator implementations remain source-compatible because the hook is additive/optional outside the kernel.
- `src/authority/host/prepared-dispatch.ts`: adds a closed credential-free non-HTTP prepared-effect projection and a shared projection digest function. Existing materialized HTTP projections remain unchanged. Ambiguous-send evidence now hashes the truthful projection arm.
- `src/authority/host/receipt-authority.ts`: adds construction of the neutral governed receipt arm from an exact mission and per-effect Outcome.
- `src/authority/evidence.ts`: adds the closed neutral governed receipt builder; durable publication remains host-owned.
- `src/authority/host/index.ts`: exports the kernel, storage/projection/capability types, neutral prepared projection, coordinator projection, and governed receipt constructor.
- `test/authority/outcome-kernel.test.ts`: covers barrier-controlled concurrent mission claim convergence and semantic conflict, revocation and expiry before send, crash injection at mission/reservation/provider-response/attempt/observation/Outcome/receipt boundaries, restart from a shared durable fixture, exact provider no-resend counters, ambiguous readback-only recovery, receipt-head loss, multi-effect pending aggregation, contract-bound single-use observation verification, missing durable storage refusal, and hermetic ambiguity downgrade.
- `test/authority/dispatch-coordinator.test.ts`: covers the detached coordinator description and closed non-HTTP prepared projection without weakening the existing dispatch/recovery contract.
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-2-report.md`: records exact scope, commits, verification evidence, deviations, and open risks.

Commits

- `c0685ff8 test(authority): define durable outcome kernel lifecycle` (committed RED; test TypeScript compilation failed on the intentionally absent kernel exports and coordinator hook).
- `a00d458a feat(authority): compose durable governed outcomes` (GREEN implementation and expanded lifecycle regressions).

Deviations from the plan and why

- None. The kernel does not introduce a provider-send or reservation state machine. Its effect lifecycle record is a projection of the existing ledger/coordinator lifecycle.
- The bare `check:agent-adapter` and `check:continuity-adapter` scripts require a candidate argument. A first bare invocation emitted a closed `status:"failed"` usage report while returning process exit 0 through npm. The gates were rerun with both documented agent fixtures and the documented Continuity core candidate; all returned `status:"passed"`.

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
git diff --check
```

```text
✔ durable mission claim converges under a barrier and changed semantics conflict (4.9847ms)
✔ revocation and expiry refuse before dispatch (3.0833ms)
✔ crash after provider response restarts from the ledger without resending (2.4348ms)
✔ every durable lifecycle boundary restarts without a second provider write (10.2873ms)
✔ a crash after the atomic mission claim converges to the exact prior semantics (0.5011ms)
✔ ambiguous restart is readback-only and a lost receipt head prevents verified aggregation (2.3038ms)
✔ trusted observation verification is contract-bound and invoked exactly once (2.2859ms)
✔ missing durable storage refuses and hermetic ambiguity cannot become verified (1.6647ms)
ℹ tests 833
ℹ suites 0
ℹ pass 827
ℹ fail 0
ℹ cancelled 0
ℹ skipped 6
ℹ todo 0
ℹ duration_ms 85689.7305

> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

```text
{"v":"reelier.agent-adapter-conformance-report/v0","status":"passed","adapterId":"xai.grok-build","checks":[{"id":"universal-operations","status":"passed","detail":"adapter exposes only the universal semantic operation set"},{"id":"dynamic-job-discovery","status":"passed","detail":"loaded and invoked job references originate in catalog discovery"},{"id":"host-bound-outcome-input","status":"passed","detail":"Outcome input contains no authenticated identity or provider authority"},{"id":"attenuated-child-principal","status":"passed","detail":"child principal and effect allocation are distinct and narrower"},{"id":"pre-freeze-no-dispatch","status":"passed","detail":"pending Adapter Contract refuses without dispatch or a passing receipt"},{"id":"observed-coverage-honesty","status":"passed","detail":"observed mode remains available with unchecked topology and completeness"},{"id":"enforced-mode-unavailable","status":"passed","detail":"enforced mode remains unavailable without verified topology"}]}
{"v":"reelier.agent-adapter-conformance-report/v0","status":"passed","adapterId":"xai.grok-bot","checks":[{"id":"universal-operations","status":"passed","detail":"adapter exposes only the universal semantic operation set"},{"id":"dynamic-job-discovery","status":"passed","detail":"loaded and invoked job references originate in catalog discovery"},{"id":"host-bound-outcome-input","status":"passed","detail":"Outcome input contains no authenticated identity or provider authority"},{"id":"attenuated-child-principal","status":"passed","detail":"child principal and effect allocation are distinct and narrower"},{"id":"pre-freeze-no-dispatch","status":"passed","detail":"pending Adapter Contract refuses without dispatch or a passing receipt"},{"id":"observed-coverage-honesty","status":"passed","detail":"observed mode remains available with unchecked topology and completeness"},{"id":"enforced-mode-unavailable","status":"passed","detail":"enforced mode remains unavailable without verified topology"}]}
{"v":"reelier.continuity-adapter-conformance-report/v1","status":"passed","maturity":"reproduced","adapterId":"core","harnessId":"core","harnessVersion":"1.0.0","reelierCommit":"44d512263b3e77a301b4d875ab03217712b17c37","authorityAdapterContractDigest":"sha256:cd092558b6963e9f414445fe2235c30530f17684bad71f1bfcfa487178ec00d7","checks":[{"id":"host-identity","status":"passed","detail":"identity is host-bound"},{"id":"identity-isolation-refuses","status":"passed","detail":"cross-identity operations refuse without ledger mutation"},{"id":"replacement-projection","status":"passed","detail":"replacement adapter preserves the resume projection"},{"id":"resume-is-read-only","status":"passed","detail":"repeated open is read-only"},{"id":"cursor-contention","status":"passed","detail":"stale cursor refuses"},{"id":"ambiguity-blocks-resend","status":"passed","detail":"ambiguity requires reconciliation without authority effects"},{"id":"status-does-not-dispatch","status":"passed","detail":"status is read-only"},{"id":"semantic-retry-is-idempotent","status":"passed","detail":"exact retry is idempotent and new ID dispatches"},{"id":"request-id-conflict-refuses","status":"passed","detail":"conflicting request ID refuses without effects"},{"id":"uncertainty-is-honest","status":"passed","detail":"unverified lifecycle states remain exact and uncertain"}],"nonClaims":{"contentCorrectness":"not-proved","productionReadiness":"not-proved","safety":"not-proved","topology":"not-proved","trafficCompleteness":"not-proved"}}
```

Open risks

- `OutcomeKernelStorage` is a host port, not a new bundled filesystem/SQL implementation. A production host must supply true atomic claim/CAS and durable receipt-head semantics; the kernel refuses a non-durable port unless explicitly hermetic.
- The kernel can resume an already claimed effect by reservation ID after process death. A still-reserved restart is closed by coordinator recovery rather than recreating send authority from an opaque consumed handle.
- The six skipped focused tests are existing platform-gated prepared-commit/N100 cases in the selected Windows run; they are reported as skipped, not passing.
- The Continuity conformance candidate reports its pinned historical `reelierCommit` by fixture design; this Task did not rewrite that existing fixture.
