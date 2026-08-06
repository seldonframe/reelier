# Agent Plugins coverage v1 — Spec

_Drafted 2026-08-06, against `origin/main` @ `4ee9ba0` (0.30.0, published) and Agent Plugins
v1.0.0 (agent-plugins.org, read 2026-08-06). **Everything in §2–§5 is proposed, not built** —
CLAUDE.md §8 discipline applies until a CHANGELOG entry says otherwise. §1's documentation lands
with the PR that carries this file; nothing else in this spec exists in code._

_research: ~/CascadeProjects/research/2026-08-06-agent-plugins-wrap-coverage/_

**One sentence:** Agent Plugins creates a portable distribution channel for MCP servers and Agent
Skills; servers delivered through it sit outside Reelier's observed boundary, and the honest
response is to document that boundary now, observe it per host as inventory (never completeness),
distribute a skill-only plugin first, and never mutate a vendor-owned plugin directory to chase
coverage.

---

## 0. The facts this spec stands on

1. **Agent Plugins v1.0.0** (announced 2026-08-06; developed by Amazon/AWS, Cursor, Microsoft,
   OpenAI, Vercel; launch clients: ChatGPT & Codex, Cursor, GitHub Copilot, Kiro, VS Code —
   Anthropic absent) defines a plugin as a directory: `plugin.json` + `skills/` + `mcp.json` +
   namespaced client-extension dirs. Normative, from `spec/1.0.0.md`: *"Clients that support MCP
   servers MUST load configuration only from `mcp.json` at the plugin root"*; clients *"map this
   portable format to their native configuration."* How any individual host routes those servers
   internally is that host's business and is **unobserved** until §4 says otherwise. Hooks,
   commands, and agents are excluded from v1 — no portable interception point exists.
2. **Claude Code plugins already use a plugin-owned load path**
   (code.claude.com/docs/en/plugins-reference, read 2026-08-06): plugin MCP servers live in
   "`.mcp.json` in plugin root, or inline in plugin.json," "configured independently of user MCP
   servers."
3. **What `install` inspects on `4ee9ba0`:** the configs in `knownMcpConfigPaths`
   (`src/init.ts`) — Claude Code project/user, Cursor project/user, Windsurf user. Deliberately
   excluded, with reasons in the same comment block: Codex's `~/.codex/config.toml` (TOML;
   `planInstall` writes JSON) and VS Code's `.vscode/mcp.json` (nests under `servers`). The wrap's
   only client transport is stdio (`src/mcp-client.ts`); `install` skips `url` entries
   (`src/wrap.ts:119`).
4. **Codex observed on one Windows machine, 2026-08-06** (treat as hypothesis until reproduced
   elsewhere): `[mcp_servers.*]` tables in `config.toml`, plus a live plugin system —
   `[marketplaces.*]`, `[plugins."<name>@<marketplace>"]` enable flags, payloads under
   `~/.codex/plugins/` and marketplace cache dirs.

## 1. The boundary, stated — lands with this PR

> Reelier `install` wraps MCP entries it finds in supported host configuration files. It does not
> inspect plugin-owned MCP manifests. Plugin-delivered calls are therefore outside Reelier's
> observed boundary unless the plugin itself invokes `reelier mcp --wrap`, or the host exposes the
> entry through a supported configuration and Reelier subsequently rewrites it. Reelier currently
> has no native wrapping path for URL-based MCP servers. Receipts attest only calls that traversed
> Reelier; they do not prove that every host or plugin write was observed.

This wording is the canonical statement. It appears, matching, in: CLAUDE.md §7.6,
`docs/REFERENCE.md`, `docs/integration-tiers.md` ("What no tier does"), and
`docs/security/threat-model.md` §3.7 — all in this PR. (`AGENTS.md` is not tracked on `main`; the
on-disk copy is kept in sync with CLAUDE.md by hand.)

## 2. Observed-coverage probe — `reelier coverage --host codex` (proposed)

Read-only. Writes nothing, edits no configuration, vendor-owned or otherwise. Codex first: it is
outside `install` entirely (§0.3), so it is the clearest test of whether Reelier can report
coverage honestly without pretending to enforce it.

**Inspects:** Codex `config.toml` MCP entries; enabled-plugin registrations; discovered plugin
`mcp.json` / `.mcp.json` files; whether each stdio command demonstrably invokes
`reelier mcp --wrap`; URL-based servers, reported as **"no native Reelier wrap path."**

**Vocabulary — two independent fields per finding:**

- **Location:** `parsed` | `unreadable` | `absent`
- **Server routing:** `wrapped` | `unwrapped` (a routing claim only — never enforcement, never
  "safe"; the seatbelt behind a wrapped entry can still be fail-open, CLAUDE.md §7.4)

Routing is judged by reading the entry, never by assumption: a hand-written Codex entry fronting
`reelier mcp --wrap` — the printed line `src/init.ts`'s own comment points Codex users at — must
report `wrapped`.

