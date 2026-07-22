---
name: data-pull-report
description: Public ECB euro reference FX rates from the Frankfurter open-data API, bound into a small report — read-only
---

<!-- synced from seldonframe/reelier examples/portfolio — edit there -->

# Data pull report

Inputs: (none — this file replays green as-is; see the personalization note)

<!--
  The "pull data on a schedule" pattern: GET a public JSON data API and bind
  several values onto the receipt as a small report. This one hits the
  Frankfurter open-data API (the European Central Bank's euro reference
  rates) — public, no key, no auth. The reference base is the euro, so `base`
  is pinned as identity while the rates themselves are left free to move day
  to day.

  Personalization: swap the two currency codes for the ones YOUR report cares
  about — the portfolio README's "Point these at YOUR project" section has
  the one-command version. The skill grammar has no default-value syntax for
  {{var}} holes — an unbound {{var}} is an explicit error, never a guessed
  fallback — so this file ships with literals that replay green with zero
  flags.

  Endpoint verified live on 2026-07-21: 200, base "EUR", date "2026-07-21".
-->

Rates move; the report's shape doesn't. The assertions pin the shape — the
API answered 200, the base is the euro, the date looks like a date, and each
reported rate is a number — never a specific exchange value that would rot by
tomorrow. The day's numbers are bound onto the receipt (date, USD, GBP), so
every replay records the fresh values while a healthy pull stays the same
shape.

## Steps

### Step 1 — Latest euro reference rates from the open-data API
- intent: Pull today's ECB euro reference rates from the Frankfurter API and check the report shape
- action: http.get {"url": "https://api.frankfurter.dev/v1/latest?symbols=USD,GBP"}
- assert: status == 200
- assert: json.base == "EUR"
- assert: json.date matches /^\d{4}-\d{2}-\d{2}$/
- assert: json.rates.USD is number
- assert: json.rates.GBP is number
- bind: date = json.date
- bind: USD = json.rates.USD
- bind: GBP = json.rates.GBP
- effect: read