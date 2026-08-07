# Threat model (v0)

> **Review status: SELF-REVIEW.** These are the maintainer's own notes, written by the same party
> that wrote the code. **No independent security audit has taken place, and no second reviewer has
> read this document.** It is published because a stated threat model someone can argue with is
> worth more than an unstated one, not because it has been validated. Corrections and adversarial
> review are welcome — open an issue, or see `SECURITY.md` for anything you would rather not say in
> public.
>
> Applying our own rule to ourselves: an unreviewed document is `unchecked`, and `unchecked` is
> never a pass.

Scope: the `reelier` CLI and the file formats in `SPEC.md`. The hosted ledger has its own
boundaries and is out of scope here except where the wire contract touches it.

---

## 1. What this thing actually is, security-wise

Reelier sits in two very different positions, and conflating them is the fastest way to reason
about it wrongly:

1. **In the data path, at record time.** `reelier mcp --wrap` proxies live tool calls. Everything
   the agent sends and receives passes through it.
2. **In the control path, at replay time.** `reelier run` decides whether a declared write executes.

Position 1 must never break the agent, so it **fails open**. Position 2 is a gate, so it **fails
closed**. Two controls, one job each — and most of the interesting threats below come from
confusing which one you are looking at.

---

## 2. Trust boundaries

| # | Boundary | Who is untrusted |
|---|---|---|
| 1 | Agent → recorder | The agent. Its tool calls are attacker-influenceable via prompt injection. |
| 2 | Downstream tool → recorder | The tool server. Responses are untrusted input, including tool *definitions*. |
| 3 | Skill file → runner | Anyone with write access to the repo. A skill file is a declaration of intent to write. |
| 4 | Runner → downstream tool | The runner is the actor here; the blast radius lives on the far side. |
| 5 | Local keystores → everything | `~/.reelier/signing/`, `~/.reelier/expect-keys.json`. Compromise here forges claims. |
| 6 | Record → receipt consumer | The consumer trusts nobody, which is the entire point. |

---

## 3. Threats and where they are handled

### 3.1 The recorder is in the data path (boundary 1)

| Threat | Handling |
|---|---|
| A malformed policy file bricks every tool call | Policy parse failure at wrap runtime degrades to **deny nothing**, warns once, and leaves a gap marker in the trace. Fail-open is deliberate here: a trust layer that stops the agent working is uninstalled within a day. |
| Secrets captured into a trace or record | Redaction runs at record time, before anything reaches disk (`src/redact.ts`). **Residual risk: redaction is pattern-based and cannot be complete.** A novel secret format lands in the trace. |
| The recorder becomes a data-exfiltration surface | Traces are local files. `push` is opt-in and sends only what `SPEC.md` §8 describes. |

### 3.2 Tool definitions change after approval (boundary 2)

The ecosystem name for this is a **rug pull**: a server presents one tool contract when you review
it and a different one when you call it.

Handled by `reelier manifest` — a per-tool schema digest stamped onto the skill, preflighted
against the live servers before step 1 and **failing closed** on any missing tool or schema
mismatch. `--ignore-manifest` is the explicit override and is stamped into the record
(`manifestIgnored: true`), never silent.

**Residual risk:** the digest covers the tool's `inputSchema`. A server that keeps its schema and
changes its *behavior* is not detected by the manifest, and cannot be — that is what the state
check (§3.4) and run-shape priors exist for.

### 3.3 The skill file is the real attack surface (boundary 3)

A skill file declares which tools run with which arguments. Whoever can edit it can change what
executes. This is the highest-value target in the system and the defenses are layered:

- Write and destructive steps are **read-only by default** on replay.
- A step carrying `approve:` is hash-bound to its exact tool and argument template. A drifted step
  is refused, and **no flag overrides that refusal** — this is why the opt-in lives in a committed
  file rather than an invocation flag: a control an agent can talk its way past is not a control.
- `expect:` binds the approval to observed state under a key that never enters the repo.

**Residual risk:** an attacker with repo write access and the ability to get a human to re-approve
can do anything the human would approve. Nothing here defends against a convinced approver, and
§3.6 is about not making that worse.

