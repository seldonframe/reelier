---
name: sf-post-deploy-smoke
description: Post-deploy smoke sweep of seldonframe.com core routes
---

# SF post-deploy smoke sweep

Inputs: (none for this skill; document `{{name}}` input variables here when a skill has them)

<!--
  Note: /record was excluded — it 307-redirects (to app.seldonframe.com/record),
  not a 200, so it doesn't fit this skill's "status == 200" pattern. The four
  routes below were curled live on 2026-07-17 and each sentinel string was
  verified present in the actual response body before being written here.
-->

## Steps

### Step 1 — Homepage is up and branded
- intent: Confirm the marketing homepage serves and carries the real hero headline
- action: http.get {"url": "https://www.seldonframe.com/"}
- assert: status == 200
- assert: body contains "Your entire service business, live in 3 minutes"
- effect: read

### Step 2 — Pricing page is up with the real tagline
- intent: Confirm the pricing page serves and carries the GoHighLevel-alternative tagline
- action: http.get {"url": "https://www.seldonframe.com/pricing"}
- assert: status == 200
- assert: body contains "Open-source alternative to GoHighLevel"
- effect: read

### Step 3 — Alternatives hub is up with the comparison headline
- intent: Confirm the alternatives hub serves and carries its real headline
- action: http.get {"url": "https://www.seldonframe.com/alternatives"}
- assert: status == 200
- assert: body contains "SeldonFrame vs the alternatives"
- effect: read

### Step 4 — Agencies page is up with the marketplace pitch
- intent: Confirm the agencies page serves and carries the real builder/agency pitch copy
- action: http.get {"url": "https://www.seldonframe.com/agencies"}
- assert: status == 200
- assert: body contains "list it on the marketplace"
- effect: read
