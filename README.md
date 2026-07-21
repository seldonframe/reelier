<div align="center">

<img src="https://www.reelier.com/avatar.svg" width="72" alt="Reelier" />

# Reelier

### Agents make claims. Reelier writes receipts.

Record the run that worked, replay it deterministically — **0 tokens, byte-identical, a receipt on every step** — and `reelier diff` catches the day it drifts.

**Think of it as CI + snapshot tests for your agent's tool-call workflows.**

[![npm version](https://img.shields.io/npm/v/reelier.svg?color=blue)](https://www.npmjs.com/package/reelier)
[![CI](https://github.com/seldonframe/reelier/actions/workflows/ci.yml/badge.svg)](https://github.com/seldonframe/reelier/actions/workflows/ci.yml)
[![tests](https://img.shields.io/badge/tests-233%20passing-brightgreen.svg)](./test)
[![license](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/nSp5sd4v)
[![stars](https://img.shields.io/github/stars/seldonframe/reelier?style=social)](https://github.com/seldonframe/reelier)

**[Website](https://www.reelier.com)** · **[Docs](https://www.reelier.com/docs)** · **[SPEC.md](./SPEC.md)**

<img src="https://raw.githubusercontent.com/seldonframe/reelier/main/docs/assets/reelier-demo.gif" width="760" alt="Reelier: record a run that worked, replay it deterministically at 0 tokens, diff for drift, a receipt on every step" />

<sub><a href="https://www.reelier.com/reelier-explainer.mp4">▶ watch with sound (22s)</a></sub>

</div>

---

Your agent re-derives the same workflow every run — burning tokens and quietly **drifting**. Reelier compiles a run that *worked* into a `SKILL.md` file that replays deterministically (no LLM, 0 tokens, every step asserted into a receipt), then diffs runs to catch the day it stops matching. **For agents on recurring production workflows — where "it ran" isn't proof.**

## Install → your first receipt in 60 seconds

```sh
npm i -g reelier && reelier init
```

`reelier init` **scans the work you've already done first** — across Claude Code, Codex, Windsurf, and OpenClaw — and offers to turn a real past session into a replayable skill. No such history? It runs a zero-setup demo and closes with a real receipt:

```
Your receipt:
  skill:        reelier-init-demo
  steps:        2 total, 2 passed, 0 unchecked, 0 failed
  replay time:  44ms  [measured]
  LLM tokens:   0     [measured]

  An agent doing a comparable task re-reasons every run (~2.8s, ~18k tokens on
  our benchmark). Your replay: 44ms, 0 tokens.
```

### Or run it with Docker — no Node install

```sh
docker run --rm ghcr.io/seldonframe/reelier --help

# Replay a skill from the current directory:
docker run --rm -v "$PWD:/work" -w /work ghcr.io/seldonframe/reelier run my.skill.md

# Record from your agent history (mount it read-only):
docker run --rm -v "$HOME/.claude:/root/.claude:ro" -v "$PWD:/work" -w /work \
  ghcr.io/seldonframe/reelier scan
```

## Why

- **Your agent relearns the job every run — then quietly drifts.** Every run re-derives the workflow, and every small "rational" fix compounds — what long-run operators call *scar tissue*. A compiled skill never relearns and can't drift.
- **The real problem is the bill.** *"How much did that cost?"* is the first reply every long agent run gets. Reelier replays for **0 tokens**, with a receipt.
- **It's not brittle RPA.** Replays *tool calls* (typed JSON in/out), not pixels — and every step carries its own assertion, so a broken step **fails loudly, never silently passes**.
- **Upgraded the model?** A replay is pinned — re-record on the new model and `reelier diff` against your frozen baseline: **SAME or DRIFTED, per step**, before it reaches production.
- **"Anything deterministic should just be code."** Agreed — your agent already wrote it. Reelier captures its real, working run into a tested file. Determinism without the hand-coding.

## How it works — record → compile → replay → diff → receipt

```sh
reelier init                        # 60s: record → compile → replay → your receipt
reelier run  <name>.skill.md        # replay deterministically — 0 tokens (read-only by default)
reelier diff <name>                 # SAME or DRIFTED, per step — exit 1 on drift
reelier push <name>.skill.md        # sync receipts to your ledger (opt-in)
```

1. **Record** — three ways: `reelier mcp --wrap "<your mcp server>"` (a lossless proxy in front of your agent's tools), straight from an existing session (`reelier scan` / `reelier from-session`), or the guided `reelier init`.
2. **Compile** — `reelier compile` turns a trace into a `SKILL.md` deterministically (0 LLM calls) — a recipe with an **assertion on every step**, and the compiler's honest gaps printed as **Open questions** (including literal dates, UUIDs, and timestamps it flags as "should this be a variable?") rather than guessed at.
3. **Replay** — `reelier run` runs it at Level 0: no LLM, milliseconds, byte-identical. **Read-only by default** — a write step (`idempotent-write`) never re-fires unless you pass `--allow-writes`.
4. **Diff** — `reelier diff` compares two runs of a skill and reports **SAME or DRIFTED per step**, with the failing assertion as the *why*. Exit code 1 on drift, so it gates a scheduled replay.
5. **Receipt** — every run is a receipt (per-step outcomes, timing, 0 tokens). `reelier push` optionally syncs them to a receipt ledger for a shareable permalink + an embeddable **verified-replay badge**.

### Convert an Agent Skill

Turn an instruction skill + one recorded run into a deterministic replay — your skill, minus the model:

```sh
reelier mcp --wrap "<your mcp server>"                 # record: agent runs the skill's task once
reelier compile trace.jsonl --from-skill ./my-skill/SKILL.md
# → my-skill.skill.md — name + description carried from your SKILL.md,
#   steps ONLY from the recorded run (never generated from instruction text)
```

## Assert the value, not just the shape

A skill's assertions are what make a replay *proof*. The grammar checks status, structure, **and value**:

```md
- assert: status == 200
- assert: json.results is array
- assert: json.count >= 1              # numeric range
- assert: json.plan is string          # type
- assert: json.id matches /^usr_/      # value pattern
- assert: body contains "ok"
```

## Use it inside your coding agent (MCP)

`reelier serve` exposes Reelier's own commands as MCP tools, so Claude Code / Cursor / Windsurf / Codex can call it mid-session:

```json
{ "mcpServers": { "reelier": { "command": "npx", "args": ["-y", "reelier", "serve"] } } }
```

The agent gets `reelier_scan`, `reelier_from_session`, `reelier_replay`, `reelier_diff`, and `reelier_push` — with descriptions that tell it exactly *when to use* each (and when not to). It records a deterministic task once, then replays instead of re-reasoning.

## Tools

- **reelier_scan** — scan agent session history (Claude Code, Codex, Windsurf, OpenClaw) for replayable tool-call workflows
- **reelier_from_session** — compile a recorded session into a replayable SKILL.md with an assertion on every step
- **reelier_replay** — replay a skill deterministically at 0 LLM tokens (read-only by default; writes gated behind `--allow-writes`)
- **reelier_diff** — compare two runs: SAME or DRIFTED per step, with the failing assertion as the why; exit 1 on drift
- **reelier_push** — sync a run receipt to the [ledger](https://www.reelier.com/replays) for a shareable permalink (opt-in)

## The measured proof

From a real, live head-to-head benchmark (agent vs. Reelier, same task, same data) — full tables + methodology in [`examples/benchmark`](./examples/benchmark):

- **1,000 / 1,000 replays byte-identical** (N=1000 tail-variance test)
- **0 tokens per replay** — verified from the run record, not assumed
- **~50× cheaper** ($0.000000/replay vs. $0.019068/run averaged over the agent arm)
- **~59× faster** (48ms vs. 2,842ms average latency)
- a real drift **self-healed for ~$0.001**, once, then free every replay after

> **Latency varies by network** — Level-0 replay re-executes the skill's tool calls, so wall-clock depends on your connection. What does **not** vary: **0 LLM tokens**, the same steps every run, and the receipt. Independently corroborated — [arXiv 2605.14237](https://arxiv.org/abs/2605.14237) found 93.3–99.98% token reduction for the same record-and-replay pattern.

## Works with any model (BYOK)

Level-0 replay (the default) never calls a model — 0 tokens, by construction. Escalation (`--max-level 1|2`) is opt-in and speaks through one narrow BYOK surface (`--llm-base-url` + `--llm-model`): a native Anthropic Messages adapter, and an OpenAI-compatible adapter for everything else (OpenRouter, Ollama, Gemini's OpenAI endpoint, Groq, vLLM, LM Studio, Kimi, …). Point it at a stronger model and every skill's *next* self-heal gets smarter for free.

## Own it — AGPL, BYOK, local-first

The engine can never be taken closed. Your skills, traces, and run records are **your data** — leaving is copying a folder. The formats are specified in [SPEC.md](./SPEC.md), a normative RFC-style reference so anyone can emit or consume them without reading the source.

## Contributing

Issues and PRs welcome — see [SPEC.md](./SPEC.md) for the formats (the spec wins over the code; fix the code, not the spec). `npm test` runs the full suite; `npm run build && npx tsc --noEmit` before a PR.

```sh
git clone https://github.com/seldonframe/reelier && cd reelier
npm install && npm test
```

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=seldonframe/reelier&type=Date)](https://star-history.com/#seldonframe/reelier&Date)

## License

[AGPL-3.0](./LICENSE) — free to fork, audit, and self-host forever.

<div align="center">

**If Reelier saved you a re-run, [star it](https://github.com/seldonframe/reelier) ⭐ — it's how other builders find it.**

</div>
