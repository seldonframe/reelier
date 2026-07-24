# TQ2 — Stryker mutation testing (trust-critical core)

Stryker set up and proven against the reelier verification core. Config: `stryker.conf.json` (command runner → `npm test`, TypeScript checker kept, `mutate` = full trust-critical set, concurrency 2, HTML report under `reports/mutation/`). Script `test:mutation`. `.stryker-tmp/` + `reports/` gitignored. CI + `test` script untouched (mutation is on-demand — too slow for CI).

## Proof run (2026-07-24)
Scope: `src/canonical-json.ts,src/approval.ts` (small, trust-critical — fast enough to validate the toolchain).

**Mutation score: 93.75%** — 15 killed, **1 survived**, 0 timeout, 11 compile-errors (killed by the type checker), 4m03s. Confirms the toolchain works end-to-end against the `tsc → dist-test → node --test` harness.

| File | Score | Killed | Survived |
|------|-------|--------|----------|
| approval.ts | 100.00% | 2 | 0 |
| canonical-json.ts | 92.86% | 13 | 1 |

## The real finding — 1 survivor (a genuine test gap in the trust core)
**`canonical-json.ts` — a `ConditionalExpression` mutant survived.** A mutation to a conditional in the SHA256 canonical-digest path did NOT cause any test to fail — coverage reported this file "covered," but the tests don't actually pin that branch's behavior. This is exactly the class of weakness mutation testing exists to catch, and it's on a trust-critical path (the digest that receipts are built on). **Follow-up:** add a canonical-json test that distinguishes the two sides of that conditional (e.g. key-ordering / nested-object / empty-value edge), then re-run `npx stryker run --mutate src/canonical-json.ts` to confirm the survivor is killed.

## Full-core run (on-demand, slow)
`npm run test:mutation` mutates the full set (runner/escalate/verify/signing/policy/assert/tsa/manifest/approval/canonical-json ≈ 3,000 LOC). At ~0.6 mutants/sec with the command runner (each mutant = tsc + 695 tests), the full core is a long run — intended as an on-demand quality gate, not per-commit CI. Consider running it per release, or per-module when touching a core file.
