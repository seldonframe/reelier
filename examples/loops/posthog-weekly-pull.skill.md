---
name: posthog-weekly-pull
description: Pull last-7-days event + pageview counts from PostHog (HogQL) — the deterministic "gather" half of a weekly SEO/GEO content loop
---

# PostHog weekly pull

The deterministic half of a content/SEO loop is always the same shape:
**gather the numbers, on a schedule, the same way every time.** That half is
a Level-0 replay — identical tool calls, a shifting date window, zero LLM
tokens. The *writing* half (turning these numbers into a post) is the
generative half and is NOT in this skill — that's the part a model should do,
not a replay.

Inputs (pass at run time; nothing sensitive is stored in this file):
- `{{posthog_key}}` — a PostHog **personal API key** (Bearer). BYOK: it's
  sent directly to PostHog, never to Reelier Cloud.
- `{{project_id}}` — your PostHog project id (e.g. `497925`).

The 7-day window uses Reelier's built-in computed date vars, so the same
skill pulls a fresh week every run without editing anything:
`{{today-7d}}` … `{{today}}` (both render as `YYYY-MM-DD`).

The assertions check the **shape**, never the value — the count changes every
week, but a healthy pull is always `200` with a `results` array. That's the
whole point: deterministic steps, fresh data.

## Steps

### Step 1 — Total events, last 7 days
- intent: Count all events ingested in the trailing 7-day window
- action: http.post {"url": "https://us.posthog.com/api/projects/{{project_id}}/query/", "headers": {"Authorization": "Bearer {{posthog_key}}", "Content-Type": "application/json"}, "body": {"query": {"kind": "HogQLQuery", "query": "SELECT count() AS events FROM events WHERE timestamp >= '{{today-7d}}' AND timestamp < '{{today}}'"}}}
- assert: status == 200
- assert: body contains "results"
- bind: events = body match /"results":\[\[(\d+)/
- effect: read

### Step 2 — Pageviews, last 7 days
- intent: Count $pageview events in the same trailing 7-day window
- action: http.post {"url": "https://us.posthog.com/api/projects/{{project_id}}/query/", "headers": {"Authorization": "Bearer {{posthog_key}}", "Content-Type": "application/json"}, "body": {"query": {"kind": "HogQLQuery", "query": "SELECT count() AS pageviews FROM events WHERE event = '$pageview' AND timestamp >= '{{today-7d}}' AND timestamp < '{{today}}'"}}}
- assert: status == 200
- assert: body contains "results"
- bind: pageviews = body match /"results":\[\[(\d+)/
- effect: read
