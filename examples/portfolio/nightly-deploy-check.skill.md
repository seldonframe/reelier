---
name: nightly-deploy-check
description: Nightly gate that sweeps several routes of YOUR live deployment — 200 + a body sentinel on each — read-only
---

<!-- synced from seldonframe/reelier examples/portfolio — edit there -->

# Nightly deploy check

Inputs: (none — this file replays green as-is; see the personalization note)

<!--
  Personalization: swap the three literal https://www.reelier.com URLs for
  your own deploy URL and routes, and swap each `body contains "..."`
  sentinel for a stable string you know is on that page (a headline, a
  tagline, a nav label). The portfolio README's "Point these at YOUR
  project" section has the one-command version. The skill grammar has no
  default-value syntax for {{var}} holes — an unbound {{var}} is an explicit
  error, never a guessed fallback — so this file ships with literals that
  replay green with zero flags.

  This checks YOUR OWN deployed routes, not a third party's status page: it
  is the nightly "is my site still up AND still serving the right content"
  gate. A 200 alone isn't enough — a route can return 200 while serving a
  blank shell or the wrong build. Pairing status == 200 with a body sentinel
  catches the silent-wrong-content failure that a bare uptime ping misses.

  Pick sentinels that are STABLE run-to-run — a headline or tagline, never a
  volatile value (a date, a view count, a build hash) that flips tomorrow. A
  route that goes down, or ships a build that dropped the sentinel, fails the
  assert and the receipt records a real failure — it never silently passes.

  All three routes verified live on 2026-07-21: each 200, each sentinel
  present in the response body.
-->

## Steps

### Step 1 — Homepage is up and serving the real tagline
- intent: Confirm the homepage serves 200 and still carries its core tagline
- action: http.get {"url": "https://www.reelier.com/"}
- assert: status == 200
- assert: body contains "Snapshot tests and CI for agent workflows"
- effect: read

### Step 2 — Blog index is up with its real heading
- intent: Confirm the blog index serves 200 and still carries its heading
- action: http.get {"url": "https://www.reelier.com/blog"}
- assert: status == 200
- assert: body contains "The receipts, written out."
- effect: read

### Step 3 — Docs page is up with its real description
- intent: Confirm the docs page serves 200 and still carries its description
- action: http.get {"url": "https://www.reelier.com/docs"}
- assert: status == 200
- assert: body contains "What Reelier is, how it works, and how to use it."
- effect: read
