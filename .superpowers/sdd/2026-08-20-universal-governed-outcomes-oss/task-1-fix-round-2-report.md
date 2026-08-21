Files changed

- `src/authority/tool-effect-contract.ts`
- `src/authority/index.ts`
- `test/authority/effect-contract.test.ts`
- `test/authority/package.test.ts`
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-1-fix-round-2-report.md`

What changed per file

- `src/authority/tool-effect-contract.ts`: bounds depth and total nodes across every snapshot value; rejects oversized arrays before descriptors; stops enumerable object scanning at key 65 before descriptors; preserves inert rejection of hidden, symbolic, accessor, proxy, cyclic, and shared-identity graphs. Attempt and observation parsers now reject contradictory provider-boundary/evidence tuples. Governed Outcome verification now requires a closed host-owned context whose trusted observation callback is captured once from an enumerable data descriptor, invoked with detached frozen contract/observation input, and must return exactly `true`; projection-pointer digests are no longer treated as observation proof.
- `src/authority/index.ts`: additively exports only the `GovernedOutcomeVerificationContextV1` type; runtime exports and V1 wire/schema ABI are unchanged.
- `test/authority/effect-contract.test.ts`: adds behaviorful descriptor-preflight, function, sparse/huge array, depth/node, cycle/shared identity, duplicate attempt, lifecycle tuple, standalone pack/claim/receipt parser-digest, and trusted verifier false/throw/accessor/exact-true tests.
- `test/authority/package.test.ts`: independently pins the single new public declaration type without changing the runtime export allowlist.
- `.superpowers/sdd/2026-08-20-universal-governed-outcomes-oss/task-1-fix-round-2-report.md`: records the exact round-2 file inventory, commits, gates, and residual trust boundary.

Commits

- `d4835b80 test(authority): preflight hostile wire graphs`
- `a354f9a7 fix(authority): bound wire preflight before descriptors`
- `93f989c7 test(authority): close lifecycle evidence combinations`
- `d01e04a5 fix(authority): close lifecycle evidence states`
- `4f9bad5b test(authority): require trusted observation verification`
- `e0cc986a fix(authority): require trusted observation capability`
- `0c9bd603 test(authority): prove graph budgets short-circuit`

Deviations from the plan and why

- None. The JSON Schema, generated contract artifacts, and V1 wire shapes were intentionally left unchanged. The only public ABI addition is the assigned type-only verification-context export and its independent declaration pin.

Test results (verbatim tail)

```text
✔ every frozen wire kind has a valid, deterministic golden vector (9.7006ms)
✔ additive governed-effect vectors do not rewrite pinned V1 wire digests (0.3298ms)
ℹ tests 73
ℹ suites 0
ℹ pass 73
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2647.223

> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

Commands completed with exit code 0:

```text
npm run build
npx tsc -p tsconfig.test.json --pretty false
node --test dist-test/test/authority/effect-contract.test.js dist-test/test/authority/wire.test.js dist-test/test/authority/compile.test.js dist-test/test/authority/contract.test.js dist-test/test/authority/agent-mandate.test.js dist-test/test/authority/package.test.js
npm run check:authority-contract
git diff --check
```

Open risks

- A `verified` Outcome now depends on the host supplying the trusted verifier capability. This closes self-attestation in the portable record, but the correctness and credential isolation of each host verifier remain part of that host/provider trust boundary and require provider-pack certification.
