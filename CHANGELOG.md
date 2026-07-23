# Changelog

All notable changes to `reelier`. Dates are release dates.

## 0.20.0 — Trust ladder: signing, timestamps, request-id refs, CI attestation

Breaking behavior: **none — every field below is an optional sibling of the
existing push payload.** An older cloud (or a caller that never opts in)
sees no difference at all; nothing here is on by default except refs
(automatic, allowlist-only, omitted when nothing was captured).

A receipt asserts several *independent* claims, each provable to a
different grade — this release adds the OSS-side rungs. See README's
"Trust ladder" section for the full table and `docs/specs/trust-ladder-v1.md`
for the normative spec (spec wins over the code on any conflict).

### Added
- **`reelier init --signing`.** Generates (or, on a re-run, prints — never
  regenerates) a local Ed25519 keypair at `~/.reelier/signing/` via
  `node:crypto` (zero new deps). `keyId` = first 16 hex chars of
  sha256(public key DER).
- **`reelier push` signs.** When a signing key exists, every pushed record
  carries `signature: {alg:"ed25519", keyId, sig}` — computed over
  `digestSha256(record)` for the EXACT bytes serialized into the payload
  (after any push-time stamping), never an earlier shape of the record. No
  key configured → the field is simply omitted; an unsigned push is never
  shamed.
- **`reelier push <skill.md> --timestamp`.** Requests an RFC-3161 trusted
  timestamp (default TSA: freetsa.org, override via `REELIER_TSA_URL`) over
  each record's own digest and attaches `timestamp: {tsa, token}`.
  Fail-open: any TSA failure (network, non-2xx, malformed response) never
  blocks the push — the record just ships without a timestamp, one stderr
  line explaining why.
- **Request-id refs.** `http.get`/`http.post` capture an allowlist of
  provider request-id response headers (`request-id`, `x-request-id`,
  `x-amzn-requestid`, `x-amz-request-id`, `x-goog-request-id`,
  `stripe-request-id`, `cf-ray`); MCP-wrapped tools capture an exact-match
  allowlist of top-level JSON body keys (`request_id`, `requestId`,
  `x_request_id`) from a single-JSON-body result. Threaded onto
  `StepRecord.refs` for ANY executed step (not just writes) — omitted when
  nothing on the allowlist was found. Passes through the existing
  redaction rules like everything else that ends up in a receipt.
- **CI attestation (GitHub Actions).** When a workflow grants
  `permissions: id-token: write`, `reelier push` automatically requests a
  GitHub OIDC token (audience `reelier.com`) and attaches
  `ciAttestation: {provider:"github-actions", token}`. Absent the
  permission (or outside Actions entirely) → omitted, nothing said — a
  laptop push is never treated as lesser.
- **`reelier verify <permalink|file> [--key <pub.pem>]`.** Recomputes the
  record's digest and prints per-claim lines — never a bare OK:
  `unaltered-since-push` (verified / **✗ SIGNATURE INVALID** / unsigned /
  signed-but-no-key-given) and `timestamped` (imprint ✓ / **✗ IMPRINT
  MISMATCH** / none). Exit code is 0 unless a claim that's actually
  *present* failed verification — an absent or unchecked claim never
  fails the exit code.
- The bundled GitHub Action's documented workflow snippet
  (`.github/workflows/reelier-replay.example.yml`) now shows
  `permissions: id-token: write` on the job, with a comment explaining
  what it buys.

## 0.19.0 — Flight recorder v2: manifest, approval, mocked failures

Breaking behavior: **none — every addition below is additive.** Every
pre-0.19.0 skill and run record parses and behaves exactly as before. The
one new fail-closed check (approval-mismatch refusal) applies **only** to a
write/destructive step that already carries an `approve:` field — a step
without one keeps today's exact `--allow-writes`/`--yes` behavior.

