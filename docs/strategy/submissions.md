# Awesome-list and directory submission payloads (DO NOT SUBMIT — prepared for Max)

Ready-to-paste entries. Nothing here has been submitted; each target's PR/
form still needs a human to open it.

## awesome-mcp-servers

Most of these lists sort alphabetically within a category (often
"Developer Tools" or "Automation / Agent Frameworks") and want a single
line: `[Name](url) - Description.`

```
- [Reelier](https://github.com/seldonframe/reelier) - Record an MCP agent workflow once as a trace of tool calls, compile it to a SKILL.md, and replay it deterministically with zero LLM calls — escalating to an LLM only when the world has changed underneath it. AGPL-3.0.
```

Shorter variant if the target list enforces a strict line-length cap:

```
- [Reelier](https://github.com/seldonframe/reelier) - Deterministic record/replay for MCP agent workflows — zero-token replay, LLM escalation only on drift.
```

## awesome-ai-agents / awesome-llm-apps (generic "agent tooling" lists)

```
- **[Reelier](https://github.com/seldonframe/reelier)** — Agents make claims, Reelier writes receipts: record a tool-call trace once, compile it into a `SKILL.md`, replay it deterministically forever at 0 tokens, and only fall back to an LLM (BYOK, any provider) when the recorded workflow no longer matches reality. Ships with `reelier init` — a 60-second guided first run.
```

## awesome-selfhosted (if/when the "SaaS-eligible" or "cloud-optional" bucket applies)

Note: Reelier itself is a CLI + library, not a hosted service — check the
list's scope rules before submitting; the optional `reelier push` cloud-sync
feature is BYO-instance and fully opt-in, which may or may not satisfy a
given list's self-hosted criteria. Flagging this here rather than guessing.

```
- [Reelier](https://github.com/seldonframe/reelier) - Deterministic replay engine for AI agent workflows (MCP). `AGPL-3.0` `NodeJS`
```

## DevHunt submission

**Name:** Reelier

**Tagline (≤60 chars):** Agents make claims. Reelier writes receipts.

**Short description (≤200 chars):**
Record an AI agent's MCP tool-call workflow once, compile it into a
readable `SKILL.md`, and replay it deterministically forever — 0 LLM
tokens, byte-identical output, escalating to an LLM only on real drift.

**Long description:**
Agentic workflows re-reason every single run — same cost, same latency,
same chance of drift, even for a task you've already gotten right a
hundred times. Reelier fixes that for the deterministic slice of what
agents do: record a live MCP session as a trace, compile it (zero LLM
calls) into a human-editable `SKILL.md` — five atoms per step (intent,
action, assert, bind, effect) — and replay it forever at 0 tokens, sub-50ms.
When the world actually changes underneath a step, an opt-in BYOK
escalation ladder (any Anthropic-compatible or OpenAI-compatible endpoint)
patches just that step and writes the fix back to the skill file, so the
same drift never costs an LLM call twice.

Measured, not claimed: 1,000/1,000 replays byte-identical, 0 tokens/replay,
~50x cheaper and ~59x faster than a comparable agent run on our own
published benchmark (raw data in the repo).

AGPL-3.0 — the engine can never be taken closed. Your skills, traces, and
run records are your data; the license doesn't touch them.

**Website:** https://reelier.com
**Repo:** https://github.com/seldonframe/reelier
**Category suggestions:** Developer Tools, AI/ML, Productivity

**Maker comment (first-comment seed):**
Built this after watching an agent re-derive the same 3-field JSON
extraction from the same API response, at the same cost, every single
time — for a task with exactly one correct answer. Reelier is the "compile
it once you know it works" step agent tooling was missing. Level 0 (the
default) never touches an LLM at all — deterministic replay is the whole
point. Happy to answer questions about the compiler's dataflow recovery or
the escalation ladder's write-back model.
