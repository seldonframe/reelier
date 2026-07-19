# Reelier agent integrations

This directory makes Reelier **agent-native**: instead of only being a CLI
you type `reelier ...` at, `reelier serve` exposes Reelier's own commands
as MCP tools any MCP-capable coding agent can call mid-session. Each
subdirectory here is the glue for one agent.

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
         "args": ["-y", "@seldonframe/reelier", "serve"]
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
`npx -y @seldonframe/reelier serve`. There's no Codex-specific rules file
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
| `reelier_push` | "Sync this skill's run records to Reelier Cloud." |

See the main `README.md`'s "Use Reelier inside your coding agent" section
and `SPEC.md` §10 for the full tool contract (input schemas, honesty
rules, error shapes).
