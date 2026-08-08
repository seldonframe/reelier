# Batch A prompt — paste into a fresh session verbatim

_Written 2026-08-05 after the foreign-dead-slot drainage shipped (`8009212`, pushed `46c89d0`).
Batch A is everything S4 needs that requires NO owner decision: the warm-prep fix, the four
pre-admission-housekeeping emissions, the reused-root default-path test class, and the 100-process
diagnosis. The withdrawal chain and the S4 flip are Batch B and wait on the step-2 decision brief._

---

You are continuing Reelier's "Universal Compiled Authority — Path C" implementation: Batch A of the
S4-preparation work. Work bounded and evidence-led. Never report progress beyond what a command
shows.

WORKTREE (cd into it explicitly for every command):
C:\Users\maxim\CascadeProjects\reelier\.worktrees\universal-compiled-authority
Branch codex/universal-compiled-authority, expected HEAD 46c89d0, draft PR
seldonframe/reelier#85. No merge, release, publish, or history rewrite.

STEP 1 — re-verify before trusting anything. Confirm branch, HEAD, dirty files and baseline
yourself. Every number below is a HYPOTHESIS until a command reproduces it: ledger baseline
recorded 498 pass / 80 fail; full npm test ~2,142 pass / ~82 fail / 1 skipped; registry
ledgerLockFaultPoints 61, ledgerFaultPoints 128; lint:fault-pins emitted 74 / declared 58 /
unemitted 10. Inherited numbers have been wrong repeatedly in this project.

