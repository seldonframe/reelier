# Paths A/B regression before the #85 merge — measured 2026-08-07

_Step 1 of the post-3C-prompt order ("full Paths A/B regression — the last unmeasured merge risk").
Every number below came from a command in this session. Nothing is inherited._

**UNCOMMITTED on purpose.** This file records a measurement; taking the merge is an owner act.

## Verdict

**Paths A and B do not regress. The merge is safe to take, with two resolutions and one test edit
named below.** Across three full suite runs — pre-merge control, merge preview, and the merge as
actually committed — **not one test outside `test/authority/` fails.** Every failure in every run is
a Path C authority test, and `src/authority/` is byte-identical across all three trees.

The merge is applied on `codex/universal-compiled-authority` as `25dd32d`. **It is not pushed**;
PR #85 is unchanged on the remote. Reverse with `git reset --hard 95b3067`.

## The risk ran the other way

The plan assumed the risk was Path C breaking A/B. Measured, that is structurally near-nil:

```
git diff --stat origin/main...HEAD -- src/ ':!src/authority'
 src/verify.ts | 6 ++++++
```

and `src/authority/` has **zero import specifiers that escape the module** — the only `../` forms
are `keys.js`, `ledger.js`, `types.js`, `wire.js`, all resolving inside `src/authority/`. Nothing in
Path C reaches `wrap.ts`, `recorder.ts`, `runner.ts`, or `serve.ts`.

The real exposure is the reverse: the branch is **26 commits behind** `origin/main` (`f03e3cc`), and
those commits rewrote exactly the Path A/B surface — `src/wrap.ts` +289, `src/serve.ts` +47,
`src/verify.ts` +22, and ~5,100 lines of new tests that had never run against this branch.

## Merge resolution

`git merge-tree --write-tree` gives two conflicts. Preview built on a detached HEAD at `8d53402`.

**1. `src/verify.ts` (content) — take main verbatim; drop the branch's six lines.**
Main's `classifyRecordVersion` (shipped in `reelier@0.31.1`) is a strict superset of the branch's
local guard:

| | branch (6 lines) | main (`record-version-guard.ts`) |
|---|---|---|
| Trigger | hardcoded `"reelier.authority-receipt/v1"` | any own top-level `v` |
| Entry points guarded | `evaluateVerifyClaims` only | all three |
| Claim reported | `unaltered-since-push`, `failed` | `unsupported-record-version`, `failed` |

