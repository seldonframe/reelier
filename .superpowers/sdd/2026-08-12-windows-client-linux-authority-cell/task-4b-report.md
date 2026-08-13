Files changed

- `.github/workflows/ci.yml`
- `README.md`
- `CHANGELOG.md`
- `docs/superpowers/plans/2026-08-12-windows-client-linux-authority-cell.md`
- `src/authority/host/fs-ledger.ts`
- `src/authority/host/index.ts`
- `test/authority/package.test.ts`
- `test/authority/ledger.test.ts`
- `test/authority/linux-authority-cell.test.ts`
- `test/packed/authority-host-boundary.mjs`
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4b-report.md`

## Scope and commits

- task4bBase: `039cc7b3703df6b859df8cb81659294b2c4bfa0d`
- historical package-boundary review range: `039cc7b3703df6b859df8cb81659294b2c4bfa0d..3080a707b5f1dfc6abda8661af77fe05a8882c25`. It contains the earlier implementation/evidence commits `2ad0e882b53a738fc4b14e8f27ac76aaa031d04a`, `46a2b88421147ac582625a1b683242e3512795e0`, `bba23a65e7a90e24c408153f4c4dd5275d7227fc`, `444c6b9104cd684cb997147e431d7c0448a0da69`, `d6d260414ade771a37d77f75e2d5fb138883bd7c`, `be3e0faef3e290590cdeb5ea32436e4e8da9ac06`, `1c4111734c77d66b937c67fe42869b80aaa83321`, `b228fc54499fb0774f532ab947f5b5dc874e02ea`, `18d973e2bea92b0b15a517839ce91b3e8deccb7b`, review RED `5e5679b5d38218e36b93cdd7374dfb63f37888d0`, review GREEN `f55287fd5d96fb9f801859892aca75d42b614fb2`, compile-order RED `e2e7f820ccf20969f0bc8cef040f95f1f81b4f90`, and compile-order GREEN `3080a707b5f1dfc6abda8661af77fe05a8882c25`. Endpoint `3080a70` is historical package-boundary review provenance, not the latest Task 4B implementation or a review endpoint for the later fixed-slot change.
- subsequent report-only history before the fixed-slot work: `106c17845d21a89289f2ee04b2ccacfe02b9a9a9` and `5dd6b2702465d5a9a61e0b7f8d84904276983ac3`.
- latest implementation GREEN: `b15277f` (`fix(ledger): tolerate unrelated released slot residue`), preceded by deterministic RED `906b68c` (`test(ledger): pin live slot released residue`). Formal amendment/report commit `23a733f` (`docs(plan): authorize fixed-slot residue correction`) followed those code commits. The docs-only commit containing this reviewer correction is separately classified as a post-amendment provenance/evidence correction, not an implementation or review-endpoint commit.
- current review status: independent review produced the findings corrected here; re-review is pending. No `task4bReviewed` endpoint is claimed for the expanded fixed-slot range. The earlier dirty-path equality evidence remains historical evidence for the earlier package-boundary review only.

## What changed

- The public Authority API test now includes the approved Adapter Contract v1 exports and declaration line.
- The host barrel no longer exports `FsAuthorityLedger`; the eight literal `SUPPORTED_LINUX_HOST_ROOTS` are asserted by source/package and packed-consumer tests. The diagnostic excluded complement is derived from runtime names, with the five required witnesses checked without freezing the complement.
- The N100 test is Linux-only, retains its 120 second timeout, and asserts zero refusals, one reserved winner, 99 exact-existing outcomes, transition to acknowledged, and exact recovery.
- The packed harness installs an exact absolute tarball and checks declared-barrel roots, raw ledger omission, `ERR_PACKAGE_PATH_NOT_EXPORTED` for the package-specifier subpath, and physical `dist/authority/host/fs-ledger.js` presence.
- CI packs once on Ubuntu, uploads the tarball and SHA/source/Adapter digest metadata, makes both matrix contexts depend on it with `always()` plus an explicit failing prerequisite step, and verifies the downloaded artifact before use.
- Every downstream matrix step is regression-tested for the pack-success guard. Ubuntu runs the full suite and N100; Windows runs only package, Linux-refusal, Authority Cell client/identity, and portable offline-evidence tests.
- The unreleased changelog now states the native Windows hosting refusal/client boundary and does not claim a Windows ledger repair.

## Dirty snapshot evidence

Pre-existing dirty paths were recorded before edits and were not staged: `.gitignore` `sha256:1e7cebd1e077359f19191d8f5ab354bb4e2171080492c4edc05eea87e842a508`; `src/authority/certification/manifests.ts` `sha256:31021c1b517b0ba1351064c3acfdf314c46d94926b00368fb97f4e45a91486b0`; `src/authority/certification/runner-registry.ts` `sha256:90d0943698f4fbb6c8261e34171aa44146e8ad840938fd10112d2d1d640cd21f`; `test/authority/certification-input-fixture.ts` `sha256:4789f255e39e000ed2ae40dbdb90ea5da2ae85a835ab604a78bb69155fcd11ba`; `.tmp-pack/full-test-output-serial.log` `sha256:a64ccf7bd70b314746f24747b03de85dab97b51080c1c5e14466d2c32476b3ab`; `.tmp-pack/full-test-output.log` `sha256:3b88281fadcdc2e2362071306fe615ba217b6b021a3d43dae6014b93f4b694bb`; `.tmp-pack/reelier-0.32.0.tgz` `sha256:acfb4e7de668cccd06c19bba1013baac506575154135b139169008fa0455cb7e`; `native/windows-k1-helper/Cargo.lock` `sha256:da1c70beb98d9279917016de836f6842483144c0d8b78f152eeffd21a45d53b6`; `native/windows-k1-helper/Cargo.toml` `sha256:5479e734bdacb84ebd0bd60f07f54b8dc700427a9dd564ee00219b51b84c53eb`; `native/windows-k1-helper/build.rs` `sha256:97468c35adf133032e6c12143c62e91171aedc34676a10cd0be3e374472dcd56`; `native/windows-k1-helper/src/lib.rs` `sha256:52a7d6f48edf4ca99e9b4d15d0a68b4e3d9b74cd9ad67fa3185ef38b6e04028d`; `native/windows-k1-helper/src/names.rs` `sha256:f6d8f6a87f7292a09553740c98a6fdc9c65f4070a7813efc1ccd1022a039251c`; `native/windows-k1-helper/src/status.rs` `sha256:a87717902392746bb51f97a07872b07dd417505b120f42eb5ba8babdfb4a7041`; `rust-toolchain.toml` `sha256:b921a5cf16cb5b9ffde3d3756e34d859051e665b05ad89df5afda3c6581ac792`.

## Tests and provenance

Pre-RED Task 1 baseline (Windows client): `npm run build && npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/package.test.js` exited 0; tail: `pass 1`, `fail 0`.

RED: build/typecheck completed and the package test failed as intended: `FsAuthorityLedger` was still an own host-barrel runtime export; the CI prerequisite regression also failed because no pack job existed.

GREEN local Windows evidence: build/typecheck and package + Linux-cell seam tests exited 0 (`pass 10`, `fail 0`). `node test/packed/authority-host-boundary.mjs --tarball <absolute-path> --mode surface` exited 0. The packed tarball SHA-256 was `sha256:8c7da130074f27a43940263157e17e3d7e103590080850349389c196a151fdd3`.

Review round RED (`5e5679b`): `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/package.test.js dist-test/test/authority/linux-authority-cell.test.js` exited 1 with `pass 9`, `fail 2`. The intended failures were the absent `Run supported tests` CI step and the harness still matching `ComSpec|cmd.exe|npmArgs.join`. The new eight-root checkout seam passed while independently measuring every root.

Review round GREEN (`f55287f`): the focused tests and the packed `windows-native` harness exited 0. The metacharacter-path packed install also exited 0.

Exact local Windows CI-equivalent verification: `npm run check:authority-contract; npm run build; npx tsc -p tsconfig.test.json; node --test --test-concurrency=1 dist-test/test/authority/package.test.js dist-test/test/authority/linux-authority-cell.test.js dist-test/test/authority/authority-cell-connection.test.js dist-test/test/authority/certification-portable-evidence.test.js; npm pack --ignore-scripts --json; packed surface; packed windows-native; git diff --check; scope diff`. Exit 0. Verbatim test tail:

```text
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1487.6268
```

Tarball SHA-256: `8c7da130074f27a43940263157e17e3d7e103590080850349389c196a151fdd3`. Both packed modes exited 0. The generated root tarball was removed after verification; `.tmp-pack` was untouched.

Argument-boundary case: copied that byte-identical tarball to native Windows temporary path `reelier task4b & args-<nonce>\reelier package & exact.tgz`, ran `node test/packed/authority-host-boundary.mjs --tarball <special-absolute-path> --mode windows-native`, compared source/copy SHA-256, and exited 0. The harness invokes the resolved npm CLI as `execFileSync(process.execPath, [npmCli, ...npmArgs])`; it never constructs a `cmd.exe` command string. Both temporary copies were removed afterward.

Fresh post-report Windows gate tail:

```text
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1415.6782
SCOPE_OK=8
```

Fix round 2 RED commit `e2e7f82`: `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/package.test.js` exited 1. Verbatim tail:

```text
ℹ tests 4
ℹ pass 3
ℹ fail 1
AssertionError [ERR_ASSERTION]: - name: Compile test checkout
```

Fix round 2 GREEN commit `3080a70`: added guarded `npx tsc -p tsconfig.test.json --pretty false` after build and before artifact download or any `dist-test` invocation. The regression asserts the compile step exists, has the prerequisite-success guard, contains the exact compile command, and precedes the first `dist-test/` token. Focused GREEN exited 0: `tests 4`, `pass 4`, `fail 0`.

Fresh workflow-equivalent command: `npm run check:authority-contract; npm run build; npx tsc -p tsconfig.test.json --pretty false; node --test --test-concurrency=1 dist-test/test/authority/package.test.js dist-test/test/authority/linux-authority-cell.test.js dist-test/test/authority/authority-cell-connection.test.js dist-test/test/authority/certification-portable-evidence.test.js; npm pack --ignore-scripts --json; packed surface; packed windows-native; git diff --check; scope audit`. Exit 0. Verbatim tail:

```text
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1428.1727
SHA256=8c7da130074f27a43940263157e17e3d7e103590080850349389c196a151fdd3
SCOPE_OK=8
```

Diagnostic excluded complement (not frozen authority): count `96`; UTF-8 JCS sorted-name-array digest `sha256:7db00876f1f8ef4c9d05c3f1b985544e776ad0a293593e57eff1811e2f0b3b15`. Witness membership: `FsDelegationBudgetLedger=true`, `executeJsonHttpsEffect=true`, `launchCodexDogfood=true`, `runCertification=true`, `runCertificationSuite=true`.

| Evidence | downloaded tarball | same-workflow checkout | native OS |
|---|---|---|---|
| declared host barrel/no raw subpath/physical internal file | verified (local surface mode) | absent | Windows |
| Windows host-root refusal before access/callback/root mutation | verified (`windows-native`, eight installed-tarball roots) | verified supplemental seam: eight per-root dependency/callback counters and empty roots | Windows |
| N100 one reserved/99 exact-existing/acknowledged recovery | absent | absent | Ubuntu hosted evidence absent |

Public API claim: `reelier/authority/host` no longer owns `FsAuthorityLedger`; its undeclared `fs-ledger.js` package-specifier rejects. Nonclaim: the physically shipped internal file is not inaccessible by an absolute resolved path, and the excluded complement is neither an approved inventory nor removed by this task.

## Open risks / deviations

## Gate 0 Linux oracle correction (2026-08-13)

### Files changed

- `test/authority/ledger.test.ts`
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4b-report.md`

