# Reelier — when to use it

Reelier (via the `reelier` MCP server, started with `reelier serve`) can
freeze a deterministic sequence of tool calls into a replayable
`SKILL.md`, then replay it later for zero LLM calls.

**Honesty boundary**: Reelier only replays deterministic API/MCP tool
calls — never file edits, shell commands, or other non-deterministic
agent actions. Don't offer to "replay" a coding/editing session; it has
nothing replayable in it, and Reelier will honestly report an empty
result rather than fabricate a skill.

**Offer freezing a task** after finishing one that was mostly a repeatable
sequence of API/MCP tool calls (data pulls, status checks, CRUD sequences,
ops runbooks): call `reelier_from_session` on the current session
transcript and report the real result honestly — skill path + stats, or
"nothing replayable found." Surface any "Open questions" the compiler
flagged before trusting the skill.

**Replay instead of redoing**: before manually re-executing a familiar
tool-call sequence, check for an existing `*.skill.md` and call
`reelier_replay` instead. Report the real run record either way.

**Setup** — add to your MCP config:

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

`reelier serve` (this tool-server) is a different command from `reelier
mcp` (the recorder that fronts other MCP servers, used to capture a
session) — don't confuse the two.
