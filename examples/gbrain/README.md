# gbrain wrap — record, approve, replay a knowledge-brain write with receipts

[gbrain](https://github.com/garrytan/gbrain) is a personal knowledge-brain
MCP server: you write pages into it, it extracts entities, and it builds a
backlink graph between them. This recipe fronts gbrain with `reelier mcp
--wrap`, records the capture-then-enrich loop every gbrain user runs by
hand, and replays it deterministically with a receipt.

Files here:

- [`gbrain-capture-enrich.skill.md`](./gbrain-capture-enrich.skill.md) — the
  recorded/authored skill (grammar-valid, covered by
  [`test/gbrain-example.test.ts`](../../test/gbrain-example.test.ts); **not**
  yet recorded against a live gbrain instance — see "What's validated / not"
  below).
- [`gbrain-replay.yml`](./gbrain-replay.yml) — a scheduled-replay GitHub
  Actions workflow variant, for a repo that wants gbrain drift caught on a
  cron instead of (or in addition to) a PR.

## Prerequisites — gbrain is Bun-only

gbrain's `package.json` declares `"engines": {"bun": ">=1.3.10"}`, its
entrypoint is `#!/usr/bin/env bun`, and its server is built directly on
`Bun.serve`/`Bun.file` — there is **no npm publish**, and it will not run
under plain Node. This is the single most common first-attempt failure, so
say it up front: install Bun first, then gbrain from GitHub, not npm.

```sh
curl -fsSL https://bun.sh/install | bash   # or: your platform's Bun installer
bun install -g github:garrytan/gbrain
```

## Zero-config, except embeddings

```sh
gbrain init --pglite --no-embedding
```

`--pglite` gives you an embedded Postgres 17.5 (WASM) with no external
database to stand up. **`--no-embedding` is not optional for this
example** — `gbrain init` with no embedding keys configured and no TTY
attached (exactly the shape of a CI runner, or this recipe's non-interactive
setup) exits 1. This example's one step that touches text
(`extract_entities`) is regex-based entity extraction, not LLM-backed, so
it needs no embedding keys at all — `--no-embedding` is simply honest about
that, not a workaround.

PGLite is WASM Postgres and has a live breakage history on macOS Tahoe as
of this writing — don't take "zero-config" as an unconditional promise on
every platform; if `gbrain init --pglite` fails to start, that's gbrain/PGLite
upstream, not this recipe.

## Wrap it

```sh
MCP_STDIO=1 reelier mcp --wrap "gbrain serve"
```

`MCP_STDIO=1` is required defensively: gbrain treats the end of its stdin
stream as a shutdown signal unless this is set, and a wrapping gateway
(exactly what `reelier mcp --wrap` is) can end up closing/reopening stdin in
ways that would otherwise kill gbrain mid-recording. Set it every time you
wrap gbrain, not just for this example.

From here, follow the normal record → compile → replay loop
([main README](../../README.md#how-to-use-it)):

```sh
reelier mcp --wrap "MCP_STDIO=1 gbrain serve"   # record your own trace
reelier compile .reelier/traces/<your-trace>.jsonl
```

Or replay the skill already authored here directly:

```sh
reelier run examples/gbrain/gbrain-capture-enrich.skill.md --wrap "gbrain serve" --allow-writes
```

(`--allow-writes` is required the first time because this shipped skill
file carries no `approve:` stamps — see "The write gate" below for why you
should add them on your own machine instead of relying on the flag.)

## The flow

`put_page` (capture) → `extract_entities` (enrich) → `extraction_pending`
(wait for the enrichment to land) → `get_backlinks` with
`assert: json.backlinks.length >= 1` as the run's own punchline — the skill
proves, on every replay, that the entity extraction it just triggered
actually grew the backlink graph, not just that the calls returned 200.

One practical constraint baked into the skill: `put_page`'s body is kept
small deliberately. On Windows, `reelier mcp --wrap`'s stdio pipe to a
wrapped MCP server has a practical limit around 45KB per message — a page
capture with a large `markdown` body can hit that ceiling. Keep captured
pages small for this example, or chunk larger content across multiple
`put_page` calls in your own skill.

## Fail-closed by design — the effect-classification story

gbrain ships **no MCP tool annotations** at all (`readOnlyHint` /
`destructiveHint` / `idempotentHint` are absent from every tool it
advertises). Reelier's effect classifier
(`classifyEffect`, [`src/effect-verbs.ts`](../../src/effect-verbs.ts)) falls
back to matching verb tokens in the tool name, and when nothing matches, it
defaults to the most restrictive rung — `destructive`, flagged `unknown:
true` — rather than guessing read. Concretely, for gbrain's four tools:

| Tool | Verb token matched | Classified effect |
| --- | --- | --- |
| `put_page` | `put` (idempotent-write verb) | `idempotent-write` |
| `extract_entities` | none recognized | `destructive` (rung-6 default-deny) |
| `extraction_pending` | none recognized | `destructive` (rung-6 default-deny) |
| `get_backlinks` | `get` (read verb) | `read` |

`extraction_pending` is the interesting case: it is a pure status **read**
— it doesn't touch anything — but because "pending" isn't a verb Reelier's
classifier recognizes, it lands on the same fail-closed default as an
unrecognized write would. That is the honest cost of a strict trust ladder
on a server with zero annotations: a read gets over-classified as a write.
It is a real cost (this step needs `--allow-writes`/`--yes`, or an
`approve:` stamp, to execute at all), but the alternative — guessing read
for an unrecognized verb — is exactly the failure mode that would let a
real write slip past the write gate on some *other* unannotated server. When
in doubt, Reelier costs you coverage, never safety margin.

**A first PR to gbrain:** the fix belongs upstream. gbrain's own
`buildToolDefs` (wherever it constructs its MCP `tools/list` response)
could set `readOnlyHint: true` on `extraction_pending` (and any other
genuinely read-only tool) — that's a small, contained change with an
immediate payoff for every Reelier user (or any MCP-aware client) wrapping
gbrain, since a `readOnlyHint` tightens Reelier's classification of a
read-verb match and refines an otherwise-unrecognized one, without ever
being able to downgrade a real write.

## Idempotency honesty

`put_page` **converges**: capturing the same slug twice ends with the same
page content, an upsert by slug. But it is not silently free to repeat —
gbrain also appends a new version row on every capture, so replaying this
step N times leaves N version rows behind even though the page itself
looks the same. `extract_entities` similarly converges on the page's
extracted entities, but internally calls `addTimelineEntry` — and that
timeline **compounds**, not converges: every replay adds another entry,
forever, with no upsert semantics at all.

This is the concrete, gbrain-specific justification for the write gate
rather than a blanket `--allow-writes` flag: `reelier approve
gbrain-capture-enrich.skill.md --all` hash-binds each write step's tool +
argument template, so it replays with **no flag needed at all** — but only
after a human has actually looked at what's being approved once, which is
exactly the moment to notice "wait, this step appends a timeline entry on
every single run" before wiring it into a recurring cron. `--allow-writes`
makes that same decision blind, every run, forever.

## Rehearsal without touching anything

Two independent ways to rehearse this skill with zero real gbrain writes:

1. **`reelier run ... ` with no `--allow-writes`** — the standard replay
   write-gate (§3.6 of [`SPEC.md`](../../SPEC.md)) refuses every
   `idempotent-write`/`destructive` step outright and reports an honest
   `"failed"` outcome for it, without calling the tool.
2. **gbrain's own undocumented `dry_run: true` param.** gbrain's dispatch
   layer reads a `dry_run` key off any tool call's args (confirmed against
   gbrain's `dispatch.ts:217`) and, when true, executes the call in a mode
   that returns `{dry_run: true, action: ...}` instead of performing the
   real side effect — its own arg validator ignores unrecognized keys, so
   this works even though `dry_run` isn't in any tool's declared schema.
   That means you can add `"dry_run": true` to any of this skill's write
   steps' action args and get a **live-connection rehearsal** — it still
   talks to your real gbrain instance and exercises the real MCP round
   trip, it just never persists anything.

Label #2 for what it is: **undocumented upstream behavior**, read directly
from gbrain's source rather than any published API contract. It may change
or disappear in a future gbrain release with no notice — don't build a
permanent CI gate on it without re-verifying against whatever gbrain
version you're pinned to.

## Manifest drift is a certainty — stamp one

gbrain releases fast (`v0.42.67.0` as of this writing) — a schema for
`put_page`/`extract_entities`/`extraction_pending`/`get_backlinks` that's
accurate today is not guaranteed to be accurate on your next `bun install
-g` of gbrain. Stamp a manifest against your own live instance and let
Reelier's manifest preflight (§6.1b of `SPEC.md`) fail closed on drift
instead of silently replaying against a schema that's moved out from under
the skill:

```sh
reelier manifest examples/gbrain/gbrain-capture-enrich.skill.md --wrap "gbrain serve"
```

## Approve the writes

Once you've reviewed what each write step actually does (see "Idempotency
honesty" above), stamp per-operation approval so replays never need
`--allow-writes` again — and so a future *change* to the tool or its
arguments forces a fresh, deliberate re-approval instead of silently
replaying under a stale blanket flag:

```sh
reelier approve examples/gbrain/gbrain-capture-enrich.skill.md --all
```

## Receipts + system of record

`gbrain sync` writes gbrain's tracked directories to disk as plain
markdown inside a git repo. That means a scheduled replay's Reelier receipt
and gbrain's own page diff can land in the **same commit** — one commit
that says both "here's what changed in the knowledge brain" and "here's
the receipt proving the replay that produced it ran cleanly." Add
`reelier push` after a passing replay for a permalink to that receipt in
your ledger.

## Honest constraints

- **Reelier Cloud's scheduled replay product is http.\*-only.** If a skill
  needs a `--wrap`'d MCP server (this one does), Reelier Cloud's own
  scheduler reports it `supported: false` — scheduled MCP-backed replays
  are not a hosted feature today. `gbrain-replay.yml` in this directory
  works around that the straightforward way: it's a plain GitHub Actions
  cron workflow running the OSS `reelier` CLI directly, which has no such
  restriction.
- **Remote `extract_entities` calls land in gbrain's quarantine lane.**
  Provenance is auto-extracted and the resulting entities carry `status:
  unverified` — `trusted_extraction` is ignored for remote (non-local)
  callers. A CI-triggered replay is a remote caller. This is gbrain's own
  design, not something Reelier changes or can bypass.
- **PGLite has a live breakage history on macOS Tahoe** (see
  "Zero-config, except embeddings" above) — treat the zero-config claim as
  conditional, not universal, and check gbrain's own issue tracker if
  `gbrain init --pglite` fails to start on your machine.
- **This example's shipped `.skill.md` has not been recorded, manifest-
  stamped, or approved on any real gbrain instance.** See the file's own
  HONESTY NOTE comment. Every command above is what you'd run to make that
  true on your own machine — this repo doesn't have Bun or gbrain
  installed, so it can't do that step for you.

## What's validated here / what isn't

**Validated:** `gbrain-capture-enrich.skill.md` parses with Reelier's real
`parseSkill` ([`src/skill.ts`](../../src/skill.ts)), and
[`test/gbrain-example.test.ts`](../../test/gbrain-example.test.ts) pins its
step count, tool names, and effect classifications (including the
`destructive`/`unknown` rung-6 classification of `extract_entities` and
`extraction_pending`) as part of this repo's own test suite — so a future
edit to this file, or a future change to `classifyEffect`, can't silently
drift these documented facts without a test failing.

**Not validated:** no live recording against a real gbrain instance
happened on the machine that authored this example (no Bun/gbrain install
in that environment). The skill file's action args (page slug, title,
markdown body) are illustrative, not captured from a real `put_page`
response — which is exactly why the file carries no `manifest:` stamp and
no `approve:` hashes (both require a real recording to produce honestly).
Reelier's honesty rule is that a receipt proves scope and change, never
correctness — the same rule applies here one level up: this README and
skill file describe what the recipe *should* do and prove it parses, not
that it has been run.
