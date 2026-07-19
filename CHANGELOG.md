# Changelog

All notable changes to `@seldonframe/reelier`. Dates are release dates.

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
