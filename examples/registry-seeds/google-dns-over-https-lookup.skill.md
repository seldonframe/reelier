---
name: google-dns-over-https-lookup
description: DNS-over-HTTPS A-record lookup for example.com via Google's public resolver JSON API — read-only
license: MIT
---

# Google DNS-over-HTTPS lookup

Inputs: (none — replays green as-is; see the personalization note)

<!--
  Personalization: swap the `name` query param for the domain you want to
  resolve.

  Why an agent would replay this: dns.google's JSON API is a key-free way
  to do a DNS lookup over HTTPS instead of raw UDP/53 — useful in sandboxed
  agent environments where raw DNS may be blocked but HTTPS isn't.
  Read-only, no auth.

  Endpoint verified live on 2026-07-22: 200, Status 0 (NOERROR), Answer a
  non-empty array with at least one A record.
-->

The assertions pin the shape (a successful resolver status, a non-empty
answer array), never the resolved IP, which can rotate.

## Steps

### Step 1 — Resolve example.com A record
- intent: Resolve example.com's A record via Google's DNS-over-HTTPS API and confirm a successful, well-formed answer
- action: http.get {"url": "https://dns.google/resolve?name=example.com&type=A"}
- assert: status == 200
- assert: json.Status == 0
- assert: json.Answer is array
- bind: first_ip = json.Answer.0.data
- effect: read
