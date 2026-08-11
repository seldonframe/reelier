<div align="center">

<img src="https://www.reelier.com/avatar.svg" width="72" alt="Reelier" />

# Reelier

### Let your agents write. Keep the receipts.

*Your agents worked all night. Here's exactly what changed.*

Reelier records the run that worked, freezes it as a replayable skill, and replays it deterministically — every run comes back as a receipt: proof of what the agent did and what changed because of it. **Agents make claims. Reelier writes receipts.**

[![npm version](https://img.shields.io/npm/v/reelier.svg?color=blue)](https://www.npmjs.com/package/reelier)
[![CI](https://github.com/seldonframe/reelier/actions/workflows/ci.yml/badge.svg)](https://github.com/seldonframe/reelier/actions/workflows/ci.yml)
[![tests](https://img.shields.io/badge/tests-2777%20passing-brightgreen.svg)](./test)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/nSp5sd4v)
[![stars](https://img.shields.io/github/stars/seldonframe/reelier?style=social)](https://github.com/seldonframe/reelier)

**[Website](https://www.reelier.com)** · **[Docs](https://www.reelier.com/docs)** · **[SPEC.md](./SPEC.md)**

<img src="https://raw.githubusercontent.com/seldonframe/reelier/main/docs/assets/reelier-demo.gif" width="760" alt="Reelier: Dependabot bumps a dependency, Reelier replays your recorded agent run at 0 tokens and diffs it, catching the drift on the PR before you merge" />

<sub><a href="https://www.reelier.com/reelier-explainer.mp4">▶ watch with sound (27s)</a></sub>

<a href="https://glama.ai/mcp/servers/seldonframe/reelier"><img width="380" height="200" src="https://glama.ai/mcp/servers/seldonframe/reelier/badge" alt="Reelier MCP server on Glama" /></a>

</div>

---

## Receipts on your agent PRs — install and done

Agent-authored PRs (Dependabot, Claude, Codex, Cursor, …) get a receipt comment in seconds: author, files changed, declared scope vs. what actually changed, sensitive paths flagged. No workflow file, no CLI, no config.

**[→ Install the Reelier receipts GitHub App](https://github.com/apps/reelier-receipts)** — free on public repos, forever.

> **Reelier receipt — agent PR**
> Author: `dependabot[bot]` · Files changed: 2 (+119 −41)
> Declared scope: none (add `.reelier/scope.yml` to enable unexpected-write detection)
> Sensitive paths touched: ⚠ 1 — `package-lock.json`
> Proves scope and change, not correctness

<sub>A real receipt from Reelier's own repos — [see one live](https://github.com/seldonframe/reelier/pull/27). Declare scope per agent in `.reelier/scope.yml` (or a <code>reelier-scope</code> block in the PR body) and the receipt reports unexpected writes. The receipt proves scope and change, never correctness or safety.</sub>

---

## Why

AI agents are non-deterministic — the same prompt, a different result every run — and they'll claim they did the work whether they did or not. Reelier records the run that worked, replays it deterministically, and writes a signed receipt that proves it. Point it at your existing CI in one workflow — it adds a verifiable receipt, it doesn't replace your stack.

Measured on a real head-to-head benchmark, same task, same data ([full method](./docs/REFERENCE.md#benchmark-method)):

- **1,000 / 1,000 replays byte-identical**
- **Every replay ships a signed receipt** — proof of what ran and what changed, never a claim
- **0 LLM calls at replay** — deterministic re-execution, not re-reasoning

Deterministic replay is also [~50× cheaper and ~59× faster than re-running the agent, on the same benchmark](./docs/REFERENCE.md#benchmark-method).

## Install

```sh
npm i -g reelier && reelier init
```

```sh
# No Node install needed — same commands via Docker:
docker run --rm ghcr.io/seldonframe/reelier --help
```

`reelier init [--dry-run]` performs one checkpointed local inspection across all three Reelier paths: Path A observation coverage, Path B replay/freeze candidates, and Path C boundable/outcome-capable/shadow-only/unsupported connections and candidates. It does not deploy, gate, dispatch, upload, copy credentials, or rewrite host configuration. `--dry-run` writes nothing; the normal command writes only sanitized artifacts below `.reelier/init/`.

### As an agent plugin

Teach your coding agent when to reach for Reelier. Same two commands, either host:

```sh
claude plugin marketplace add seldonframe/reelier
claude plugin install reelier@seldonframe
```

```sh
codex plugin marketplace add seldonframe/reelier
codex plugin add reelier@seldonframe
```

This installs two Agent Skills and nothing else. `reelier-replay` teaches your agent to freeze a
repeatable tool-call job and replay it at 0 tokens. `reelier-write-safety` covers bounding an
agent's writes before you grant them: what the recorder sees, what a policy refuses, and what a
receipt does and does not prove. **It ships no MCP servers**, so it does not wrap, observe, or gate
any tool call on its own; the `reelier` CLI does that, and the skills drive it via `npx`. Packaged in both the [Agent Plugins](https://agent-plugins.org) v1.0.0 format (`plugin/agent-plugins/`) and the Claude Code format (`plugin/claude/`), generated from one source by `scripts/build-plugin-packages.mjs`.

Verified end to end on `codex-cli 0.147.0-alpha.1.2`: both formats install, enable, and the skill reaches the model. Other hosts are untested, and per-host status is tracked in [`docs/specs/agent-plugins-coverage-v1.md`](docs/specs/agent-plugins-coverage-v1.md) §4 rather than claimed here.

## How to use it

```sh
reelier init --dry-run              # inspect Path A/B/C locally; write nothing
reelier init                        # persist resumable sanitized inspection artifacts
reelier run  <name>.skill.md        # replay deterministically — 0 tokens (read-only by default)
reelier diff <name>                 # SAME or DRIFTED, per step — exit 1 on drift
reelier push <name>.skill.md        # sync receipts to your ledger (opt-in)
reelier ci                          # write a workflow: drift-CI + PR receipts, one command
```

1. **Inspect, then record or freeze.** `reelier init` reveals observed coverage and local candidates without changing routes. `reelier mcp --wrap "<mcp server>"` proxies live tools; `reelier scan`/`from-session` freezes supported history.
2. **Compile.** `reelier compile` turns a trace into a `SKILL.md` — 0 LLM calls, minimal assertions, honest gaps printed as **Open questions**.
3. **Replay.** `reelier run` replays it at Level 0 — no LLM, byte-identical, read-only by default (writes need `--allow-writes`).
4. **Diff.** `reelier diff` reports SAME or DRIFTED per step, with the failing assertion as the *why* — exit 1 on drift.
5. **Log in.** `reelier login` connects this machine to Reelier Cloud with a device code in your browser — or set `REELIER_CLOUD_URL`/`REELIER_CLOUD_KEY` for CI and self-hosting.
6. **Push.** Every run is a receipt; `reelier push` optionally syncs it to a ledger for a permalink and an embeddable verified-replay badge.

Already have an Agent Skill? Convert it — your skill, minus the model:

```sh
reelier compile trace.jsonl --from-skill ./my-skill/SKILL.md
```

## Three tests, one skill

| Test | Command | Answers |
| --- | --- | --- |
| **Determinism** | `reelier run <skill.md>` | *Does this still do what it did?* |
| **Recovery** | `reelier run <skill.md> --fail N` | *If this broke, would the skill notice and heal?* |
| **Drift** | `reelier run <skill.md> --wrap "<your mcp server>"` | *Has the world moved out from under this skill?* |

*Taxonomy due to Mads Hansen's review of the launch post.* Full semantics for each test, including recovery injection and manifest guardrails: [docs/REFERENCE.md](./docs/REFERENCE.md).

## Gate Dependabot / Renovate bump PRs

Dependabot and Renovate open the PR and run your test suite — but neither knows what your agent actually *does* at runtime, so a dependency bump that silently changes a tool call's shape (a renamed field, a new default, a different error) sails through with green unit tests. This is the check they don't run.

Copy [`.github/workflows/reelier-bump-check.yml`](.github/workflows/reelier-bump-check.yml) into your repo, point `skill:` at your own recorded `.skill.md` file(s), and it will: gate to PRs from `dependabot[bot]`/`renovate[bot]` (or a `dependencies` label), install the bumped dependency, replay your recorded skill live against it at `--max-level 0` (0 tokens), and fail the check on the exact step that drifted.

This tests dependency and MCP-tool-call behavior — it does **not** test model upgrades; `--max-level 0` never calls an LLM. Full listing copy and setup: [`docs/marketplace-listing.md`](docs/marketplace-listing.md).

## Prove it

A pushed receipt carries a ladder of independently-verifiable claims — not one blanket "verified." Depending on what you turn on, it can be signed, timestamped, CI-attested, and carry cross-checkable provider request-ids. `reelier verify` recomputes every claim offline, and a claim you haven't enabled just renders as an honest gap, never a shamed one.

See a real one: [reelier.com/r/HWBdmGob9KeHRqXi-OEaRD0z](https://www.reelier.com/r/HWBdmGob9KeHRqXi-OEaRD0z).

Full 8-rung ladder, what each rung does and doesn't prove: [docs/REFERENCE.md](./docs/REFERENCE.md).

## If your skills are employees

| Employee lifecycle | Reelier equivalent |
| --- | --- |
| Skillify a session | `reelier from-session` |
| Performance review | `reelier run` + `reelier diff` |
| Fleet maintenance | scheduled replays + drift alerts |
| The record | signed receipts |

"Verified" describes the record, never the agent — a receipt proves what ran and what changed, not that the agent was good at its job.

An employment contract doesn't make an employee good — it makes what they did visible and bounded. Same here: receipts prove scope and change, never correctness.

## Who it's for

- **Solo dev / OSS maintainer** — a real regression test again; drift can't pass silently.
- **Team shipping agent changes** — "it ran clean" becomes a checkable PR artifact, not a claim.
- **Agency running agents for clients** — signed, timestamped proof-of-delivery a client can verify.
- **Marketplace buyer or seller** — corroborated receipts are reviews that can't be astroturfed.
- **Audit-facing ops** — a signed, CI-attested trail of every write, idempotency key included.

---

MIT, free forever (versions ≤0.16.0 remain AGPL-3.0). Your data — skills, traces, runs — is specified in [SPEC.md](./SPEC.md), so leaving is copying a folder.

**Contributing:** issues and PRs welcome — [SPEC.md](./SPEC.md) is the source of truth for formats; fix the code, not the spec. `npm test` before a PR.

<div align="center">

**If Reelier saved you a re-run, [star it](https://github.com/seldonframe/reelier) ⭐ — it's how other builders find it.**

</div>