### Added
- **`reelier manifest <skill.md> --wrap "..."`.** Stamps a per-tool schema
  digest (sha256 over the tool's `inputSchema`) onto the skill, for every
  tool its steps actually use. `reelier run --wrap ...` preflights the
  stamped manifest against the live servers BEFORE step 1 executes and fails
  closed — `MANIFEST DRIFT — refusing to replay` — on any missing tool or
  schema mismatch. `--ignore-manifest` is the explicit break-glass override
  (stamped as `manifestIgnored: true` on the run record — never silent). A
  skill with no manifest gets an advisory note only; nothing is required.
- **`reelier approve <skill.md> [--all]`.** Hash-binds approval to one
  write/destructive step's exact tool + argument template (`{{placeholders}}`
  intact) — the FINAL boundary a write crosses before it executes on replay.
  An approved step whose tool/args still match executes with no flags at
  all; if they've drifted since approval, replay fails closed —
  `Approval mismatch` — and **no flag overrides that refusal**
  (`--allow-writes`/`--yes` do not apply once a step carries `approve:`).
- **Write receipts.** Every step whose tool call actually dispatched a
  write-effect (`idempotent-write`/`destructive`) now carries a `write`
  block: `idempotencyKey` (tool + filled args + server), `approved` (via
  hash vs. via the legacy flags), a best-effort `resource` (`id`/`version`
  extracted from a JSON response body, honestly omitted otherwise), and
  `duplicateOf` when an earlier step in the same run wrote the identical
  key. `reelier run` prints one summary deprecation note when any write
  executed via the legacy flags rather than a per-step approval.
- **`reelier run <skill.md> --fail N[=status]`.** Injects a synthetic failed
  Observation at step `N` (default status `500`, override with `--fail
  N=429`, repeatable) instead of dispatching that step's real tool call —
  the mocked failure flows into the same assert/bind evaluation and, on
  divergence, the same real escalation ladder a genuine failure would hit.
  A mocked step never consults the write/approval gates (there's no side
  effect to guard) and never gets a `write` receipt. Prints a `MOCK RUN —
  injected failures at step(s): ...` banner and a per-step `⚡ INJECTED
  failure` line.
- **`reelier push` refuses mock runs.** A run record carrying any injected
  failures (`RunRecord.mockFailures`) is a local recovery test, never a real
  receipt — pushing the whole batch is refused with a structured error
  naming the step(s), before any fetch call. No `--force`/`--all` override.

## 0.18.0 — The flight recorder

### Added
- **Policy seatbelt.** `.reelier/policy.yml` (or `~/.reelier/policy.yml`)
  deny-lists and dry-runs tool calls at the wrap chokepoint — enforced in
  the recorder, not the prompt, so the agent can't be talked out of it.
  Denied calls return a structured policy error; dry-runs return synthetic
  success marked DRY-RUN and never forward. `reelier policy check` lints
  the file. Endpoint rules match literal URLs in tool args (apex-or-
  subdomain semantics); rules that match no wrapped tool warn at start.
  Fail-open with a visible gap marker — a policy problem never bricks
  your agent, and never hides.
- **The $ meter.** `reelier cost [skill] [--since 7d|30d|all]` prices your
  recorded runs from actual token counts — bundled table verified against
  provider pricing pages (2026-07-22), overridable via
  `~/.reelier/prices.yml`. Unknown model → honest "n/a", never a guess.
  Receipts gain optional `costUsd` + `priceTableDate`.
- **Import sessions from any agent.** `from-session`/`scan` now parse
  Codex CLI and OpenClaw session logs (formats verified against upstream
  sources), alongside Claude Code. Cursor/Windsurf are detected and
  reported honestly (undocumented SQLite — no guessed parser).

## 0.17.0 — MIT

### Changed
- **License: AGPL-3.0 → MIT**, from this version forward. Use Reelier
  anywhere, embed it in anything — no copyleft obligations, no legal
  review needed. Versions ≤0.16.0 remain AGPL-3.0 as released. The moat
  was never the code; it's the receipts.

## 0.16.0 — Publish in one flag, fetch your own

