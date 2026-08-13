Files changed

- `.github/workflows/ci.yml`
- `.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-5-report.md`
- `CHANGELOG.md`
- `contract/certification/v1/factory-journey-summary.schema.json`
- `package.json`
- `src/authority/certification/factory-journey.ts`
- `src/authority/cli.ts`
- `src/authority/index.ts`
- `test/authority/certification-factory-journey.test.ts`
- `test/authority/package.test.ts`
- `test/packed/authority-factory-journey.mjs`

## What changed per file

- `.github/workflows/ci.yml`: keeps exactly one pack job, rejects obsolete Windows FIFO/native-helper package entries, produces one closed four-file public evidence artifact on Ubuntu, and makes both matrix legs verify provenance and the installed offline verifier before later guarded steps.
- `CHANGELOG.md`: records the unreleased installed factory-journey CLI and offline graph verifier.
- `contract/certification/v1/factory-journey-summary.schema.json`: closes the summary and reviewer-packet schemas, including four stages, four-state/nonclaim fields, existing graph lineage, signed cleanup results, and a non-authorizing fixture confirmation.
- `package.json`: excludes the obsolete compiled `windows-k1-fifo` helper from npm contents and retains the packed harness script.
- `src/authority/certification/factory-journey.ts`: stages in a private sibling, allocates its private Cell root under the same cleanup lifecycle, removes both on every failure, exposes only a direct package-internal test fault seam, and derives the closed reviewer packet from the already verified signed graph. The deterministic fixture confirmation is bound to the graph's signed-readiness digest; it says `liveHuman: false` and `grantsAuthority: false`.
- `src/authority/cli.ts`: accepts only `authority certify factory-journey --out <absolute-absent-path>` and emits the exact compact success/refusal streams.
- `src/authority/index.ts`: exports only `verifyCertificationTaskReceiptGraph` for installed offline verification; no factory executor, provider, signer, ledger, budget, callback, or fault seam is public.
- `test/authority/certification-factory-journey.test.ts`: covers exact success output/files, relative output, existing file/directory/symlink, extra positionals, unknown flags and credential/provider/signer/ledger/callback/network/retry/task/grant/principal/allocation-like options, non-Linux refusal, staging/root/write/cleanup/rename faults, residue cleanup, and literal graph-derived reviewer fields.
- `test/authority/package.test.ts`: enforces the two-prerequisite DAG, exact one-pack rule, closed evidence artifact, installed verifier, raw provenance checks, and absence of obsolete helper exports/package entries.
- `test/packed/authority-factory-journey.mjs`: accepts one exact argument shape, installs only the supplied tarball in a clean consumer, resolves `reelier/authority` inside it, enforces exact CLI/file/path contracts, and recomputes raw-byte graph/trust/summary/tarball digests plus Adapter Contract provenance.

## Deviations from the plan

- None in Task 5 scope. The private fault seam is exported only from the internal module so the TypeScript test can exercise lifecycle faults; it is absent from every package export/barrel and cannot inject executable dependencies into the public CLI/API.
- Local verification ran on Windows. Linux Authority Cell hosting was not claimed locally; hosted Ubuntu and Windows checks for the current workflow SHA remain required before merge.

## TDD evidence

- RED `2ed433c`: compile failed because `FactoryJourneyFault` and `__testSetFactoryJourneyFault` did not exist.
- GREEN `a07ada6`: factory suite passed 3/3 after lifecycle cleanup, graph derivation, and closed schema implementation.
- RED `303f319`: package structure test failed because exact-one-pack/package/evidence closure was absent.
- GREEN `8c55790`: package suite passed 7/7 after CI closure guards.
- RED `a74bfac`: packed provenance test failed because the harness did not hash raw bytes or bind tarball/Adapter Contract provenance.
- GREEN `d20961c`: package suite passed 7/7 after packed harness and matrix provenance hardening.
- Pack inspection then found two obsolete entries, `dist/authority/host/windows-k1-fifo.js` and `.d.ts`; `03fd75c` excludes them. The next pack contained 497 files and reported `OBSOLETE_COUNT=0`.
- RED `5b7aad6`: the reviewer packet's cleanup result was empty while signed cleanup receipts reported `not-attempted`, `matched`, `matched`.
- GREEN `6d5f08f`: final focused factory/package suite passed 10/10 with signed cleanup results derived from receipt evidence.

## Test results

`npm run check:authority-contract`: exit 0.

`npm run build`: exit 0; verbatim tail:

