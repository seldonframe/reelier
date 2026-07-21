---
name: github-repo-health
description: Public GitHub repo health pull for seldonframe/reelier — stars, open issues, identity — read-only
---

# GitHub repo health

Inputs: (none — this file replays green as-is; see the personalization note)

<!--
  Personalization: swap the literal `seldonframe/reelier` in the URL for your
  own `owner/repo` (the portfolio README's "Point these at YOUR project"
  section has the one-command version). The skill grammar has no
  default-value syntax for {{var}} holes — an unbound {{var}} is an explicit
  error, never a guessed fallback — so this file ships with literals that
  work with zero flags.

  Honesty note: this hits the UNAUTHENTICATED GitHub REST API (60 req/hr per
  IP). A rate-limited run returns 403, the `status == 200` assert fails, and
  the receipt records a real failure — it never silently passes. That is the
  intended behavior, not a flake to paper over.

  Endpoint verified live on 2026-07-21: 200, `full_name` = "seldonframe/reelier".
-->

Counts move; identity doesn't. The assertions pin the shape (non-negative
counters) and the identity (`full_name` contains `seldonframe`), never a
specific star count that would rot the day someone stars the repo.

## Steps

### Step 1 — Repo metadata and counters
- intent: Fetch public repo metadata for seldonframe/reelier and check stars/issues/identity
- action: http.get {"url": "https://api.github.com/repos/seldonframe/reelier"}
- assert: status == 200
- assert: json.stargazers_count >= 0
- assert: json.open_issues_count >= 0
- assert: json.full_name matches /seldonframe/
- bind: stars = json.stargazers_count
- bind: open_issues = json.open_issues_count
- effect: read