### Added
- **`reelier push <skill> --public`.** Publish a skill to the reelier.com
  registry in one command — triage grades it and either lists it instantly
  (read-only) or queues it for review. Prints `Listed: <url>` /
  `Pending review (usually within 2 business days): <url>` / the honest
  fallback if the cloud can't mint a link. Missing `license:` surfaces the
  server error and exits non-zero.
- **`reelier get --mine <name>`.** Fetch your OWN private skill from the
  cloud — "push here, fetch anywhere you're logged in," zero public
  exposure. Sha-verified before write, same collision semantics as public
  `get`; the trust block marks it as your private copy. Never executes.
- **Run receipts now carry `skillContentSha256`** (the sha256 of the exact
  skill bytes that produced the run), so a shared receipt can be tied to a
  registry listing by content — the basis for the registry's cross-tenant
  "someone else ran this" signal. Optional; older clouds ignore it.

### Fixed
- `get <missing>` (and every `get` error path) now exits non-zero for CI.

## 0.15.0 — Get skills from the registry

### Added
- **`reelier get <owner>/<skill>`.** Fetch a published skill from the
  reelier.com registry — latest listed version by default, or pin with
  `@<N>` / `@sha256:<hex>`. The CLI verifies the content hash against
  the registry's `contentSha256` before writing anything; a mismatch
  writes nothing and errors loudly. Lands at `./skills/<skill>.skill.md`
  (`--dir` overrides); identical content is a no-op, different content
  is a hard error unless `--force`. After writing it prints the trust
  block — effect grade, per-step effects, endpoints, license, content
  hash — and the next command. WRITES-graded skills print the
  replay-re-executes warning. `get` never executes anything.

## 0.14.0 — Receipts you can hand to someone

### Added
- **`reelier push --share`.** Pushing with `--share` mints a public receipt
  permalink (same mint path as the dashboard's Share button) and prints it
  plus the copy-paste badge markdown
  (`[![reelier](<badge>)](<receipt>)`). Without `--share`, push stays
  private and prints the dashboard ledger URL with a one-line tip — no
  receipt is ever made public implicitly. If share is requested but the
  cloud returns no link (older cloud, mint failure), the CLI says so
  explicitly instead of staying silent.
- **SKILL.md provenance.** Compiled skills now carry
  `recorded_with: reelier v<version>` in frontmatter and a single footer
  line linking back to reelier.com with the replay one-liner, so a skill
  file found in the wild explains how to run it. Heal write-backs insert
  changelog bullets above the footer — it stays the file's last line.

### Fixed
- **Entrypoint guard resolves symlinks.** `cli.ts` now compares
  `import.meta.url` against `pathToFileURL(realpathSync(argv[1]))`, so
  invocation through npm's `.bin` symlinks (`npx reelier`, global
  installs) runs `main()` correctly. Guarded by a junction/symlink
  regression test.

## 0.13.0 — Annotation trust ladder + the self-measuring scan

### Added
- **MCP annotation consumption.** The recording proxy captures each wrapped
  tool's `tools/list` annotation hints (`readOnlyHint` / `destructiveHint` /
  `idempotentHint`) into the trace `meta` record (`toolAnnotations`, keyed by
  exposed tool name; omitted when nothing is annotated — see SPEC §2.2).
  `classifyEffect` consumes them via a strict trust ladder:
  `destructiveHint` always wins → destructive verb match → idempotent-write
  verb match → read verb match (`idempotentHint` may tighten it) →
  `readOnlyHint`/`idempotentHint` refine unrecognized verbs → unknown stays
  destructive + flagged. An annotation NEVER downgrades a verb-list match — a
  server's `readOnlyHint: true` on `create_note` cannot exempt it from
  `--allow-writes`. Hints, not security: replay write-gating
  (`--allow-writes`) still applies to everything `idempotent-write` or worse.
  The runner's MCP tool adapter now shares this exact classifier, so the
  compiler and the adapter can never disagree.
- **Wrap onboarding in `reelier init`.** Init now closes by offering
  `reelier install` as the recommended next step: "Wrap captures lossless
  traces (tool annotations included) — scan-from-history is a
  reconstruction; wrap is the recording." Interactive TTY: an explicit y/N
  (default N — the config is never modified without an explicit yes);
  non-TTY (or `--yes`): the exact `reelier install` one-liner is printed
  instead of a prompt.
