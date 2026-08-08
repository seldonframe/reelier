# Task 3C launch prompt — dispatch, evidence, reconciliation

_Drafted 2026-08-07. This is the task that makes Path C **do** something. Everything shipped so far
AUTHORIZES a write; 3C EXECUTES one and reconciles what happened. Without it Path C can decide a
write is allowed and then do nothing._

**Scope warning, read before pasting.** 3C is six slices against a 500-line brief. It is not one
session and this prompt does not pretend otherwise — it says where to split. Task 4 (driver, host,
ingress, CLI) and the Cloud half are deliberately NOT in here; their entry conditions are at the
end of this file, outside the prompt block.

**Two prerequisites that are not optional.** The 3C brief's own first line blocks the task until
3B2 has (a) an independently approved product commit and (b) a final docs-only pin. Neither exists
today: there is no `task-3b2-review-*.md` verdict, and the pin still reads `9666b90`, which is
3B1's commit. They are small. Do them first or the whole task is built on an unpinned base.

> **Prerequisite (b) was re-specified on 2026-08-07 and the original wording is now wrong.** It said
> to re-pin `AGENTS.md`. After the merge with `origin/main` (`25dd32d`), `AGENTS.md` is a
> byte-identical twin of `CLAUDE.md` enforced by `test/claim-guard.test.ts:177`, and carries no
> `code pin` line at all. The pin now lives in **`docs/path-c-status.md`**. Editing either twin to
> hold a Path C pin would break `claim-guard` and would assert capability about unbuilt work.
> See `docs/superpowers/plans/2026-08-07-paths-ab-merge-regression.md`.

---

