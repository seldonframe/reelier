# Changelog

All notable changes to `reelier`. Dates are release dates.

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
