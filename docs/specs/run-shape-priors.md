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
field by field.

Every per-run signal is a projection of one counter on the `RunFootprint`
that `deriveFootprint` (`src/footprint.ts`) computes — **the single place in
this package where a run's shape is derived**. Every one of those counters
comes from `steps[]` rather than from `totals`: the per-step outcomes were
always recorded correctly even in versions where the rollup that summed them
was not, so the steps are authoritative and the rollup is only sometimes
trustworthy. (`recordTotals`, in the same file, deliberately *does* read
`totals` where SPEC §4.4 says it can be trusted. It answers a different
question — "what does this record claim its totals were?", which is what
`reelier bench` needs — and the two functions carry a comment each saying why
they are not duplicates.)

| signal | footprint counter | derivation |
|---|---|---|
| `steps` | `steps` | `steps.length` |
| `passed` / `unchecked` / `skipped` / `failed` | same | count of `steps[].outcome` — four separate signals, never collapsed |
| `writes` | `writesDispatched` | count of steps carrying a `write` block (`StepRecord.write` is present iff a write-effect step actually dispatched) |
| `writeResources` | `distinctWriteResources` | count of **distinct present** `write.resource.id` values; a dispatched write whose resource could not be extracted contributes nothing and is not an "unknown" bucket |
| `escalations` | `escalations` | count of steps carrying an `llm` block — an escalation that actually ran (`llm` is *absent*, not zero, when it did not) |
| `healedL1` / `healedL2` | `healL1` / `healL2` | count of steps recorded at that heal level |
| `mocked` | `mocked` | count of steps marked `mocked: true` |
| `duration` | `ms` | sum of `steps[].ms`, skipping any step whose `ms` is not a finite number |
| `gap` | — | this run's `startedAt` minus the previous run's `startedAt` |
| `silence` | — | the reading instant minus the latest run's `startedAt` |

Rendered labels differ from the metric names where the identifier does not
read as English: `writeResources` prints as `resources` (directly under
`writes`, which is what makes the short form unambiguous) and `healedL1` /
`healedL2` print as `healed L1` / `healed L2`, matching the `[healed L1]` tag
`reelier run` already prints against an escalated step.

Section numbers below are stable and referenced from `src/priors.ts`; new
subsections are appended rather than inserted.

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

### 2.3 One derivation: a behaviour change, named rather than slipped in

*See also §2.4 (the two counters that are deliberately not signals) and §2.5
(what `writeResources` is), appended after this one to keep §2.1's number
stable — it is cited from `src/priors.ts`.*

F5 originally carried its own `shapeOf`, a near-copy of `deriveFootprint`.
Two functions answering "what shape did this run have?" is how the answer to
that question drifts apart, so `shapeOf` is gone and the signals project off
the shared object.

That swap is a **silent change to a shipped surface** and is recorded here as
one. `deriveFootprint` counts outcomes and duration from `steps[]`
unconditionally; on any record whose `totals` rollup contradicts its own
`steps[]`, F5's counts follow the steps, and an existing operator's baseline
can move by the size of that contradiction. This is the correct direction —
the steps are the measurement and the rollup is a claim about it.

**Why no existing baseline moves, argued rather than sampled.** The old
`shapeOf` already counted from `steps[]` and already summed per-step `ms`, so
the two derivations are arithmetically identical on every record — the
divergence class above is reachable only through `deriveFootprint`'s earlier,
totals-trusting behaviour, which no longer exists. The one real difference is
a tightened guard: a step whose `write` or `llm` is present but is not a
non-null, non-array object (a hand-edited `"write": []`, `0`, or a bare
string) is no longer counted as a dispatched write or an escalation. Neither
shape can be produced by this package's writer.

**A third change, and the only one an operator can see today.** The old
`shapeOf` dereferenced each entry of `steps[]` without checking it, so a
record containing `null` in that array threw. `printRunShapeDeviations`
(`src/cli.ts:266-276`) wraps the whole read in a bare `catch` and stays
silent, so on such a file the entire run-shape block vanished with no
explanation — indistinguishable from "nothing departed", which §1 forbids
this surface from implying. `deriveFootprint` is total, so the block now
renders, counting the malformed entry in `steps` and nothing else. This is a
fix, not a regression, and it is listed here because this is the paragraph
whose job is naming behaviour changes.

A sweep of 1,835 records across 190 local run-record files found zero
changes, which is consistent with the argument above and is not independent
evidence for it: those records were all written by this package, where both
divergence classes are unreachable by construction. The guarantee rests on
the construction. A hand-edited or externally generated `.jsonl` — which is
what F5 is fed by — can still carry either shape, and on those the counts now
follow the steps.

Neither change can move an outcome or an exit code. §1 still holds.

### 2.4 Three footprint counters that are deliberately NOT signals

A counter earns a row in §2 only if it can be non-zero **on a record §4
keeps**. That is a stricter test than "is it a number", and applying the
weaker one is how `mocked` briefly shipped as a row that could never read
anything but 0.

- **`healL0`.** It is `steps` minus `healL1` and `healL2`, so it carries no
  information those three do not already carry. A run where one step
  escalated would report a single movement twice — a healed-L1 row going up
  and a healed-L0 row coming down — and a surface that says the same thing
  twice teaches the operator that half of what it says is redundant.
- **`manifestIgnored`.** It is a boolean, and the deviation rule (§3) is
  defined over numbers: there is no honest median of a flag. Its absence is
  also ambiguous between "no manifest" and "preflight ran normally"
  (`src/runner.ts:237-243`), so no consumer may read `false` as "preflight
  passed". It stays on `RunFootprint` for persistence and is never baselined.
