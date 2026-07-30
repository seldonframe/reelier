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
- intent: Trigger gbrain's regex-based entity extraction on the page just captured — no LLM, no embedding keys needed (see README.md "Zero-config, except embeddings")
- action: extract_entities {"slug": "reelier-demo-page"}
- assert: status == 200
- effect: destructive

### Step 3 — Confirm extraction landed
- intent: Poll gbrain's extraction-pending state for this page — a pure read, but classified destructive by fail-closed default since gbrain declares no readOnlyHint (see the effect-classification note above)
- action: extraction_pending {"slug": "reelier-demo-page"}
- assert: status == 200
- effect: destructive

### Step 4 — Self-verify the backlink graph grew
- intent: Fetch the page's backlinks and assert the extraction actually produced at least one — the run's own punchline, not an assumption
- action: get_backlinks {"slug": "reelier-demo-page"}
- assert: status == 200
- assert: json.backlinks.length >= 1
- effect: read

## Open questions

- (none — see the HONESTY NOTE above for what this file does and does not prove)

## Changelog

- (none yet — this file has not been recorded, manifest-stamped, or approved on any machine; run the commands in README.md to do all three on your own)
- 2026-07-30 — Step 1 gains an `attest:` declaration (probe `get_page`, explicit projection `[compiled_truth]` — state-conditioned approval Stage 1, wave2 §6.1.5). The projection field name is UNVERIFIED until the dogfood loop first runs live (A15); `.github/workflows/gbrain-state-e2e.yml` is the loop that verifies it — it stamps `approve:`/`expect:` at run time in CI (per-run keystore), so this checked-in file still carries neither.
- 2026-07-30 — Step 1's `put_page` args aligned with live gbrain's op schema per the wave2 spec's Stage-0 recon (`{"slug","content"}` — the shipped `title`/`markdown` shape predated any live recording and matched no live schema). Still unverified until the e2e loop first runs green; if live gbrain disagrees, the loop fails loudly at the seed run and the correction lands here.
