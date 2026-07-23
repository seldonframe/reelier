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

Your agent re-derives the same workflow every run, burning tokens and quietly **drifting**. Reelier compiles a run that worked into a `SKILL.md` that replays deterministically — no LLM, 0 tokens — and `reelier diff` catches the day it stops matching.

It's not brittle RPA: typed tool calls, not pixels, so a broken step **fails loudly, never silently passes** — and it answers *"how much did that cost?"* with **0 tokens**.

## Install → your first receipt in 60 seconds

```sh
npm i -g reelier && reelier init
```

`reelier init` **scans work you've already done** (Claude Code, Codex, Windsurf, OpenClaw) into a real skill, or falls back to a zero-setup demo with a real receipt:

```
Your receipt:
  skill:        reelier-init-demo
  steps:        2 total, 2 passed, 0 unchecked, 0 failed
  replay time:  44ms  [measured]
  LLM tokens:   0     [measured]

  An agent doing a comparable task re-reasons every run (~2.8s, ~18k tokens on
  our benchmark). Your replay: 44ms, 0 tokens.
```

```sh
# No Node install needed — same commands via Docker:
docker run --rm ghcr.io/seldonframe/reelier --help

# Replay a skill from the current directory:
docker run --rm -v "$PWD:/work" -w /work ghcr.io/seldonframe/reelier run my.skill.md

# Record from your agent history (mount it read-only):
docker run --rm -v "$HOME/.claude:/root/.claude:ro" -v "$PWD:/work" -w /work \
  ghcr.io/seldonframe/reelier scan
```

## The five steps

```sh
reelier init                        # 60s: record → compile → replay → your receipt
reelier run  <name>.skill.md        # replay deterministically — 0 tokens (read-only by default)
reelier diff <name>                 # SAME or DRIFTED, per step — exit 1 on drift
reelier push <name>.skill.md        # sync receipts to your ledger (opt-in)
```

1. **Record.** `reelier mcp --wrap "<mcp server>"` proxies your tools live, or pull a session via `reelier scan`/`from-session` (below), or run the guided `reelier init`.
2. **Compile.** `reelier compile` turns a trace into a `SKILL.md` (0 LLM calls), an assertion per step, honest gaps printed as **Open questions**.
3. **Replay.** `reelier run` runs it at Level 0 — no LLM, byte-identical, **read-only by default** (writes need `--allow-writes`).
4. **Diff.** `reelier diff` reports **SAME or DRIFTED per step**, failing assertion as the *why* — exit 1 on drift.
5. **Push → receipt.** Every run is a receipt; `reelier push` optionally syncs it to a ledger for a permalink + embeddable **verified-replay badge**.

```sh
# Already have an Agent Skill? Convert it — your skill, minus the model:
reelier mcp --wrap "<your mcp server>"                 # record: agent runs the skill's task once
reelier compile trace.jsonl --from-skill ./my-skill/SKILL.md
# → my-skill.skill.md — name + description carried from your SKILL.md,
#   steps ONLY from the recorded run (never generated from instruction text)
```

**Importing sessions:** `reelier scan` finds replayable workflows in your agent's session logs; `reelier from-session` turns one into a skill, auto-sniffing the format:

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

Only replayable calls — builtins or `mcp__<server>__<tool>` — compile into a skill; native file/shell/search actions are skipped, never fabricated. `--agent <claude-code|codex|openclaw|cursor|windsurf>` forces a format instead of guessing.

## Three tests, one skill

One recorded skill gives you three different questions to ask of it, not one:

| Test | Command | Answers |
| --- | --- | --- |
| **Determinism** | `reelier run <skill.md>` replays against the assertions you recorded. Same steps, same asserts, 0 tokens. | *Does this still do what it did?* |
| **Recovery** | `reelier run <skill.md> --fail N[=status]` injects a synthetic failure at step `N` (default status `500`; override with `--fail N=429`, repeatable) instead of dispatching that step's real tool call, then runs the SAME escalation ladder a real failure would hit. | *If this broke, would the skill notice and heal?* |
| **Drift** | `reelier run <skill.md> --wrap "<your mcp server>"` replays against your *live*, read-only dependencies instead of the recorded trace. Paired with `reelier manifest` (below), this catches a tool's schema moving out from under you before a real replay does. | *Has the world moved out from under this skill?* |

A mocked step never calls its tool, so a write step is recovery-testable with no `--allow-writes`, no side effect — `reelier push` refuses to publish a mock run.

*Taxonomy due to Mads Hansen's review of the launch post.*

Normative spec: [docs/specs/flight-recorder-v2.md](./docs/specs/flight-recorder-v2.md)

**Guardrails.** `reelier manifest` stamps a schema digest per tool a skill uses; drift or a missing tool fails closed — `MANIFEST DRIFT — refusing to replay`. `--ignore-manifest` is the break-glass override, recorded (`manifestIgnored: true`), never silent. A skill with no manifest gets an advisory note.