- **`mocked`** — excluded for a third, different reason: **§4 excludes every
  record that could carry it.** `StepRecord.mocked` is set only by
  `executeStep`'s mock branch (`src/runner.ts:853-858`), reachable only when
  `options.mockFailures[step.n]` is defined; any run with `mockFailures`
  writes the record-level `mockFailures` array, which is exactly what §4
  strips out. So `footprint.mocked > 0` implies the record is neither in the
  sample nor the subject, and a `mocked` row could only ever read
  `mocked 0, median 0, min 0, max 0` — forever, on the surface whose written
  law (§1, §3) is that noise is worse than silence. It stays on
  `RunFootprint`, where the record it describes is not filtered out.

All three exclusions are pinned in `test/priors.test.ts`, which asserts the
metric list verbatim, plus a test that pins `mocked`'s structural argument
against a fixture carrying **both** the step-level flag and the record-level
`mockFailures` — the only shape the runner can actually produce. A test that
set the step flag alone would pin behaviour no record has ever had and read
as coverage.

**Heal level is now reported by two surfaces with different rules, and they
do not conflict.** `src/diff.ts:16`'s `healed-differently` is a *per-step*
comparison against a recorded baseline run, and it feeds a verdict that gates
an exit code. F5's `healedL1` / `healedL2` are *aggregate counts* for one run
against that skill's own recent history, and they gate nothing. An earlier
draft excluded heal levels here on the grounds that "heal level is `diff.ts`'s
job"; that reasoning conflated the two. The question `diff` answers is "did
this run's step 4 heal differently from the recorded one?" — the question here
is "did this run heal more than this skill usually does?" Neither answer is
available from the other, and only one of them can fail a build.

### 2.5 `writeResources` is not a second write count

Six writes landing on six records and six writes landing on the same record
are the same `writes` and a different blast radius. `writes` cannot see the
difference; this signal is the only row that can. It is still only a
difference — a collapse to one resource is not evidence of a fault, and this
surface does not say it is.

`distinctWriteResources` counts **distinct present** ids. `resource` and
`resource.id` are best-effort and frequently absent, never fabricated
(`src/runner.ts:487-493`), so a dispatched write whose resource could not be
extracted contributes nothing at all. It is not an "unknown" bucket, and the
signal must not be read as "every resource this run touched" — only as "the
distinct ones the record names".

### 2.6 `duration`: exactly what `ms` is allowed to do

The rule elsewhere in this codebase is that timing is never drift
(`src/diff.ts:10`), and `duration` is a signal here, so the rule needs
restating rather than waving at. It takes its authority from what a `diff`
verdict does — it gates an exit code — and F5 provably cannot gate: it is a
recorder (§1, `src/priors.ts:14-17`) and its only consumers are two
print-only renderers. So `duration` is not an exception to the rule. The rule
was worded for a surface that decides things, and this one does not.

Stated for this surface:

> `ms` never enters a gate, an exit code, or a check predicate, and is never
> rendered as a fault or a saving. It may be reported as a local, advisory
> difference against a skill's own history.

**The carve-out, written down before the surface exists that would breach
it.** `RunFootprint` is designed to be persisted, and a persisted footprint
invites an alert — an email, a notification, something that arrives at an
operator who was not looking. That is much closer to a verdict than a line
printed under a run the operator is already watching, and `duration` is the
most environment-sensitive signal in the set: a slow network, a cold cache or
a laptop on battery moves it while saying nothing whatsoever about the skill.

> **`duration` may be a locally rendered difference. `duration` must never be
> able to raise an alert.**

This applies to every consumer of `RunFootprint.ms`, in this package or any
other. A `duration` deviation is not an alert condition, is not an input to
one, and must not be one term of a compound condition that produces one.

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

### 6.1 One escalation event prints one line

A single L1 heal moves two counters at once: `runner.ts:1443` returns
`{ level: 1, llm: usage, … }`, so `escalations` and `healedL1` both go up by
one. Both are near-always-zero counters, so both have a window of `[0,0,0,0]`
— median 0, MAD 0 — and §3's rule reports the first time either is ever
non-zero. Left alone, one step escalating prints two lines saying the same
thing, on the surface every user gets by default. §1's law cuts against that
directly: an operator who learns to ignore the line has lost the signal.

So on the `reelier run` surface those lines collapse into one. **Only when
the collapsed line is exactly true of every counter named in it** — three
conditions, all required:

1. `escalations` and at least one of `healedL1` / `healedL2` both deviated.
2. The heal movements **sum** to the escalation movement, each measured
   against its own median, and every movement points the same way. Two
   counters that moved by different amounts moved for different reasons and
   are two facts, not one.
3. All of them were computed over an **identical baseline window** (same
   median, MAD, min, max and n). The collapsed line prints a single
   `previous N runs: …` clause, and without this condition that clause would
   be the first counter's baseline presented as everyone's — a small lie in
   the one place this surface is supposed to be exact. In the realistic
   all-zero case it holds trivially, so it suppresses nothing real.

Anything else prints separate rows. The rendered form names every counter and
keeps every value its own:

> `! escalations: 1, healed L1: 1 (previous 4 runs: median 0, min 0, max 0)`

It deliberately does **not** read "escalations: 1, healed at L1", which is
better English and asserts that the same step caused both movements. That is
true in every record the runner writes and is still an inference the record
does not carry.

**A failed escalation is why both metrics stay.** A step that burned tokens
and did not heal returns `level: 0` with an `llm` block
(`src/runner.ts:1451`), so it moves `escalations` and no heal level, fails
condition 1, and reports on its own line. That distinction is the whole
reason the two counters are not one counter.

**`reelier baseline` collapses nothing.** It prints a row per signal by
contract — the whole picture, including what did not move — so hiding a row
there would answer a question nobody asked.

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
