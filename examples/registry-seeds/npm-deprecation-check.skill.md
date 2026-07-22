---
name: npm-deprecation-check
description: Checks whether the npm package "request" is marked deprecated on its latest published version — read-only
license: MIT
---

# npm deprecation check

Inputs: (none — replays green as-is; see the personalization note)

<!--
  Personalization: swap the literal `request` in the URL for your own
  package name to check its deprecation status instead.

  Why an agent would replay this: npm's per-version registry document
  carries a `deprecated` string when an author marked that version
  deprecated — a useful pre-install gate for a dependency-bump job.
  `request` is a famously deprecated package, chosen deliberately so this
  replay proves the deprecated branch, not just the happy path. Read-only,
  no auth.

  Endpoint verified live on 2026-07-22: 200, version "2.88.2", `deprecated`
  field a non-empty string.
-->

The assertion pins the shape (a deprecation message exists and is a
string), never its exact wording, which an author could edit.

## Steps

### Step 1 — Deprecation status of the latest published version
- intent: Fetch npm's registry document for request's latest published version and confirm it carries a deprecation notice
- action: http.get {"url": "https://registry.npmjs.org/request/latest"}
- assert: status == 200
- assert: json.name == "request"
- assert: json.deprecated is string
- bind: version = json.version
- bind: deprecated = json.deprecated
- effect: read
