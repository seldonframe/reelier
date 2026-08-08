# Batch E launch prompt — Task 3C, drafted 2026-08-06 from the measured post-flip state

_Drafted at the close of Batch D (`d09d03f`), which flipped K1 active-by-default and certified it.
Every number below carries its reproduction command; six inherited numbers have been wrong across
five batches now, so treat all of them as hypotheses. Three grants are carried verbatim from the
owner's Batch D approval and are already SPENT — they are recorded here only so Batch E does not
re-litigate them. The one NEW decision Batch E needs is named in the grants block._

---

```
You are continuing Reelier's "Universal Compiled Authority — Path C" implementation: BATCH E —
phase 3 (the migrated fixtures re-fixtured and the option retired, in that order), then TASK 3C:
the ReservedDispatchHandle -> provider write -> dispatched/acknowledged/definitive-failure/
ambiguous -> reconciled lifecycle, plus the conformance/security items and a full Paths A/B
regression proving Path C touched neither. Work bounded and evidence-led. Never report progress
beyond what a command shows.
WORKTREE (cd into it explicitly for EVERY command — the Bash cwd silently resets to the primary
checkout after background-task notifications, and this trap put one Batch C commit on the wrong
branch before being caught):
C:\Users\maxim\CascadeProjects\reelier\.worktrees\universal-compiled-authority
Branch codex/universal-compiled-authority, expected HEAD d09d03f, draft PR seldonframe/reelier#85.
No merge, release, publish, or history rewrite — the #85 merge and reelier-cloud#54 are the
OWNER's acts, in that order. Verify with node -p "require('./package.json').version" (worktree
0.30.0, primary 0.29.x).
THIS BATCH MAY HONESTLY SPLIT after phase 3 and before 3C: "option retired, 3C not started,
recorded" is a SUCCESS outcome. 3C is a large task; it may split again after its RED design.
STEP 1 — re-verify before trusting anything. Confirm branch, HEAD, dirty files, and baseline
yourself. Every number below is a HYPOTHESIS until a command reproduces it:
  node scripts/baseline-diff.mjs        -> expect ledger floor 688 pass / 16 fail
  npm test                              -> expect ~2,331 / 20 / 1, every non-ledger failure
                                           passing in isolation (documented rotating set)
  npm run lint:fault-pins               -> expect emitted 84 / declared 58, backlog 0
  node -e "const m=require('./dist-test/src/authority/host/fs-ledger.js');console.log(m.ledgerFaultPoints.length,m.ledgerLockFaultPoints.length)"
                                        -> expect 125 58, FROZEN; any delta this batch is a STOP
The 16 remaining ledger reds are the ungranted housekeeping-permission family (dead-*, the
slot-retirement crash windows marker-only/marker-plus-stage/marker-plus-ack/orphan-ack, :1748,
and the before-admission-slot-rename / before-lock-publication-rename members). They are red BY
DESIGN. Do not "fix" them; that is D2-adjacent owner territory.
The spec's ONE live moving citation is now :906-907 (grep ":906-907" — one comment each in
src/authority/host/fs-ledger.ts and test/authority/ledger.test.ts); remap it in the same commit
as any spec insert above it. Committed test anchors that must not move (or whose every recorded
citation must be remapped in the same commit): :1020, :1022, :1119, :1134, :1141, :1157, :1672,
:1746, :1748, :1760, :1777, :1822.
STEP 2 — read these before touching code. They are the plan; do not re-derive them:
docs/superpowers/plans/2026-08-06-s4-activation-respec.md — §3 (the four crash classes, class 3
  now CLOSED), §5 (the activation contract), §6 (the Batch C revert), §7 (the Batch D execution
  record: phase 1a, phase 1b's bijection and 32-name green set, task 3, the flip, certification,
  and the THREE PHASE-3 RIDERS — read those riders, they are phase 3's known inputs)
docs/specs/compiled-authority-v1.md — grep, do not trust line numbers: "Resolved 2026-08-06
  (Batch D)" (the dead-stage route, incl. the disclosed before-publication-stage-validation
  emission site and the note that the committed ordering pin is now fixture-local), "The seal —
  proposed from measurement and SIGNED" (all six clauses), the slot-retired authority rules
docs/REELIER-NUMBERS.md — §1 FROZEN; §2 the 688/16 floor; §3 the contention-gate table, the N40
  recipe, the clock-rollback lesson, AND the stash-the-tests discriminator
docs/GLOSSARY.md · .claude/skills/reelier-slice (the loop — use it for every slice)
WHAT IS SHIPPED (Batch D, 2026-08-06, pushed through d09d03f): phase 1a (the {mode:"legacy"}
disable value + the unknown-value TypeError pin); phase 1b (all 30 work-list fixtures migrated,
seven line-neutral slices); the dead-stage withdrawal route (f971054 — class 3 closed, :1020
flipped); THE FLIP (bc21407 — 654/50 -> 688/16, zero newly failing, the 32 greens identical to
prediction); certification (both contention gates 3/3 post-flip on a quiet machine).
OWNER GRANTS — SPENT in Batch D, recorded so you do not re-litigate them: the two-phase
migration, the dead-stage withdrawal route, and the empty-terminal ratification. Do not reopen.
* STILL NOT GRANTED, owner decisions, do not decide alone: D2 (pins :1119/:1134); the BROADER
  housekeeping-permission question — the dead-* family and :1748 STAY RED through this batch too;
  any pin deletion or weakening beyond what phase 3's own retirement necessarily touches.
* THE ONE NEW DECISION THIS BATCH NEEDS, and it should be raised EARLY with measurement rather
  than at the end: phase 3 re-fixtures ~30 committed fixtures to flipped-default semantics, which
  MOVES committed pins by construction (signal counts gain the acquisition's own slot lifecycle;
  mint recipes change where the continuation now heals). Batch D's migration grant authorized
  moving them ONTO the disable value; it did not pre-authorize the semantic re-fixture. Measure
  the full move-list FIRST (per-family, on the flipped tree), present it as a named list with the
  measured before/after for each, and get the grant before editing. If the owner is unavailable,
  ship the option-retirement steps that need NO re-fixture and stop.
THE TASKS, IN THIS ORDER:
1 PHASE 3a — re-fixture, family by family, each count and residue MEASURED on the flipped tree
  before pinning, never derived. The seven migrated families are listed in the re-spec §7
  bijection. Known riders, measured by Batch D's GREEN review: (i) runChain also pins the two
  recover entries and the zero-terminal member; (ii) the dead-W1 drive line also constructs its
  recover leaf; (iii) the hardExit family's in-process successor recover() at :1894 stayed
  default-mode, so post-flip that family is a CROSS-MODE scenario — measured green under the A/B,
  but re-fixture it deliberately rather than leaving it accidental. The dead-W1 mint pattern from
  Batch C is the template for lone-marker-class fixtures.
2 PHASE 3b — retire, in this order, each its own commit: delete {mode:"legacy"} recognition and
  its fixtures' explicit OFF; migrate the option-gated constructors to plain (names keep their
  "option-gated" prefix history in the commit message, not in the test names — rename them in the
  same commit and say so); delete __testK1AdmissionPreparationRuntimeOption LAST. The retirement
  invariant pin ("the recognized admission-preparation ON value is a no-op against the flipped
  default") is what licenses each step — run it before and after each. Watch §1: if the symbol
  deletion changes emitted counts, lint:fault-pins moves and the NUMBERS row moves in the same
  commit. MEASURE, do not assume it stays 84/58.
3 TASK 3C — the execution/reconciliation lifecycle. Everything shipped so far AUTHORIZES a write;
  3C EXECUTES and RECONCILES one. Scope: ReservedDispatchHandle -> provider write ->
  dispatched | acknowledged | definitive-failure | ambiguous -> reconciled. Design review FIRST
  (it is new mechanism, not emission — the GLOSSARY entry exists because "mostly emission" was
  asserted twice and wrong twice). The four-state honesty invariant is load-bearing here: an
  `ambiguous` outcome must never render as a pass, and `reconciled` must say WHEN it reconciled,
  not merely that it did. Expect the fault-point registry to need extension — it is FROZEN, so
  any new point is an ABI break requiring an owner decision, exactly like D3(a) was. Raise it
  with the measured list before writing code.
3b PORT THE N-1 GUARD SHAPE ONTO THIS BRANCH. Found 2026-08-07 while building the guard-only
  0.31.1 predecessor: this branch's own version guard (src/verify.ts, grep
  "authority-receipt/v1") is strictly weaker than the one that release carries, in three ways
  that all matter. It is an exact string equality on ONE version, so a v2, a v99, or any other
  versioned record falls straight through to legacy evaluation. It sits only inside
  evaluateVerifyClaims, while evaluateUnalteredSincePushClaim and evaluateTimestampClaim are
  exported and reach legacy crypto without it. And it reports under the `unaltered-since-push`
  claim name, so a version refusal renders as a legacy claim failure. The guard release's shape
  (src/record-version-guard.ts on branch codex/nminus1-guard) fixes all three: no allow-list, all
  three entry points, its own `unsupported-record-version` claim name, plus an allow-charset
  renderer that stops a hostile `v` from forging claim rows into the verdict line — a defect
  measured in a real subprocess there, not hypothesized. Port it, do not re-derive it.
4 CONFORMANCE + SECURITY items, and a FULL PATHS A/B REGRESSION proving Path C touched neither.
  The regression is not optional and not a formality: Path C has been changing shared host code
  for five batches. Run the wrap path and the replay path end to end and record the result.
STOP-RULES — explicit, they override task completion:
* Any committed-pin movement beyond what the phase-3 grant names: ship the sound slices alone,
  record beside the rule in the spec, STOP.
* Any change to the FROZEN registry (58/125) without an owner ABI decision is a stop.
* D2, the broader housekeeping permission, and anything touching another batch's grants: owner
  decisions.
LOOP, per slice, no steps skipped: baseline — smallest gap — RED tests satisfiable
(lint:fault-pins + the fixture reaches the path) — independent RED review (fresh subagent;
patch-the-compiled-build discriminators both ways; hard-exit children hardcode dist-test/
relative to cwd) — smallest change — focused tests — TWO-SIDED GATE (pass must not drop, failing
set gains no names, new pins green; run it more than once) — broader npm test when shared code
changed — independent GREEN review (reviews found real findings in EVERY Batch A–D slice; send
the fix delta back to the SAME reviewer for sign-off before committing) — commit only if
shippable; revert and record why if not. Re-save the floor per shipped slice on a quiet machine,
and only when the 100-process member PASSED in that run.
MEASUREMENT DISCIPLINE:
* Classify mechanism-vs-emission and every "should green"/"zero movers" claim ONLY by
  implementing and running. Batch D was wrong twice more this way: the `as never` casts were not
  type-required, and an emission-order probe's shape did not generalize from complete to
  sub-complete stages.
* Never run the suite alongside subagents. baseline-diff refuses above 70% CPU. Below ~3.3GB free
  memory, child-spawning tests die in bulk runs (spawn errno -4094) and re-pass in isolation.
* WHEN A GATE SHOWS A ROTATING SET, run the Batch D discriminator before believing anything about
  src: stash the new TESTS, keep the src change, rebuild, gate. That run tells you what your
  source change actually moved. Batch D saw 8- and 9-name rotating sets that were pure load, and
  the src-only gate showed exactly the one granted pin.
* STASH work-in-progress test appends before any baseline --save; discard a --save that caught a
  rotator rather than committing it.
* Known rotating flakes — isolate before any regression claim: the 100-process test, the
  fixed-seed ledger fuzz, "candidate precedence is independent of input order…", "structured
  boundary mappings use exact stage…", "the decision boundary has no ambient network…", "unknown
  exceptions and clock failure…", "K1 construction churn distinguishes…", "typed slot-retired
  stage zero growth…", "typed creator-withdrawal stage zero growth…", "coordination cleanup stage
  write hooks are live…", "closed retirement dispositions reject unknown…". A ~30s+ duration on a
  normally-fast test is the load-timeout signature.
DOCS with each slice, same commit: the spec (the option's retirement removes its spec mentions
LAST; if 3C needs new rules they land beside the seal), REELIER-NUMBERS (§1 only if measured
counts move; §2 rows move in the commit that moves them; §3 if the gates or the spawn fix move),
GLOSSARY if a costly word emerges, plan postscripts, and the :906-907 citation rule above.
FINISH BY: updating PR #85 in its house style (a Batch E checkpoint section; refresh the S4
bullet only if phase 3 changes what it claims); pushing the branch; REPORTING (verified
branch/HEAD/dirty; baseline before/after each slice; every fault point and committed pin that
moved, by name; anything predicted that measurement contradicted; discrepancies recorded and
where; which stop-rule or designed split ended the batch and what the owner must decide or wait
for next); and DRAFTING THE BATCH F PROMPT from the measured state. Do NOT claim 3C, Path C, or
the merge complete beyond the evidence; the #85 and cloud#54 merges are the owner's, in that
order, and remain undone regardless. If blocked, stop and report the blocker rather than guessing.
```
