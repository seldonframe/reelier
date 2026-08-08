# Path C close-out prompt — four items, from the measured state at `32f293f`

Paste the block below. Everything in it was read from a command on 2026-08-08, not from memory.

---

```
You are closing out Reelier's Path C branch. Work bounded and evidence-led. Never report progress
beyond what a command shows. Every number below is a HYPOTHESIS until a command reproduces it —
this branch has now produced EIGHT wrong inherited numbers across six batches, and the last session
found the inherited DIAGNOSIS wrong in all four of its cases, not just the counts.

WORKTREE (cd into it explicitly for EVERY command — the Bash cwd silently resets after
background-task notifications, and it did so three times last session):
C:\Users\maxim\CascadeProjects\reelier\.worktrees\universal-compiled-authority
Branch codex/universal-compiled-authority. No release, no npm publish. reelier@0.31.1 is published,
main and this branch both say 0.31.1, and the N-1 guard is DISCHARGED. Do not touch it.

STEP 0 — establish where you are, because it HAS changed:
  git log --oneline -1                      -> was 32f293f
  git status --porcelain                    -> was clean
  git rev-list --count HEAD..origin/main    -> was 10. THIS IS THE BIG ONE. It was 0 last session.
  gh pr view 85 --json mergeable,mergeStateStatus,isDraft
                                            -> was CONFLICTING / DIRTY / draft:true
  npm run lint:fault-pins                   -> registry FROZEN at 84 emitted / 58 declared
  gh run list --branch codex/universal-compiled-authority --workflow CI --limit 3

STATE AT 32f293f, all to be re-derived:
  * CI run 31257309136 was GREEN ON BOTH LEGS — ubuntu 2483 pass / 0 fail with the badge gate
    passing, windows 2484 pass / 0 fail. First green in the branch's life.
  * BUT its `event` was `workflow_dispatch`. No run has fired from a PUSH since d1efbd8. See item 1.
  * fuzz 24/24 (25s). e2e byte-identical run records across two runs, sha256:1da8298b7c978efb...
    preflight's only FAIL is `version not already published`, which is a RELEASE gate and correct —
    we are not releasing.
  * Mutation has NOT been run. ~11.5h at the committed concurrency; schedule it, do not start it
    inline.

READ THESE FIRST. They are the record; do not re-derive them:
  docs/superpowers/plans/2026-08-07-gate-rotator-rootcause.md — the derived-port EACCES defect, its
    seven refuted hypotheses, and a same-day CORRECTION to its own attribution. Read the correction.
  docs/superpowers/plans/2026-08-07-d2-grant-measured.md — why no permission width ever worked
    (1/7, 6/17, 8/52) and the four-group decomposition.
  docs/superpowers/plans/2026-08-07-bindingress-lock-busy-rootcause.md — A RETRACTION. Read it for
    the reasoning error, which is still the most available mistake here.
  docs/specs/compiled-authority-v1.md — the signed contract. Two OPEN DISCREPANCY blocks were added
    on 2026-08-07 (the fence port, and the third re-fixture grant). Where spec and tests disagree,
    STOP and record beside the rule; never silently change either side.
  .claude/skills/reelier-slice — the loop. Use it for every slice.

=== ITEM 1 — merge #85. It is NOT just an admin override any more. ===
Two blockers, and the second is new:

  (a) BRANCH PROTECTION. Actions webhooks have been throttled since 2026-08-06; no push has created
      a run since d1efbd8. Every green result was produced by `gh workflow run ci.yml --ref <branch>`.
      .github/workflows/ci.yml documents, MEASURED, that a dispatched run does NOT satisfy branch
      protection: check-runs attach to the head SHA but the PR's statusCheckRollup stays 0 and
      mergeable_state stays blocked. It is a DIAGNOSTIC, never a merge escape hatch. Landing #85
      during the outage needs an ADMIN OVERRIDE — an owner action, not yours. Ask; do not attempt.

  (b) THE BRANCH IS 10 COMMITS BEHIND origin/main AND #85 IS CONFLICTING/DIRTY. This appeared during
      the last session. main gained plugin/skill work: ReelierPluginV1 local bridge, two shipped
      skills, contract/reelier-plugin.v1.*, plugin/ packages, integrations/.
      The conflict surface is exactly TWO files:
        README.md    — main's tests badge says 1664, this branch says 2483. Direct line conflict.
        package.json — both are 0.31.1, so check what actually differs before assuming.
      DO THE MERGE FIRST, then re-measure, then re-badge. The badge after merging is NEITHER 1664
      NOR 2483: main added tests (five classifier tests among them) and this branch added its own,
      so the merged Linux count is a new number that only CI's ubuntu leg can tell you. The gate is
      `if: runner.os == 'Linux'`, matching badge-check.mjs CANONICAL_PLATFORM='linux'. Your Windows
      count is one HIGHER than Linux's (skip counts differ) and preflight will tell you it cannot
      confirm the badge on this machine. Believe it.
      Expect the merge to be where regressions enter. Re-run the full suite and both CI legs after,
      not before.

=== ITEM 2 — the docs-only pin. Small, and now genuinely takeable. ===
docs/path-c-status.md:23 still reads `code pin 9666b90d838820ffcf1f8f3e58ffdb370ba34530`, which is
Task 3B1's commit, and lines 14-19 flag it as stale. NOT AGENTS.md — since 25dd32d that file is a
byte-identical twin of CLAUDE.md guarded by test/claim-guard.test.ts, and a Path C pin there breaks
the guard.
Take the pin AFTER item 1's merge, against the merged commit, or the pin names a tree that never
existed. The prose it pins is a capability summary: re-read it before pinning, because Path C's
shipped surface did not change last session — the work was tests, one src fix, and docs — so most
of that paragraph should still be true. Verify rather than assume; if a sentence is now wrong, fix
the sentence in the same commit that moves the pin.

=== ITEM 3 — the src EACCES fail-fast. APPROVED, UNBUILT, and unpinnable so far. ===
The K1 fence binds a derived loopback port (fs-ledger.ts, `20000 + u32be(sha256(canonicalRoot NUL
dev NUL ino)) % 30000`) and retries EACCES as if it were contention, burning the whole lockTimeoutMs
before returning busy. Measured: 501 of 30000 ports are OS-reserved on one ordinary Windows machine
(~1.67% of roots), and a reserved port is permanently unbindable — 3s, 30s and 90s budgets were each
consumed identically. The owner approved failing fast on EACCES.
It is not built because I could not pin it portably, and shipping an unpinned change to a
spec-governed mechanism is against the stop-rules. What was measured:
  * EACCES is unambiguous HERE: a cross-process exclusive-bind conflict reports EADDRINUSE, not
    EACCES (measured on this host). So failing fast does not break cross-process contention.
    Scope: ONE host. Re-measure before generalising.
  * It cannot be reproduced on demand — the fence validates the port into [20000, 49999], so no
    privileged port can be injected, and OS exclusion ranges differ per machine.
  * There is no test seam: withK1OperationFence takes the port from the DERIVED binding, not from
    the injectable runtime's expectedBinding, so injecting a runtime does not change what is bound.
Three honest options, all needing an owner call: add a narrow seam; write a host-conditional pin
that runs only where `netsh interface ipv4 show excludedportrange protocol=tcp` reports an
in-range exclusion and skips loudly elsewhere; or ship it unpinned with the limitation recorded.
Do NOT quietly pick the third.
Note this is a LATENCY and honesty fix, not a availability fix: a reserved port still yields an
unusable ledger, just immediately instead of after 30s per operation. The real remedy is a spec
change ("no port scan, no reuse, and no fallback" at compiled-authority-v1.md forbids a fallback),
recorded as an OPEN DISCREPANCY beside that rule.

=== ITEM 4 — three load-sensitive names. Observed, unexplained, NOT fixed. ===
Each failed exactly once in a full-suite or full-file run and passed in isolation on re-run:
  the recognized admission-preparation ON value is a no-op against the flipped default
  a concrete valid live fixed admission slot denies publication only after complete classification
  valid slot never masks malformed publication membership
The last two appeared together in one baseline run and both passed 2/2 in isolation; the re-run of
the same gate was 704/0. So the ledger gate is GREEN but not QUIET, and heavier suites (mutation
especially) will make these MORE likely, not less.
Do not "fix" them from the names. Diagnose first, and note the discriminator that worked twice last
session: run the failing thing in ISOLATION, then vary the ONE environmental knob (budget, load,
platform) and see whether the verdict moves. Budget sensitivity cracked Group D; platform difference
cracked the other three. A name that only fails in a full run and never alone is an interference
question, and the interference is what to characterise — not the assertion.

WHAT IS LOAD-BEARING AND MUST NOT BE COMPROMISED:
* FOUR-STATE HONESTY. verified / failed / unchecked / absent. An `ambiguous` outcome must NEVER
  render as a pass. Brand invariant #1.
* The registry is FROZEN at 84 emitted / 58 declared. New fault points are an ABI BREAK and an
  OWNER DECISION. Measure the complete list first, present it, get the decision.
* FORBIDDEN SCOPE: Paths A/B, runner.ts, recorder.ts, serve.ts, legacy fixtures. Needing one of
  these is a design error or a finding — stop and report it.

STOP-RULES — they override task completion:
* Committed-pin movement without an explicit named grant: STOP and ask. Three were granted last
  session (Group B's re-fixture, the six D2 re-scopes, Group D's terminal); each is recorded in its
  commit message and beside the spec rule. Follow that form.
* Registry change without an owner ABI decision: STOP.
* Merging #85 yourself, or attempting to bypass branch protection: STOP. Owner action.

MEASUREMENT DISCIPLINE — every line paid for last session:
* VERIFY ON THE OTHER PLATFORM, not just locally. Four of the last session's bugs were tests
  encoding one machine's behaviour as the contract: a hard-coded `directorySync:"best-effort"`
  (win32-only value), an nlink expectation that POSIX increments and NTFS does not, a probe path
  that breaks when TEMP and the checkout are on different Windows VOLUMES, and a pid that read
  alive on a CI runner. ALL passed locally. Local green is not green.
* READ THE CI LOG BEFORE RE-RUNNING ANYTHING. Three of those four were diagnosed entirely from a
  log already downloaded. `gh run view <id> --log` and grep `not ok`; the TAP block carries actual
  vs expected. Note the extraction trap: test NAMES can contain "not ok", so filter those out.
* A claim about a TYPE'S MEMBERS must be read from the TYPE, not from return sites.
* WHEN A VERDICT IS RETURNED RATHER THAN THROWN, probing the exception constructor finds nothing.
  Last session wasted two attempts on that; the classifier returns "corruption" as a value.
* WRITE INSTRUMENTATION PATCHES FROM A FILE, never through shell quoting — an escaped template
  literal corrupted the compiled build and cost a full rebuild to notice.
* Patch dist-test/ for experiments, NEVER src/, and restore with `npx tsc -p tsconfig.test.json`.
* Never run the suite alongside subagents. baseline-diff refuses above 70% CPU
  (REELIER_BASELINE_MAX_BUSY ?? 0.7, scripts/baseline-diff.mjs).
* A single green run is not evidence of stability. Run it three times; last session's "green" full
  suite was a coin flip that showed its other face on the third ledger run.

LOOP, per slice: baseline — smallest gap — RED tests verified SATISFIABLE — independent RED review
(fresh subagent, adversarial, grounded in file+line) — smallest change — focused tests — TWO-SIDED
GATE (pass must not drop, failing set gains no NAMES; run it more than once) — broader npm test when
shared code changed — independent GREEN review — commit only if shippable.
The GREEN review earns its place: last session's found that a pin advertised as the guard against
silent divergence caught none of the four drifts it was supposed to catch.

FINISH BY: reporting the verified branch/HEAD/dirty state; both CI legs by number; every pin that
moved BY NAME with its grant; anything predicted that measurement contradicted; and which stop-rule
or blocker ended the session. Do NOT claim Path C complete — after this branch merges it still has
no user-facing command until Task 4 ships, and src/cli.ts does not import the authority module.
```

---

## Why these four, in this order

**Item 1 first because it invalidates the others.** The branch went 10 commits behind during the
last session and #85 is now CONFLICTING. Taking the docs pin before merging would pin a commit that
never existed in the merged history, and re-badging before merging produces a number that is wrong
the moment main lands.

**Item 4 last, deliberately.** Three names failed once each and passed in isolation. That is the
weakest evidence in the whole backlog and the easiest thing to "fix" into a false green. It is also
the item most likely to matter when mutation testing eventually runs, because that run will apply
exactly the load that surfaced them.

## What this prompt does not carry forward

The four D2 groups, the fence-port rotation, Group D and the platform three are **closed**, verified
green on both CI legs at `32f293f`. They are in the record for their reasoning, not as open work.
If a future session finds them red again, that is new information — start from the commit, not from
the old hypothesis.
