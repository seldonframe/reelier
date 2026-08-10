---
name: reelier-replay
description: Freeze a repeatable, tool-call-driven task into a replayable Reelier skill, and replay an existing skill instead of redoing deterministic work. Use after finishing a task that was mostly API/MCP tool calls (data pulls, report generation, deploy checks, CRUD sequences) — never for arbitrary coding/file-edit sessions, which Reelier cannot replay.
---

# Reelier — record once, replay forever

Reelier turns a deterministic sequence of tool calls into a `SKILL.md` file
that replays for free (zero LLM calls) instead of being re-reasoned from
scratch every time. This skill teaches you **when** to reach for it.

_written against `reelier` 0.32.x. `reelier --help` on the installed CLI is
always authoritative._

## How to run Reelier — in this order

1. **If the `reelier_*` MCP tools are connected, use them.** Structured
   results, no shell.
2. **Otherwise run the CLI:** `npx -y reelier <command>`. Nothing needs to be
   installed first.
3. **If neither is available** — no shell access and no MCP tools — say
   plainly which is missing and stop. Never describe a step as done when it
   did not run.

**The tool name is not the command name.** Two of them differ, and guessing
gets you a usage error — there is no `reelier replay` subcommand:

| MCP tool | CLI command |
| --- | --- |
| `reelier_scan` | `npx -y reelier scan` |
| `reelier_from_session` | `npx -y reelier from-session` |
| `reelier_replay` | `npx -y reelier run` |
| `reelier_push` | `npx -y reelier push` |
| `reelier_diff` | `npx -y reelier diff` |

Optional, and worth offering once: adding `reelier serve` to the user's own
project MCP config makes path 1 available and is faster than `npx` on every
call.

```json
{ "mcpServers": { "reelier": { "command": "npx", "args": ["-y", "reelier", "serve"] } } }
```

## The honesty boundary — read this first

Reelier can only replay **deterministic tool calls**: its own HTTP
builtins (`http.get`/`http.post`) and MCP server tool calls
(`mcp__<server>__<tool>`). It **cannot** replay:

- File edits (`Edit`, `Write`, `NotebookEdit`)
- Shell commands (`Bash`)
- Reads/searches (`Read`, `Grep`, `Glob`)
- Subagent dispatch (`Task`)
- Anything non-deterministic (web search results that vary, LLM-generated
  content, timestamps that aren't parameterized)

**Never tell a user "I'll replay this session for you" about a coding
session.** A session that was mostly edits and greps has nothing
replayable in it, and `reelier_scan`/`reelier_from_session` will say so
honestly (an empty result, not an error) — that's expected, not a bug.
Only offer to freeze a task when it was **actually** a sequence of API/MCP
calls: pulling data from a CRM, hitting a deploy-status endpoint, walking
a ticketing system, querying a database via its MCP server, and similar.

## When to offer freezing a skill

After finishing a task, ask yourself: *if the user (or I) needed to do
this exact sequence again next week with different inputs, would it be
the same tool calls with different arguments?* If yes, offer it:

> "That was a deterministic sequence of API calls — want me to freeze it
> into a Reelier skill so it replays instantly next time, without burning
> tokens re-reasoning through it?"

Good candidates:
- "Pull this week's numbers from PostHog and summarize them" (if the pull
  itself was tool calls, not the summarizing)
- "Check whether the last 5 deploys are green" (status-check loops)
- "Create these 10 contacts in the CRM from this CSV"
- Any recurring ops/support runbook driven through MCP tools

Bad candidates — do not offer:
- "Refactor this function" / "fix this bug" (pure code editing)
- "Investigate why X is slow" (open-ended reading/greeping)
- Anything where the *value* was your judgment, not the sequence of calls

## How to freeze one

1. Call `reelier_from_session` with the current session's transcript path
   (Claude Code writes it under `~/.claude/projects/<project>/<uuid>.jsonl`
   — if you don't know the exact path, call `reelier_scan` first to find
   it).
2. Report the result honestly:
   - **Success**: name the skill path, step/assert/bind counts, and read
     out the "Open questions" list verbatim if non-empty — those are gaps
     the compiler declined to guess about; tell the user to look at them
     before trusting the skill blindly.
   - **Nothing replayable**: say so plainly — "nothing in that session was
     a deterministic tool-call sequence Reelier can replay" — and don't
     manufacture a skill anyway.
3. Optionally call `reelier_replay` once against the new skill to prove it
   actually works before telling the user it's ready — report the real
   run record (passed/failed, per-step outcome), never an assumed pass.

## How to replay instead of redoing

Before manually re-executing a sequence of tool calls, check whether a
skill for it already exists (ask the user, check for `*.skill.md` files in
the project, or call `reelier_scan` if session history might have one).
If one exists, call `reelier_replay` with the skill path (and any
`vars`/`wrap` it needs) instead of re-issuing the calls by hand — it's
faster, costs zero tokens, and its assertions catch drift the calls
themselves wouldn't surface. Report the real run record either way; if it
fails, say so and fall back to doing the task manually rather than
pretending the replay succeeded.
