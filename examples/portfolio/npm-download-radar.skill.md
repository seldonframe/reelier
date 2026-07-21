---
name: npm-download-radar
description: Trailing-7-day npm download count for the reelier package — shape-asserted, value-fresh, read-only
---

# npm download radar

Inputs: (none — this file replays green as-is; see the personalization note)

<!--
  Personalization: swap the one literal `reelier` at the end of the URL for
  your own package name (the portfolio README's "Point these at YOUR project"
  section has the one-command version). The skill grammar deliberately has no
  default-value syntax for {{var}} holes — an unbound {{var}} is an explicit
  error, never a guessed fallback — so this file ships with a literal that
  works with zero flags instead of a hole that fails without one.

  Endpoint verified live on 2026-07-21: 200, body
  {"downloads":263,"start":"2026-07-14","end":"2026-07-20","package":"reelier"}.
-->

The assertions check the **shape**, never the value: the count changes every
week, but a healthy pull is always a 200 with a numeric `downloads` and the
package name echoed back as a string.

## Steps

### Step 1 — Last-week downloads
- intent: Fetch the trailing-7-day npm download count for the reelier package
- action: http.get {"url": "https://api.npmjs.org/downloads/point/last-week/reelier"}
- assert: status == 200
- assert: json.downloads >= 0
- assert: json.package is string
- bind: downloads = json.downloads
- effect: read