```
You are implementing Reelier Path C's Task 3C: dispatch, evidence, and reconciliation — the
lifecycle that takes an AUTHORIZED write and actually performs it against a provider, then
reconciles the outcome. Work bounded and evidence-led. Never report progress beyond what a command
shows.
WORKTREE (cd into it explicitly for EVERY command — the Bash cwd silently resets after
background-task notifications, and this trap put one commit on the wrong branch before being
caught): C:\Users\maxim\CascadeProjects\reelier\.worktrees\universal-compiled-authority
Branch codex/universal-compiled-authority (or its successor if #85 merged — CHECK FIRST, see step 0).
Verify with node -p "require('./package.json').version".
No release or npm publish. reelier@0.31.1 is published and tagged; do not touch it.
STEP 0 — establish where you are, because it may have changed:
  gh pr view 85 --json state,isDraft   -> if MERGED, branch from origin/main instead and say so
  git log --oneline -1 ; git status --porcelain
  node scripts/baseline-diff.mjs       -> ledger floor; record it, whatever it is
  npm run lint:fault-pins              -> emitted/declared; the registry is FROZEN at 58/125
Every number you inherit is a HYPOTHESIS until a command reproduces it. Six inherited numbers have
been wrong across five batches.
STEP 1 — CLEAR THE TWO PREREQUISITES. The 3C brief blocks on them and they are cheap:
 (a) An independent review of 3B2's fairness slice (5eca255 and its follow-ups). Tasks 1, 1A and 2
     each have task-*-review-*.md verdicts on file; 3B2 has none. Produce one: fresh reviewer,
     adversarial, grounded in file+line and reproducible runs.
 (b) The final docs-only pin. docs/path-c-status.md carries `code pin 9666b90...`, which is 3B1's
     product commit. Re-pin it to the reviewed 3B2 commit in a docs-only commit. NOT AGENTS.md —
     since 25dd32d that file is a byte-identical twin of CLAUDE.md, guarded by
     test/claim-guard.test.ts:177, and putting a Path C pin in it breaks the guard.
STEP 1b — #85 IS NOT MERGED AND CANNOT BE MERGED YET. Do not assume a merged base. Measured
2026-08-07: main's CI is green, this branch fails 23 tests, CI runs `npm test` under `set -o
pipefail`, and the README badge (1,650) disagrees with the real suite size (2,480), so
check-badge.mjs fails on the Linux leg independently of the tests. The 16 core reds are the
ungranted housekeeping-permission family and cannot go green without the owner's D2 decision.
The merge with origin/main IS applied on this branch (25dd32d) and Paths A/B were measured
non-regressing across three full runs — that work is done. What is missing is an owner decision,
not code.
Do not start 3C0 until both exist. If the review finds something blocking, that finding IS the
session's outcome — report it and stop.
STEP 2 — read these. They are the plan; do not re-derive them:
.superpowers/sdd/universal-compiled-authority/task-3c-brief.md — THE BRIEF, ~500 lines. Read the
  WHOLE thing. It defines the closed cross-slice model, the exact internal evidence records, the
  stable source-state projection, the claim derivation matrix, the closed pre-dispatch outcomes,
  and all six slices with their acceptance gates. This prompt does not restate it and must not.
docs/specs/compiled-authority-v1.md — the signed contract. Where it and the tests disagree, STOP
  and record the discrepancy in the spec beside the rule; do not silently change either side.
docs/superpowers/plans/2026-08-06-sdd-ledger-reconciliation.md — current true status of everything
docs/REELIER-NUMBERS.md §3 — the load discipline AND the stash-the-tests discriminator
.claude/skills/reelier-slice — the loop; use it for every slice
THE SIX SLICES, in the brief's order. One slice per session is realistic; two is optimistic:
  3C0  freeze the execution-evidence protocol
  3C1  evidence-bound ledger v5
  3C2  pre-dispatch revalidation and durable refusal (NO driver, no provider write)
  3C3  sealed driver boundary and terminal result evidence  <- first slice that can write
  3C4  read-only reconciliation
  3C5  portable derivation and authority-aware verifier
THE N-1 GUARD IS DISCHARGED. reelier@0.31.1 is published, tagged, and verified: it refuses every
record carrying an own top-level `v`, so an old CLI can no longer render a confident legacy verdict
about an authority receipt. Slices 3C3+ may therefore call a receipt N-1-safe. Do not re-do this.
DESIGN REVIEW BEFORE CODE, for 3C0 and again for 3C3. This is MECHANISM, not emission. The
GLOSSARY carries that distinction because "the transitions exist, so this is mostly emission" was
asserted twice on this project and was wrong twice. Give the design reviewer a candidate bound and
require it to BUILD and MEASURE alternatives rather than reason about them.
WHAT IS LOAD-BEARING AND MUST NOT BE COMPROMISED:
* FOUR-STATE HONESTY. verified / failed / unchecked / absent. An `ambiguous` dispatch outcome must
  NEVER render as a pass. This is brand invariant #1 and the single most important property in the
  product. A reconciliation must say WHEN it reconciled, not merely that it did.
* The registry is FROZEN at 58 ledger-lock / 125 public fault points. 3C will probably need new
  points. That is an ABI BREAK and therefore an OWNER DECISION, exactly as D3(a) was. Measure the
  complete list of needed points FIRST, present it, and get the decision before writing them. Do
  not add one "just to get the slice moving".
* FORBIDDEN SCOPE throughout, per the brief: Paths A/B, runner.ts, recorder.ts, serve.ts, legacy
  fixtures, and legacy verifier output for records with no own top-level `v`. If a slice seems to
  need one of these, that is a design error or a finding — stop and report it.
* No provider write or credential access exists before slice 3C3. If 3C0-3C2 appear to need one,
  the design is wrong.
STOP-RULES — they override task completion:
* Any committed-pin movement that is not explicitly granted: ship the sound slices alone, record
  beside the rule in the spec, STOP.
* Any registry change without an owner ABI decision: STOP.
* The 16 ledger reds are the ungranted housekeeping-permission family and are red BY DESIGN. Do
  not "fix" them. D2 and the broader housekeeping permission are owner decisions.
* A real provider credential must never appear in a test, a fixture, a log, or a receipt.
LOOP, per slice, no steps skipped: baseline — smallest gap — RED tests, verified SATISFIABLE
(lint:fault-pins + confirm the fixture actually reaches the path) — independent RED review (fresh
subagent; make it patch the compiled build BOTH ways to prove the pin discriminates) — smallest
change — focused tests — TWO-SIDED GATE (pass must not drop, failing set gains no names; run it
more than once) — broader npm test when shared code changed — independent GREEN review (every
slice in batches A-D drew a real finding; send the fix delta back to the SAME reviewer for sign-off
before committing) — commit only if shippable; revert and record why if not.
MEASUREMENT DISCIPLINE:
* Classify every "this should work"/"zero movers" claim ONLY by running it. Recent refutations:
  the `as never` casts were not type-required; an emission-order probe did not generalize from
  complete to sub-complete stages; a convergence failure that looked like a timeout survived a 10x
  budget increase and turned out to be a stranded slot.
* WHEN A GATE SHOWS A ROTATING SET, run the discriminator before concluding anything about src:
  stash the new TESTS, keep the src change, rebuild, gate. Rotating sets of 8-9 names have been
  pure machine load; the src-only gate showed exactly one real mover.
* Never run the suite alongside subagents. baseline-diff refuses above 70% CPU. Below ~3.3GB free
  memory child-spawning tests die in bulk and re-pass in isolation.
* Only re-save a floor from a run where the 100-process member PASSED; discard a --save that
  caught a rotator rather than committing it.
DOCS with each slice, same commit: the spec (new rules land beside the seal; a discrepancy is
recorded, never silently resolved), REELIER-NUMBERS (§1 only if measured counts move; §2 in the
commit that moves them), GLOSSARY if a costly word emerges, and the SDD ledger row for 3C.
FINISH BY: updating the PR in its house style; pushing; REPORTING (verified branch/HEAD/dirty;
baseline before/after each slice; every pin and fault point that moved BY NAME; anything predicted
that measurement contradicted; which stop-rule or split ended the session); and drafting the next
slice's prompt from the measured state. Do NOT claim 3C or Path C complete beyond the evidence —
after 3C, Path C still has no user-facing command until Task 4 ships. If blocked, stop and report
the blocker rather than guessing.
```

---

## What comes after, and why it is not in the prompt above

**Task 4 — driver, host, ingress, CLI.** This is what gives Path C a door. Today the CLI has 35
commands and none of them is Path C; `src/cli.ts` does not import the authority module at all.
Entry condition: 3C3 at minimum, because a CLI over a lifecycle that cannot dispatch is a shell.
Realistically start it after 3C4, so the command surface can expose reconciliation rather than be
retrofitted for it. It needs its own brief — there is none today.

**The Cloud half — control plane, packs, kernels, custody, UI.** `reelier-cloud`'s own architecture
record marks all of it *designed, not shipped*, and states that managed custody "cannot precede
customer-held proof of the protocol and operational controls." That is a sequencing constraint, not
a preference: the OSS side must first prove the protocol on a customer-held kernel. Entry condition
is therefore all of 3C plus Task 4, plus `reelier-cloud#54`, which itself waits on the OSS ABI
freeze (done) and the #85 merge.

**Do not bundle these into one session.** Each is a different repo, a different reviewer, and a
different failure mode. The reason this project has stayed correct across five batches is that each
batch had one bounded scope and a stop-rule.
