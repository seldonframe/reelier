# Reelier reference

Technical depth that doesn't belong in the [README](../README.md). Start there; come here for the details.

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

Normative spec: [specs/trust-ladder-v1.md](./specs/trust-ladder-v1.md)

`reelier verify <permalink|file> [--key <pub.pem>]` recomputes every claim offline — never a bare OK:

```sh
reelier verify https://reelier.com/r/<token> --key mykey.pub.pem
# unaltered-since-push: ✓ (key a1b2c3d4e5f6a7b8)
# timestamped: imprint ✓ (tsa https://freetsa.org/tsr) — full chain verification: openssl ts -verify ...
```

Absent claims render honestly, never shamed — `— unsigned`, not "insecure." Only a **present**, failing claim fails the exit code; absent/unchecked never do.

Normative spec: [specs/flight-recorder-v2.md](./specs/flight-recorder-v2.md)

## CI: replay on every PR

`reelier ci [--force] [--path <dir>]` discovers every `*.skill.md` in the repo (depth-capped, `node_modules`/`.git` excluded) and writes `.github/workflows/reelier-replay.yml` — one command instead of hand-copying [`reelier-replay.example.yml`](../.github/workflows/reelier-replay.example.yml). `--path` overrides the discovery root only; the workflow file itself always lands under the current directory's `.github/workflows/`. Refuses to overwrite an existing file without `--force`. Zero skills found still writes the workflow, with a clearly-marked placeholder path and a `reelier init` nudge — never a silently-invented real-looking path.

The generated workflow:

- Triggers on `pull_request`, a daily `schedule`, and manual `workflow_dispatch`.
- Runs one matrix job per discovered skill, so one skill's replay failing never hides another's receipt.
- Replays fail-closed (the drift/manifest preflight in `reelier run`, see above) and gates the check on the replay's own exit code — a red check here is a genuine failure, never a workflow bug.
- Posts a sticky PR receipt comment (one comment per PR, upserted every run) via the action's `pr-comment` input — one section per skill, so a matrix of skills reads as one comment, not N. Needs `permissions: pull-requests: write` (the generated workflow sets it); without it, the action logs a skip line and the replay's pass/fail is unaffected.
- Carries a commented-out `cloud-key` push block pointing at a `REELIER_API_KEY` secret — uncomment it to also sync receipts to your ledger; also needs `permissions: id-token: write` for the push's CI attestation (the generated workflow sets this too).

## Guardrails: manifest and approve

`reelier manifest` stamps a schema digest per tool a skill uses; drift or a missing tool fails closed — `MANIFEST DRIFT — refusing to replay`. `--ignore-manifest` is the break-glass override, recorded (`manifestIgnored: true`), never silent. A skill with no manifest gets an advisory note.

```sh
reelier manifest <skill.md> --wrap "<your mcp server>"   # stamp/refresh the manifest from live servers
reelier run <skill.md> --wrap "<your mcp server>"         # preflight checks the manifest BEFORE step 1 runs
```

`--allow-writes`/`--yes` are blanket — "may write," not "this write is reviewed." `reelier approve` hash-binds one step's tool + args: a match runs with **no flags at all**; a change fails closed — `Approval mismatch` — and no flag overrides it. No `approve:` field keeps today's behavior.

```sh
reelier approve <skill.md>          # walk each write/destructive step, y/N to approve
reelier approve <skill.md> --all    # approve every write step non-interactively
```

## Recovery testing (`--fail`)

`reelier run <skill.md> --fail N[=status]` injects a synthetic failure at step `N` (default status `500`; override with `--fail N=429`, repeatable) instead of dispatching that step's real tool call, then runs the SAME escalation ladder a real failure would hit. This answers: *if this broke, would the skill notice and heal?*

A mocked step never calls its tool, so a write step is recovery-testable with no `--allow-writes`, no side effect — `reelier push` refuses to publish a mock run.

*Taxonomy (Determinism / Recovery / Drift) due to Mads Hansen's review of the launch post.*

## Run-shape priors (`reelier baseline`)

Your skill's own past runs are already on your disk, at `.reelier/runs/<skill>.jsonl`. `reelier baseline <skill.md>` computes a median + MAD baseline from the previous runs of *that* skill and reports how the latest one sits against it — steps, per-outcome counts, dispatched writes, duration, the gap since the previous run, and the silence since the latest one.

```sh
reelier baseline my-skill.skill.md   # read-only; executes nothing; always exits 0
```

