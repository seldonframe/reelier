<div align="center">

<img src="https://www.reelier.com/avatar.svg" width="72" alt="Reelier" />

# Reelier

### Agents make claims. Reelier writes receipts.

Record the run that worked, replay it deterministically — **0 tokens, byte-identical, a receipt on every step** — and `reelier diff` catches the day it drifts.

**Think of it as CI + snapshot tests for your agent's tool-call workflows.**

[![npm version](https://img.shields.io/npm/v/reelier.svg?color=blue)](https://www.npmjs.com/package/reelier)
[![CI](https://github.com/seldonframe/reelier/actions/workflows/ci.yml/badge.svg)](https://github.com/seldonframe/reelier/actions/workflows/ci.yml)
[![tests](https://img.shields.io/badge/tests-641%20passing-brightgreen.svg)](./test)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/nSp5sd4v)
[![stars](https://img.shields.io/github/stars/seldonframe/reelier?style=social)](https://github.com/seldonframe/reelier)

**[Website](https://www.reelier.com)** · **[Docs](https://www.reelier.com/docs)** · **[SPEC.md](./SPEC.md)**

<img src="https://raw.githubusercontent.com/seldonframe/reelier/main/docs/assets/reelier-demo.gif" width="760" alt="Reelier: record a run that worked, replay it deterministically at 0 tokens, diff for drift, a receipt on every step" />

<sub><a href="https://www.reelier.com/reelier-explainer.mp4">▶ watch with sound (22s)</a></sub>

<a href="https://glama.ai/mcp/servers/seldonframe/reelier"><img width="380" height="200" src="https://glama.ai/mcp/servers/seldonframe/reelier/badge" alt="Reelier MCP server on Glama" /></a>

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

- **Your agent relearns the job every run — then quietly drifts.** Every run re-derives the workflow, and every small "rational" fix compounds. A compiled skill never relearns and can't drift.
- **The real problem is the bill.** *"How much did that cost?"* is the first reply every long agent run gets. Reelier replays for **0 tokens**, with a receipt.
- **It's not brittle RPA.** Replays *tool calls* (typed JSON in/out), not pixels — every step carries its own assertion, so a broken step **fails loudly, never silently passes**.

## The five steps

```sh
reelier init                        # 60s: record → compile → replay → your receipt
reelier run  <name>.skill.md        # replay deterministically — 0 tokens (read-only by default)
reelier diff <name>                 # SAME or DRIFTED, per step — exit 1 on drift
reelier push <name>.skill.md        # sync receipts to your ledger (opt-in)
```

1. **Record.** Three ways in: `reelier mcp --wrap "<your mcp server>"` (a lossless proxy in front of your agent's tools), straight from an existing session (`reelier scan` / `reelier from-session`, see below), or the guided `reelier init`.
2. **Compile.** `reelier compile` turns a trace into a `SKILL.md` deterministically (0 LLM calls) — an assertion on every step, and honest gaps printed as **Open questions** (literal dates, UUIDs, timestamps flagged "should this be a variable?") rather than guessed at.
3. **Replay.** `reelier run` runs it at Level 0: no LLM, milliseconds, byte-identical. **Read-only by default** — a write step (`idempotent-write`) never re-fires unless you pass `--allow-writes`.
4. **Diff.** `reelier diff` compares two runs and reports **SAME or DRIFTED per step**, with the failing assertion as the *why*. Exit code 1 on drift, so it gates a scheduled replay. Upgraded the model? Re-record against it and diff against your frozen baseline before it reaches production.
5. **Push → receipt.** Every run is a receipt (per-step outcomes, timing, 0 tokens). `reelier push` optionally syncs it to a ledger for a shareable permalink + an embeddable **verified-replay badge**.

**Already have an Agent Skill?** Convert it — your skill, minus the model:

```sh
reelier mcp --wrap "<your mcp server>"                 # record: agent runs the skill's task once
reelier compile trace.jsonl --from-skill ./my-skill/SKILL.md
# → my-skill.skill.md — name + description carried from your SKILL.md,
#   steps ONLY from the recorded run (never generated from instruction text)
```

### Import sessions from any agent

`reelier scan` finds replayable workflows already sitting in your agent's session logs; `reelier from-session` turns one into a skill. Format is sniffed from content — no flag needed for supported agents:

```sh
reelier scan                                          # discovers sessions from every known agent under your home dir
reelier from-session ~/.claude/projects/*/*.jsonl      # Claude Code
reelier from-session ~/.codex/sessions/**/rollout-*.jsonl   # Codex CLI
reelier from-session ~/.openclaw/agents/*/sessions/*.jsonl  # OpenClaw
```

| Agent | Session location | Status |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/<project>/<uuid>.jsonl` | supported |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | supported |
| OpenClaw | `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl` | supported |
| Cursor | `.../User/globalStorage/state.vscdb` (SQLite, undocumented) | detected, not yet parseable |
| Windsurf | `.../User/globalStorage/state.vscdb` (SQLite, undocumented) | detected, not yet parseable |

Only replayable calls (Reelier's own builtins, or `mcp__<server>__<tool>` calls) ever compile into a skill — native file/shell/search actions are reported as skipped, never fabricated into a step. Pass `--agent <claude-code|codex|openclaw>` to force a format; `--agent cursor`/`--agent windsurf` report what's on disk honestly rather than guessing at an undocumented binary format.

## Three tests, one skill

One recorded skill gives you three different questions to ask of it, not one:

| Test | Command | Answers |
| --- | --- | --- |
| **Determinism** | `reelier run <skill.md>` replays against the assertions you recorded. Same steps, same asserts, 0 tokens. | *Does this still do what it did?* |
| **Recovery** | `reelier run <skill.md> --fail N[=status]` injects a synthetic failure at step `N` (default status `500`; override with `--fail N=429`, repeatable) instead of dispatching that step's real tool call, then runs the SAME escalation ladder a real failure would hit. | *If this broke, would the skill notice and heal?* |
| **Drift** | `reelier run <skill.md> --wrap "<your mcp server>"` replays against your *live*, read-only dependencies instead of the recorded trace. Paired with `reelier manifest` (below), this catches a tool's schema moving out from under you before a real replay does. | *Has the world moved out from under this skill?* |

Nothing outside the network actually happens during a recovery test — a mocked step never calls its tool, so you can recovery-test a write step with no `--allow-writes` and no side effect. A mock run is a local test only — `reelier push` refuses to publish one.

*Taxonomy due to Mads Hansen's review of the launch post.*

Normative spec: [docs/specs/flight-recorder-v2.md](./docs/specs/flight-recorder-v2.md)

### Tool-schema drift: `reelier manifest`

`reelier manifest` stamps a schema digest for every tool a skill's steps actually use, so replay refuses loudly instead of silently filling the wrong args once a wrapped server's tool schema changes: a drifted or missing tool fails closed — `MANIFEST DRIFT — refusing to replay` — before anything executes. `--ignore-manifest` is the explicit break-glass override, still recorded on the run (`manifestIgnored: true`), never a silent bypass; a skill with no manifest at all just gets an advisory note and keeps working unmodified.

```sh
reelier manifest <skill.md> --wrap "<your mcp server>"   # stamp/refresh the manifest from live servers
reelier run <skill.md> --wrap "<your mcp server>"         # preflight checks the manifest BEFORE step 1 runs
```

### Per-step write approval: `reelier approve`

`--allow-writes`/`--yes` are blanket flags — "this run may write," not "this exact write is reviewed." `reelier approve` hash-binds approval to one step's tool + argument template: a match executes with **no flags at all**; a changed tool or args fails closed — `Approval mismatch` — and no flag overrides it. A step with no `approve:` field keeps today's `--allow-writes`/`--yes` behavior, unchanged.

```sh
reelier approve <skill.md>          # walk each write/destructive step, y/N to approve
reelier approve <skill.md> --all    # approve every write step non-interactively
```

## Assert the value, not just the shape

A skill's assertions are what make a replay *proof* — the grammar checks status, structure, **and value**:

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

- **reelier_scan** — scan agent session history for replayable tool-call workflows
- **reelier_from_session** — compile a recorded session into a replayable SKILL.md with an assertion on every step
- **reelier_replay** — replay a skill deterministically at 0 LLM tokens (read-only by default; writes gated behind `--allow-writes`)
- **reelier_diff** — compare two runs: SAME or DRIFTED per step, with the failing assertion as the why; exit 1 on drift
- **reelier_push** — sync a run receipt to the [ledger](https://www.reelier.com/replays) for a shareable permalink (opt-in)

## Trust ladder — a ladder of graded claims, never a blanket ✓

A receipt asserts several *independent* things about a run, each provable to a different grade — never one "verified ✓" that would be a lie by compression. **What no rung claims:** none of this proves a run wasn't *fabricated before it was recorded* — signing proves unaltered-since-push by a known key-holder, timestamps prove existed-by-T, request-id refs make claims externally falsifiable.

| Claim | How you get it | What it proves | What it does *not* prove |
| --- | --- | --- | --- |
| **Unaltered since push** | `reelier init --signing` once, then every `reelier push` signs automatically | Produced by the holder of this Ed25519 key and **tamper-evident** since it was pushed | The run wasn't fabricated before it was ever recorded |
| **Timestamped** | `reelier push <skill.md> --timestamp` | An RFC-3161 timestamp authority attests the record's digest existed by time T | The record's contents, or that it wasn't backdated before *this* timestamp request |
| **Produced by** | Register your public key at reelier.com (verified-org badge via DNS domain verification) | The receipt names the identity holding the signing key | Identity is not intent — it says who pushed, not that the run was honest |
| **Tools verified** | `reelier manifest <skill.md> --wrap "…"` once; every replay preflights it | The tools replayed against carry byte-identical input schemas to the tools recorded | That tool *behavior* is unchanged — the digest covers the schema contract, not the implementation behind it |
| **Writes approved** | `reelier approve <skill.md>` | Every executed write matched a human-approved hash of its exact tool + argument template | That values bound into the template at run time were the intended ones — approval binds the operation shape |
| **Cross-checkable refs** | Automatic — any step whose call returns a provider request-id (`request-id`, `stripe-request-id`, `cf-ray`, …, or an MCP body's `request_id`/`requestId`/`x_request_id`) carries it | An auditor can cross-check the claim against the provider's own logs | Reelier does not verify these upstream itself — that's the auditor's job |
| **CI-attested** | Automatic in GitHub Actions (needs `permissions: id-token: write`) | Which repo, sha, and workflow run produced the push — an anchor the operator can't mint themselves | The workflow's own logic wasn't compromised — attests the *environment*, not the truth of what it ran |
| **Corroborated** | Accrues automatically on reelier.com as distinct tenants push receipts for byte-identical skill content | Independent tenants produced matching receipts — matching accrues only across distinct tenants | That tenants are truly independent people — same billing identity counts once, but sybil accounts are named as the known limit |

Normative spec: [docs/specs/trust-ladder-v1.md](./docs/specs/trust-ladder-v1.md)

`reelier verify <permalink|file> [--key <pub.pem>]` recomputes each claim offline and prints every row — never a bare OK:

```sh
reelier verify https://reelier.com/r/<token> --key mykey.pub.pem
# unaltered-since-push: ✓ (key a1b2c3d4e5f6a7b8)
# timestamped: imprint ✓ (tsa https://freetsa.org/tsr) — full chain verification: openssl ts -verify ...
```

Absent claims are rendered honestly, never shamed: an unsigned push says `— unsigned`, not "unverified" or "insecure." Exit code is 0 unless a claim that's actually **present** fails verification (a bad signature, a mismatched timestamp imprint); an absent or unchecked claim never fails the exit code.

## What it means for you

- **Solo dev / OSS maintainer** — your replay is a real regression test again: drift can't pass silently, and you can test recovery on purpose.
- **Team shipping agent changes** — "the migration ran clean" becomes a checkable artifact on the PR, not a claim — CI-attested receipts are structurally harder to fake than a laptop's.
- **Agency running agents for clients** — proof-of-delivery: "the agent booked these 40 jobs" as signed, timestamped evidence a client can verify themselves.
- **Marketplace buyer or seller** — corroborated receipts are reviews that can't be astroturfed: they accrue only across distinct tenants running byte-identical skill content.
- **Audit-facing ops** — a signed, timestamped, CI-attested trail of every write, with an idempotency key and the resource it touched.

## The measured proof

From a real, live head-to-head benchmark (agent vs. Reelier, same task, same data) — full tables + methodology in [`examples/benchmark`](./examples/benchmark):

- **1,000 / 1,000 replays byte-identical** (N=1000 tail-variance test)
- **0 tokens per replay** — verified from the run record, not assumed
- **~50× cheaper** ($0.000000/replay vs. $0.019068/run averaged over the agent arm)
- **~59× faster** (48ms vs. 2,842ms average latency)
- a real drift **self-healed for ~$0.001**, once, then free every replay after

> **Latency varies by network** — Level-0 replay re-executes the skill's tool calls, so wall-clock depends on your connection. What does **not** vary: **0 LLM tokens**, the same steps every run, and the receipt. Independently corroborated — [arXiv 2605.14237](https://arxiv.org/abs/2605.14237) found 93.3–99.98% token reduction for the same record-and-replay pattern.

## Works with any model (BYOK)

Level-0 replay (the default) never calls a model — 0 tokens, by construction. Escalation (`--max-level 1|2`) is opt-in through one narrow BYOK surface (`--llm-base-url` + `--llm-model`): a native Anthropic Messages adapter, and an OpenAI-compatible adapter for everything else (OpenRouter, Ollama, Gemini's OpenAI endpoint, Groq, vLLM, LM Studio, Kimi, …).

## Own it — MIT, BYOK, local-first

Use it anywhere, embed it in anything — no copyleft strings, no legal review needed. Your skills, traces, and run records are **your data** — leaving is copying a folder. Formats are specified in [SPEC.md](./SPEC.md), a normative RFC-style reference so anyone can emit or consume them without reading the source. [MIT](./LICENSE), free to fork, embed, audit, and self-host forever. (Versions ≤0.16.0 were released under AGPL-3.0 and remain so.)

## Contributing

Issues and PRs welcome — [SPEC.md](./SPEC.md) is the source of truth for formats (fix the code, not the spec).

```sh
git clone https://github.com/seldonframe/reelier && cd reelier
npm install && npm test
```

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=seldonframe/reelier&type=Date)](https://star-history.com/#seldonframe/reelier&Date)

<div align="center">

**If Reelier saved you a re-run, [star it](https://github.com/seldonframe/reelier) ⭐ — it's how other builders find it.**

</div>