### What changed per file

- `test/authority/ledger.test.ts`: corrected the N100 test oracle so assignment indices are asserted per distinct intent-limit key. Both committed slots use different keys and therefore each receives the first free index, `0`; the previous expected second-slot index of `1` incorrectly used its position in `limitSlots`.
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4b-report.md`: recorded this hosted Gate 0 oracle correction and its local Windows verification limitation.

### Deviations from plan

- None. Production allocator code, timeout, retry, concurrency, and conservation behavior were not modified. The allocator filters existing assignments by `item.key` before selecting the first unoccupied index, which confirms the test-only correction.

### Test results (verbatim tail)

`npx tsc -p tsconfig.test.json --noEmit; npx tsc -p tsconfig.test.json; node --test --test-concurrency=1 --test-name-pattern "N100 authority convergence" dist-test/test/authority/ledger.test.js` exited `0` on Windows. The test compilation completed successfully. Focused test tail:

```text
﹣ N100 authority convergence: one committed reservation, exact-existing outcomes, and acknowledged recovery (1.9701ms) # SKIP
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 232.9408
```

### Open risks

- The N100 test is intentionally guarded with `skip: process.platform !== "linux"`; Windows cannot execute its Linux filesystem convergence path. Hosted Ubuntu revalidation is still required to demonstrate the corrected oracle there.

- Hosted `test (ubuntu-latest)` evidence attached to this workflow SHA was not available locally, so the required N100 result is absent.
- The earlier native-Windows full-suite run confirmed Linux-host-only tests are inappropriate for the required Windows context. The approved native Windows gate is now the explicit supported 26-test suite above; Ubuntu retains the full suite and N100.
- `windows-native` RED command: `node test/packed/authority-host-boundary.mjs --tarball <absolute-path> --mode windows-native` failed with `windows-native composition-root no-access proof not implemented`. GREEN rerun exited 0 after asserting all eight installed-tarball roots reject with `AUTHORITY_CELL_LINUX_REQUIRED`, dependency accesses `0`, callback invocations `0`, and every supplied temporary root empty.
- The generated root `reelier-0.32.1.tgz` was verified as this task's just-packed 894960-byte artifact with SHA-256 `8c7da130074f27a43940263157e17e3d7e103590080850349389c196a151fdd3` and removed. `.tmp-pack` was untouched.
- Hosted Ubuntu status remains `absent` locally. No Ubuntu full-suite or N100 green claim is made.

## Merge review fix round 1 (2026-08-13)

### Files changed

- `README.md`
- `test/authority/package.test.ts`
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4b-report.md`

