# Path C / Task 3B2 — handoff

_Written 2026-08-04 at `53e30f0`. Read this before touching the authority ledger. It is written to be
understood cold. **The §0 numbers each carry a reproducing command; numbers elsewhere do not — treat
those as narrative.** Where anything here disagrees with a fresh command, the command wins._

_This file was fact-checked against the repository before it was committed, and that pass found nine
problems in it, including two wrong counts inherited from a tool defect. Do the same to whatever you
write next._

---

## 0. Verified state

Worktree `C:/Users/maxim/CascadeProjects/reelier/.worktrees/universal-compiled-authority`, branch
`codex/universal-compiled-authority`, HEAD **`53e30f0`** plus this file, pushed. Draft PR
[#85](https://github.com/seldonframe/reelier/pull/85) — no merge, release, or publish authorised.

| | Value | Command |
|---|---|---|
| Ledger suite | **427 pass / 79 fail** | `npm run baseline` |
| Full suite | **2,074 pass / 79 fail / 1 skipped** | `npm test` |
| Failures outside `ledger.test.ts` | **0** | as above |
| Fault points declared in spec / emitted in `src` / unemittable | **57 / 59 / 24** | `npm run lint:fault-pins` |
| Exported `ledgerLockFaultPoints` | **46** | `node -p "require('./dist-test/src/authority/host/fs-ledger.js').ledgerLockFaultPoints.length"` |
| Registry entries the spec does not name | **13** | derived — see `docs/REELIER-NUMBERS.md` §1 |

`npm run baseline` needs `dist-test/` built (`npm test` or `npx tsc -p tsconfig.test.json` first); on
a fresh checkout it is absent. Its first output line is the *recorded* baseline, only the `current :`
line is a measurement. It refuses above 70% CPU busy on a machine whose ambient floor is 34–53%, so
expect to wait or set `REELIER_BASELINE_MAX_BUSY`.

`emitted` exceeds `declared` because `src` emits points beyond the ledger-lock taxonomy. **The 79 are
failing, not pending** — see `docs/GLOSSARY.md`.

## 1. What shipped

Sixteen commits since `1d6ebe2` (`git log --oneline 1d6ebe2..HEAD`). The substantive ones:

- **Ticket admission** — spec `0a3fc3b`, pins `7cf926d`, implementation `5eca255`. Same-process
  publication contenders queue and are admitted in drawn-ticket order; housekeeping episodes keep a
  zero-filesystem one-shot refusal; one fence deadline covers bind, wait and admission.
- **`before-lock-publication-rename`** `ee94f31` — one fault point, which also turned the committed
  same-PID converge pin green.
- **Fence class decoupled from write permission** `4be4f51`, then **permission split from the
  deadline kill-switch** `adc7bbb`.
- **Dead-prep cleanup admitted from lock-seeking contenders** `0fb7874` — the bounded wide rule plus
  nine coordination-cleanup emissions. 417/89 → 427/79.
- **ABI group ordering** `7ed8553`.
- **Tooling** `5e547d9`, `48430e9` — `lint:fault-pins`, `baseline-diff`, the `reelier-slice` skill.
- **Records** — `docs/strategy/icp.md`, `docs/REELIER-NUMBERS.md`, `docs/GLOSSARY.md`, and the
  open-discrepancy notes below.

## 2. Decisions waiting on the owner

**Neither is mine to make. Both block real work.**

1. **The slot-retirement family** — `before-admission-slot-retire-rename`,
   `after-admission-slot-retire-rename`, `after-admission-slot-retire-root-sync`,
   `after-admission-slot-retire-cleanup-root-sync`. Pinned by tests driving `observeClock`
   (`ledger.test.ts:1716`), but the shipped bound keeps slot routes gated, and widening to slot is
   exactly what the dead-owner slot-orphan tests at `ledger.test.ts:1137` and `:1171` forbid. Either
   those tests change, or the family stays red. **A prior revision of this file misnamed these as the
   `admission-slot-rename` promotion points** — those belong to the creation mechanism in §4 and are
   blocked on nothing but the mechanism itself. That error came from the fact-check pass, which is
   trap 5 applying to the fact-checker too. **Further refinement (design review, same day): the
   decision blocks only foreign-dead-slot housekeeping.** The active owner retiring its *own* slot as
   `published` is an act the spec assigns to the owner, not the housekeeper, and three of the four
   retire points are reachable through it — see
   `docs/superpowers/plans/2026-08-04-admission-preparation-design.md` §2.
2. **Deleting the 13 non-spec registry entries.** Source-breaking for a consumer narrowing on
   `LedgerFaultPoint` (TS2322 under `--strict`), though additive at runtime. Sequence against the ABI
   freeze, which gates `reelier-cloud#54` together with merging PR #85.

**Recorded, not resolved.** Two open-discrepancy notes live in `docs/specs/compiled-authority-v1.md`
(who may perform a housekeeping transition; the fourth `k1-writer-released` ack purpose its closed
union does not admit). A third — `CLAUDE.md` §5's example-corpus claim — is recorded in
`docs/strategy/icp.md` §10 and `docs/REELIER-NUMBERS.md` §5, **not** in the spec.

## 3. Traps that already cost slices

Five, counting the one found while checking this document. Each is cheap to detect.

1. **Phantom pins.** A test injecting at a fault point absent from `src/` fails because its injector
   never fires — indistinguishable from an honest failing test. `:954` was handed over as a slice's
   acceptance criterion while being unsatisfiable. **Run `npm run lint:fault-pins` before adopting any
   pin as a goal.**
2. **"It's only emission."** Asserted twice, wrong twice. The coordination-cleanup lifecycle was fully
   built, and emitting its points greened nothing, because the operation its tests drive could not
   reach them. **Implement, run, and look.**
3. **Inherited numbers.** "15 missing fault points" (34) and "402 pass" (411) were both repeated as
   fact. **Re-run the command.**
4. **Load artifacts.** A baseline taken alongside three subagents reported 411 as 410. Two full-suite
   runs of identical code each produced one *different* extra failure, both passing in isolation. A
   crashed child (`3221226505`) is always environmental. **Never run the suite beside subagents.**
5. **Tools inherit the bug they were built to catch.** `lint-fault-pins` matched only a literal in
   first argument position, so `fault(cond ? "a" : "b")` was invisible and two emitted points were
   reported unemittable. The wrong count reached a pinned numbers doc, a commit message and the first
   draft of this file. **A checker is not evidence until something independent checks the checker.**

## 4. Next work, in order

Of the 24 unemittable points: 9 admission-preparation lifecycle (5 prep creation + 4 slot promotion),
6 creator-withdrawal (**blocked, see the spec's open-discrepancy notes**), 4 slot-retirement
(**blocked, see §2**), 4 pre-admission-housekeeping, and 1 pre-callback.

1. **Admission-preparation lifecycle** (9) — mechanism, the largest piece, and the only family with
   no open decision in front of it. The creation path does not exist at all; nothing creates a
   preparation directory or promotes one to the fixed slot. Only classification and recovery exist.
   The 4 slot-*promotion* points belong here — they are the contender's own admission act, not a
   housekeeping route.
2. **Creator-withdrawal chain** (6) — mechanism, blocked on three recorded items: two pins that
   contradict each other for the same root shape, an under-defined seal step, and a dependency on
   slot retirement.
3. **Pre-admission-housekeeping points** (4) — sit on existing housekeeping code; the marker-removal
   pair may have become reachable via the shipped dead-prep exemption. **Verify by running, not by
   reading** (trap 2).
4. **Pre-callback generation closure** (1) — mechanism, not emission.
4. Then K1 activation for normal operations, legacy-election deletion, N40/N100 contention gates, and
   reclassifying whatever still fails as explicit 3C-or-later obligations. That is the agreed
   definition of done for 3B2.

## 5. How to work here

Follow `.claude/skills/reelier-slice`. In short: measure the baseline, take the smallest gap, add or
verify RED pins, get an independent RED review, implement, run focused then broad tests, compare
against baseline, get an independent GREEN review, and commit only if shippable — a change that adds
public surface and greens nothing is not shippable.

The signed spec is the contract; tests are evidence. When they disagree, **record the discrepancy in
the spec beside the rule and stop** — do not quietly change either side.

Two environment notes that will bite: the Bash tool's cwd silently resets to the primary checkout
after background-task notifications, so prefix every command with an explicit `cd` and confirm with
`node -p "require('./package.json').version"` (worktree 0.30.0); and long sessions degrade — the
`pending` mislabel, the repeated inherited numbers, and the linter blind spot all happened late.