```text
> node scripts/build-authority-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

`npx tsc -p tsconfig.test.json --pretty false`: exit 0.

Final focused factory/package command: exit 0; verbatim tail:

```text
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 22411.6506
```

The broader 54-test authority batch had factory 3/3 and package 7/7 green, but exited 1 on this Windows host with three existing Linux-host/race expectations in the GitHub runner corpus: concurrent recovery lock refusal, linked-journal controlled-cut wording, and its post-test async ENOENT. No retry, sleep, timeout, or mutex behavior changed.

Full `npm test`: exit 1 on Windows after 463 seconds; verbatim result tail:

```text
ℹ tests 3011
ℹ suites 0
ℹ pass 2980
ℹ fail 25
ℹ cancelled 0
ℹ skipped 6
ℹ todo 0
ℹ duration_ms 449811.2547
```

The verbatim failure tail ends with `AuthorityCellLinuxRequiredError` from `local-runtime.test.js` and `receipts.test.js`: Windows is supported as a client, while Authority Cell hosting requires Linux. This is reported as a failure, not a pass. Hosted Ubuntu remains the authority-host correctness gate.

Local pack surface verification: exit 0. The final pack was created once in a fresh OS temp directory, installed by the packed surface harness, contained 497 files, and had zero paths matching obsolete Windows FIFO/native helpers. Both generated Task 5 temp tarball directories were deleted after verification (`A_EXISTS=False`, `B_EXISTS=False`); no Task 5 tarball exists in the worktree or its temporary verification locations. The pre-existing `.tmp-pack/reelier-0.32.0.tgz` is unrelated dirty state and is byte-identical below.

`git diff --check 55ff795..6d5f08f` and `git diff --check`: exit 0.

## Audit

- `task5Base`: `55ff79566bdcd6b88ba47bbf36996236fd6c7b1b`
- `task5Reviewed` current review snapshot before this evidence-finalization commit: `22e5e2bdaedf17e39b3071ca0d157779026ecded`
- `task5Reviewed` names the literal complete code-and-report snapshot reviewed by the final audits below. This evidence-finalization commit changes only this report. Reviewers should diff `task5Base..HEAD`, which contains exactly the allowlist at the top of this report.

Literal pre-existing dirty-path snapshot, before and after (path, before SHA-256, after SHA-256, equal):

```text
.gitignore  8e60b7940460e69ba94c3ff85aeff87c5388478026760c4b6d1f9aa2f36bf609  8e60b7940460e69ba94c3ff85aeff87c5388478026760c4b6d1f9aa2f36bf609  true
src/authority/certification/manifests.ts  31021c1b517b0ba1351064c3acfdf314c46d94926b00368fb97f4e45a91486b0  31021c1b517b0ba1351064c3acfdf314c46d94926b00368fb97f4e45a91486b0  true
src/authority/certification/runner-registry.ts  90d0943698f4fbb6c8261e34171aa44146e8ad840938fd10112d2d1d640cd21f  90d0943698f4fbb6c8261e34171aa44146e8ad840938fd10112d2d1d640cd21f  true
test/authority/certification-input-fixture.ts  4789f255e39e000ed2ae40dbdb90ea5da2ae85a835ab604a78bb69155fcd11ba  4789f255e39e000ed2ae40dbdb90ea5da2ae85a835ab604a78bb69155fcd11ba  true
.tmp-pack/full-test-output-serial.log  a64ccf7bd70b314746f24747b03de85dab97b51080c1c5e14466d2c32476b3ab  a64ccf7bd70b314746f24747b03de85dab97b51080c1c5e14466d2c32476b3ab  true
.tmp-pack/full-test-output.log  3b88281fadcdc2e2362071306fe615ba217b6b021a3d43dae6014b93f4b694bb  3b88281fadcdc2e2362071306fe615ba217b6b021a3d43dae6014b93f4b694bb  true
.tmp-pack/reelier-0.32.0.tgz  acfb4e7de668cccd06c19bba1013baac506575154135b139169008fa0455cb7e  acfb4e7de668cccd06c19bba1013baac506575154135b139169008fa0455cb7e  true
native/windows-k1-helper/Cargo.lock  da1c70beb98d9279917016de836f6842483144c0d8b78f152eeffd21a45d53b6  da1c70beb98d9279917016de836f6842483144c0d8b78f152eeffd21a45d53b6  true
native/windows-k1-helper/Cargo.toml  5479e734bdacb84ebd0bd60f07f54b8dc700427a9dd564ee00219b51b84c53eb  5479e734bdacb84ebd0bd60f07f54b8dc700427a9dd564ee00219b51b84c53eb  true
native/windows-k1-helper/build.rs  97468c35adf133032e6c12143c62e91171aedc34676a10cd0be3e374472dcd56  97468c35adf133032e6c12143c62e91171aedc34676a10cd0be3e374472dcd56  true
native/windows-k1-helper/src/lib.rs  52a7d6f48edf4ca99e9b4d15d0a68b4e3d9b74cd9ad67fa3185ef38b6e04028d  52a7d6f48edf4ca99e9b4d15d0a68b4e3d9b74cd9ad67fa3185ef38b6e04028d  true
native/windows-k1-helper/src/names.rs  f6d8f6a87f7292a09553740c98a6fdc9c65f4070a7813efc1ccd1022a039251c  f6d8f6a87f7292a09553740c98a6fdc9c65f4070a7813efc1ccd1022a039251c  true
native/windows-k1-helper/src/status.rs  a87717902392746bb51f97a07872b07dd417505b120f42eb5ba8babdfb4a7041  a87717902392746bb51f97a07872b07dd417505b120f42eb5ba8babdfb4a7041  true
rust-toolchain.toml  b921a5cf16cb5b9ffde3d3756e34d859051e665b05ad89df5afda3c6581ac792  b921a5cf16cb5b9ffde3d3756e34d859051e665b05ad89df5afda3c6581ac792  true
```

Snapshot equality: `true`. All remain unstaged.

Literal scope audit for `git diff --name-only 55ff795..22e5e2b`:

```text
.github/workflows/ci.yml
.superpowers/sdd/2026-08-12-windows-client-linux-authority-cell/task-5-report.md
CHANGELOG.md
contract/certification/v1/factory-journey-summary.schema.json
package.json
src/authority/certification/factory-journey.ts
src/authority/cli.ts
src/authority/index.ts
test/authority/certification-factory-journey.test.ts
test/authority/package.test.ts
test/packed/authority-factory-journey.mjs
```

This is exactly the Task 5 allowlist. `git status --short --untracked-files=all` contains only the 14 byte-identical pre-existing dirty paths listed above. No Task 5 file is uncommitted.

## Open risks

- Hosted `test (ubuntu-latest)` and `test (windows-latest)` checks attached to the current workflow SHA are pending. Do not merge until both are green.
- The local Windows full suite remains red as recorded above; it is not evidence for Linux Authority Cell hosting.
- Acceptance measurements are release evidence only, not market evidence. The packet makes no claim of semantic correctness, live human review, or general software-factory capability.
