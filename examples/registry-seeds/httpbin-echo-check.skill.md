---
name: httpbin-echo-check
description: Request echo shape check against httpbin.org/get — read-only, useful for verifying outbound HTTP plumbing
license: MIT
---

# httpbin echo check

Inputs: (none — replays green as-is)

<!--
  Why an agent would replay this: httpbin.org echoes back exactly what it
  received — a handy zero-setup way to confirm an agent's outbound HTTP
  path (proxies, headers, egress) is working before pointing it at a real
  API. Read-only, no auth.

  Endpoint verified live on 2026-07-22: 200, url field echoes back the
  request URL, origin a well-formed IP string.
-->

The assertions pin the shape (the echoed url field, a present origin
string), never the actual IP, which depends on the caller's network.

## Steps

### Step 1 — Echo check via httpbin
- intent: Fetch httpbin's GET-echo endpoint and confirm it echoes back a well-formed request record
- action: http.get {"url": "https://httpbin.org/get"}
- assert: status == 200
- assert: json.url == "https://httpbin.org/get"
- assert: json.origin is string
- bind: origin = json.origin
- effect: read
