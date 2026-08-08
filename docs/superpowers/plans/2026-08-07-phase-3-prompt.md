# Phase 3 launch prompt — re-fixture and retire the admission-preparation option

_Drafted 2026-08-07 against `codex/universal-compiled-authority` @ `f887dab`. Supersedes the phase-3
portion of `2026-08-06-batch-e-prompt.md`, which was written before the ledger reconciliation and
before the N-1 guard was published, and which bundled phase 3 with Task 3C — too much for one
session. Task 3C keeps its own prompt; this one stops when the option is gone._

**Why this is worth a session of its own.** Eighteen construction sites across eight families
currently pass `{mode:"legacy"}`, so they pin the pre-flip configuration. No user runs that
configuration. Until they are re-fixtured, that part of the suite measures something that does not
ship, and every fixture written afterward inherits the ambiguity.

---

```
You are continuing Reelier's "Universal Compiled Authority — Path C": PHASE 3 — re-fixture the
option-pinned families to flipped-default semantics, then retire the option in three ordered
commits. Work bounded and evidence-led. Never report progress beyond what a command shows.
WORKTREE (cd into it explicitly for EVERY command — the Bash cwd silently resets to the primary
checkout after background-task notifications, and this trap put one Batch C commit on the wrong
branch before being caught):
C:\Users\maxim\CascadeProjects\reelier\.worktrees\universal-compiled-authority
Branch codex/universal-compiled-authority, expected HEAD f887dab or later, draft PR
seldonframe/reelier#85. Verify with node -p "require('./package.json').version" -> 0.30.0 in this
worktree (the primary checkout and the guard worktree are different versions; if you see anything
else you are in the wrong tree).
NO merge, release, publish, or history rewrite. The #85 merge and reelier-cloud#54 are the OWNER's
acts, in that order. reelier@0.31.1 is already published and tagged — do not touch it.
THIS SESSION MAY HONESTLY SPLIT after 3a and before 3b: "families re-fixtured, option still
present, recorded" is a SUCCESS outcome. It may also end at the very start — see the grant.
STEP 1 — re-verify before trusting anything. Every number below is a HYPOTHESIS until a command
reproduces it; six inherited numbers have been wrong across five batches:
  node scripts/baseline-diff.mjs   -> expect ledger floor 688 pass / 16 fail
  npm run lint:fault-pins          -> expect emitted 84 / declared 58, backlog 0
  node -e "const m=require('./dist-test/src/authority/host/fs-ledger.js');console.log(m.ledgerFaultPoints.length,m.ledgerLockFaultPoints.length)"
                                   -> expect 125 58, FROZEN; any delta is a STOP
  grep -c K1_ADMISSION_PREPARATION_LEGACY test/authority/ledger.test.ts  -> expect 18
  grep -c K1_ADMISSION_PREPARATION_MODE   test/authority/ledger.test.ts  -> expect 29
The 16 remaining ledger reds are the ungranted housekeeping-permission family (dead-*, the
slot-retirement crash windows marker-only/marker-plus-stage/marker-plus-ack/orphan-ack, :1748, and
the before-admission-slot-rename / before-lock-publication-rename members). They are red BY DESIGN.
Do not "fix" them; that is D2-adjacent owner territory.
Committed anchors that must not move, or whose every recorded citation must be remapped in the same
commit: :1020, :1022, :1119, :1134, :1141, :1157, :1672, :1746, :1748, :1760, :1777, :1822. The
spec's one live moving citation is :906-907 (grep it — one comment each in
src/authority/host/fs-ledger.ts and test/authority/ledger.test.ts).
STEP 2 — read these before touching code. They are the plan; do not re-derive them:
docs/superpowers/plans/2026-08-06-s4-activation-respec.md §7 — the Batch D execution record: the
  phase-1b bijection (which family owns which site), the flip, certification, and the RIDERS
docs/superpowers/plans/2026-08-06-sdd-ledger-reconciliation.md — current true status of everything
docs/REELIER-NUMBERS.md §1 FROZEN, §2 the 688/16 floor, §3 the contention gates AND the
  stash-the-tests discriminator
docs/specs/compiled-authority-v1.md — grep "Resolved 2026-08-06 (Batch D)" for the dead-stage route
.claude/skills/reelier-slice — the loop; use it for every slice
THE ONE OWNER DECISION THIS SESSION NEEDS — RAISE IT FIRST, WITH MEASUREMENT, NOT AT THE END.
Re-fixturing moves committed pins BY CONSTRUCTION: signal counts gain the acquisition's own K1 slot
lifecycle, and mint recipes change because the continuation now heals residue the fixture wants to
seed. Batch D's migration grant authorized moving fixtures ONTO the disable value; it did NOT
pre-authorize moving them off it semantically. So:
  1. FIRST, measure the complete move-list per family on the flipped tree — for each fixture, its
     current asserted values and the measured post-re-fixture values, by running, never derived.
  2. Present that as a named list with before/after per fixture and ask for the grant.
  3. If the owner is unavailable: ship ONLY what needs no committed-pin movement (see 3b step 1,
     which may be doable alone for fixtures whose explicit OFF can simply be deleted once their
     family is already default-equivalent — verify, do not assume), record the measured move-list
     in the re-spec §7, and STOP.
Do not decide this alone. Do not "just re-fixture and see".
THE WORK — 3a then 3b, in that order.
3a — RE-FIXTURE, family by family, one slice each, each count and residue MEASURED on the flipped
tree before pinning. The eighteen legacy-pinned sites belong to EIGHT families:
  1. :957/:958   "two ledger instances in one PID wait through admission and converge"
  2. :1746       "atomic admission active owner cleans coordination once after every sync barrier"
  3. :1852       hardExitAtPublicationPoint's child template — sole caller is "owner publication
                 hard-exit boundaries never expose an ownerless shared lock"
  4. :3165/:3183/:3199/:3219  the reused-root lifecycle family ("one root survives the
                 crash-and-heal lifecycle end to end" + crashDefaultChild/observeAdvances/recover)
  5. :3349/:3357/:3359  the lone-withdrawal family's mint template and dead members
  6. :3409/:3435 the dead-owner chain family (runChain + the warm members' warming acquisition)
  7. :3637       the dead-W1 window's completing drive
  8. :3885/:3887/:3948  the DEAD-STAGE WITHDRAWAL family (Batch D task 3) — warmRoot, settle, and
                 the emission-order pin. NOT in the original three riders; found 2026-08-07.
  (:2236 is the K1_ADMISSION_PREPARATION_LEGACY constant itself — it dies in 3b step 1, not here.)
FOUR RIDERS, measured by Batch D's GREEN review and by the 2026-08-07 site sweep. Handle each
deliberately rather than discovering it mid-slice:
  (i)   runChain also pins the two recover entries and the zero-terminal member, not just the
        observe members.
  (ii)  the dead-W1 drive line at :3637 also constructs its recover leaf.
  (iii) the hardExit family's in-process successor recover() at :1894 stayed DEFAULT-mode, so post
        flip that family is a CROSS-MODE scenario. Measured green under the flip A/B, but
        re-fixture it deliberately rather than leaving it accidental.
  (iv)  family 8's settle() is shared by every subtest in the dead-stage family, including the two
        complete-form members whose oracle is "observe progresses but the bare slot stays
        recover-reserved". Re-fixturing it changes what those members drive; re-measure that
        oracle, do not assume it survives.
The dead-W1 mint pattern from Batch C is the template for lone-marker-class fixtures.
3b — RETIRE, in this order, EACH ITS OWN COMMIT:
  1. Delete {mode:"legacy"} recognition from parseK1AdmissionPreparationRuntime AND the fixtures'
     explicit OFF, together — leaving the recognition with no callers is dead surface, and leaving
     the callers with no recognition is a TypeError at construction (the value becomes
     unrecognized, which the task-1 pin makes throw).
  2. Migrate the option-gated constructors to plain. Twenty-nine sites currently pass the ON
     literal. Their test NAMES carry an "option-gated" prefix that becomes false the moment the
     option is gone — rename them in the same commit and say so in the message, because the prefix
     is history, not description.
  3. Delete __testK1AdmissionPreparationRuntimeOption LAST, with its type, its
     InternalFsAuthorityLedgerOptions member, and the parse function if nothing else calls it.
THE RETIREMENT-INVARIANT PIN IS WHAT LICENSES EACH STEP: "the recognized admission-preparation ON
value is a no-op against the flipped default" (test/authority/ledger.test.ts:2349). Run it before
and after every retirement commit. It is the property that makes deleting the option safe — if the
two constructions ever diverge, the option is doing something the default is not and CANNOT be
deleted. It necessarily dies in step 3 with its subject; say so in that commit.
WATCH §1 THROUGHOUT: if the symbol deletion changes emitted fault-point counts, lint:fault-pins
moves and the NUMBERS §1 row moves in the SAME commit. MEASURE it; do not assume it stays 84/58.
STOP-RULES — explicit, they override task completion:
* Any committed-pin movement beyond what the phase-3 grant names: ship the sound slices alone,
  record beside the rule in the spec, STOP.
* Any change to the FROZEN registry (58/125) without an owner ABI decision is a STOP.
* The dead-* family and :1748 STAY RED. D2 and the broader housekeeping permission are owner
  decisions.
* If a re-fixtured family cannot be made to pass without weakening an assertion, that is a finding,
  not an obstacle: revert the slice, record the measurement, and raise it.
LOOP, per slice, no steps skipped: baseline — smallest gap — RED tests satisfiable (lint:fault-pins
+ the fixture reaches the path) — independent RED review (fresh subagent; patch-the-compiled-build
discriminators both ways; hard-exit children hardcode dist-test/ relative to cwd) — smallest change
— focused tests — TWO-SIDED GATE (pass must not drop, failing set gains no names; run it more than
once) — broader npm test when shared code changed — independent GREEN review (reviews found real
findings in EVERY Batch A-D slice; send the fix delta back to the SAME reviewer for sign-off before
committing) — commit only if shippable; revert and record why if not. Re-save the floor per shipped
slice on a quiet machine, and ONLY from a run where the 100-process member passed.
MEASUREMENT DISCIPLINE:
* Classify every "should be identical"/"zero movers" claim ONLY by running. Batch D was wrong twice
  more this way: the `as never` casts turned out not to be type-required, and an emission-order
  probe's shape did not generalize from complete to sub-complete stages because a sub-complete
  acquisition completes and goes on to publish.
* WHEN A GATE SHOWS A ROTATING SET, run the discriminator before concluding anything about src:
  stash the new TESTS, keep the src change, rebuild, gate. Batch D saw 8- and 9-name rotating sets
  that were pure load; the src-only gate showed exactly the one granted pin. A rotating set is not
  evidence about src until that A/B says so.
* Never run the suite alongside subagents. baseline-diff refuses above 70% CPU. Below ~3.3GB free
  memory child-spawning tests die in bulk (spawn errno -4094) and re-pass in isolation.
* Discard a --save that caught a rotator rather than committing it; a floor with phantom names baked
  in is worse than no re-save.
* Known rotating flakes — isolate before any regression claim: the 100-process test, the fixed-seed
  ledger fuzz, "candidate precedence is independent of input order…", "structured boundary mappings
  use exact stage…", "the decision boundary has no ambient network…", "every closed refusal…",
  "unknown exceptions and clock failure…", "K1 construction churn distinguishes…", "typed
  slot-retired stage zero growth…", "typed creator-withdrawal stage zero growth…", "coordination
  cleanup stage write hooks are live…", "closed retirement dispositions reject unknown…". An
  elevated duration on a normally-fast test is the load signature (measured at 6.6s and 8.9s).
DOCS with each slice, same commit: REELIER-NUMBERS (§2 rows move in the commit that moves them; §1
ONLY if measured counts change); the spec (the option's retirement removes its spec mentions LAST,
in step 3); the re-spec §7 execution record; GLOSSARY if a costly word emerges; and the :906-907
citation rule.
FINISH BY: updating PR #85 in its house style (a phase-3 checkpoint section; refresh the S4 bullet
to say the option is retired and what that does and does not mean); pushing; REPORTING (verified
branch/HEAD/dirty; baseline before/after each slice; every committed pin that moved, BY NAME;
anything predicted that measurement contradicted; which stop-rule or split ended the session); and
stating plainly what remains for Task 3C. Do NOT claim Path C or 3C complete beyond the evidence.
If blocked, stop and report the blocker rather than guessing.
```
