---
name: unpkg-package-metadata
description: package.json shape check for the vue package served through the unpkg CDN — read-only
license: MIT
---

# unpkg package metadata

Inputs: (none — replays green as-is; see the personalization note)

<!--
  Personalization: swap the literal `vue` in the URL for your own npm
  package name.

  Why an agent would replay this: unpkg serves the exact package.json a CDN
  consumer would get — confirms the CDN path is resolvable and the file
  looks like a real package manifest, independent of the npm registry API.
  Read-only, no auth.

  Endpoint verified live on 2026-07-22: 200, name "vue", license "MIT".
-->

The assertions pin identity and shape (name, license present, a
semver-looking version), never the exact version number.

## Steps

### Step 1 — package.json via unpkg
- intent: Fetch the vue package.json through unpkg and confirm identity + license fields
- action: http.get {"url": "https://unpkg.com/vue/package.json"}
- assert: status == 200
- assert: json.name == "vue"
- assert: json.version matches /^\d+\./
- assert: json.license is string
- bind: version = json.version
- effect: read
