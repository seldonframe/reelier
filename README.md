# Reelier

Your agent's muscle memory. Record an agent workflow once as a trace of tool
calls, compile it to a `SKILL.md` — a recipe with a test — and replay it
deterministically with zero LLM calls, escalating to an LLM only when the
world has changed underneath it.

## Status: v0 spike + recorder

The Level-0 deterministic runner and file formats are the spike. On top of
that there's now a **recorder**: a lossless MCP proxy that captures a live
agent session as a trace, and MCP replay support in the runner. There is
still:

- **No compiler** (no automatic trace → SKILL.md step — traces are
  hand-compiled into skills for now; use `reelier trace` to read one)
- **No escalation ladder** (a divergence at Level 0 just stops the run and
  reports the failure — Levels 1-3 below are not implemented)
- **No LLM calls anywhere in this codebase** — zero, by construction

## Record

Point Reelier at the real MCP server(s) your agent already uses. It spawns
them, re-exposes their tools 1:1 (pure passthrough — the live path is never
modified), and adds three control tools your agent can call to capture a
lossless trace of what it did.

Install it in front of an existing MCP server (Claude Code example):

```sh
claude mcp add reelier -- npx reelier mcp --wrap "npx -y @your/mcp-server"
```

Wrap more than one downstream server by repeating `--wrap`. Then tell your
agent: **"record yourself doing this."** It will:

1. Call `reelier_start_recording {name}` — opens
   `.reelier/traces/<name>-<n>.jsonl` (`n` auto-increments so an existing
   trace is never overwritten) and returns the path.
2. Call `reelier_note {text}` before each logical step to narrate intent
   ("I'm about to pull this week's bookings"). No-op with a friendly message
   if you're not currently recording.
3. Work normally — every wrapped tool call and its result is appended to the
   trace, in order, while recording is on. Calls made while *not* recording
   pass through unlogged.
4. Call `reelier_stop_recording {}` — returns the path and how many calls
   were captured.

Then inspect it:

```sh
reelier trace .reelier/traces/<name>-1.jsonl
```

