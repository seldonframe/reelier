# SDD ledger reconciliation — 2026-08-06, against `codex/universal-compiled-authority` @ `533b06d`

_Run before planning Batch E, on the principle that a status document is the artifact most likely to
be present, confident, and wrong. Every status below was re-derived from a command. The findings
changed the plan: 3C is closer than the ledger said, and its guard dependency starts earlier._

**Why this lives here and not only in `.superpowers/sdd/`.** That directory is gitignored
(`.gitignore:35`). The task ledger there is local-only, unreviewable in a PR, and exists on exactly
one machine. It has been the file the batch prompts plan from. Nothing forces it to agree with the
branch, which is why it drifted. This tracked copy is the durable record; see "The one thing to
decide" at the end.

---

## Finding 1 — the 3B2 row was stale by 52 commits and misnamed its own blocker

The ledger recorded head `bc9e730` with the note "election fairness remains", and listed
"publication-stage admission fairness" as the next unfinished slice.

```bash
git log --oneline bc9e730..HEAD -- src/authority/host/fs-ledger.ts | wc -l   # 52
git log --oneline bc9e730..HEAD -- src/authority/host/fs-ledger.ts | grep 5eca255
```

`5eca255` ("admit same-process publications by ticket") landed **after** the recorded head. The
mechanism the architecture review selected — a fixed-width 64-bit monotonic/visible-maximum ticket
in the ephemeral stage name — is in `src/authority/host/fs-ledger.ts` today as
`drawK1AdmissionTicket`, `maxVisibleAdmissionTicket`, `k1AdmissionTicketFloor`, and the 16-hex
ticket field of the stage name. `task-3b2-fairness-green-report.md` and its follow-up record 254/254
on the non-stress ledger suite.

That slice's one recorded open risk was the deliberately unexecuted 100-process stress gate. It is
**discharged**: 3 of 3 passes measured 2026-08-06 post-flip on a quiet machine (~21–22 s each).

**What is actually outstanding for 3B2 is procedural, not code:**

1. No independent review verdict exists for the fairness slice. Tasks 1, 1A and 2 each have
   `task-*-review-*.md` files; `ls .superpowers/sdd/universal-compiled-authority/ | grep task-3b2-review`
   returns nothing.
2. The final docs-only pin was never taken. `AGENTS.md` still reads
   ``code pin `9666b90d838820ffcf1f8f3e58ffdb370ba34530` ``, which is **3B1's** product commit.

## Finding 2 — 3C is closer than the ledger implied, and the guard binds earlier

The ledger said 3C was "blocked on reviewed 3B2 plus guard package for final verifier slice". Both
halves are off. From `task-3c-brief.md` itself:

- *"Blocked until Task 3B2 has an independently approved product commit and final docs-only pin."*
  That is a review and a pin — the two items in Finding 1 — not the code slice the ledger implied.
- *"No provider write or credential access exists before Slice 3C3."* So the N-1 guard package binds
  from **3C3**, not only at the final verifier slice.

**Therefore: 3C0, 3C1 and 3C2 are unblocked as soon as 3B2 is reviewed and pinned.** They need no
guard package. The six slices are 3C0 freeze execution-evidence protocol, 3C1 evidence-bound ledger
v5, 3C2 pre-dispatch revalidation and durable refusal (no driver), 3C3 sealed driver boundary and
terminal result evidence, 3C4 read-only reconciliation, 3C5 portable derivation and authority-aware
verifier.

## Finding 3 — the N-1 guard is the only item with irreducible external latency

`task-nminus1-guard-brief.md` exists and is specified: the smallest release descendant of published
`reelier@0.30.0` that safely precedes Path C, built in a **separate clean worktree** off
`946d7f171930343d1db0640171cc592cdc2ee05c`, classifying any own top-level `v` as an
unsupported-version failure so it rejects `reelier.authority-receipt/v1` and every unknown versioned
record, while preserving every legacy byte for records with no own `v`.

