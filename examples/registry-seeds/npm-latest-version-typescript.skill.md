---
name: npm-latest-version-typescript
description: Latest published version of the TypeScript compiler from the npm registry — read-only
license: MIT
---

# npm latest version — TypeScript

Inputs: (none — replays green as-is; see the personalization note)

<!--
  Personalization: swap the literal `typescript` in the URL for your own
  npm package name.

  Why an agent would replay this: the `/latest` shortcut on the npm
  registry is the cheapest possible "what version am I actually going to
  install" check — useful before a build pins a compiler or tool version.
  Read-only, no auth.

  Endpoint verified live on 2026-07-22: 200, name "typescript", version
  matches semver.
-->

The assertion pins the shape (a semver-looking string, the right package
identity), never the exact version — a new TypeScript release should not
break this replay.

## Steps

### Step 1 — Latest published version
- intent: Fetch the latest published version of typescript from the npm registry and confirm identity + a semver-looking version
- action: http.get {"url": "https://registry.npmjs.org/typescript/latest"}
- assert: status == 200
- assert: json.name == "typescript"
- assert: json.version matches /^\d+\./
- bind: version = json.version
- effect: read
