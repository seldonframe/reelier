---
name: openlibrary-search-shape
description: Open Library public search API shape check — read-only, no key required
license: MIT
---

# Open Library search shape

Inputs: (none — replays green as-is; see the personalization note)

<!--
  Personalization: swap the `q` query param for whatever search term your
  use case needs.

  Why an agent would replay this: Open Library's search API is a free,
  key-free book-metadata source — a useful contract check before wiring it
  into a lookup or enrichment tool. Read-only.

  Endpoint verified live on 2026-07-22: 200, numFound a non-negative
  number, docs a non-empty array.
-->

The assertions pin the shape (a numeric hit count, a well-formed docs
array), never the exact count, which grows as new editions are catalogued.

## Steps

### Step 1 — Search Open Library
- intent: Search Open Library for "the lord of the rings" and confirm a well-formed result set
- action: http.get {"url": "https://openlibrary.org/search.json?q=the+lord+of+the+rings"}
- assert: status == 200
- assert: json.numFound >= 0
- assert: json.docs is array
- bind: num_found = json.numFound
- effect: read
