# Reelier

Your agent's muscle memory. Record an agent workflow once as a trace of tool
calls, compile it to a `SKILL.md` — a recipe with a test — and replay it
deterministically with zero LLM calls, escalating to an LLM only when the
world has changed underneath it.

## Status: v0 spike

This is the v0 spike. It builds **only** the file formats and the Level-0
deterministic runner, against a real example skill. There is:

- **No recorder** (nothing captures a live agent trace yet — skills are
  hand-written for now)
- **No compiler** (no automatic trace → SKILL.md step)
- **No escalation ladder** (a divergence at Level 0 just stops the run and
  reports the failure — Levels 1-3 below are not implemented)
- **No LLM calls anywhere in this codebase** — zero, by construction
- **No MCP server** — this is a plain CLI over a plain file format

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

# Summarize a skill's run-record history.
reelier bench skills/my-skill.skill.md
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
