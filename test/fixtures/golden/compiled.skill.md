---
name: golden-demo-skill
description: Compiled from golden-trace.jsonl (3 calls) on <NORMALIZED_DATE>
recorded_with: reelier v<NORMALIZED_VERSION>
---

# golden-demo-skill

Inputs: none — every bound value below was recovered automatically from a prior step's result.

## Steps

### Step 1 — bind the created account id for later steps
- intent: bind the created account id for later steps
- action: create_account {"name":"Golden Demo Co"}
- assert: status == 200
- effect: idempotent-write

### Step 2 — fetch the account's public status page
- intent: fetch the account's public status page
- action: http.get {"url":"https://status.example.com/acct_golden_0001"}
- assert: json.accountId is set
- assert: status == 200
- bind: accountId = json.accountId
- effect: read

### Step 3 — assert the fetched status is healthy
- intent: assert the fetched status is healthy
- action: assert_status {"accountId":"{{accountId}}","expected":"ok"}
- assert: status == 200
- effect: read

## Open questions

- (none)

## Changelog

- <NORMALIZED_DATE> — compiled from golden-trace.jsonl (3 calls, 3 steps)

_Recorded with [Reelier](https://reelier.com/?utm_source=skill-md) — replay: `npx -y reelier run golden-demo-skill.skill.md`_