and hand-write the corresponding `SKILL.md` from what you see (the compiler
that automates this step doesn't exist yet). Once you have a skill, replay it
against the same downstream(s):

```sh
reelier run skills/my-skill.skill.md --wrap "npx -y @your/mcp-server"
```

### The trace format

One JSON object per line, written in order — order in the file IS the
association between a call and its result. Every record carries a
file-global monotonic `seq`; `call`/`result` pairs additionally share a
call-index `i`.

```jsonc
{"t":"meta","seq":0,"name":"...","startedAt":"<ISO>","wrapped":["<downstream server names>"]}
{"t":"note","seq":1,"ts":"<ISO>","text":"..."}
{"t":"call","seq":2,"i":0,"ts":"<ISO>","tool":"...","args":{...}}
{"t":"result","seq":3,"i":0,"ok":true,"ms":12,"body":{...}}
```

Control-tool calls (`reelier_start_recording`/`reelier_note`/
`reelier_stop_recording`) are never themselves written as `call`/`result`
entries.

### Redaction (trace-write time only, never on the live path)

`redact()` (`src/redact.ts`) deep-walks `args`/`body` before they're written
to the trace:

- **`REELIER_REDACT`** — comma-separated env var *names*. Any occurrence of
  those vars' *values* (length ≥ 6) inside a string is replaced with
  `«redacted:NAME»`.
- **Always on, no config needed**: `sk-...`-shaped tokens and `Bearer ...`
  headers are replaced with `«redacted»`.
- **Always on**: a 32+-char hex string sitting in a field literally named
  like `/token|secret|key|password|authorization/i` is replaced with
  `«redacted»`.

This is deliberately conservative — it will miss secrets that don't match
these shapes (e.g. base64-encoded keys, secrets embedded mid-string in an
unnamed field, non-hex tokens under 32 chars). It will not corrupt a trace
with false-positive redactions of ordinary data, which was the higher
priority for a first pass. Treat trace files as sensitive until you've
verified redaction covers what you're wrapping.

### Tool name identity

A downstream tool is exposed under its original name. If two `--wrap`d
downstreams both have a tool of the same name, the later one (by `--wrap`
order, 0-indexed) is exposed as `<downstreamIndex>_<name>` and a warning is
logged to stderr. **The exposed name is what gets recorded, and it's what
`reelier run --wrap` looks up on replay** — both sides build the same
collision table from the same `--wrap` order, so a name recorded by
`reelier mcp` always resolves to the same tool on replay.

### MCP result → Observation mapping (for `reelier run --wrap`)

Runner steps assert against an `Observation` (`{status, headers, body}` —
see `src/assert.ts`). MCP tool results don't have that shape natively, so
`src/mcp-tool.ts` adapts:

- `status`: `200` if the call succeeded, `500` if the MCP result set
  `isError: true`.
- `headers`: always `{}` — MCP has no header concept.
- `body`: every `text`-type content block's `.text`, concatenated with
  `"\n"`. When a tool returns a single JSON-shaped text block (the common
  case — e.g. `{"result": 9}`), `body` *is* that JSON text, so
  `json.<dotpath>` asserts/binds parse it directly through the existing
  `JSON.parse(obs.body)` path. If a tool returns multiple text blocks, only
  `body contains`/`body match` asserts are reliable; `json.*` will fail to
  parse the concatenation — this is a documented limitation, not silently
  papered over.

Builtin `http.*` tools keep working unchanged when `--wrap` is also passed —
the MCP-backed tools are merged alongside them.

## The five atoms

Every step in a skill is five atoms:

| Atom | What it is |
| --- | --- |
| **intent** | A natural-language sentence describing what the step is for |
| **action** | A tool name + a JSON args template (`{{var}}` holes allowed) |
| **assert** | Predicates over the observation the tool returned |
| **bind** | Extractions from the observation that feed later steps |
| **effect** | `read` \| `idempotent-write` \| `destructive` |

## The SKILL.md format

SKILL.md-standard-compatible frontmatter, then human-editable step blocks:

```markdown
---
name: sf-post-deploy-smoke
description: Post-deploy smoke sweep of seldonframe.com core routes
---

# SF post-deploy smoke sweep

Inputs: (none for this skill; document `{{name}}` input variables here when a skill has them)

## Steps

### Step 1 — Homepage is up and branded
- intent: Confirm the marketing homepage serves and carries the brand sentinel
- action: http.get {"url": "https://www.seldonframe.com/"}
- assert: status == 200
- assert: body contains "SeldonFrame"
- effect: read
```

Steps must be numbered sequentially from 1. A malformed skill (bad
frontmatter, a missing required field, an unrecognized assert/bind
expression, an out-of-order step number) is **rejected with an error naming
the exact step and line** — Reelier never silently skips a broken step.

### Assert mini-language

- `status == <int>` / `status != <int>`
- `body contains "<text>"` / `body not contains "<text>"`
- `json.<dotpath> is array` / `is set`
- `json.<dotpath> == <json-scalar>` / `!=` / `>` / `<`
- `json.<dotpath> length > <int>` (arrays and strings)

### Bind mini-language

- `<name> = json.<dotpath>`
- `<name> = body match /<regex>/` (first capture group; no match is a
  divergence)

### Builtin tools (v0)

`http.get {url}` and `http.post {url, headers?, body?}`, backed by Node's
native `fetch` with a 15s timeout. The registry is a plain map so MCP-backed
tools can be registered alongside these later without touching the runner.

A step whose `effect` is `destructive` is refused unless `--yes` is passed —
Reelier prints the filled action instead of executing it.

## CLI usage

```sh
# Print every step's filled action without executing anything.
reelier run skills/my-skill.skill.md --dry-run

# Run for real. Exit 0 if every step passed or was unchecked, 1 on any failure.
reelier run skills/my-skill.skill.md

# Pass input variables.
reelier run skills/my-skill.skill.md --var name=acme

# Allow destructive steps to actually execute.
reelier run skills/my-skill.skill.md --yes

# Replay against one or more live MCP downstreams (repeatable --wrap).
reelier run skills/my-skill.skill.md --wrap "npx -y @your/mcp-server"

# Summarize a skill's run-record history.
reelier bench skills/my-skill.skill.md

# Start the recording proxy: re-exposes each --wrap'd downstream's tools
# 1:1 plus 3 reelier_* control tools, on stdio.
reelier mcp --wrap "npx -y @your/mcp-server" [--wrap "..."] [--trace-dir <dir>]

# Pretty-print a trace file.
reelier trace .reelier/traces/my-trace-1.jsonl
```

Every run appends one JSON line to `.reelier/runs/<skill-name>.jsonl`. A step
with zero assertions is recorded as `"unchecked"`, never `"passed"` — an
honest-success rule: Reelier will not report a step as having verified
anything it didn't actually check.

## Roadmap: the escalation ladder

- **L0 (this spike)** — deterministic replay, zero LLM calls, fails closed on
  divergence.
- **L1** — on divergence, an LLM proposes a patched step (e.g. an updated
  selector or sentinel), a human or policy approves it, the skill is
  re-compiled.
- **L2** — an LLM handles the diverged step live (one-off), the run
  continues, and the outcome is logged as a candidate patch.
- **L3** — full agentic recovery when the recorded trace no longer applies
  at all, with the successful recovery folded back into the skill.

No benchmark numbers or cost-savings claims are made here — this spike is
too small to earn them. Receipts come later, once there's something to
measure against.

## Licensing

The AGPL-3.0 license in this repository covers the **Reelier harness only**
— the parser, runner, and CLI in `src/`. Your traces, your `SKILL.md` files,
and your run records are **your data**. They are not covered by, and not
affected by, this license.
