# Path C continuation prompt — from a green gate to a merged #85 and on to 3C

_Drafted 2026-08-07 from the measured state at `e8db1c6`. Everything Path C needs from here, in
dependency order. This is NOT one session and does not pretend to be — it names where to split._

**Read this before pasting.** The first bounded session is **Session A** (the gate rotation). Do not
start Session B until A's gate is stable, because every later session's acceptance test depends on
being able to tell a real regression from noise — and today it cannot.

**The one decision that is not ours.** D2 / the housekeeping permission. Sixteen ledger tests are red
**by design** pending it. No mechanism should turn them green beforehand; doing so manufactures a
green that asserts a decision nobody made. It blocks the merge, not the engineering.

---

```
You are continuing Reelier's Path C. Work bounded and evidence-led. Never report progress beyond
what a command shows. Every number below is a HYPOTHESIS until a command reproduces it — six
inherited numbers have been wrong across five batches, and one of them was wrong yesterday.

WORKTREE (cd into it explicitly for EVERY command — the Bash cwd silently resets after
background-task notifications, and this trap put one commit on the wrong branch before being
caught): C:\Users\maxim\CascadeProjects\reelier\.worktrees\universal-compiled-authority
Branch codex/universal-compiled-authority. No release, no npm publish. reelier@0.31.1 is published
and the N-1 guard is DISCHARGED; do not touch it.

STEP 0 — establish where you are, because it may have changed:
  git log --oneline -1 ; git status --porcelain ; git branch --show-current
  git rev-list --count HEAD..origin/main        -> was 0; if nonzero, reconcile FIRST
  gh pr view 85 --json state,isDraft            -> was OPEN + draft
  npm run build && npx tsc -p tsconfig.test.json
  npm run lint:fault-pins                       -> registry FROZEN at 84 emitted / 58 declared
  gh run list --branch codex/universal-compiled-authority --workflow CI --limit 1

INHERITED STATE at e8db1c6, all to be re-derived:
  * origin/main is merged in (25dd32d). Paths A/B measured NON-REGRESSING across three full runs;
    src/authority/ has zero import specifiers that escape the module and nothing in cli.ts /
    runner.ts / recorder.ts imports it. Path C is inert with respect to shipped behaviour.
  * CI at e8db1c6 FAILS ON BOTH LEGS. Linux 2,480 / 2,456 pass / 22 fail / 2 skip.
    Windows 2,480 / 2,458 pass / 21 fail / 1 skip. Same suite size, different failing sets.
  * README badge says tests-1650. The real pass count is ~2,456. check-badge.mjs fails on the Linux
    leg INDEPENDENTLY of the tests, and today never even runs because the test step fails first.
  * 16 core reds = the ungranted housekeeping-permission family = D2. RED BY DESIGN. Do not fix.

READ THESE FIRST. They are the plan; do not re-derive them:
  docs/superpowers/plans/2026-08-07-bindingress-lock-busy-rootcause.md — A RETRACTION. Read it for
    the reasoning error, not the conclusion. It is the shape of mistake most available to you here.
  docs/superpowers/plans/2026-08-07-paths-ab-merge-regression.md — the merge gate, three full runs
  docs/superpowers/plans/2026-08-07-task-3c-prompt.md — the 3C launch prompt, incl. its STEP 1b
  docs/superpowers/plans/2026-08-06-sdd-ledger-reconciliation.md — true status of everything
  .superpowers/sdd/universal-compiled-authority/task-3c-brief.md — THE 3C BRIEF, ~500 lines, whole
  docs/specs/compiled-authority-v1.md — the signed contract. Where it and the tests disagree, STOP
    and record the discrepancy in the spec beside the rule; never silently change either side.
  docs/REELIER-NUMBERS.md §3 — load discipline AND the stash-the-tests discriminator
  docs/path-c-status.md — the pinned capability summary and its stale pin
  .claude/skills/reelier-slice — the loop; use it for every slice

=== SESSION A — make the gate trustworthy. Do this first and alone. ===
gate.test.js rotates: across five observations its failing subset changed every time, and the
Linux and Windows sets differ at the same commit. A gate that cannot distinguish a regression from
noise cannot gate anything, and Task 3C's loop leans on it at all six slices.

The identical problem was solved for fuzz.test.ts in e8db1c6 and that fix is the template:
  * The ledger reports a lock it could not take as a RESULT REASON, not an exception. "busy",
    "lock-owner-unverifiable" and "corruption" are declared members of BindIngressResult
    (src/authority/ledger.ts:128), ReserveReason (:80), TransitionReason (:94), and RecoverResult
    (:117) — whose failure member is EXACTLY that lock union and nothing else.
  * The K1 operation fence budgets acquisition against REAL monotonic time
    (monotonicNow() + lockTimeoutMs, default 30s), and K1 admission is active by default since
    bc21407. Under load a legal "busy" appears.
  * So any `assert…(x.ok, true)` on such a result asserts something the contract explicitly permits
    to fail. That is why an IDENTICAL fast-check seed rotated red.
FIRST, TEST WHETHER THAT SHAPE EVEN APPLIES HERE — do not assume it. The observed gate messages
include `contract-expired`, which is NOT a ReserveReason, so at least one gate rotator has a
DIFFERENT cause (a wall-clock/expiry sensitivity is the obvious candidate, and it is a candidate,
not a finding). Enumerate the rotators, classify each, and say which bucket each falls in with the
line that proves it.
ALSO undiagnosed: four names that failed only on Linux — `type-replacement`, `rename collision
retains one synced creator stage and fixed slot across replacement classes`, `option-gated
acquisitions leave a root that every entry point can still use`, `ledger-lock publication rename
attempt declares and emits its before boundary`.
ACCEPTANCE for Session A, and it is deliberately strict: the same failing set twice in a row
locally AND agreeing with a CI run on both legs, with the residue being exactly the D2 family.
Anything less and the gate is still lying.

=== SESSION B — the merge. Needs D2 from the owner. ===
  1. D2 / housekeeping permission: OWNER DECISION. Ask; do not work around it. If granted, the 16
     go green by the granted mechanism. If explicitly quarantined instead, the quarantine must be
     loud, named, owner-attributed and expiring — never a silent skip.
  2. README badge -> the real Linux pass count (scripts/check-badge.mjs, canonical platform Linux).
  3. Retitle #85 off [WIP]; mark ready for review.
  4. Green CI on BOTH legs, twice.
  5. Merge #85. Then reelier-cloud#54 unblocks.
Do NOT merge while red. main is currently green and the whole premise of this product is that a
guardrail which is present and dead is worse than none.

=== SESSION C — the two 3C prerequisites. Small; they unblock 3C0-3C2. ===
  (a) An independent review verdict for 3B2's fairness slice (5eca255 + follow-ups). Tasks 1, 1A
      and 2 each have task-*-review-*.md on file; 3B2 has none. Fresh reviewer, adversarial,
      grounded in file+line and reproducible runs.
  (b) The final docs-only pin. It lives in docs/path-c-status.md, which still carries 3B1's commit
      9666b90. NOT AGENTS.md — since 25dd32d that file is a byte-identical twin of CLAUDE.md
      guarded by test/claim-guard.test.ts:177, and a Path C pin there breaks the guard.

=== SESSION D+ — Task 3C, six slices, one per session (two is optimistic). ===
Use docs/superpowers/plans/2026-08-07-task-3c-prompt.md verbatim; it is current and carries the
design-review, ABI and stop-rule requirements. 3C0 freeze the execution-evidence protocol; 3C1
evidence-bound ledger v5; 3C2 pre-dispatch revalidation and durable refusal (no driver); 3C3 sealed
driver boundary and terminal result evidence (first slice that can write); 3C4 read-only
reconciliation; 3C5 portable derivation and authority-aware verifier.

=== THEN Task 4 — driver, host, ingress, CLI. It has NO brief; one must be written. ===
This is what gives Path C a door: src/cli.ts does not import the authority module at all, so until
Task 4 ships, nothing above is reachable by a user. Entry condition 3C3 minimum, realistically
after 3C4 so the command surface can expose reconciliation rather than be retrofitted.

WHAT IS LOAD-BEARING AND MUST NOT BE COMPROMISED:
* FOUR-STATE HONESTY. verified / failed / unchecked / absent. An `ambiguous` dispatch outcome must
  NEVER render as a pass. Brand invariant #1 and the single most important property in the product.
* The registry is FROZEN at 58 ledger-lock / 125 public fault points. New points are an ABI BREAK
  and an OWNER DECISION. Measure the complete list needed FIRST, present it, get the decision.
* FORBIDDEN SCOPE: Paths A/B, runner.ts, recorder.ts, serve.ts, legacy fixtures, and legacy verifier
  output for records with no own top-level `v`. Needing one of these is a design error or a finding
  — stop and report it.
* No provider write or credential access before slice 3C3. A real credential must never appear in a
  test, a fixture, a log, or a receipt.

STOP-RULES — they override task completion:
* Any committed-pin movement not explicitly granted: ship the sound slices alone, record beside the
  rule in the spec, STOP.
* Any registry change without an owner ABI decision: STOP.
* The 16 ledger reds are red BY DESIGN. Do not "fix" them.
* Merging #85 while CI is red: STOP and ask.

MEASUREMENT DISCIPLINE — the first two are yesterday's lessons, paid for in full:
* A claim about a TYPE'S MEMBERS must be read from the TYPE. Reading a union off the
  implementation's return sites produced a confident, committed, pushed claim of a defect that did
  not exist. When a claim is about a declared contract, open the declaration.
* VERIFY A FLAKINESS FIX UNDER DELIBERATE CONTENTION, never on a quiet machine. Spawn CPU hogs and
  re-run. The fuzz fix was only credible because a 407s contended run passed where a 347s one had
  failed. Three quiet passes proved nothing.
* An identical fixed seed that still rotates means the HARNESS varies, not the input.
* WHEN A GATE SHOWS A ROTATING SET, run the discriminator before concluding anything about src:
  stash the new TESTS, keep the src change, rebuild, gate.
* Classify every "this should work" / "zero movers" claim ONLY by running it.
* Never run the suite alongside subagents. baseline-diff refuses above 70% CPU. Below ~3.3GB free
  memory, child-spawning tests die in bulk and re-pass in isolation.
* Only re-save a floor from a run where the 100-process member PASSED.

LOOP, per slice, no steps skipped: baseline — smallest gap — RED tests, verified SATISFIABLE
(lint:fault-pins + confirm the fixture actually reaches the path) — independent RED review (fresh
subagent; make it patch the compiled build BOTH ways to prove the pin discriminates) — smallest
change — focused tests — TWO-SIDED GATE (pass must not drop, failing set gains no NAMES; run it more
than once) — broader npm test when shared code changed — independent GREEN review (every slice in
batches A-D drew a real finding; send the fix delta back to the SAME reviewer) — commit only if
shippable; revert and record why if not.

DOCS with each slice, same commit: the spec (new rules land beside the seal; a discrepancy is
recorded, never silently resolved), REELIER-NUMBERS (§1 only if measured counts move; §2 in the
commit that moves them), GLOSSARY if a costly word emerges, and the SDD ledger row.

FINISH BY: updating the PR in its house style; pushing; REPORTING (verified branch/HEAD/dirty;
baseline before and after; every pin and fault point that moved BY NAME; anything predicted that
measurement contradicted; which stop-rule or split ended the session); and drafting the next
session's prompt from the measured state. Do NOT claim Path C complete beyond the evidence — after
3C it still has no user-facing command until Task 4 ships. If blocked, stop and report the blocker
rather than guessing.
```

---

## Why the sessions are split here and not elsewhere

**A before B** because the merge's acceptance criterion is "green CI on both legs", and today nobody
can tell a green from a lucky roll. Merging on a lucky green is worse than not merging.

**B before C** because 3C's brief blocks on a reviewed and pinned 3B2, and the pin should be taken
against a merged, stable base rather than re-taken after the merge moves it.

**C before D** because the 3C brief says so in its own first line.

**Task 4 last** because a CLI over a lifecycle that cannot dispatch is a shell, and retrofitting a
command surface for reconciliation costs more than designing it after 3C4.

## The Cloud half, and why it is not in the prompt

`reelier-cloud`'s architecture record marks the control plane, packs, kernels, custody and UI
*designed, not shipped*, and states that managed custody "cannot precede customer-held proof of the
protocol and operational controls." Entry condition is all of 3C plus Task 4 plus `reelier-cloud#54`
— which itself waits on the OSS ABI freeze (done) and the #85 merge. Different repo, different
reviewer, different failure mode. Do not bundle it.
