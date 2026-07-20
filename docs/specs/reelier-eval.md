# Spec: `reelier eval` — cross-variant behavioral SAME-rate (first principles + probabilities)

Status: PROPOSED (2026-07-20). Owner: engine + cloud. **Read §1 before believing the value.**

## 1. The crux, stated against ourselves (first principles)

A Level-0 **replay is deterministic and never calls a model.** So "replay a skill
under model A vs model B" is vacuous — the replay is identical regardless of
model. That kills the naive pitch.

`reelier eval` is therefore **NOT replay-based. It is re-record-based:** for each
variant it RUNS THE AGENT FRESH (which uses the model), captures the new tool-call
trace, and `diff`s that fresh recording against a frozen baseline recording. What
it measures is **agent behavioral drift** — "does the agent, using model B, still
choose the same tool calls, in the same order, with the same args, passing the
same assertions, as the baseline?"

This has two immediate, honest consequences:
- It **costs tokens** (each variant×K is a real agent run). It is not free like replay.
- Its value is a function of **how often a model upgrade actually changes the
  tool-call sequence** of a *recurring, deterministic-shaped* workflow — which is
  exactly the class Reelier targets, and exactly the class where drift is probably
  **rare**. (The escalation ladder L1/L2 also rarely fires, reinforcing that the
  model's role in a settled Reelier workflow is small.)

**So the eval is mostly going to say SAME.** That is not a bug; it changes what the
product IS (see §3).

## 2. Probabilities (where I'd bet)

- **P(cross-model drift is *frequent* on deterministic workflows): ~20%.** Your
  instinct is likely right — a competent new model reproduces a well-scoped
  tool-call sequence. Drift concentrates in looser/agentic tasks, not Reelier's core.
- **P(eval is valuable to a *single-workflow* user): ~25%.** They'd notice a break.
- **P(eval is valuable to a *fleet* operator — SF's whitelabel-agency ICP): ~75%.**
  You cannot eyeball 500 client workflows after a model bump; the tail (the 2–3
  that silently drift) is expensive and invisible without this.
- **P(the metric is genuinely unavailable elsewhere): ~90%.** No output-eval tool
  produces a structural, per-step, reproducible tool-call SAME-rate across model
  versions.
- **P(worth building *before* a fleet + an observed drift exists): low.** Value =
  (corpus size) × (model churn) × (tail cost). All three are ~0 today.

Net: **narrow, scale-dependent, tail-heavy value — real, but not the broad "measure
your agent" tool.** It's a *fleet regression gate for model upgrades*.

## 3. What it lets a user do that was impossible before / exists nowhere

Precisely one sentence: **"Across all N of my recorded agent workflows, model B
changed the observable behavior of exactly these 3 — at these steps, on these
assertions — verified and reproducible, before any reached a customer."**

- **Impossible before:** you'd eyeball two piles of logs, or LLM-judge the final
  outputs (fuzzy, expensive, doesn't localize to a step). No per-step, tool-call-
  level, deterministic diff of agent behavior across model versions, at scale.
- **Not elsewhere:** openai/evals, LangSmith, Evidently measure *output quality*
  on datasets. None measure *structural tool-call fidelity of recorded workflows
  across model versions.*
- **A second, only-Reelier fact:** nobody actually knows the real cross-model
  drift rate for tool-call workflows. The corpus **measures it.** The first
  valuable output of eval may be the answer to "does it even mess up much?" —
  a number only Reelier can produce.

Honest boundary (never oversell): SAME-rate measures **behavioral fidelity, not
answer quality.** Two models can both be SAME-rate 1.0 and one still be better.
So it is **complementary**: run SAME-rate first (structural gate), spend judge
tokens only on the DRIFTED cells. That "free gate first, judge the tail" cost
story is the one thing none of the three have.

## 4. Design (built from existing atoms — `diff` is the inner loop)

```
for each variant v in matrix:          # v = {model? | prompt/skillSha? | env?}
  for k in 1..K:
    trace_vk   = RE-RECORD(task, config=v)      # a real agent run → new recording
    skill_vk   = compile(trace_vk)              # existing compiler
    cand_vk    = replay(skill_vk)               # existing L0 replay → RunRecord
    verdict_vk = diff(baseline, cand_vk)        # existing v0.8 SAME/DRIFTED + why
  sameRate(v) = |{k: verdict_vk == SAME}| / K
```
`eval` adds **no new comparison logic** — baseline pinning + fan-out + aggregation.

**Metric (carries the honesty invariants):**
- Step SAME iff same tool ∧ same filled-arg shape ∧ same outcome ∧ same holding
  assertions ∧ equal binds. **`passed → unchecked` counts as DRIFT** (a check
  silently vanished). Richer asserts (0.11.0 value/type/pattern) make the baseline
  strong enough that SAME-rate is meaningful, not shape-only.
- SAME-rate(variant) = fraction of K re-recordings that diff clean vs the baseline.
- Free secondaries from the records: first-drift-step, per-step drift frequency,
  Δcost / Δlatency per variant.

**`EvalRecord`** (pushed verbatim like a RunRecord; new `eval_records` header table
mirrors `run_records`; each cell recording is an ordinary RunRecord ingested via
the existing `src/lib/ingest.ts` with added `eval_id`/`variant_id`/`replay_k`):
```jsonc
{ "eval":"weekly-bookings-model-bakeoff", "skill":"weekly-bookings",
  "baselineRunId":"…",
  "variants":[ { "id":"gpt6","label":"gpt-6","config":{"model":"gpt-6"},
      "replays":5, "sameRate":0.8, "firstDriftStep":3,
      "driftedSteps":{"3":1}, "p50ms":900, "tokens": 14200,
      "cells":[ {"k":1,"runId":"…","diff":{"verdict":"DRIFTED","drifts":[{"n":3,"why":"status==200 → 429"}]}} ] } ] }
```

**Surface:**
```
reelier eval <skill|task> --baseline last-green --variants variants.yaml -k 5 --push
```
Output: a `variant × SAME-rate | first-drift-step | Δcost | Δlatency` table. Because
re-recording needs the live agent, `eval` runs a recording harness (or accepts
pre-recorded traces per variant for CI). Cloud dashboard renders it as a
variant×replay grid, green=SAME/red=DRIFTED, reusing the step-chip + outcome colors.

## 5. Build trigger (do NOT build ahead of it)

Ship it the first time **both** hold: (a) the cloud corpus has ≥1 skill recorded
under ≥2 model versions, and (b) a real user asks "will the new model break my
agents?" — equivalently, the run-up to a major model release for a customer with a
*fleet* of recorded workflows. That event is the mechanism proof, the demo, and the
demand proof at once, and it tells us the real drift rate instead of guessing it.

## 6. Non-goals
- Not an output-quality / answer-correctness eval (that needs an oracle/judge).
- Not free (re-recording burns tokens; only the diff is 0-token).
- Not for single-workflow hobbyists — its value is fleet-scale + the tail.
