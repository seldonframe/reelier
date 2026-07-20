# Reelier for recurring loops — see it work with your own key

Reelier replays the **deterministic half** of a loop (gather the same way,
every time, 0 tokens) and leaves the **generative half** (writing, deciding)
to a model. This folder shows that split on real workflows.

> **The honest boundary:** a loop is a good Reelier fit to the exact degree it
> is *deterministic*. "Fetch the GSC/PostHog numbers" is a replay. "Write the
> blog post from those numbers" is not — that's the model's job, and Reelier
> doesn't pretend otherwise.

---

## 1. See it work in 60 seconds (no data key needed)

This uses the already-green `npm-info` skill and pushes the receipt to **your**
receipt ledger, so you watch a run appear in your dashboard.

```bash
npm i -g reelier

# Put YOUR ledger key somewhere it can be read (get it from
# https://www.reelier.com/dashboard — "Regenerate key" shows it once):
export REELIER_CLOUD_URL=https://www.reelier.com
export REELIER_CLOUD_KEY=sfr_...          # your regenerated key

# Replay a deterministic skill locally (0 LLM tokens):
reelier run examples/benchmark/npm-info.skill.md
#   ✓ Step 1 ... [passed]  ~0.5s
#   PASSED: 1/1 steps ok, 0 failed

# Push the receipt to your ledger, then open the dashboard:
reelier push
```

Open <https://www.reelier.com/dashboard> — the run is now in your ledger.
That's the whole loop: replay → receipt → ledger, on your key.

---

## 2. A real loop: the weekly PostHog pull (the "gather" half of a metrics loop)

[`posthog-weekly-pull.skill.md`](./posthog-weekly-pull.skill.md) pulls the
last-7-days event + pageview counts from PostHog. It's **BYOK** — your PostHog
personal API key is passed at run time with `--var` and goes directly to
PostHog, never to the ledger, and is never written to the skill file.

```bash
# BYOK: a PostHog *personal* API key (Bearer) + your project id.
reelier run examples/loops/posthog-weekly-pull.skill.md \
  --var posthog_key=phx_your_real_key \
  --var project_id=497925
#   ✓ Step 1 — Total events, last 7 days   [passed]
#   ✓ Step 2 — Pageviews, last 7 days       [passed]

reelier push   # receipt lands in your ledger
```

The 7-day window shifts automatically every run — `{{today-7d}}` … `{{today}}`
are Reelier's built-in computed date vars, so the *same* skill pulls a fresh
week without editing anything. The assertions check **shape, not value**
(`200` + a `results` array), because the count changes weekly but the pull
never should.

To run it every Monday untouched, that's exactly what a scheduled replay
is for (Level-0, builtin-only, behind the SSRF guard) — same
skill, no laptop required.

---

## What's a replay vs. what's a model's job

| Loop | Deterministic half (Reelier replays, 0 tokens) | Generative half (a model does, not Reelier) |
| --- | --- | --- |
| **verify-build** | run tests / `tsc` / grep the diff, assert exit-0 + sentinels | interpreting a *new* failure |
| **GSC / PostHog weekly pull** | fetch the metrics for the window (this skill) | writing the summary / deciding what to change |
| **seo-geo-loop** | fetch GSC + PostHog rows | writing the page copy |
| **content loops** | gather the sources (URLs, transcripts, data) | drafting the content |

Every row's left column is a Reelier skill waiting to be recorded. The right
column stays with your agent — that's the boundary, and keeping it honest is
why the receipts mean something.
