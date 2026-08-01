# Reelier agent integrations

This directory makes Reelier **agent-native**: instead of only being a CLI
you type `reelier ...` at, `reelier serve` exposes Reelier's own commands
as MCP tools any MCP-capable coding agent can call mid-session. Each
subdirectory here is the glue for one agent.

## The skill file works in more clients than its directory name suggests

`claude-code/reelier/SKILL.md` is a plain **Agent Skill** — the open format
originally published by Anthropic, now supported by a large and growing number
of agent clients (Claude Code, Cursor, Copilot, VS Code, Codex, Gemini CLI,
OpenCode, Goose, Letta, Factory, Amp, Kiro, Roo Code, and many more; see
[agentskills.io](https://agentskills.io) for the current list and the format
spec).

Nothing in that file is Claude-Code-specific. It lives under `claude-code/`
because that is where it was first written, and the path is kept so existing
links and `curl` commands do not break. **Any client that loads Agent Skills
can use it** — the install path is the only thing that differs:

| Client | Where the skill goes |
| --- | --- |
| Claude Code | `~/.claude/skills/reelier/SKILL.md` (user) or `.claude/skills/reelier/SKILL.md` (project) |
| OpenClaw | via clawhub — see `clawhub/reelier/SKILL.md`, which carries OpenClaw install metadata |
| Others | each client documents its own skills directory; the file itself is unchanged |

Two things worth knowing before you copy it around:

- **The `description` field is the whole trigger.** Agent Skills load by
  progressive disclosure: at startup a client reads only `name` and
  `description`, and pulls the body in only when a task matches. If the
  description does not say *when* to reach for Reelier — and, just as
  importantly, when not to — the skill never fires.
- **This is not a Reelier `*.skill.md`.** The Agent Skill is prose a model
  reads; a Reelier skill file is a deterministic program the runner executes
  with no model involved. Same word, different artifacts — SPEC.md §0.4 states
  the distinction normatively. `reelier compile --from-skill` converts the
  first into the second: your skill, minus the model.

Cursor's `.mdc` and Windsurf's rules file are genuinely different formats and
are maintained separately below.

**Role split, worth repeating everywhere**: `reelier serve` is the
tool-server that exposes Reelier's own commands (`reelier_scan`,
`reelier_from_session`, `reelier_replay`, `reelier_push`). It is a
*different* command from `reelier mcp`, which is the recorder — it fronts
your *other* MCP server(s) so their calls get captured into a trace. Don't
confuse the two when wiring things up.

## Claude Code

1. Add the MCP server (project `.mcp.json` or user `~/.claude.json`):
   ```json
   {
     "mcpServers": {
       "reelier": {
         "command": "npx",
         "args": ["-y", "reelier", "serve"]
       }
     }
   }
   ```
2. Drop `claude-code/reelier/SKILL.md` (this directory) into
   `~/.claude/skills/reelier/SKILL.md` (user-level, all projects) or
   `.claude/skills/reelier/SKILL.md` (project-level). This is what teaches
   Claude Code *when* to reach for the tools — freeze a task after a
   deterministic tool-call sequence, replay before redoing one, never
   claim to replay a coding session.
3. Restart Claude Code. Confirm the tools are visible with `/mcp` or by
   asking it to list available MCP tools.

## Cursor

1. Add the MCP server to `~/.cursor/mcp.json` (or your project's
   `.cursor/mcp.json`) — same JSON block as above.
2. Copy `cursor/reelier.mdc` into your project's `.cursor/rules/` directory
   (Cursor's project-rules mechanism). It's a thinner variant of the
   Claude Code skill's guidance, in Cursor's `.mdc` rule format.

## Windsurf

1. Add the MCP server to Windsurf's MCP config (Windsurf Settings → MCP
   Servers, or `~/.codeium/windsurf/mcp_config.json` depending on
   version) — same JSON block as above.
2. Copy the contents of `windsurf/reelier.md` into your Windsurf rules
   (global rules or a project `.windsurfrules` file, depending on how your
   version organizes rules).

## Codex / other MCP-capable agents

Any agent that can connect to a local MCP server over stdio can use
`reelier serve` the same way — point its MCP config at
`npx -y reelier serve`. There's no Codex-specific rules file
here yet; the Cursor/Windsurf variants above are close enough to adapt by
hand, or use `claude-code/reelier/SKILL.md` as the fullest reference for
the "when" guidance.

## What you get

Once connected, the agent can call:

| Tool | Use |
| --- | --- |
| `reelier_scan` | "What in my session history could I turn into a replayable skill?" |
| `reelier_from_session` | "Freeze this session's tool calls into a SKILL.md." |
| `reelier_replay` | "Run this skill and tell me if it still passes." |
| `reelier_push` | "Sync this skill's run records to your receipt ledger." |

See the main `README.md`'s "Use Reelier inside your coding agent" section
and `SPEC.md` §10 for the full tool contract (input schemas, honesty
rules, error shapes).
