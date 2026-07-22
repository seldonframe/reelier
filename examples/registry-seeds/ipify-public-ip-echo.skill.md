---
name: ipify-public-ip-echo
description: Public IP echo check against the ipify API — read-only, useful for confirming outbound network identity
license: MIT
---

# ipify public IP echo

Inputs: (none — replays green as-is)

<!--
  Why an agent would replay this: a one-shot "what does the internet see as
  my outbound IP" check — useful for confirming a CI runner or agent
  sandbox's egress identity before debugging an allowlist issue. Read-only,
  no auth.

  Endpoint verified live on 2026-07-22: 200, ip a well-formed dotted-quad
  string.
-->

The assertion pins the shape (a dotted-quad IPv4 string), never the actual
address — that's the point of this replay, it's supposed to change per
runner.

## Steps

### Step 1 — Public IP from ipify
- intent: Fetch the caller's public IP from ipify and confirm it looks like a dotted-quad IPv4 address
- action: http.get {"url": "https://api.ipify.org?format=json"}
- assert: status == 200
- assert: json.ip matches /^\d+\.\d+\.\d+\.\d+$/
- bind: ip = json.ip
- effect: read
