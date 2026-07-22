---
name: release-radar
description: Newest published GitHub release for seldonframe/reelier — dependency-release watching, read-only
---

<!-- synced from seldonframe/reelier examples/portfolio — edit there -->

# Release radar

Inputs: (none — this file replays green as-is; see the personalization note)

<!--
  Personalization: swap the literal `seldonframe/reelier` in the URL for the
  `owner/repo` of a dependency YOU rely on (the portfolio README's "Point
  these at YOUR project" section has the one-command version). The skill
  grammar has no default-value syntax for {{var}} holes — an unbound {{var}}
  is an explicit error, never a guessed fallback — so this file ships with
  literals that work with zero flags.

  Why this is not registry-latest: that skill asks the npm registry "what is
  the current dist-tag?"; this one asks GitHub "what release did the
  maintainer actually cut?". A tag can exist before it's published to npm,
  and many dependencies you watch never ship to npm at all — this is the
  upstream signal.

  Honesty note: this hits the UNAUTHENTICATED GitHub REST API (60 req/hr per
  IP). A rate-limited run returns 403, the `status == 200` assert fails, and
  the receipt records a real failure — it never silently passes. The
  /releases/latest endpoint excludes drafts and prereleases by definition, so
  a green run always reflects a real published release.

  Endpoint verified live on 2026-07-21: 200, `tag_name` = "v1".
-->

The tag moves; the shape doesn't. The assertions pin that a release exists
(`tag_name` is a non-empty string) and carries a real numeric id, never a
specific version that would rot the day the maintainer cuts the next release.

## Steps

### Step 1 — Latest published release from GitHub
- intent: Fetch the latest published GitHub release for seldonframe/reelier and check it has a tag and a numeric id
- action: http.get {"url": "https://api.github.com/repos/seldonframe/reelier/releases/latest"}
- assert: status == 200
- assert: json.tag_name matches /.+/
- assert: json.id >= 0
- bind: release = json.tag_name
- bind: published = json.published_at
- effect: read