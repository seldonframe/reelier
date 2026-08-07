# Paths A/B regression before the #85 merge — measured 2026-08-07

_Step 1 of the post-3C-prompt order ("full Paths A/B regression — the last unmeasured merge risk").
Every number below came from a command in this session. Nothing is inherited._

**UNCOMMITTED on purpose.** This file records a measurement; taking the merge is an owner act.

## Verdict

**Paths A and B do not regress. The merge is safe to take, with two resolutions and one test edit
named below.** No test outside `test/authority/` fails in either tree.

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

Both full suites run serially (`--test-concurrency=1`) on a quiet machine (≥3.3 GB free, CPU < 70%).

| | control `95b3067` (pre-merge) | merge preview `8d53402` |
|---|---|---|
| tests | 2,352 | 2,476 |
| pass | 2,331 | **2,455** (+124) |
| fail | 20 | 20 |
| skipped | 1 | 1 |
| duration | 314.9 s | 427.3 s |

Control's `2,331 / 20 / 1` reproduces the reconciliation doc's recorded figure exactly — one
inherited number that survived re-measurement.

`npm run build` exit 0, `tsc -p tsconfig.test.json` exit 0, `lint:fault-pins` **84 emitted / 58
declared** — the frozen registry is unmoved by the merge.

### The failing set rotated — and it is environmental, proven not inferred

Counts matched at 20/20, but the gate is name-based, and the names moved: 12 shared, 4 only-merged,
3 only-control.

- **12 stable**: `dead-{empty,zero,partial,complete}`, `dead exact slot`,
  `marker-{only,plus-stage,plus-ack}`, `orphan-ack`, `pre-admission housekeeper …`,
  `before-admission-slot-rename`, `before-lock-publication-rename` — the ungranted
  housekeeping-permission family, red by design. Do not fix.
- **7 rotating**, all in `gate.test.js` / `fuzz.test.js` / `ledger.test.js`.

Two independent lines of evidence say the rotation is not the merge:

1. **Structural.** `git diff 95b3067 8d53402 -- src/authority/` is **empty**. The authority module
   is byte-identical across the two trees, and imports nothing that differs. No source change
   exists that could flip an authority verdict.
2. **Isolation discriminator.** `gate.test.js` + `fuzz.test.js` alone: merge preview **34/34 pass,
   0 fail** — all four merged-only failures pass alone. The control in isolation failed **one
   different name again** (`every found-record trust edge is reverified …`), which had failed in
   neither bulk run. Both trees rotate; the merge is not the variable.

What the merge does change is the environment: 124 more tests run ahead of these in the same serial
process. The two messages that rotated in — `contract-expired` (a wall-clock assertion) and
`capability-already-reserved` (shared-state collision) — are precisely what a longer run perturbs.

**Recorded correction:** these were first read as timeouts on the strength of their 30–52 s
durations. They are `AssertionError`s on slow tests, not timeouts. The conclusion survived; the
stated reason for it did not, and the isolation run is what actually carried it.

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

- `merge-preview/` — detached HEAD `8d53402`, conflicts resolved, builds and tests clean
- `control-premerge/` — detached HEAD `95b3067`
- `suite-merge-preview.log`, `suite-control-premerge.log`, `iso.log`
- `names-merged.txt`, `names-control.txt`, `branch-AGENTS-preserved.md`

Remove the worktrees with `git worktree remove <path>` when done.