**Output rules:** every run names the locations actually inspected. Observed totals are permitted
when the denominator is named ("4 of 5 entries in `~/.codex/config.toml` parsed"); an overall
coverage percentage is not calculated. Every output ends with:

> Observed inventory only; this is not proof of completeness.

**Required cases:** missing configuration; malformed/unreadable TOML; hand-wrapped stdio entry;
unwrapped stdio entry; URL-based entry; enabled plugin with MCP servers; disabled plugin; plugin
registration whose payload cannot be located.

Prior Codex-shaped code: `src/scan.ts:82-83` (sessions dir), `src/session-formats.ts:106+`
(rollout format), `src/discovery.ts`. Other hosts follow the same shape later; each host's plugin
topology is empirical (§4).

## 3. Distribution: Reelier as an Agent Plugin — skill-only first (proposed)

**Phase one is a skill-only plugin: `plugin.json` + `skills/` carrying the existing Reelier
skill. No `mcp.json`, no `reelier serve` — yet.**

The reason is workspace semantics, not caution for its own sake. Agent Plugins clients use the
plugin root as the default subprocess working directory (client-implementers conformance,
agent-plugins.org, read 2026-08-06), while several `serve` operations resolve workspace-sensitive
paths from `process.cwd()`: compiled-skill output (`src/serve.ts:158`), run records
(`src/serve.ts:232`), `.reelier/` state (`src/serve.ts:393`). Launched from a plugin root, `serve`
would place compiled skills and `.reelier` records inside the plugin directory instead of the
user's project — evidence written to the wrong place, the opposite of the product's promise.

Before adding the MCP component, design and pick one:

1. Require explicit absolute `cwd`/`out` arguments for every workspace-sensitive tool in plugin
   mode.
2. Add a reliable client-provided workspace-root mechanism.
3. Introduce `reelier serve --workspace <path>`, with the host supplying the path at launch.

The standard-format and Claude-format packages are generated from shared source — never two
handwritten copies. Claims discipline regardless of phase: the plugin distributes Reelier's own
tools and guidance; it does not put the Path A seatbelt around any other server's writes.
"Install the plugin and your writes are covered" is a forbidden sentence.

## 4. The verification gate — no universal claims

| Host | plugin loads | `mcp.json` honored | skills visible | tool naming observed |
|---|---|---|---|---|
| Codex | unchecked | unchecked | unchecked | unchecked |
| ChatGPT | unchecked | unchecked | unchecked | unchecked |
| Cursor | unchecked | unchecked | unchecked | unchecked |
| GitHub Copilot | unchecked | unchecked | unchecked | unchecked |
| Kiro | unchecked | unchecked | unchecked | unchecked |
| VS Code | unchecked | unchecked | unchecked | unchecked |

A cell flips only on an observed run, recorded with date and host version. Public claims quote
observed cells and name the host; "works with Agent Plugins hosts" as a universal is banned until
observed per host. Local reality at spec time: Codex installed (§0.4), Cursor absent, others
untested.

## 5. Non-mutating interception (proposed sketch)

Hard rule: **never edit a vendor-owned plugin directory.** Updates clobber silently, and a trust
product does not tamper with third-party artifacts. Candidates, every one unchecked:

- **Claude Code:** plugin-shipped hooks (client-specific) as observation, not enforcement; or
  operator-side duplication — a wrapped copy of a plugin's stdio server in operator-owned config
  with the plugin's copy disabled — always the operator's explicit choice, never applied silently.
- **Codex:** `~/.codex/config.toml` is operator-owned, not vendor-owned — a comment-round-tripping
  TOML writer (the missing piece `src/init.ts:63` names) would make `[mcp_servers.*]` wrappable.
  Plugin payload dirs stay untouchable regardless.
- **Portable:** does not exist in v1. Participate in the open project — issues, conformance tests,
  proposals — and claim nothing about that participation until it is real and observable.
- **Author-side:** the §1 escape hatch — a plugin author declaring a stdio entry in their own
  `mcp.json` that fronts their server with `reelier mcp --wrap`. Stdio-only (`url` entries cannot
  be fronted, `src/wrap.ts:119`); expressible now, observed on no host yet — a §4 cell.

## 6. Positioning — publish after §4 runs

> **Agent Plugins standardizes distribution; runtime proof of writes remains unsolved.**

Guardrails: never imply plugins are unsafe — the plan is to distribute through them (§3,
proposed). Never render Reelier's absence on a host as coverage. Calibrate per population as
always (CLAUDE.md §6).

## 7. Order of work

1. §1 boundary documentation — this PR.
2. §2 Codex probe — separate branch and PR.
3. §3 skill-only plugin; `mcp.json` only after the workspace-semantics decision.
4. §4 matrix runs.
5. §5 refinement per host.
6. §6 positioning — after §4, not before.
