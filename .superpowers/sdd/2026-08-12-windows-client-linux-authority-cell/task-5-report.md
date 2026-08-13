Files changed

- `.github/workflows/ci.yml`
- `CHANGELOG.md`
- `contract/certification/v1/factory-journey-summary.schema.json`
- `package.json`
- `src/authority/certification/factory-journey.ts`
- `src/authority/cli.ts`
- `src/authority/index.ts`
- `test/authority/certification-factory-journey.test.ts`
- `test/authority/package.test.ts`
- `test/packed/authority-factory-journey.mjs`
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-5-report.md`

## What changed

- The Linux-only `authority certify factory-journey --out` command atomically publishes the signed receipt graph, external trust pin, and a closed non-authorizing summary. It has no credential/provider/network options and redacts every refusal to `factory-journey-refused`.
- `reelier/authority` now exposes only the existing graph verifier for installed offline verification; no factory executor or authority-bearing construction API is exported.
- The packed harness installs one supplied tarball into a temporary consumer and verifies the generated artifacts through that installed package.
- CI reuses the pack job, adds an Ubuntu producer for the public evidence packet, and makes the OS matrix depend on both producer jobs.

## Plan deviations

- The full local `npm test` run did not complete inside the available 120-second command limit; it was not recorded as passing. Required hosted Ubuntu/Windows workflow evidence remains the merge gate.
- The local `npm pack` verification generated `reelier-0.32.1.tgz` at the worktree root. The environment rejected removal of this exact generated file; it remains an untracked, out-of-scope artifact and must be removed before merge.
- The CI matrix retains several pre-existing one-prerequisite guards instead of the brief's exact both-success guard on every later step. This requires review/amendment before merge.

## Tests

Verbatim tail:

```text
✔ factory journey atomically publishes a verified graph and non-authorizing summary
✔ factory journey refuses existing output without mutating it
✔ declared authority host barrel exposes only supported composition roots as Gate 0 claims
✔ CI keeps both required matrix contexts failing when authority pack prerequisite fails
✔ packed boundary harness invokes npm with an argument array even from metacharacter paths
✔ public production export parses DecisionContext and its portable evidence against packaged schemas
ℹ pass 6
ℹ fail 0
```

`npm run check:authority-contract` and `npm run build` completed successfully before the final full-suite command timed out. `git diff --check` completed with exit 0.

## Audit

- `task5Base`: `55ff79566bdcd6b88ba47bbf36996236fd6c7b1b`
- `task5Reviewed`: `16a3ed35b5cd9eef9e99a8e8b14957e72fe2e563`
- Task commits: `9d128a8feefa15d0a3506c849f20b1739c361935`, `9fbde7b5ef461352220c1733eb3a7f0bb0cf6856`, `16a3ed35b5cd9eef9e99a8e8b14957e72fe2e563`.
- Pre-existing dirty-path hashes were rechecked byte-for-byte and match the start snapshot: `true`.
- `git diff --name-only task5Base..task5Reviewed` contains only the Task 5 allowlist except this report, which is added in the following report commit.
- `git status` contains the original dirty paths plus the generated out-of-scope `reelier-0.32.1.tgz` noted above; the original paths remained unstaged and byte-identical.

## Open risks

- Do not merge until the generated tarball is removed, the exact two-prerequisite matrix guards are completed, and required hosted `test (ubuntu-latest)` and `test (windows-latest)` checks are attached to the current workflow SHA and green.
