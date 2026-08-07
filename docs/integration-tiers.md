# Integration tiers: what you get at each depth

Reelier is not one thing you install. It is three depths of integration, and most teams only ever
need the first. This page exists because the depths were only ever discoverable by reading the
README end to end and inferring them — which is a bad way for a platform team to evaluate anything.

The tiers are defined by **what a human has to do**, not by lines of code. Reelier is not an SDK;
there is nothing to import.

| Tier | What you do | Who does it | Repo change |
| --- | --- | --- | --- |
| **0 — Install** | Install an App, or put the CLI in front of what you already run. | Platform / infra | none |
| **1 — Commit a file** | Commit a skill file, a declared scope, or a policy. | Whoever owns the repo | one file |
| **2 — Approve** | A human binds a specific write to a specific reviewed state. | The person who says no today | one file + a ceremony |

Each tier includes everything below it. **Nothing at any tier requires changing agent code**, and
no tier puts a model in the verification path.

---

## Tier 0 — install (no repo change)

### Receipts on agent PRs — the zero-config path

Install the GitHub App. The next PR an agent opens carries a receipt comment: declared scope, files
changed, unexpected-write count, sensitive paths touched, and a signed permalink.

No workflow, no CLI, no config file. If you do nothing else, this is the whole product.

### Drift CI in one command

```sh
reelier ci
```

Discovers the repo's `*.skill.md` files and writes `.github/workflows/reelier-replay.yml` — replay
on every PR plus a daily schedule, manifest preflight failing closed, permissions preconfigured. It
refuses to overwrite an existing workflow without `--force`, and with zero skills found it writes
an honestly-marked placeholder rather than an invented path.

### Recording what already runs

```sh
reelier mcp --wrap "<your mcp server>"
```

A proxy in front of servers you already run. The agent does not know it is there. Every tool call
is recorded to a local trace; the deny-list in `.reelier/policy.yml` is enforced at that chokepoint
rather than in a prompt where it can be argued with. The wrap sees only servers it fronts —
plugin-delivered MCP servers load from plugin-owned manifests `install` does not inspect (see
[What no tier does](#what-no-tier-does)).

**What Tier 0 gives you:** a record of what agents did, drift detection on anything repeatable, and
a receipt anyone can check. **What it does not:** it cannot stop a write. Everything here observes.

**Failure posture:** fail open. The recorder must never be the reason your agent stops working.

---

## Tier 1 — commit a file

### A skill file — deterministic replay

`reelier init` scans work you have already done into a `SKILL.md`, or records a fresh run. Once
committed, `reelier run` replays it with **no model in the loop**: 0 tokens, byte-identical, and
`reelier diff` reports SAME or DRIFTED per step with the failing assertion as the *why*.

This is the tier where "did this job change" becomes answerable instead of a vibe.

### `.reelier/scope.yml` — declared write scope

Glob allowlists per agent author. Turns the receipt's unexpected-write count from *"scope: not
declared"* into a real number. Until you commit this, the receipt honestly reports that it has
nothing to compare against — it never renders `0 unexpected` for an undeclared scope.

### `.reelier/policy.yml` — the deny-list

Human-declared deny and dry-run rules, enforced at the recorder chokepoint. A malformed file
degrades to *deny nothing*, warns once, and leaves a gap marker in the trace — enforcement being
silently off is the one thing that must never happen quietly.

### `.reelier/agents.yml` — which authors are agents

Detection defaults to `[bot]` logins and `claude/`-style branch prefixes. If your agents commit
under a human login on ordinary branch names, they are invisible to it until you say so here.

**What Tier 1 gives you:** drift caught before a human notices, and a declared expectation to
compare observed change against. **What it does not:** still nothing here refuses a write.

---

## Tier 2 — approve (a human decides once)

This is the only tier that can refuse, and it is the only one requiring a person.

### `reelier approve` — bind a yes to an operation

Hash-binds one write step to its exact tool and argument template. An approved step whose tool or
args have drifted since is refused, and **no flag overrides that refusal** — not `--allow-writes`,
not `--yes`. That is the entire reason the binding lives in a committed file rather than an
invocation flag: a control an agent can pass a flag to defeat is not a control.

### `reelier approve --probe` — bind a yes to the world

The step's declared probe runs at approve time, the projected state is shown to the approver, and
the approval is stamped with a keyed commitment. At execute time the runner re-observes through the
same probe and compares. Approved five minutes ago is not the same as still true now.

A mismatch names **which declared field moved** — names, never values.

### `state_gate: refuse` — turn the recorder into a gate

One line at the top level of `.reelier/policy.yml`. A write whose pre-state check lands `mismatch`
or `unevaluated` is refused **before dispatch**: the record carries no `write` block and no
`attest`, so the call provably never went out. Refusing on `unevaluated` is deliberate — after a
key is deleted, which is how a binding is revoked, the approval is no longer evidence.

**Failure posture:** fail closed. Two controls, one job each; the recorder still fails open at
Tier 0 and always will.

---

## Choosing a tier

- **You want to know what your agents did.** Tier 0. Stop there.
- **You have jobs that run repeatedly and you would notice if one quietly changed.** Tier 1.
- **Someone in your organization currently says no to agent write access.** Tier 2 is the
  conversation to have with them, and it is the only tier that answers them.

Do not start at Tier 2. An approval ceremony over a workflow nobody has a record of yet is
ceremony without evidence.

---

## What no tier does

Stated here so it is not inferred from silence:

- **No tier proves a change was correct.** Every tier proves what changed and whether it stayed in
  declared scope. In-scope-and-wrong is a real category and Reelier does not detect it.
- **No tier observes plugin-delivered MCP calls.** Reelier `install` wraps MCP entries it finds in
  supported host configuration files. It does not inspect plugin-owned MCP manifests.
  Plugin-delivered calls are therefore outside Reelier's observed boundary unless the plugin
  itself invokes `reelier mcp --wrap`, or the host exposes the entry through a supported
  configuration and Reelier subsequently rewrites it. Reelier currently has no native wrapping
  path for URL-based MCP servers. Receipts attest only calls that traversed Reelier; they do not
  prove that every host or plugin write was observed.
- **No tier inspects prompts** or makes any claim about model behavior.
- **No tier is a sandbox.** Run agents in whatever isolation your platform provides.
- **No tier puts a model in the verification or enforcement path.** Record, hash, compare, gate —
  all deterministic, which is why a better model cannot make the check less trustworthy, or more.

See [docs/security/threat-model.md](./security/threat-model.md) for boundaries and residual risk.