### What changed per file

- `README.md`: replaced the unsupported merged-tree `2875 passing` claim with the explicit non-numeric `hosted verification pending` badge state. No merged Ubuntu count is claimed.
- `test/authority/package.test.ts`: retained the exact prerequisite-only assertion for every ordinary downstream matrix step, while recognizing the badge step's conjunction and independently requiring the pack-success predicate, the Linux-runner predicate, and `&&`. Existing job dependency, `always()`, explicit failure propagation, step ordering, and compile-before-`dist-test` checks remain intact.
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4b-report.md`: recorded the merge-review correction, focused test evidence, and hosted-evidence limitation.

### Deviations from plan and why

- None. The workflow itself was not changed in this fix round; its already-correct combined guard remains intact. No numeric badge value was inferred from local Windows evidence.

### Test results (verbatim tail)

RED before the test compatibility fix: `node --test --test-concurrency=1 dist-test/test/authority/package.test.js` exited `1` because the old assertion required the exact prerequisite-only guard on the badge step:

```text
ℹ tests 4
ℹ suites 0
ℹ pass 3
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1748.6376
AssertionError [ERR_ASSERTION]: - name: Check README tests badge has a prerequisite success guard
```

Final verification command: `npx tsc -p tsconfig.test.json --pretty false`, then the focused package and badge suites, then `git diff --check -- README.md test/authority/package.test.ts`; all exited `0`. Package-suite tail:

```text
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 522.4707
```

Badge-suite tail:

```text
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 79.7643
```

Controlled canonical-style diagnostic used the unmistakably synthetic count `314159`; it printed the TAP total and exited `1` with the pending README state, proving the hosted badge step will intentionally fail rather than certify a count:

```text
# tests 314159
# pass 314159
# fail 0
{"ok":false,"actualPass":314159,"badgeCount":null,"message":"no tests badge found in README.md"}
```

### Open risks

- The canonical merged Ubuntu pass count remains absent locally. The next hosted Ubuntu full-suite run must supply the actual `# pass` total before the pending badge can be replaced with a numeric claim.
- The controlled diagnostic proves failure disposition and preservation of the parsed total; `314159` is a fixture, not suite evidence.

