Files changed

- `.github/workflows/ci.yml`
- `CHANGELOG.md`
- `src/authority/host/index.ts`
- `test/authority/package.test.ts`
- `test/authority/ledger.test.ts`
- `test/authority/linux-authority-cell.test.ts`
- `test/packed/authority-host-boundary.mjs`
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-4b-report.md`

## Scope and commits

- task4bBase: `039cc7b3703df6b859df8cb81659294b2c4bfa0d`
- implementation/review range: `039cc7b3703df6b859df8cb81659294b2c4bfa0d..f55287fd5d96fb9f801859892aca75d42b614fb2` (the evidence-report commit recording this range is intentionally outside it, avoiding self-reference).
- implementation commits: `2ad0e882b53a738fc4b14e8f27ac76aaa031d04a`, `46a2b88421147ac582625a1b683242e3512795e0`, `bba23a65e7a90e24c408153f4c4dd5275d7227fc`, `444c6b9104cd684cb997147e431d7c0448a0da69`, `d6d260414ade771a37d77f75e2d5fb138883bd7c`, `5e5679b5d38218e36b93cdd7374dfb63f37888d0` (review RED), and `f55287fd5d96fb9f801859892aca75d42b614fb2` (review GREEN). Earlier evidence-only report commits: `be3e0faef3e290590cdeb5ea32436e4e8da9ac06`, `1c4111734c77d66b937c67fe42869b80aaa83321`.
- task4bReviewed: `f55287fd5d96fb9f801859892aca75d42b614fb2`; pre-existing dirty-path hashes were rechecked and matched exactly.

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

- Hosted `test (ubuntu-latest)` evidence attached to this workflow SHA was not available locally, so the required N100 result is absent.
- The earlier native-Windows full-suite run confirmed Linux-host-only tests are inappropriate for the required Windows context. The approved native Windows gate is now the explicit supported 26-test suite above; Ubuntu retains the full suite and N100.
- `windows-native` RED command: `node test/packed/authority-host-boundary.mjs --tarball <absolute-path> --mode windows-native` failed with `windows-native composition-root no-access proof not implemented`. GREEN rerun exited 0 after asserting all eight installed-tarball roots reject with `AUTHORITY_CELL_LINUX_REQUIRED`, dependency accesses `0`, callback invocations `0`, and every supplied temporary root empty.
- The generated root `reelier-0.32.1.tgz` was verified as this task's just-packed 894960-byte artifact with SHA-256 `8c7da130074f27a43940263157e17e3d7e103590080850349389c196a151fdd3` and removed. `.tmp-pack` was untouched.
- Hosted Ubuntu status remains `absent` locally. No Ubuntu full-suite or N100 green claim is made.