The branch's version is not merely weaker. It hardcodes the one version string that
`record-version-guard.ts` explicitly argues a guard must not know ("a guard that understood
`reelier.authority-receipt/v1` well enough to allow-list it would be an authority-aware parser"),
and it reports a **signature** claim as failed for a reason that is not the signature — which is
what main's dedicated claim name, "deliberately not one of the legacy claim names", exists to avoid.
After resolution `src/verify.ts` is byte-identical to `origin/main`.

**2. `AGENTS.md` (add/add) — take main's 334-line twin.** `test/claim-guard.test.ts:177` requires
`AGENTS.md` and `CLAUDE.md` to be byte-identical; after resolution they are (24,932 bytes each).
The branch's 3-line pinned capability summary is preserved beside the preview worktree at
`scratchpad/branch-AGENTS-preserved.md`. **Owner decision needed:** it is the only prose describing
what Path C currently ships, and it now has nowhere to live. It was not relocated into the
capabilities doc, because that doc is pinned and guarded and editing it is a claim-making act.

**One consequential test edit.** `test/authority/wire.test.ts:551` matched the refusal by regex
(`/unsupported authority receipt/`); main's line reads `unsupported-record-version: ✗ REFUSED — …`.
Deterministic red, not flaky. Retargeted at the guard's actual contract — exactly one claim, named
claim, `failed`, `/REFUSED/` — so the test's intent ("refuses instead of awarding a legacy pass") is
unchanged and now stronger.

## Two-sided gate

All suites run serially (`--test-concurrency=1`), machine above the ≥3.3 GB free / CPU < 70% floor.

| | control `95b3067` (pre-merge) | preview `8d53402` (merged `f03e3cc`) | **committed `25dd32d` (merged `e3dd465`)** |
|---|---|---|---|
| tests | 2,352 | 2,476 | **2,480** |
| pass | 2,331 | 2,455 | **2,456** |
| fail | 20 | 20 | **23** |
| skipped | 1 | 1 | **1** |
| duration | 314.9 s | 427.3 s | 371.4 s |

Control's `2,331 / 20 / 1` reproduces the reconciliation doc's recorded figure exactly — one
inherited number that survived re-measurement.

> **`origin/main` moved mid-session, and the first measurement did not cover the merge that was
> committed.** The preview merged `f03e3cc`; between that and applying the merge for real, `#112`
> landed and the branch merged `e3dd465` instead. `#112` adds `test/release-ancestor-guard.test.ts`,
> so suite composition changed and the preview's `2,476 / 2,455 / 20 / 1` describes a tree that was
> never committed. The committed state was therefore re-measured from scratch — that is the third
> column, and it is the one that describes this branch. `#112`'s own three tests all pass, including
> `FAILS when the release tag is not an ancestor of main — the 0.31.1 case`.
>
> Recorded because it is the file's own failure mode in miniature: a measurement is bound to a
> commit, and the commit it was bound to stopped being the commit in question.

`npm run build` exit 0, `tsc -p tsconfig.test.json` exit 0, `lint:fault-pins` **84 emitted / 58
declared** — the frozen registry is unmoved by the merge.

### The failing set rotated — and it is environmental, proven not inferred

Counts nearly matched (20 / 20 / 23) but the gate is name-based, and the names moved on **every
single run**. Five observations, five different failing sets:

| run | distinct failing names | file scope |
|---|---|---|
| control bulk | 15 | gate 2, ledger 13 |
| preview bulk | 16 | fuzz 1, gate 3, ledger 12 |
| committed bulk | 18 | fuzz 1, gate 4, ledger 13 |
| preview isolation (gate+fuzz alone) | 0 of 34 | — |
| committed isolation (gate+fuzz alone) | 1 of 34 | fuzz 1 |

- **13 stable across every bulk run**: `dead-{empty,zero,partial,complete}`, `dead exact slot`,
  `marker-{only,plus-stage,plus-ack}`, `orphan-ack`, `pre-admission housekeeper …`,
  `before-admission-slot-rename`, `before-lock-publication-rename` and their kin — the ungranted
  housekeeping-permission family, red by design. Do not fix.
- **Everything else rotates**, and only ever inside `gate.test.js` / `fuzz.test.js` /
  `ledger.test.js`. Two names in the committed run had failed in *neither* earlier run
  (`exact retry and committed-unknown retry …`, `existing-decision lookup … mappings are closed …`);
  the control's isolation run produced yet another (`every found-record trust edge is reverified …`).

Two independent lines of evidence say the rotation is not the merge:

1. **Structural.** `git diff 95b3067 25dd32d -- src/authority/` is **empty** — as is the same diff
   against the preview. The authority module is byte-identical across all three trees and imports
   nothing that differs. No source change exists that could flip an authority verdict.
2. **Isolation discriminator.** `gate.test.js` + `fuzz.test.js` alone: preview **34/34**, committed
   **33/34**. Every `gate.test.js` bulk failure passes alone in both trees. All three trees rotate;
   the merge is not the variable.

What the merge changes is the environment: ~128 more tests run ahead of these in the same serial
process. Two of the rotating messages — `contract-expired` (a wall-clock assertion) and
`capability-already-reserved` (shared-state collision) — are precisely what a longer run perturbs.

### Separate finding: the fixed-seed fuzz test is not deterministic

`fixed-seed bounded ledger state-machine fuzz never creates two committed reservations for one
ingress or outcome` failed in 3 of 5 observations, **including once in isolation** (committed tree,
alone, 33/34) while passing in isolation on the preview. A *fixed-seed* test that changes verdict
between runs of identical source is either not actually seeded against every input it consumes —
wall clock, filesystem timing, directory iteration order — or it is surfacing a genuine latent race
in the ledger state machine. Both readings are worth knowing and neither is settled here.

**This is out of scope for the merge gate** (`src/authority/` is byte-identical across all trees, so
it predates the merge) but it should not stay buried in a merge report: it means the ledger suite
cannot currently be used as a clean two-sided gate for Task 3C without first stabilising it or
explicitly quarantining the rotating set. That decision is the owner's.

**Recorded correction:** the rotating failures were first read as timeouts on the strength of their
30–52 s durations. They are `AssertionError`s on slow tests, not timeouts. The conclusion survived;
the stated reason for it did not, and the isolation runs are what actually carried it.

## Consequence for the Task 3C prompt

**Prerequisite (b) is stale and must be re-specified before it is executed.** It says to re-pin
`AGENTS.md`, "which reads `` code pin `9666b90` ``". After this merge that line does not exist:
`ea35f04` replaced `AGENTS.md` with a byte-identical twin of `CLAUDE.md`. Any docs-only pin must go
in the twin's `Pinned to origin/main @ <sha>` header and be applied to **both** files, or
`claim-guard` goes red. Prerequisite (a), the missing 3B2 review verdict, is unaffected.

## Not covered

`npm run test:e2e`, `test:fuzz` beyond the in-suite fixed-seed case, and `test:mutation` were not
run. The mutation suite is ~11.5 h at the committed concurrency and is not a merge gate.

## Artifacts

Scratchpad (ephemeral — copy anything worth keeping):

- `merge-preview/` — detached HEAD `8d53402` (merged `f03e3cc`; superseded by `25dd32d`)
- `control-premerge/` — detached HEAD `95b3067`
- `suite-control-premerge.log`, `suite-merge-preview.log`, **`suite-committed-merge.log`**
- `iso.log` (both trees), **`iso-committed.log`**
- `names-control.txt`, `names-merged.txt`, **`names-committed.txt`**, `branch-AGENTS-preserved.md`

Remove the worktrees with `git worktree remove <path>` when done.