## Merge review fix round 2 (2026-08-13)

### Files changed

- `test/authority/package.test.ts`
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4b-report.md`

### What changed per file

- `test/authority/package.test.ts`: replaced the three independently loose badge-guard token checks with exact normalized equality against `if: ${{ needs.pack-authority-host-boundary.result == 'success' && runner.os == 'Linux' }}`. The downstream step audit now requires that same exact combined guard; ordinary steps retain their exact prerequisite-only checks.
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4b-report.md`: recorded the falsifier RED and focused GREEN evidence.

### Deviations from plan and why

- None. `.github/workflows/ci.yml` and `README.md` were unchanged.

### Test results (verbatim tail)

RED mutation command evaluated the prior three assertions against the reviewer's weakened guard `${{ needs.pack-authority-host-boundary.result == 'success' || true && runner.os == 'Linux' }}`. It exited `1`, proving those checks incorrectly accepted the falsifier:

```text
AssertionError [ERR_ASSERTION]: regression must reject a guard that weakens pack success with || true

true !== false
```

Final verification ran `npx tsc -p tsconfig.test.json --pretty false`, focused package and badge suites, and `git diff --check -- test/authority/package.test.ts`; all exited `0`. Package-suite tail:

```text
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 693.7931
```

Badge-suite tail:

