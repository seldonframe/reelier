---
name: gbrain-capture-enrich
description: Wrap gbrain (a Bun-only personal knowledge-brain MCP server) to capture a page, enrich it with regex-based entity extraction, and self-verify the resulting backlink graph
---

<!--
  This skill fronts gbrain (github.com/garrytan/gbrain) with
  `reelier mcp --wrap "gbrain serve"` and records the capture-then-enrich
  loop every gbrain user runs by hand: save a page, extract its entities,
  wait for extraction to land, then confirm the backlink graph actually
  grew. See ../gbrain/README.md for the full recipe, the effect-
  classification story below, and exactly what to run to reproduce this
  file's own manifest/approve stamps on your own machine.

  HONESTY NOTE — this file has NOT been recorded against a live gbrain
  instance on this machine (no Bun/gbrain install in this repo's dev
  environment). It is grammar-valid (parses, and is covered by
  test/gbrain-example.test.ts) but is NOT a replayed receipt. It carries no
  `manifest:` frontmatter key and no `approve:` step fields, because both
  are hash-bound to a real tool schema / argument template this repo cannot
  honestly produce without a live gbrain server to stamp against — faking
  either would be exactly the kind of fabricated receipt this project's
  honesty rules forbid. Run `reelier manifest` and `reelier approve` on
  your own machine (README.md walks through both) before you rely on this
  file for anything.

  Effect classification (see README.md "Fail-closed by design" section for
  the full explanation): gbrain ships NO MCP tool annotations
  (readOnlyHint/destructiveHint/idempotentHint all absent), so every step's
  `effect:` below is what Reelier's verb-based classifier
  (`classifyEffect`, src/effect-verbs.ts) actually assigns from the tool
  name alone:
    - put_page          -> idempotent-write ("put" is a recognized write verb)
    - extract_entities   -> destructive, unknown:true (no recognized verb -> rung-6 default-deny)
    - extraction_pending -> destructive, unknown:true (same rung-6 default-deny, even though this call is a pure status read)
    - get_backlinks      -> read ("get" is a recognized read verb)
  extraction_pending's over-classification is the honest cost of fail-
  closed defaults on an annotation-less server: a read gets treated as a
  write. The fix belongs upstream (gbrain's buildToolDefs should set
  readOnlyHint on its status/read tools) — see README.md's "A first PR to
  gbrain" note.
-->

# gbrain capture + enrich

Inputs: (none — `slug`/`title`/`markdown` below are literals, repeated
across all four steps rather than templated via `{{var}}`/`bind`, since
this file was authored without a live gbrain response to bind a real JSON
field from; see README.md "Personalize this" for swapping in your own page
content)

## Steps

### Step 1 — Capture a page into gbrain
- intent: Save a small page into gbrain by slug (upsert — same slug converges, but each run still adds a version row, see README.md "Idempotency honesty")
- action: put_page {"slug": "reelier-demo-page", "content": "# Reelier x gbrain\n\nThis page was captured by the reelier example skill examples/gbrain/gbrain-capture-enrich.skill.md. It links to [[Reelier]] and [[gbrain]] so entity extraction has something to find."}
- assert: status == 200
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"reelier-demo-page"},"projection":["compiled_truth"]}

### Step 2 — Extract entities from the captured page
- intent: Run gbrain's regex-based entity extraction over text attributed to the captured page (live schema: text + source_slug — remote MCP calls land the stubs in the quarantine lane, provenance auto-extracted; the text deliberately carries a person-shaped and a company-shaped name for the extractor)
- action: extract_entities {"source_slug": "reelier-demo-page", "text": "Garry Tan reviewed this demo for Reelier Inc. It links to [[Reelier]] and [[gbrain]] so entity extraction has something to find."}
- assert: status == 200
- effect: destructive

### Step 3 — Confirm extraction landed in the quarantine lane
- intent: List the unverified-stub lane and assert this page's extraction actually produced stubs attributed to it (rows carry extracted_from = source slug) — the run's own punchline, not an assumption. A pure read, but classified destructive by fail-closed default since gbrain declares no readOnlyHint (see the effect-classification note above)
- action: extraction_pending {"limit": 50}
- assert: status == 200
- assert: body contains "reelier-demo-page"
- effect: destructive

### Step 4 — Read the page's backlink graph
- intent: Fetch the page's backlinks (live behavior: QUARANTINED stubs do not write backlink rows — run 2 of the e2e proved the graph stays empty until stubs are promoted via extraction_review, so this read documents the graph as-is rather than asserting growth)
- action: get_backlinks {"slug": "reelier-demo-page"}
- assert: status == 200
- effect: read

## Open questions

- (none — see the HONESTY NOTE above for what this file does and does not prove)

## Changelog

- (none yet — this file has not been recorded, manifest-stamped, or approved on any machine; run the commands in README.md to do all three on your own)
- 2026-07-30 — Step 1 gains an `attest:` declaration (probe `get_page`, explicit projection `[compiled_truth]` — state-conditioned approval Stage 1, wave2 §6.1.5). The projection field name is UNVERIFIED until the dogfood loop first runs live (A15); `.github/workflows/gbrain-state-e2e.yml` is the loop that verifies it — it stamps `approve:`/`expect:` at run time in CI (per-run keystore), so this checked-in file still carries neither.
- 2026-07-30 — Step 1's `put_page` args aligned with live gbrain's op schema per the wave2 spec's Stage-0 recon (`{"slug","content"}` — the shipped `title`/`markdown` shape predated any live recording and matched no live schema). Still unverified until the e2e loop first runs green; if live gbrain disagrees, the loop fails loudly at the seed run and the correction lands here.
- 2026-07-30 — e2e run 2 (30534736372): steps 1–3 PASSED live (extract_entities {text, source_slug} verified). Step 4 disproved the shipped punchline: quarantined stubs write NO backlink rows (body was exactly []), so the graph-grew assert moved to step 3 (extraction_pending rows carry extracted_from = source slug) and step 4 became an as-is read of the graph. Promotion via extraction_review is the missing link — a future extension.
- 2026-07-30 — First LIVE run of the e2e loop (Actions run 30534286059) verified step 1 against real gbrain (put_page {slug, content} passed) and corrected the rest from gbrain's actual `src/core/operations.ts`: `extract_entities` takes `{text, source_slug}` not `{slug}` (remote calls land stubs in the quarantine lane); `extraction_pending` is a global `{limit, offset}` list, not per-slug; `get_backlinks` returns a BARE array of Link rows, so step 4's `json.backlinks.length` assert could never hold — replaced with the non-empty check. This is the discovery loop the wave2 spec anticipated (A15): grammar-valid is not receipted.