- **Backup-or-abort guard.** `reelier install` (and init's inline offer)
  now refuses to rewrite a config when the pre-write backup itself cannot
  be written — the install aborts with an honest error and the config is
  left byte-identical.
- **Self-measuring scan KPI.** `reelier scan` (and the `reelier_scan` MCP
  tool, as `replayableRate`) now reports
  `Replayable rate: X/Y sessions fully read-only (Z%)` plus
  `N session(s) blocked ONLY by unknown-verb tools (top blockers: ...)` —
  the blocker list names exactly which verbs to consider classifying next.
- **Empirical verb audit** (run against a real 2,334-session history):
  read gains `count retrieve tail preview ping health browse glob grep stat
  stats head exists info summarize screenshot logs`; idempotent-write gains
  `mark upload embed patch append sync`; destructive gains `spawn exec eval
  evaluate start stop clear push rotate finalize`. Deliberately left out
  (write sense exists): `resolve`, `watch`, `snapshot`, `meta`, `context`,
  `navigate`. On that history the audit collapsed "blocked only by
  unknown-verb tools" from 494 sessions to 6 — 488 of them contained real
  writes now classified confidently instead of flagged as unknown.
- **Compiler variable-extraction polish** (flag-only throughout — no new
  auto-substitution; exact-match dataflow binds are unchanged):
  - An array-element bind (`json.items.2.id`) now asks the concrete
    stability question — "is element [2] positionally stable across runs,
    or should this select it by a field match (e.g. the element whose
    id/name matches)?" — with the candidate fields read from the recorded
    element's own scalar keys (identifying names like `id`/`name` first).
  - Date-heuristic hardening: impossible calendar dates (`2026-02-30`, a
    non-leap `2026-02-29`) are flagged "not a real calendar date" instead of
    receiving offset math fabricated from the `Date.UTC` roll-over; a
    datetime literal's suggestion keeps its time suffix verbatim
    (`"{{today-7d}}T09:30:00Z"` — `{{today±Nd}}` resolves date-only); a
    non-UTC offset that lands on a different UTC calendar day gets an
    explicit which-day note; "1 day" is singular.
  - The same date/UUID/timestamp literal appearing in 3+ steps now flags
    ONCE with the full step list ("appears in steps 2, 4, 7 — one
    variable?") instead of per-step duplicates (SPEC §6.5).

## 0.12.1 — MCP registry metadata

### Added
- `mcpName` in package.json + a `server.json` manifest, so Reelier can be listed in the official
  MCP registry as `io.github.seldonframe/reelier`.

## 0.12.0 — Cleaner install: the package is now `reelier`

### Changed
- **The npm package is now `reelier`** (was `@seldonframe/reelier`) — install with
  `npm i -g reelier`. The `reelier` command, the skill / trace / receipt formats,
  and every flag are unchanged; only the install name is shorter. The old scoped
  package is deprecated with a pointer to the new name.
- Standalone-OSS polish: removed hosted-product marketing from the README, CLI,
  and integrations so the repo reads as a self-contained tool. `reelier push` and
  the receipt ledger remain available as an opt-in.

### Added
- `reelier --version` / `-v` prints the version; `reelier --help` / `-h` prints usage.

## 0.7.1 — Replay-worthiness, not just replay-mechanics

`scan` and `from-session` now tell you which discovered workflows are actually
worth replaying — not just which ones Reelier *can* re-issue.

### Added
- **`reelier scan`** shows each session's effect split — `X replayable
  (Y read-only · Z side-effectful)` — ranks read-only sessions (the ideal
  replay targets) first, tags side-effect-heavy ones `⚠ side-effectful`, and
  headlines how many are read-only. (On a real 2,307-session history: 556
  replayable, but only **5** read-only.)
- **`reelier from-session`** warns after compiling when a skill contains
  side-effectful steps (`create/update/delete/write`) — replaying re-executes
  those side effects — or confirms `✓ all N steps are read-only — safe to
  replay repeatedly`. It never blocks the compile; it just tells the truth.

### Why
"Replayable" proves Reelier *can* re-issue a call, not that you *should*
replay it — a `create_scheduled_task` call is replayable-shaped but would
re-create the task every run. This reuses the same effect classifier that
already keeps destructive steps off the escalation ladder.

## 0.7.0 — Use Reelier inside your coding agent

`reelier serve` starts an MCP tool-server that exposes Reelier's own commands
as tools any MCP-capable agent (Claude Code, Cursor, Windsurf, Codex) can call
mid-session — so the agent itself can turn a repeatable workflow into a
replayable skill, or replay one instead of redoing it.

### Added
- **`reelier serve`** — an MCP server exposing four tools: `reelier_scan`,
  `reelier_from_session`, `reelier_replay` (**Level-0 only** — a tool-server
  call can never trigger LLM/BYOK spend), and `reelier_push` (explicit
  `ok`/`skipped-no-key`/`failed` outcomes, never a silent success). It is the
  deliberate opposite of `reelier mcp` (the recorder that fronts *other* MCP
  servers); the distinction is documented in both commands' `--help` and
  SPEC.md §10.
- **`integrations/`** — a distributable Claude Code skill that teaches the
  agent *when* to reach for Reelier (freeze deterministic tool-call workflows;
  replay existing skills instead of redoing them; never promise to replay a
  coding/editing session), plus thinner Cursor (`.mdc`) and Windsurf rules
  variants and per-agent install steps.

### The honesty rule still holds
Only deterministic tool-call workflows are replayable. A `reelier_scan` /
`reelier_from_session` over a session with nothing replayable returns an honest
empty/skip result — never a fabricated skill — and `reelier_replay` returns the
actual run record, pass or fail.

## 0.6.0 — Record from your agent's history

The recording already happened. Your agent (Claude Code, and any tool that
writes a session transcript) logs every tool call it makes — Reelier can now
compile a replayable skill straight from that log, with no proxy to set up and
no task to redo.

### Added
- **`reelier from-session <transcript.jsonl>`** — compile a `SKILL.md` from an
  agent session transcript you already produced (e.g. Claude Code's
  `~/.claude/projects/*/*.jsonl`). Feeds the same deterministic compiler as a
  recorded trace.
- **`reelier scan [--dir]`** — walk your whole agent history, find every
  session that contains a replayable workflow, and pick which ones to turn into
  skills (`--yes` for all).
- **`reelier install`** / **`reelier uninstall`** — auto-wrap your MCP config so
  recording *future* workflows is one phrase ("record this" … "done"). Backs up
  the original first, is idempotent (never double-wraps), and is fully
  reversible.

### The honesty rule (unchanged, and enforced here)
Only deterministically-replayable calls are compiled: the `http.get`/`http.post`
builtins and `mcp__<server>__<tool>` calls. Native editor/shell tools (Bash,
Read, Edit, Write, Grep, Glob, Task, WebFetch, …) are **reported skipped with a
reason, never fabricated into a skill**. A session with zero replayable calls
compiles nothing and says so, rather than emitting an empty or fake skill.
Level-0 replay still calls no model, by construction.

## 0.5.0 — First receipt in 60 seconds

- **`reelier init`** — guided record → compile → replay → receipt in ~60s
  (zero-setup demo, or record against your own MCP server).
- Escalation ladder (`--max-level 1|2`) — an LLM patches one broken step only on
  real divergence, then writes back to the skill; destructive steps never
  escalate.
- BYOK LLM surface — any OpenAI-compatible endpoint (OpenRouter, Ollama, Groq,
  vLLM, LM Studio, Kimi/Moonshot, …) or the native Anthropic Messages API;
  the key is only used, and only checked, when a step actually escalates.
- Recorder (lossless MCP proxy), deterministic compiler (`reelier compile`),
  and run receipts (`reelier push` to Reelier Cloud, opt-in).
