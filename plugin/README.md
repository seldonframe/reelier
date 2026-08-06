# Reelier plugin packages

**Generated — do not hand-edit.** Source of truth:
`integrations/claude-code/reelier/SKILL.md` (the portable Agent Skill) and
`package.json` (version). Regenerate with
`node scripts/build-plugin-packages.mjs`; drift is caught by
`test/plugin-packages.test.ts` via `--check`.

- `agent-plugins/` — [Agent Plugins v1.0.0](https://agent-plugins.org) format:
  `plugin.json` at the root plus `skills/`.
- `claude/` — Claude Code plugin format: `.claude-plugin/plugin.json` plus
  the same `skills/`.

Both packages are **skill-only by design**: no `mcp.json`, no
`reelier serve`. The MCP component is gated on the workspace-semantics
decision in `docs/specs/agent-plugins-coverage-v1.md` §3 — several `serve`
operations resolve workspace paths from `process.cwd()` (`src/serve.ts`),
while plugin hosts default a subprocess's working directory to the plugin
root; launched that way, `serve` would write compiled skills and
`.reelier` records into the plugin directory instead of the user's project.

What this plugin is: Reelier's Agent Skill, distributed. What it is not: it
does not put the Reelier wrap around any other server's writes, and
installing it does not make any write covered. Whether a given host loads
these packages is unchecked until observed per host (spec §4).
