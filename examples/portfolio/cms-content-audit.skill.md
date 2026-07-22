---
name: cms-content-audit
description: Read-only content audit of a public sitemap — well-formed urlset, not truncated, canonical URL still present
---

<!-- synced from seldonframe/reelier examples/portfolio — edit there -->

# CMS content audit

Inputs: (none — this file replays green as-is; see the personalization note)

<!--
  Personalization: swap the literal host `www.reelier.com` for your own
  domain — one sed pass rewrites BOTH the sitemap URL and the canonical-URL
  assertion, since both carry the same host (the portfolio README's "Point
  these at YOUR project" section has the one-command version). Then make the
  `body contains "<loc>...</loc>"` assertion name a URL you KNOW is always in
  your sitemap (your homepage, a pillar page). The skill grammar has no
  default-value syntax for {{var}} holes — an unbound {{var}} is an explicit
  error, never a guessed fallback — so this file ships with literals that
  replay green with zero flags.

  This is the "did my published content break" audit, not a freshness radar.
  It reads the sitemap the way a crawler would and pins the invariants that
  must never quietly break: the response is a real urlset (not an HTML error
  page), the document arrived whole (the closing tag is present, so it wasn't
  truncated mid-stream), and a canonical URL is still enumerated (a regen that
  silently drops your homepage fails here instead of in Search Console weeks
  later).

  Endpoint verified live on 2026-07-21: 200, application/xml, 73 <loc>
  entries, `<loc>https://www.reelier.com/</loc>` present.
-->

Content moves; structure and canonicals don't. The assertions pin the SHAPE
(it's a urlset, it's complete, the homepage is in it) and bind the first
enumerated URL onto the receipt — never a specific URL count that would rot
the day a new page ships.

## Steps

### Step 1 — Sitemap is a complete urlset with the canonical URL present
- intent: Fetch the public sitemap and confirm it is a well-formed, untruncated urlset that still enumerates the homepage
- action: http.get {"url": "https://www.reelier.com/sitemap.xml"}
- assert: status == 200
- assert: body contains "<urlset"
- assert: body contains "</urlset>"
- assert: body contains "<loc>https://www.reelier.com/</loc>"
- bind: first_url = body match /<loc>([^<]+)<\/loc>/
- effect: read
