# Changelog

All notable changes to `@seldonframe/reelier`. Dates are release dates.

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