It must be *"both conformance-tested and actually published or otherwise distributed with the user's
authorization."* Publishing is an owner act. Everything else remaining on Path C is code under our
control; this is the one item whose duration cannot be compressed by working harder, and it gates
3C3 through 3C5. **It should start now, in parallel, not when 3C3 starts.**

> **DISCHARGED 2026-08-07 — `reelier@0.31.1` is published, dist-tag `latest`.** The base and version
> were rebased from the brief's `0.30.1`/`946d7f1` because npm published `0.31.0` before execution;
> the brief permits exactly that and names the invariant instead of the number, so the guard is now
> N-1 to a first authority-aware `0.32.0`. Verified against the artifact **downloaded back from
> npm**, not the local pack: versioned, future-versioned, and signature-sibling records are all
> REFUSED with exit 1 and print zero legacy claim rows, while a legacy record's stdout is
> byte-identical to published `0.31.0`. The unsafe control was measured too — published `0.31.0`
> exits 0 and prints a confident legacy verdict for a record it cannot read, which is the failure
> this release removes.
>
> **Two items outstanding on the release itself:** it carries no git tag, so the released source is
> identifiable only from the report; and `codex/nminus1-guard` is pushed but unmerged, so `main` is
> behind the published `latest`.
>
> **Consequence for the plan:** 3C is no longer gated by the guard at any slice. Its only remaining
> blocker is 3B2's independent review and docs-only pin.

## Finding 4 — the batch A–D substrate work had no row in the ledger at all

A reader of `progress.md` would not have learned that K1 admission preparation is now active by
default. It was recorded only in PR #85 and `docs/superpowers/plans/`. Summarised:

| Item | Status | Evidence |
|---|---|---|
| Ledger-lock fault ABI | **FROZEN**, 58 lock / 125 public, backlog 0 | `npm run lint:fault-pins` → 84 emitted / 58 declared |
| Creator-withdrawal chain, W1 window, dead-owner routes | complete (B–C) | reviewer's 82-cell crash matrix, zero wedged cells |
| Dead-stage withdrawal route | complete (`f971054`) | closed the S4 re-spec class-3 wedge; `:1020` flipped, named |
| **S4 — K1 active by default** | **DONE AND CERTIFIED** (`bc21407`) | 654/50 → 688/16, zero newly failing, 32 greens identical to prediction; both contention gates 3/3 |
| Phase 3 — option re-fixture and retirement | **pending** | ~30 fixtures still construct `{mode:"legacy"}` |

Current aggregate at `533b06d`: ledger **688 pass / 16 fail**; full `npm test` **2,331 / 20 / 1**.
The 16 ledger reds are the ungranted housekeeping-permission family, red by design. Two gate members
re-confirmed as load flakes this pass, failing in a bulk run then passing alone at 8.9 s and 6.6 s on
normally-fast tests — the documented load-timeout signature.

## What this changes about the plan

The critical path is **not** "finish a fairness slice". It is:

1. Review 3B2's fairness slice and take the docs-only pin. Small, and it unblocks 3C0–3C2.
2. Start the N-1 guard package in parallel, because only it has external latency.
3. Phase 3 (re-fixture, then retire the option), before 3C fixtures inherit the ambiguity.
4. 3C0 → 3C5.
5. Task 4 (driver, host, ingress, CLI) — still entirely pending, and nothing above is reachable by a
   user without it.
6. Full Paths A/B regression before the merge.

## The one thing to decide

`.superpowers/` is gitignored, so the task ledger is untracked, unreviewable, and single-machine —
while being the file batch prompts plan from. That guarantees recurrence of exactly this drift.
Options: (a) un-ignore `.superpowers/sdd/*/progress.md` specifically, keeping the per-slice reports
ignored as the briefs require; (b) keep the ledger local and treat this tracked directory as
authoritative for status; (c) leave it and re-reconcile before each batch. (a) is the smallest change
that removes the failure mode, because it puts status where review can see it without disturbing the
"ignored report" convention.