```sh
reelier manifest <skill.md> --wrap "<your mcp server>"   # stamp/refresh the manifest from live servers
reelier run <skill.md> --wrap "<your mcp server>"         # preflight checks the manifest BEFORE step 1 runs
```

`--allow-writes`/`--yes` are blanket — "may write," not "this write is reviewed." `reelier approve` hash-binds one step's tool + args: a match runs with **no flags at all**; a change fails closed — `Approval mismatch` — and no flag overrides it. No `approve:` field keeps today's behavior.

```sh
reelier approve <skill.md>          # walk each write/destructive step, y/N to approve
reelier approve <skill.md> --all    # approve every write step non-interactively
```

## Assert the value, not just the shape

```md
- assert: status == 200
- assert: json.results is array
- assert: json.count >= 1              # numeric range
- assert: json.plan is string          # type
- assert: json.id matches /^usr_/      # value pattern
- assert: body contains "ok"
```

**Use it inside your coding agent (MCP):** `reelier serve` exposes Reelier's commands as MCP tools your coding agent can call mid-session:

```json
{ "mcpServers": { "reelier": { "command": "npx", "args": ["-y", "reelier", "serve"] } } }
```

- **reelier_scan** — find replayable workflows in session history
- **reelier_from_session** — compile a session into a SKILL.md
- **reelier_replay** — replay at 0 tokens (read-only by default)
- **reelier_diff** — SAME or DRIFTED per step; exit 1 on drift
- **reelier_push** — sync a receipt to the [ledger](https://www.reelier.com/replays) (opt-in)

## Trust ladder — a ladder of graded claims, never a blanket ✓

A receipt asserts several *independent* things, each provable to a different grade — never one blanket "verified ✓". **What no rung claims:** a run wasn't *fabricated before it was recorded*.

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

`reelier verify <permalink|file> [--key <pub.pem>]` recomputes every claim offline — never a bare OK:

```sh
reelier verify https://reelier.com/r/<token> --key mykey.pub.pem
# unaltered-since-push: ✓ (key a1b2c3d4e5f6a7b8)
# timestamped: imprint ✓ (tsa https://freetsa.org/tsr) — full chain verification: openssl ts -verify ...
```

Absent claims render honestly, never shamed — `— unsigned`, not "insecure." Only a **present**, failing claim fails the exit code; absent/unchecked never do.

## What it means for you

- **Solo dev / OSS maintainer** — a real regression test again; drift can't pass silently.
- **Team shipping agent changes** — "it ran clean" becomes a checkable PR artifact, not a claim.
- **Agency running agents for clients** — signed, timestamped proof-of-delivery a client can verify.
- **Marketplace buyer or seller** — corroborated receipts are reviews that can't be astroturfed.
- **Audit-facing ops** — a signed, CI-attested trail of every write, idempotency key included.

## The measured proof

A real, live head-to-head benchmark (agent vs. Reelier, same task, same data) — full methodology in [`examples/benchmark`](./examples/benchmark):

- **1,000 / 1,000 replays byte-identical** (N=1000 tail-variance test)
- **0 tokens per replay** — verified from the run record, not assumed
- **~50× cheaper** ($0.000000/replay vs. $0.019068/run averaged over the agent arm)
- **~59× faster** (48ms vs. 2,842ms average latency)
- a real drift **self-healed for ~$0.001**, once, then free every replay after

> **Latency varies by network** — replay re-executes the tool calls. What doesn't vary: **0 LLM tokens**, same steps, receipt. Independently corroborated — [arXiv 2605.14237](https://arxiv.org/abs/2605.14237) found 93.3–99.98% token reduction for the same pattern.

## Own it — MIT, BYOK, local-first

Use it anywhere, embed it in anything — no copyleft strings; your data (skills, traces, runs) is specified in [SPEC.md](./SPEC.md), so leaving is copying a folder. [MIT](./LICENSE), free forever (versions ≤0.16.0 remain AGPL-3.0).

**Any model (BYOK):** Level-0 never calls a model — 0 tokens, by construction. Escalation (`--max-level 1|2`) is opt-in via one BYOK surface: native Anthropic, or OpenAI-compatible for the rest (OpenRouter, Ollama, Gemini, Groq, vLLM, LM Studio, Kimi, …).

**Contributing:** issues and PRs welcome — [SPEC.md](./SPEC.md) is the source of truth for formats; fix the code, not the spec. `npm test` before a PR.

```sh
git clone https://github.com/seldonframe/reelier && cd reelier
npm install && npm test
```

## Star history

[![Star History Chart](https://api.star-history.com/svg?repos=seldonframe/reelier&type=Date)](https://star-history.com/#seldonframe/reelier&Date)

<div align="center">

**If Reelier saved you a re-run, [star it](https://github.com/seldonframe/reelier) ⭐ — it's how other builders find it.**

</div>