STEP 2 — read these before touching code. They are the plan; do not re-derive them:
  docs/superpowers/plans/2026-08-05-narrow-drainage-reverted.md   (incl. the shipped postscript)
  docs/superpowers/plans/2026-08-05-s4-activation-measured.md     (incl. the shipped postscript)
  docs/specs/compiled-authority-v1.md    (the contract; find the warm-prep defect record by
    grepping "A related measured limit" and the drainage resolution by grepping "Resolved
    2026-08-05"; line numbers rot — grep, do not trust citations in this prompt)
  docs/GLOSSARY.md · docs/REELIER-NUMBERS.md · .claude/skills/reelier-slice (the loop — use it)

WHAT IS SHIPPED. Foreign-dead-slot drainage is live: 9252f18 (same-owner successor counting),
d869a64 (marker-owner-remove window + published rescue), 8009212 (the granted drainage — any
contender retires a dead-owner slot as published on the byte-identical same-owner lock; every
crash at/after publication root sync self-heals in one acquisition, warm-measured). The
__testK1AdmissionPreparationRuntimeOption default is still OFF; defaults are byte-identical.

THE TASKS, IN THIS ORDER:

 1 FIX THE WARM-PREP DEFECT. Measured 2026-08-05, recorded in the spec: a crash at any of the six
   pre-rename points (after-admission-prep-create, -owner-create, -owner-partial-write,
   -owner-sync, -prep-sync, before-admission-slot-rename) on a WARM root — one carrying the
   previous acquisition's steady-state `.released` marker, which every real root carries — is
   PERMANENT corruption from both observeClock and recover(). The prep branch of
   classifyClosedHybridGraph throws "impossible preparation graph" on retired.size, and the
   pre-classification legacy service (fs-ledger.ts, the hook keyed on the bare ADMISSION_SLOT_NAME
   in acquireLock) never fires for preparation names. The three post-rename points leave the fixed
   slot and drain warm via recover() — pin those as regression guards.
   TWO CANDIDATE DESIGNS — build and measure both, per the skill's design-review rule:
   (a) tolerance: the prep (and, if measured reachable, prep-retired) classification branches
       tolerate unrelated inert `released`/`publication-aborted` markers, mirroring the slice-1
       published-successor tolerance;
   (b) service widening: the pre-classification hook also fires when k1Names is exactly one
       prep-family name.
   THE PIN TRAP, measured in advance: committed orphan-family pins (test/authority/ledger.test.ts
   ~:1139, :1141, :1151-:1152, :1157, :1159 — grep their names, lines rot) assert corruption AND
   byte-identical preservation for hand-seeded orphan+released graphs. Design (b) would DRAIN
   those fixtures' released markers and flip them. If BOTH designs flip committed pins, hard-stop
   and record. Measure which K1 branches encounter warm residue from REAL lineages (crash
   children, not hand-seeds) before deciding scope: prep is proven; prep-retired and withdrawal
   coexistence with `.released` may be unreachable — if unreachable, their committed corruption
   verdicts stay untouched and you record why.
   Pins on WARM roots FIRST: crash real option-on children at all six pre-rename points, assert
   both entry points recover and the root fully heals (use the drainage suite's assertHealed
   pattern: zero admission residue, exactly one released marker, no lock). Fresh-root blindness
   has hidden six defects in this codebase; the sixth was found because a reviewer ran warm
   probes this prompt's author had only run at one point.

 2 EMIT THE FOUR PRE-ADMISSION-HOUSEKEEPING POINTS: before-pre-admission-housekeeping-transition,
   after-pre-admission-housekeeping-root-sync, after-pre-admission-housekeeping-marker-remove,
   after-pre-admission-housekeeping-marker-root-sync. lint:fault-pins lists them as specified,
   test-referenced (~:1752, :1812, :1813, :1827, :1840) and unemitted. "This is probably just
   emission" has been asserted three times in this project and wrong three times — classify by
   implementing and running. Note the committed test "pre-admission housekeeper retires one dead
   slot before preparation and mutates no semantic state" (~:1748) already injects at
   after-pre-admission-housekeeping-root-sync and is in the red 80: emitting may green committed
   reds. That is allowed (pass may rise, failing set may shrink) — name every one that moves in
   the report. Spec taxonomy already declares all four; the registry gains nothing (they are in
   the exported 61 — verify). REELIER-NUMBERS backlog row moves 10 -> 6; update it.

 3 ADD THE REUSED-ROOT DEFAULT-PATH TEST CLASS. Institutionalize the warm-root discipline for the
   DEFAULT path: a committed family that runs several default (option-off) acquisitions against
   one root interleaved with crashes and recover() calls, asserting residue and healed-state
   oracles at each step. Copy the drainage suite's warmup/assertHealed patterns. Append at END of
   ledger.test.ts (committed anchors must not move). Keep it deterministic — no child races
   beyond the existing pattern.

 4 DIAGNOSE THE 100-PROCESS TEST. "100 real processes converge on one committed reservation and
   one dispatch eligibility" fails ~50/50 on this host as `Error: child <pid>: 3221226505`
   (STATUS_STACK_BUFFER_OVERRUN) — an environment signal, in the recorded failing baseline on
   purpose. Reproduce in isolation N>=3, then diagnose: spawn concurrency vs machine limits, node
   version, port-fence contention, CRT stack protection under load. Fix ONLY if the root cause is
   mechanical and the fix is measurable (e.g. staggered spawning) — the test is committed; do not
   weaken its assertions. If not mechanically fixable, write a quarantine PROPOSAL with the
   evidence in the handoff doc and leave the test untouched. This is an S4 gate prerequisite, not
   an S4 gate.

LOOP, per slice, no steps skipped: baseline (npm run baseline) — smallest gap — RED tests
satisfiable (npm run lint:fault-pins + fixture reaches the path) — independent RED review (fresh
subagent, patch-the-compiled-build discriminators; hard-exit children hardcode dist-test/, a
copied tree will not see your patch) — smallest change — focused tests — TWO-SIDED GATE (pass must
not drop, failing set gains no names, new pins green) — broader npm test when shared code changed
— independent GREEN review (it found blockers in ALL SIX panels of the drainage session) — commit
only if shippable; revert and record why if not.

HARD STOPS — owner decisions, do not decide alone:
 - the creator-withdrawal chain (:1022 vs :1746 seed the BYTE-IDENTICAL live-owner graph and
   drive the same default observeClock demanding opposite results; the seal step is undefined) —
   Batch B, see docs/superpowers/plans/2026-08-05-step2-decision-brief.md
 - the two recorded corruption lineages beside the successor rule (candidate rule written there)
 - deleting the 13 non-spec registry entries vs the ABI freeze gating reelier-cloud#54
 - anything whose resolution would delete or weaken a committed pin, or any spec
   under-definition: record in the spec beside the rule and stop.

MEASUREMENT DISCIPLINE:
 - Classify emission-vs-mechanism ONLY by implementing and running.
 - Never run the suite alongside subagents. Baseline BEFORE full npm test, confirm with a second
   comparison; baseline-diff refuses above 70% CPU.
 - Known flaky, re-run in isolation before calling anything a regression: the 100-process test,
   "cross-process collisions use ingress, semantic, capability, then limit precedence", and a
   rotating gate.test.js member (last seen: "the complete sink handling matrix covers valid
   collisions and all appended lookup outcomes" — passes alone in its own file).
 - Spec and code citations rot on every insert: spec edits line-neutral where possible (the file
   is 983 lines; keep it 983 or remap every downstream citation in the same commit and verify
   each resolves). Append new tests at END of file.
 - The Bash tool's cwd silently resets after background-task notifications. Explicit cd every
   command; verify with node -p "require('./package.json').version" (worktree 0.30.0, primary
   0.29.x).

DOCS with each slice, same commit: spec (the warm-prep record moves from open to resolved when
task 1 lands — grep it), REELIER-NUMBERS (backlog row, ledger row, pin header), GLOSSARY if a
costly word emerges, plan postscripts. FINISH BY: updating PR #85 in its house style (a new
checkpoint section; refresh the Known open gates bullets your work moves), pushing the branch,
and REPORTING: verified branch/HEAD/dirty files; baseline before/after each slice; which fault
points and which committed pins moved (name them); anything predicted that measurement
contradicted; any discrepancy recorded and where. Do NOT claim S4, Task 3B2, K1 or Path C
complete beyond the evidence. If blocked, stop and report the blocker rather than guessing.