Nothing is transmitted, nothing is compared across skills or machines, and you declare nothing — the run-shape signals exist as soon as there are four runs; gap and silence need five. `reelier run` prints the same block, but only when something actually departed; a repo with no history, or a run that matches its own history, prints exactly what it always did.

What it reports is a **deviation** — a difference from this skill's own history:

```
! writes: 400 (previous 4 runs: median 1, min 1, max 2)
```

Not a cause, and not a verdict. A deviation is not a failure: it changes no outcome, no exit code, and no gate. The rule is one sentence — a value is reported when it lands more than 3 median-absolute-deviations *outside the range the previous runs actually spanned* — so a value your skill has already produced is never called a departure, and with fewer than three prior runs it says so instead of inventing a baseline. Full design, including what was deliberately left out: [`docs/specs/run-shape-priors.md`](specs/run-shape-priors.md).

## Assert grammar

```md
- assert: status == 200
- assert: json.results is array
- assert: json.count >= 1              # numeric range
- assert: json.plan is string          # type
- assert: json.id matches /^usr_/      # value pattern
- assert: body contains "ok"
```

## Session import

`reelier scan` finds replayable workflows in your agent's session logs; `reelier from-session` turns one into a skill, auto-sniffing the format:

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

## MCP server (`reelier serve`)

`reelier serve` exposes Reelier's commands as MCP tools your coding agent can call mid-session:

```json
{ "mcpServers": { "reelier": { "command": "npx", "args": ["-y", "reelier", "serve"] } } }
```

- **reelier_scan** — find replayable workflows in session history
- **reelier_from_session** — compile a session into a SKILL.md
- **reelier_replay** — replay at 0 tokens (read-only by default)
- **reelier_diff** — SAME or DRIFTED per step; exit 1 on drift
- **reelier_push** — sync a receipt to the [ledger](https://www.reelier.com/replays) (opt-in)

## Login: `reelier login` / `logout` / `whoami`

`reelier push`/`get`/`verify`/`serve` default `REELIER_CLOUD_URL` to
`https://www.reelier.com` — no config needed. Credentials resolve in this
order: `REELIER_CLOUD_KEY` env var, then the key stored in the local config
file. Env vars remain the CI/self-hosting path; `login` is the interactive
one.

```sh
reelier login    # connect this machine to Reelier Cloud
reelier whoami    # print who the stored key resolves to
reelier logout    # clear the locally stored key
```

**Device flow.** `reelier login` starts an OAuth-Device-Flow-shaped handshake
against Reelier Cloud: the CLI requests a device code, prints a short user
code (`XXXX-XXXX`) plus an `https://www.reelier.com/activate` link, and
best-effort opens that link in your default browser (falling back to just
printing it if the browser can't be launched). You approve the code on
reelier.com — that's where GitHub OAuth happens; the CLI itself never talks
to GitHub, it only polls Reelier Cloud. Once approved, the cloud mints an API
key: the CLI never sees the user's GitHub credentials, and the minted key is
shown to no one and stored **hashed** server-side. Device codes expire after
15 minutes; an expired or denied code makes `login` exit non-zero with the
reason. `reelier logout` only clears the local credential — it does not
revoke the key server-side; revoke a leaked key from the dashboard's
Settings.

**Config file.** The key (and, if you ever pointed at a non-default cloud, the
URL) are stored at `~/.reelier/config.json`, written with `chmod 0o600`
best-effort (a no-op on platforms without POSIX permissions, e.g. Windows) —
this restricts read access to the current OS user, but the file is **plain
JSON on disk, not encrypted**. Treat it like any other local credential file.

## BYOK

Level-0 never calls a model — 0 tokens, by construction. Escalation (`--max-level 1|2`) is opt-in via one BYOK surface: native Anthropic, or OpenAI-compatible for the rest (OpenRouter, Ollama, Gemini, Groq, vLLM, LM Studio, Kimi, …).

## Benchmark method

A real, live head-to-head benchmark (agent vs. Reelier, same task, same data) — full methodology in [`examples/benchmark`](../examples/benchmark):

- **1,000 / 1,000 replays byte-identical** (N=1000 tail-variance test)
- **0 tokens per replay** — verified from the run record, not assumed
- **~50× cheaper** ($0.000000/replay vs. $0.019068/run averaged over the agent arm)
- **~59× faster** (48ms vs. 2,842ms average latency)
- a real drift **self-healed for ~$0.001**, once, then free every replay after

> **Latency varies by network** — replay re-executes the tool calls. What doesn't vary: **0 LLM tokens**, same steps, receipt. Independently corroborated — [arXiv 2605.14237](https://arxiv.org/abs/2605.14237) found 93.3–99.98% token reduction for the same pattern.
