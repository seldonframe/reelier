# Local run-shape priors (F5)

A skill's own past runs are already on the operator's disk, one JSON record
per line, at `.reelier/runs/<skill>.jsonl`. This computes a baseline from
that history and reports how the latest run departs from it.

n=1. One tenant, one skill, one disk. Nothing is transmitted, no network call
is made, no cross-skill or cross-tenant comparison happens, and the operator
declares nothing — the run-shape signals exist the moment there are four
runs, and `gap`/`silence`, computed over the intervals *between* runs, from
five (§3.1).

## 1. What it is allowed to say

A **deviation**, and only a deviation:

> `writes: 400 (previous 4 runs: median 1, min 1, max 2)`

Never a cause. Never a verdict. The words "anomaly", "unsafe", "verified",
"suspicious", "something went wrong", "detected" and their neighbours are
forbidden on this surface and the ban is test-pinned
(`test/priors-render.test.ts`). A run that departs from its own history has
departed from its own history; that is the entire claim, and it is a claim
about a *difference*, not about correctness, safety, or intent.

Corollary, also pinned: a deviation changes **no outcome and no exit code**.
`reelier run` returns exactly what it would have returned; `reelier baseline`
exits 0 whether or not anything deviated. Nothing here may enter a check or a
gate predicate. This is a recorder.

## 2. Signals

All derived from the shipped `RunRecord` shape (`src/runner.ts`), verified
field by field. Every per-run count is derived from `steps[]` rather than
from `totals`, for the reason already documented at `recordTotals` in
`src/footprint.ts`: the per-step outcomes were always recorded correctly
even in versions where the rollup that summed them was not.

| signal | derivation |
|---|---|
| `steps` | `steps.length` |
| `passed` / `unchecked` / `skipped` / `failed` | count of `steps[].outcome` — four separate signals, never collapsed |
| `writes` | count of steps carrying a `write` block (`StepRecord.write` is present iff a write-effect step actually dispatched) |
| `duration` | sum of `steps[].ms` |
| `gap` | this run's `startedAt` minus the previous run's `startedAt` |
| `silence` | the reading instant minus the latest run's `startedAt` |

### 2.1 Not shipped: distinct tools touched

**`StepRecord` carries no tool name.** Its fields are `n, title, level,
outcome, ms, failures, llm, escalationAttempted, why, write, attest,
stateCheck, refs, mocked` — the tool is passed to `RunOptions.onStep` as a
side channel at run time and is never persisted. `attest.selector` holds a
*probe* tool name, which is a different tool from the one the step dispatched.

So a "distinct tools touched" signal cannot be computed from a run record
without either (a) re-reading the skill file, which describes the skill as it
is *now* and not as it was when each prior run executed, or (b) inferring it
from step titles, which are prose. Both would be a claim we did not observe.
It is left out. Adding `tool` to `StepRecord` would be an additive wire
change and would make the signal available on records written after it — that
is the honest way to get it, and it is not in this slice.

### 2.2 `steps` is nearly constant by construction

Every step of a skill gets a record, including skipped ones, so `steps`
changes essentially only when the skill file itself changed. That is why the
report carries the skill-file note (§5): a `steps` deviation with a changed
skill file is the operator's own edit, and saying so is the difference
between a useful line and a scary one.

## 3. The statistic

**Median + median absolute deviation (MAD).** Not a mean: with four or five
samples one 400-write run poisons a mean permanently, and the baseline then
hides exactly the next event it exists to surface.

**The deviation rule, stated once:** a value deviates iff it lands more than
`DEVIATION_MADS` (3) MADs **outside the closed range the prior window
actually spanned**.

Two properties this shape buys that a bare `|x − median| > k·MAD` test loses
on samples this small:

- **It cannot flag a value the skill has already produced.** Window
  `[1,1,1,2,2]` has median 1 and MAD 0, so the bare test calls a run with 2
  writes a deviation — while two of the last five runs dispatched exactly 2.
  Noise on this surface is worse than silence: an operator who learns to
  ignore the line has lost the signal the line existed for.
- **It degrades honestly when MAD is 0**, which for integer counts is the
  common case, not the edge one. MAD 0 makes the threshold 0 and the rule
  reduces to "outside everything the previous runs did" — exactly the honest
  claim available when every prior run agreed.

The median is not decoration: MAD is defined about it, so the center sets the
scale even though the range sets the position.

### 3.0 One exception: `silence` is one-sided

Every signal is two-sided — a write count that collapsed to 0 is as
reportable as one that spiked to 400 — **except `silence`**, which is tested
on the high side only.

`silence` is not a completed measurement. It is counted from the latest run
to *now*, so between runs it necessarily passes through every value from 0
upward. A two-sided test would report "silence 1h, previous gaps median 1d"
every time an operator looked shortly after a run — the single loudest way to
make this surface worthless. Only the high side of silence carries
information. `gap`, by contrast, stays two-sided: it is measured between two
runs that both happened, so a run arriving far earlier than usual is a real
observation.

### 3.1 Small-n behaviour, pinned

- **`MIN_PRIOR_RUNS = 3`.** Three is the smallest sample where the median is
  an *observed* value rather than an interpolation, and where one outlier
  cannot take the center with it: at n=3 the median is the middle order
  statistic and survives one arbitrary corruption; at n=2 the "median" is the
  midpoint of the two, so a single bad run drags the baseline halfway to
  itself and the MAD is just half the gap between them. Both statistics are
  *defined* at n=2 and neither *means* anything. Below three priors the
  report says `insufficient-history` and computes no baseline.
