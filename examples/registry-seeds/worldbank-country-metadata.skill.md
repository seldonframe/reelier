---
name: worldbank-country-metadata
description: World Bank public country-metadata API shape check for the United States — read-only, no key required
license: MIT
---

# World Bank country metadata

Inputs: (none — replays green as-is; see the personalization note)

<!--
  Personalization: swap the `USA` country code in the URL for any ISO-3
  country code.

  Why an agent would replay this: the World Bank's country API is a free,
  key-free reference source for country metadata (region, income level,
  capital) — a useful contract check before wiring it into an enrichment
  tool. The response is a two-element array: [pagination-meta, data-array].
  Read-only.

  Endpoint verified live on 2026-07-22: 200, second array element's first
  entry has id "USA" and a capitalCity string.
-->

The assertions pin identity and shape, never anything that would drift —
country metadata like this changes only on the rare occasion a capital or
region classification is redefined.

## Steps

### Step 1 — Country metadata from the World Bank API
- intent: Fetch World Bank country metadata for the United States and confirm identity + shape
- action: http.get {"url": "https://api.worldbank.org/v2/country/USA?format=json"}
- assert: status == 200
- assert: json.1.0.id == "USA"
- assert: json.1.0.capitalCity is string
- bind: name = json.1.0.name
- bind: capital = json.1.0.capitalCity
- effect: read
