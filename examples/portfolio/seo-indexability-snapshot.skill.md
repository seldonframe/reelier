---
name: seo-indexability-snapshot
description: On-page SEO/indexability signals for a public page — title, meta description, canonical, Open Graph — read-only
---

<!-- synced from seldonframe/reelier examples/portfolio — edit there -->

# SEO indexability snapshot

Inputs: (none — this file replays green as-is; see the personalization note)

<!--
  Personalization: swap the literal page URL `https://www.reelier.com/skills`
  in the action for your own page (the portfolio README's "Point these at
  YOUR project" section has the one-command version). The skill grammar has
  no default-value syntax for {{var}} holes — an unbound {{var}} is an
  explicit error, never a guessed fallback — so this file ships with a
  literal that replays green with zero flags.

  Honesty note — this is NOT a rank checker. There is no free, read-only,
  unauthenticated SERP/position API, so this skill never claims to know where
  a page ranks. It checks on-page INDEXABILITY SIGNALS: the head tags that
  decide how a crawler indexes the page and how it previews when shared. The
  `body contains` asserts test the HTML exactly as the server delivered it —
  the same bytes a crawler sees before running any JavaScript — so a page
  that only injects these tags client-side after hydration will (correctly)
  fail, because a crawler wouldn't see them either.

  Endpoint verified live on 2026-07-21: 200; head carries <title>,
  name="description", rel="canonical", og:title, og:description.
-->

The assertions pin the PRESENCE of each signal (the tag marker is in the
served HTML), never its exact value — the title text and canonical URL are
bound onto the receipt instead, so re-titling the page or moving its
canonical changes the recorded values without ever breaking the replay.

## Steps

### Step 1 — Fetch the page and check its indexability head tags
- intent: GET a public page and confirm it serves the core on-page SEO signals — title, meta description, canonical, and Open Graph
- action: http.get {"url": "https://www.reelier.com/skills"}
- assert: status == 200
- assert: body contains "<title>"
- assert: body contains "name="description""
- assert: body contains "rel="canonical""
- assert: body contains "og:title"
- assert: body contains "og:description"
- bind: title = body match /<title>([^<]*)<\/title>/
- bind: canonical = body match /rel="canonical" href="([^"]*)"/
- effect: read
