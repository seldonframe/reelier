---
name: gbrain-verify-promoted
description: Read-only companion to gbrain-capture-enrich — after the OWNER promotes the quarantined stubs on the host machine, verify the promotion took and the backlink graph actually grew
---

<!--
  The second half of the quarantine story. gbrain's extraction_review op is
  owner-only BY DESIGN (localOnly: if a remote caller could promote,
  injected content could self-promote and the quarantine lane would be
  decorative) — so promotion can never be a step in a wrapped skill. It
  happens on the host machine:

      gbrain extraction-review promote --slugs people/garry-tan,companies/reelier-inc

  and THIS skill is the receipted read that proves what the promotion
  changed: the stub is now a verified page, and the backlink graph of the
  source page grew — the punchline gbrain-capture-enrich originally
  claimed, restored on the honest side of the trust boundary. Every step
  here is a read; replaying it re-fires nothing.

  Effect classification: both tools are "get" verbs → read (see the main
  example's effect-classification note for the fail-closed story).
-->

# gbrain verify promoted

Inputs: (none — slugs are literals matching gbrain-capture-enrich's
extraction text: "Garry Tan" → people/garry-tan, "Reelier Inc." →
companies/reelier-inc, per gbrain's slugifyEntity convention)

## Steps

### Step 1 — The stub is a real page now
- intent: Read the promoted person stub — before promotion it sat in the quarantine lane; after, it reads back as a page whose status the owner has verified
- action: get_page {"slug": "people/garry-tan"}
- assert: status == 200
- assert: body contains "garry-tan"
- effect: read

### Step 2 — The backlink graph grew
- intent: Fetch the source page's backlinks and assert the list is non-empty — the original capture-enrich punchline, now honestly reachable because the owner reviewed the stubs (live behavior, e2e run 2: quarantined stubs write no backlink rows; promotion is what makes the graph visible)
- action: get_backlinks {"slug": "reelier-demo-page"}
- assert: status == 200
- assert: body not contains "[]"
- effect: read

## Open questions

- Whether promotion materializes backlink rows retroactively or extraction wrote them pre-filtered is gbrain-internal — this skill only asserts the observable outcome. If the graph stays empty even after promotion, step 2 fails loudly and the finding lands in the changelog (discovery loop).

## Changelog

- 2026-07-30 — authored as the promotion companion; UNVERIFIED against live gbrain until `.github/workflows/gbrain-state-e2e.yml`'s promotion stage first runs green (same A15 discipline as the main example).