```text
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 95.641
```

### Open risks

- The exact normalized equality intentionally treats any semantic change to the badge guard as review-requiring. The hosted Ubuntu pass count remains absent and pending as recorded in fix round 1.

## N100 acknowledge diagnostic follow-up (2026-08-13)

### Files changed

- `test/authority/ledger.test.ts`
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4b-report.md`

### What changed per file

- `test/authority/ledger.test.ts`: Added a lazy, deterministic N100 transition failure diagnostic. It reports only the transition result discriminants (`ok`, `reason`, and `status`) and sorted root entry names. The existing dispatch and acknowledge success assertions now attach that diagnostic only if their result is not OK.
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4b-report.md`: Records this scoped diagnostic-only change and its verification evidence.

### Deviations from the plan and why

- None. Journal event summaries were intentionally omitted because the result discriminants and sorted root names are sufficient to distinguish the requested busy, corruption, and state-conflict classes without exposing journal content.

### Test results (verbatim tail)

`npx tsc -p tsconfig.test.json`

```text
Exit code: 0
```

`node --test --test-concurrency=1 --test-name-pattern "N100 authority convergence" dist-test/test/authority/ledger.test.js`

```text
﹣ N100 authority convergence: one committed reservation, exact-existing outcomes, and acknowledged recovery (9.1247ms) # SKIP
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 732.8441
```

### Open risks

- The hosted Ubuntu reproduction was not run from this Windows worktree. The next Linux failure will include the redacted transition result and sorted root entries in the failed dispatch or acknowledge assertion.

## Gate 0 Linux fixed-slot released-residue correction (2026-08-13)

### Files changed

- `docs/superpowers/plans/2026-08-12-windows-client-linux-authority-cell.md`
- `src/authority/host/fs-ledger.ts`
- `test/authority/ledger.test.ts`
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4b-report.md`

### What changed per file

- `docs/superpowers/plans/2026-08-12-windows-client-linux-authority-cell.md`: amends Task 4B to authorize only the evidence-led bare fixed-slot `blockingRetiredResidue` correction after the two hosted Ubuntu falsifiers, with explicit RED/GREEN conditions and preserved prohibitions against every broader change.
- `src/authority/host/fs-ledger.ts`: the closed bare fixed-slot branch now uses the existing `blockingRetiredResidue(retired, slot.owner)` boundary. It tolerates only unrelated `released` legacy markers; same-owner `released` and every `publication-aborted` or `recovery-pending` marker remain blocking corruption.
- `test/authority/ledger.test.ts`: adds a deterministic closed-graph RED/GREEN regression for a live fixed slot beside byte-valid retirement markers, including byte identity and zero-callback assertions; adds a no-sleep/no-retry same-process option-on reserve, dispatch, and immediate acknowledge regression; and replaces the N100 fixture's non-hex `digest("n")` with the valid fixed SHA-256-shaped `digest("a")`.
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4b-report.md`: records the hosted evidence, root cause, RED/GREEN evidence, and remaining hosted requirement.

### Root cause and hosted evidence