### 3.4 State moved between approval and execution (boundary 4)

Handled by the state check: re-observe through the declared probe, compare keyed commitments,
report `match` / `mismatch` / `unevaluated`. Under `state_gate: refuse` a mismatch or an
unevaluated check refuses before dispatch, and the record carries no `write` block — the call
provably never went out.

**Residual risk, stated in `SPEC.md` and repeated here:** this is check-then-act against an
observation, not compare-and-swap at the resource. A window exists. Where a tool supports
`If-Match`, use the tool's own conditional write; this is the vendor-neutral fallback with a paper
trail, not a substitute for atomicity.

### 3.5 Key compromise (boundary 5)

| Key | Compromise means |
|---|---|
| Signing key (`~/.reelier/signing/`) | Forged `unaltered-since-push` claims. Mitigation: keys never leave the machine, never enter a repo, and `.reelier/` is deny-all in `.gitignore` with explicit config-only exceptions. |
| Expect keystore (`~/.reelier/expect-keys.json`) | Forged state-check matches. Same custody rules. Deleting an entry is revocation and degrades loudly to `unevaluated`, never to a silent pass. |

MAC comparisons are constant-time (`macEquals`); a source lint prevents a raw `===` returning.
**Residual risk: there is no key revocation feed.** A stolen signing key produces valid receipts
until someone notices out of band. This is the largest known hole and it is named in
`principal-delegation-v0.md` §6 as well.

### 3.6 The receipt is misread (boundary 6)

The failure that worries us most, because it is the one where the product causes the harm.

A receipt proves **what changed and whether it stayed in declared scope**. It does not prove the
change was correct or safe. A buyer who reads a green receipt as "safe" and grants write access on
that basis has been misled by us, whatever the fine print said.

Handling is editorial and structural, not technical: no blanket ✓/"safe"/"verified" verdicts;
checkmarks only on individually proven claims; four-state honesty everywhere (`verified` /
`failed` / `unchecked` / `absent`), with `absent` and `unchecked` never rendering as a pass; and
`SPEC.md` §4.6 enumerating exactly which bytes the signature covers.

**Residual risk: unbounded.** This is a language and design problem that recurs with every new
surface, and no test catches it.

### 3.7 Plugin-delivered MCP servers never reach the recorder (boundary 1)

Agent plugin systems — Claude Code plugins today, the Agent Plugins standard (v1.0.0, 2026-08-06)
portably — deliver MCP servers through plugin-owned manifests. Reelier `install` wraps MCP entries
it finds in supported host configuration files. It does not inspect plugin-owned MCP manifests.
Plugin-delivered calls are therefore outside Reelier's observed boundary unless the plugin itself
invokes `reelier mcp --wrap`, or the host exposes the entry through a supported configuration and
Reelier subsequently rewrites it. Reelier currently has no native wrapping path for URL-based MCP
servers.

The threat that matters is a §3.6-shaped misreading: a consumer who assumes wrap coverage extends
to plugin-delivered servers. Receipts attest only calls that traversed Reelier; they do not prove
that every host or plugin write was observed. Handling is editorial (this section;
`docs/REFERENCE.md`; `docs/integration-tiers.md`; CLAUDE.md §7.6) plus a proposed read-only
observed-coverage probe (`docs/specs/agent-plugins-coverage-v1.md`) that reports inventory, never
completeness.

**Residual risk:** the boundary moves with every host and plugin-system release, and nothing
enforces that these documents move with it.

---

## 4. Explicitly out of scope

- **Prompt injection.** Reelier does not inspect prompts and makes no claim about model behavior.
  It constrains what a tool call may do, not what the model may think.
- **Semantic correctness.** See §3.6.
- **Sandboxing and process isolation.** Reelier is not a sandbox. Run agents in whatever isolation
  your platform provides; that is a different layer and we do not replace it.
- **Availability of downstream tools.** The runner reports what happened; it is not a proxy that
  keeps your dependencies up.
- **The hosted ledger's own infrastructure.**

---

## 5. Reporting

See `SECURITY.md`. Please do not open a public issue for a vulnerability.
