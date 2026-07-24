<div align="center">

<img src="https://www.reelier.com/avatar.svg" width="72" alt="Reelier" />

# Reelier

### Agents make claims. Reelier writes receipts.

**Upgrade the model on Friday.**

Record the run that worked, replay it deterministically — **0 tokens, byte-identical, a receipt on every step** — and `reelier diff` catches the day it drifts.

**Think of it as CI + snapshot tests for your agent's tool-call workflows.**

[![npm version](https://img.shields.io/npm/v/reelier.svg?color=blue)](https://www.npmjs.com/package/reelier)
[![CI](https://github.com/seldonframe/reelier/actions/workflows/ci.yml/badge.svg)](https://github.com/seldonframe/reelier/actions/workflows/ci.yml)
[![tests](https://img.shields.io/badge/tests-691%20passing-brightgreen.svg)](./test)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/nSp5sd4v)
[![stars](https://img.shields.io/github/stars/seldonframe/reelier?style=social)](https://github.com/seldonframe/reelier)

**[Website](https://www.reelier.com)** · **[Docs](https://www.reelier.com/docs)** · **[SPEC.md](./SPEC.md)**

<img src="https://raw.githubusercontent.com/seldonframe/reelier/main/docs/assets/reelier-demo.gif" width="760" alt="Reelier: record a run that worked, replay it deterministically at 0 tokens, diff for drift, a receipt on every step" />

<sub><a href="https://www.reelier.com/reelier-explainer.mp4">▶ watch with sound (22s)</a></sub>

<a href="https://glama.ai/mcp/servers/seldonframe/reelier"><img width="380" height="200" src="https://glama.ai/mcp/servers/seldonframe/reelier/badge" alt="Reelier MCP server on Glama" /></a>

</div>

---

## Why

AI agents are non-deterministic — the same prompt, a different result every run — and they'll claim they did the work whether they did or not. Reelier records the run that worked, replays it deterministically at $0, and writes a signed receipt that proves it. Point it at your existing CI in one workflow — it adds a verifiable receipt, it doesn't replace your stack.

Measured on a real head-to-head benchmark, same task, same data ([full method](./docs/REFERENCE.md#benchmark-method)):

- **1,000 / 1,000 replays byte-identical**
- **~50× cheaper**
- **~59× faster**

## Install

```sh
npm i -g reelier && reelier init
```

```sh
# No Node install needed — same commands via Docker:
docker run --rm ghcr.io/seldonframe/reelier --help
```

`reelier init` scans work you've already done (Claude Code, Codex, OpenClaw) into a real skill, or falls back to a zero-setup demo with a real receipt in under 60 seconds.

## How to use it

```sh
reelier init                        # 60s: record → compile → replay → your receipt
reelier run  <name>.skill.md        # replay deterministically — 0 tokens (read-only by default)
reelier diff <name>                 # SAME or DRIFTED, per step — exit 1 on drift
reelier push <name>.skill.md        # sync receipts to your ledger (opt-in)
reelier ci                          # write a workflow: drift-CI + PR receipts, one command
```

1. **Record.** `reelier mcp --wrap "<mcp server>"` proxies your tools live, or pull a session via `reelier scan`/`from-session`, or run the guided `reelier init`.
2. **Compile.** `reelier compile` turns a trace into a `SKILL.md` — 0 LLM calls, an assertion per step, honest gaps printed as **Open questions**.
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

## Prove it

A pushed receipt carries a ladder of independently-verifiable claims — not one blanket "verified." Depending on what you turn on, it can be signed, timestamped, CI-attested, and carry cross-checkable provider request-ids. `reelier verify` recomputes every claim offline, and a claim you haven't enabled just renders as an honest gap, never a shamed one.

See a real one: [reelier.com/r/HWBdmGob9KeHRqXi-OEaRD0z](https://www.reelier.com/r/HWBdmGob9KeHRqXi-OEaRD0z).

Full 8-rung ladder, what each rung does and doesn't prove: [docs/REFERENCE.md](./docs/REFERENCE.md).

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
