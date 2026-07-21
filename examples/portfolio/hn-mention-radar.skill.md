---
name: hn-mention-radar
description: Hacker News mention search for "reelier" via the Algolia HN API — read-only radar sweep
---

# HN mention radar

Inputs: (none — this file replays green as-is; see the personalization note)

<!--
  Personalization: swap the literal `reelier` in the query string for your
  own project name (the portfolio README's "Point these at YOUR project"
  section has the one-command version). The skill grammar has no
  default-value syntax for {{var}} holes — an unbound {{var}} is an explicit
  error, never a guessed fallback — so this file ships with a literal that
  works with zero flags.

  Endpoint verified live on 2026-07-21: 200, `hits` is an array.
-->

Zero hits is a perfectly healthy replay — the assertion is that the search
API answered with a well-formed hits array, not that anyone is talking about
you this week. The receipt's bound `mentions` count is the number worth
watching over time.

## Steps

### Step 1 — Search HN for mentions
- intent: Search Hacker News (Algolia API) for mentions of reelier and confirm a well-formed result set
- action: http.get {"url": "https://hn.algolia.com/api/v1/search?query=reelier"}
- assert: status == 200
- assert: json.hits is array
- bind: mentions = json.nbHits
- effect: read