Hosted run `31690656890` / Ubuntu job `94417084543` directly showed only the acknowledge assertion failure. Hosted run `31691716040` / Ubuntu job `94420370893` directly showed immediate acknowledge returning `{ok:false,reason:"corruption"}` and the post-failure root containing one byte-valid unrelated `.authority-ledger-lock-<same parent pid>-<different nonce>.released` marker plus normal ledger directories; it did not show a fixed admission slot. Fixed-slot coexistence and the bare fixed-slot branch as root cause are an inference from the transition path and code trace, confirmed by the deterministic local RED that constructed the live-slot-plus-unrelated-released graph. In that reproduced graph the bare fixed-slot branch alone rejected `retired.size`; adjacent preparation, W1, retired-preparation, withdrawal, and orphan-final families already use `blockingRetiredResidue`. The correction applies that same boundary to the bare fixed slot and changes no timeout, retry, concurrency, lock, or non-released corruption rule.

The same-process regression also exposed a separate test-fixture defect: `digest("n")` is not hexadecimal and therefore correctly fails result-digest validation. N100 now uses `digest("a")`; production digest validation was not changed.

### Plan-amended scope and test seam

- The deterministic classifier regression calls the emitted private classification pipeline directly. A static public-entry fixture is pre-drained by the deliberately earlier legacy-retirement service, while a paused cross-process fixture is refused by the outer K1 operation fence before filesystem classification. The direct pipeline test isolates the inferred live-slot-plus-unrelated-released graph, exercises real parsing/classification, and proves byte identity and zero callback entry; it is local root-cause confirmation, not hosted observation of a slot.
- The Task 4B plan is amended to authorize the already-implemented production exception in RED `906b68c` and GREEN/report `b15277f`: only the bare fixed-slot branch may replace blanket `retired.size` rejection with the existing `blockingRetiredResidue(retired, slot.owner)` boundary. The same-process public regression was feasible and was added without sleeps or retries. No other classifier branch, retirement disposition, timeout, retry, concurrency, mutex/locking design, Windows authority-host behavior, or production scope is authorized.
- Sequencing deviation: RED `906b68c` and GREEN/report `b15277f` were committed before formal amendment/report commit `23a733f`. User approval and independent review occurred before push, but the required amendment-before-code ordering was violated. The later amendment records the approved narrow scope and does not retroactively make that sequence compliant.

### Test results (verbatim tails)

RED commit `906b68c` (`test(ledger): pin live slot released residue`). Command: `npx tsc -p tsconfig.test.json; node --test --test-concurrency=1 --test-name-pattern "a live fixed admission slot tolerates only unrelated released retirement residue" dist-test/test/authority/ledger.test.js`. It exited `1` only on the intended unrelated-released case; both boundary falsifiers passed:

```text
▶ a live fixed admission slot tolerates only unrelated released retirement residue
  ✖ an unrelated released marker is inert bounded-busy residue (42.9421ms)
  ✔ a same-owner released marker stays corruption (15.5592ms)
  ✔ an unrelated recovery-pending marker stays corruption (13.1423ms)
✖ a live fixed admission slot tolerates only unrelated released retirement residue (73.2135ms)
ℹ tests 4
ℹ pass 2
ℹ fail 2
AssertionError [ERR_ASSERTION]: unrelated released
  + actual - expected
  {
    ok: false,
  + reason: 'corruption'
  - reason: 'busy'
  }
```

GREEN focused command: `npx tsc -p tsconfig.test.json; node --test --test-concurrency=1 --test-name-pattern "^N100 authority convergence:|an option-on warm ledger dispatches and immediately acknowledges|a live fixed admission slot tolerates only unrelated released retirement residue|warm preparation-stage|K1 fixed slot with same-owner|transition timestamps are stamped|result digest presence is enforced" dist-test/test/authority/ledger.test.js`. It exited `0` on native Windows:

```text
✔ K1 fixed slot with same-owner sub-complete withdrawal terminal is preserved live in-flight residue (467.3688ms)
ℹ tests 35
ℹ suites 0
ℹ pass 34
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 6767.0829
```

The skipped test is exactly the Linux-only N100 hosted gate. Test compilation completed with exit code `0` before the focused run.

### Open risks

- Required hosted Ubuntu revalidation remains absent for the corrected workflow SHA. Gate 0 is not claimed complete until the Linux N100 test demonstrates one winner, 99 exact-existing outcomes, successful dispatch, successful immediate acknowledge, and acknowledged recovery on the current workflow SHA.
- Native Windows proves the deterministic classifier boundaries and same-process transition regression, but cannot execute the Linux-only N100 gate.