- **`MAX_BASELINE_RUNS = 20`.** A baseline over the file's whole life answers
  the wrong question — a skill that legitimately changed shape 200 runs ago
  should not hold its present hostage. Twenty gives the MAD something to work
  with and lets a regime change wash out within a few weeks of daily runs.
- **Gap and silence need three *gaps*, so four priors.** With exactly three
  priors there are two consecutive gaps, below the minimum, and neither
  signal is emitted at all. Pinned.

## 4. Excluded records

Runs carrying `mockFailures` (`reelier run --fail N`) are excluded from both
the baseline sample and the subject. An injected failure is a local recovery
test, not a receipt — `reelier push` already refuses to push one — and
including them would poison the outcome counts with failures nobody observed.

### 4.1 The subject is not always the newest record

Excluding a mock run from *being the subject* has a consequence that has to
travel with the report: `reelier run --fail 1` immediately after a real run
appends a record that is filtered out, so the run the report describes is the
one BEFORE it — one record back from the end of the file.

`RunShapeReport` therefore carries **`subjectIsNewestRecord`** on both the
`baseline` and `insufficient-history` variants: false when the newest record
on disk was excluded. It is a field on the report rather than a check each
caller re-derives, because a caller that forgets prints an older run's numbers
under this run's headline.

- **`reelier run` prints nothing at all when it is false.** That surface's
  entire claim is the words *this run*: a `--fail` run dispatches nothing, so
  a `writes: 1` line under that heading would be a figure belonging to a
  different run on a different day. There is nothing honest to print instead
  — the run that just happened has no baseline of its own — so it is silent.
- **`reelier baseline` names the exclusion** in a line of its own, the same
  way the no-comparable-runs copy already does. That surface reports the
  whole picture, and "latest run: \<stamp\>" without the note would quietly
  omit that a newer record exists.

Both are pinned end to end in `test/baseline-cli.test.ts`: a `--fail` run
after a deviating real run is byte-identical to a `--fail` run in a repo with
no history at all, and `reelier baseline` on that same file states the
exclusion.

Gaps computed from unparseable or non-monotonic timestamps are dropped from
the sample rather than clamped, mirroring `attest-render.ts`'s
`measuredWindowMs`: the figure is omitted, never invented.

## 5. The skill-file note

`skillChanged` is three-valued, not two:

- `true` — both the latest run and the previous one carry a
  `skillContentSha256` and they differ. Rendered as a note.
- `false` — both carry one and they match. Rendered as nothing.
- `undefined` — at least one record has no `skillContentSha256` (it is an
  optional field, absent on older records and on callers with no file to
  hash). **Unknown, and rendered as nothing.** Never as "unchanged".

## 6. Surfaces

- **`reelier run`** prints the block only when at least one signal deviates
  *and* the run that just happened is the subject (§4.1). Silent otherwise,
  and silent when the run-record file is missing, unreadable, or has a
  corrupt line — the read is wrapped so that a report that cannot be computed
  is simply absent (fail open at the recorder). No
  `now` is supplied on this surface: at the end of a run there is no silence
  to measure, so the silence signal is not emitted.
- **`reelier baseline <skill.md>`** is read-only and standalone: it executes
  nothing, gates nothing, and always exits 0 on a successful read — suitable
  for a cron. It prints the full picture (every signal, deviating or not,
  plus `insufficient-history` when that is the truth) and supplies the real
  clock, so it is the only surface where `silence` appears. It exits 1 only
  for things the operator must fix: no skill argument, an unreadable or
  malformed skill file, a missing run-record file, an empty one.

## 7. Zero-touch guarantee

A skill with no prior history, or a repo with no `.reelier/runs`, produces
byte-identical `reelier run` output to the release before this existed. So
does a repo with history whose latest run does not deviate. Pinned in
`test/baseline-cli.test.ts` by comparing normalised stdout across a
no-history repo and a matched-history repo.

## 8. Left out, and why

§2.1 covers the one signal that was designed and then dropped (distinct tools
touched — `StepRecord` carries no tool name). Two further limits belong here,
in front of the operator, rather than in a handoff note: both are properties
of the design as shipped, and neither is a defect scheduled for repair.

### 8.1 The thresholds are reasoned, not measured

`MIN_PRIOR_RUNS = 3`, `MAX_BASELINE_RUNS = 20` and `DEVIATION_MADS = 3` are
argued from first principles (§3, §3.1) and were fixed before any corpus of
real run histories existed to calibrate them against. **No false-positive or
false-negative rate is claimed anywhere, because none has been measured.** The
argument for each number is a statistical property (a median that is an
observed value and survives one outlier; a window that lets a regime change
wash out; a rule conservative enough that the surface speaks rarely), not
evidence about how often it will speak on your skill. They are exported
constants precisely so that the first real measurement can move them.

### 8.2 The rule gets strictly LESS sensitive as history grows

A value is reported only when it lands outside the range the prior window
*actually spanned*, so every run can widen that range and no run narrows it
while it stays in the window: **one historical 400-write run silences every
later 400-write run** until it falls out of the 20-run window — the next 20
runs. Only the first occurrence of anything is ever reported.

This is deliberate, and it is the same property that stops `[1,1,1,2,2]` from
flagging a 2 (§3, pinned in `test/priors.test.ts`): a surface that flags a
value the skill has already produced becomes noise, and a line the operator
has learned to ignore is strictly worse than no line. The cost is stated
plainly here so nobody mistakes silence for evidence — this reports
departures from a skill's own history, and a repeat is not a departure. It is
a recorder, never a detector (§1).
