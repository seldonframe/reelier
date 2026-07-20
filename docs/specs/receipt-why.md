# Spec: Receipt "why" — capturing the trigger + decision behind every change

Status: PROPOSED (2026-07-19). Owner: engine (`@seldonframe/reelier`).

## 1. Motivation (from the market, verbatim)

The r/AgentsOfAI "300 hours" thread and its top comments ask, unprompted, for
exactly this:

- *"Force the agent to write receipts … log the trigger condition alongside the
  new rule. It should explicitly state, 'I am modifying my behavior because X
  just happened,' so we aren't stuck reverse-engineering its logic 200 hours
  later."*
- *"+1 on receipts, I like forcing a short 'behavior change log' entry any time
  it introduces a new rule."*

Today Reelier's receipt proves **what** happened (each step's outcome). It does
not record **why** a step changed. This spec closes that gap.

## 2. First-principles scope (what "why" means in Reelier — and what it does NOT)

The market's "why" is a *behavioral-change log*. Reelier must NOT try to be a
general diary of a novel autonomous agent's reasoning — that is **in-run
mutation**, which Reelier does not govern (see landing honesty note: Reelier is
for *recurring* workflows, record→replay→diff). Fabricating a natural-language
"why" would break the never-lies property.

So Reelier's "why" is the **mechanical, deterministically-observed** trigger and
change at the only two moments a recorded workflow's behavior actually changes:

1. **A step DRIFTS on replay** — an assertion fails / the world moved. The "why"
   is the trigger: *what diverged* (expected vs. observed), captured from the
   real failure, never guessed.
2. **A step HEALS via escalation** (L1/L2) — the "why" is the decision: *what the
   escalation changed* (the patched assertion / re-bind / step), captured from
   the real patch.

A clean, unchanged step has **no** `why` (absence, not a fabricated "nothing
changed").

## 3. Data-model change (`StepRecord`, `src/runner.ts`)

Add one optional field:

```ts
export interface StepWhy {
  /** Why this step diverged — from the real failure, e.g. "assert status==200 failed: observed 401". Present on drift. */
  trigger?: string;
  /** What healing changed — from the real L1/L2 patch, e.g. "re-bound auth token from step 1". Present on heal. */
  change?: string;
  /** The before/after of the changed assertion or value, when known. */
  from?: string;
  to?: string;
}

export interface StepRecord {
  // ...existing fields (n, title, level, outcome, ms, failures, llm?, escalationAttempted?)...
  /** Present only when this step drifted or healed; absent for an unchanged step. Never fabricated. */
  why?: StepWhy;
}
```

Because the whole `RunRecord` is stored verbatim as `record` jsonb, `why` flows
through `reelier push` → cloud → the receipt permalink/twins **for free** — no
cloud schema change required.

## 4. Where it's populated (`src/runner.ts`)

- **On assertion failure** → set `why.trigger` from the failure string + the
  assert that failed (the data is already in `failures[]`; this promotes the
  load-bearing one to a structured trigger). `from` = the asserted expectation,
  `to` = the observed value when parseable.
- **On escalation heal (L1/L2)** → set `why.change` from the patch the escalation
  applied (already computed by `src/escalate.ts`), plus `from`/`to` of the
  changed assertion/bind. This is the same information the existing **changelog
  write-back** puts into the SKILL.md — surfaced per-run in the record.

Existing `changelog` write-back convention (README "Write-back and the changelog
convention") stays the human-facing skill-file history; `why` is its
machine-readable, per-run twin.

## 5. Surfacing

- **`reelier diff`** (`src/diff.ts`): thread `why.trigger` into `StepDiff.note`
  for `outcome-changed` steps, so a DRIFTED verdict reads *"step 3 DRIFTED:
  assert status==200 failed (observed 401)"* instead of just *"passed → failed"*.
- **Receipt permalink twins** (reelier-cloud `/r/[token]/json` + `/md`):
  **EXCLUDED** (amended 2026-07-19): `why.trigger` carries failure text, which
  the public permalink deliberately never exposes (`share.ts`'s display-safe
  restriction: no failures text, no tool args). `why` stays in the pushed
  `record` jsonb for the owner (dashboard/authenticated surfaces may show it);
  the public twins keep the existing restricted shape.
- **`SPEC.md` §4**: add the optional `why` object to the run-record schema.

## 6. Honesty guards (non-negotiable)

- `why` is populated ONLY from observed engine data (real failure, real patch).
  If the engine can't determine it, `why` is **absent** — never an LLM-written
  or guessed narrative.
- No `why` on `passed`/`unchecked` steps that didn't change.
- Level-0 replay produces `why.trigger` on a failed assertion **without** calling
  a model (it's the assert result). `why.change` only appears when escalation
  actually ran (L1/L2), matching the existing token-accounting honesty.

## 7. Tests (`test/diff.test.ts`, `test/runner*.test.ts`)

- A drifted step carries `why.trigger` derived from its failure; the diff note
  includes it.
- A healed step carries `why.change` (+ `from`/`to`); a clean step has no `why`.
- A Level-0 failed-assert run populates `why.trigger` with 0 LLM tokens.

## 8. Copy payoff

Unlocks an honest, market-worded claim: **"Not just proof it ran — proof of what
changed, and why."** Delivers the thread's exact ask ("behavior change log")
without a fabricated narrative.

## 9. Non-goals

- NOT a general reasoning diary of a novel long-running agent (in-run mutation;
  out of scope).
- NOT an LLM-generated explanation (fabrication; breaks never-lies).
- NOT a new cloud table (rides the existing `record` jsonb).
