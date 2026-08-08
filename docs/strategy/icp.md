# Reelier — who benefits most, and what that decides

_Written 2026-08-04. The source-of-truth targeting doc: who Reelier is for, in what order, and which
roadmap choices follow from that. Living reference — update it in place rather than superseding it.
Read it before scoping a provider pack, an integration, or landing copy._

---

## 0. Current state (what is TRUE right now)

**Read this before quoting any line below to a customer.** This doc sets *targeting*, and most of what
it targets is Path C, which is not a shipped product.

- **Paths A and B ship.** `reelier@0.30.0` is on `main`; npm still serves 0.29.0 because publishing is
  manual. The live proxy and recorded replay work today.
- **Path C does not ship.** It is an unmerged draft on `codex/universal-compiled-authority` (PR #85 —
  no merge, release, or publish authorized). Its wire schemas, delegation validation, and local atomic
  ledger exist. Contract selection, gate decisions, dispatch, provider writes, the credential broker,
  ingress transport, receipts, and every concrete pack are **designed, not built** (`AGENTS.md`).
- **Reelier does not scope, broker, or hold credentials — on any path, by charter.** Credential
  scoping is on the never-ours list (`CLAUDE.md` §7.5). Path C's *design* is to delegate bounded
  outcomes instead of credentials; that is intent, not shipped behaviour.
- **No completeness claim exists.** Reelier sees MCP-shaped traffic only, and no receipt proves that
  *every* write was receipted. Completeness attestation is designed, not built (`CLAUDE.md` §8).
- Reelier certifies the **scope** of a change, never its semantic correctness.

Wherever this doc speaks of Path C in the present tense, read it as design intent under those
constraints.

---

## 1. The one-sentence ICP

The highest-value Reelier user is **not "anyone using an AI agent."** It is:

> A person or team whose agent can cause a consequential external change while they are not watching,
> and who currently must choose between blocking automation or granting broad credentials.

That person understands Reelier immediately, uses it daily, and has a reason to become a Path C
customer. Everyone else is discovery.

## 2. The three user layers

### 2.1 Distribution users — coding-agent operators

Claude Code, Codex, Cursor, and developers wiring up MCP servers. Their job is *"let my agent work
faster without losing visibility or control."*

They are excellent **Path A and Path B** users: Path A wraps their MCP tools and shows what the agent
is doing; Path B turns repeatable procedures into deterministic, testable skills. They generate
traces, examples, issues, and word of mouth.

Most will **not** immediately need Path C. A coding agent reading files, editing code, or opening a
pull request may benefit from Reelier, but urgency is low unless it also touches production systems,
customer data, deployments, payments, or communications. This layer is top of funnel.

### 2.2 Daily autonomy users — personal-agent operators

GBrain operators, OpenClaw users, Hermes users, Eve operators running scheduled or durable agents.
Their agents run overnight, ingest and modify memory, send messages, update CRM records, manage
calendars, execute scheduled workflows, call external APIs, and delegate to subagents.

They are the **strongest Path C candidates**, because the agent is already acting continuously and
unattended. Their question is not "can the agent call this tool?" It is:

> "Can I let the agent do this while I sleep and still know exactly what it was allowed to change?"

This is the layer **Path C is designed to be**: a consequential write carries bounded authority rather
than a credential, a recurring workflow carries a contract, a result carries an acknowledgement and
reconciliation claim graded `verified`/`failed`/`unchecked`/`absent`, and uncertainty stays an
explicit non-success state.

Of those, only the four-state grading ships today; contract selection, gate decisions, provider
writes, and receipts are unbuilt (§0). And note the quantifier that is deliberately absent — nothing
proves that *every* write went through Reelier. Completeness attestation is designed, not built.

### 2.3 Economic buyers — teams, agencies, and platform owners

Small companies deploying agents across teams, AI automation agencies, internal platform and security
teams, companies building agent products, and consultants responsible for client automation.

They buy **Path C and Cloud** because they need multiple principals, isolated credentials, shared
policy, expiry-bound authority, audit-ready receipts, exception review, proof for customers or
regulators, and one control layer across different agent frameworks. They often discover Reelier
through a developer using Path A or B, but they purchase when the question turns organizational:

> "How do we let ten agents perform real work without giving each one unrestricted access?"

## 3. Framework fit

| Users | Best first path | Best long-term value |
|---|---|---|
| Claude Code | A/B | C when connected to production or customer systems |
| Codex | A/B | C for external writes and autonomous workflows |
| Cursor | A/B | C for deployment, operations, and integrations |
| GBrain | A/B for memory operations | C for unattended ingestion, enrichment, multi-user writes |
| OpenClaw | A for live tools/channels | C for messaging, CRM, calendar, device actions |
| Hermes | A/B for tools, skills, cron | C for scheduled jobs, subagents, external side effects |
| Eve | A/B for tool/workflow development | C for durable scheduled workflows and provider actions |

**The framework is not the distinction. The type of action is:**

```text
Read-only or local work              → Path A/B
Repeatable controlled procedure      → Path B
Unattended external side effect      → Path C
Third-party evidence or governance   → Path C + Cloud
```

## 4. How conversion actually happens

Path A and B users do not automatically become Path C customers. They convert after a **trust event**.

```text
Agent user installs Path A
        ↓  sees tool calls and effects
Compiles a repeatable workflow with Path B
        ↓  agent reaches a consequential external write
User hits credential, audit, or unattended-execution risk
        ↓  Reelier blocks or explains the boundary
User activates Path C for that specific workflow
        ↓  the workflow runs repeatedly and expands inside the team
```

The trigger is usually one of: *"I want this agent to run overnight." · "I don't want to give it my
production API key." · "I need to prove what it changed." · "The provider response was ambiguous." ·
"Several agents now need the same permission." · "A customer or auditor will ask how this action was
authorized." · "I need the agent to act, but not invent recipients, amounts, or endpoints."*

## 5. Priority order

1. **Autonomous personal-agent operators** — OpenClaw, Hermes, GBrain, Eve schedules. High action
   frequency, visible risk, natural daily use case.
2. **AI automation agencies** — strong multipliers, immediate need: *"deploy agent workflows for
   clients without becoming the holder of every credential or reviewing every action by hand."*
3. **Agent-framework and skill authors** — they embed or recommend Reelier inside OpenClaw skills,
   Hermes skills, GBrain integrations, Eve tools, and MCP servers. Not necessarily buyers; they are
   **distribution infrastructure**.
4. **Coding-agent users** — largest discovery audience, excellent for Path A/B, but only a subset
   have urgent Path C need. Do **not** position Reelier to them as "security software for coding."
   Position it as *the control and evidence layer when your coding agent starts making real-world
   changes.*

## 6. How each group finds Reelier

- **Agents** find it through `SKILL.md`, MCP metadata, `AGENTS.md`, `llms.txt`, framework
  integrations, exact task descriptions, install recipes, and blocked-action recommendations.
- **Humans** find it through questions: *"How do I safely let OpenClaw send messages?" · "How do I
  audit MCP writes?" · "How do I stop Hermes from using unrestricted credentials?" · "How do I verify
  an AI agent actually changed the CRM?" · "How do I give GBrain controlled write access?" · "How do
  I run an agent overnight safely?"*
- **Teams** find it through public receipts, customer case studies, benchmark results, audit
  requirements, agency recommendations, and framework partnerships.

## 7. Positioning lines

| Audience | Line |
|---|---|
| Audience | Line | Ships today? |
|---|---|---|
| Individual agent users | "See and control what your agent changes." | **yes** — Paths A/B |
| Autonomous operators | "Let your agent act while you sleep without handing it unrestricted credentials." | **no** — Path C design intent |
| Agencies | "Deploy agent workflows for clients with bounded authority and durable proof." | **no** — Path C + Cloud |
| Companies | "Delegate real work without losing control of external side effects." | **no** — Path C |

> **The credential line is the one to be careful with.** It is the most quotable sentence here and it
> describes the thing no shipped path does: on Paths A and B the agent still holds the same
> unrestricted credential it always held, and the seatbelt denies by tool name and host glob rather
> than scoping the secret. Reelier never scopes, brokers, or holds credentials — that is a charter
> never-ours (§0). What Path C is *designed* to do is let the agent act on a compiled capability
> instead of a credential. Until it ships, use the line only with that framing. The shipped-today
> equivalent is: *"every MCP write bounded before it happens and attested after."*

The growth strategy in one line: **use Path A and B as the free discovery and trust-building layer;
convert to Path C when the agent needs to perform consequential, unattended, externally verifiable
work.** Path A/B create familiarity and evidence. Path C becomes necessary when the user is ready to
delegate outcomes rather than merely observe activity.

## 8. What this decides in the roadmap

Recorded 2026-08-04 against the Path C SDD ledger.

**HighLevel and Slack are not ICP frameworks**, so SDD task 5 (HighLevel pack and host guides) and
task 6 (Slack pack and ABI freeze) are **not targeted as scoped**. Two pieces bundled inside them are
**not** dropped:

- **ABI freeze** (was inside task 6). Cloud PR `seldonframe/reelier-cloud#54` merges only after the
  OSS ABI is frozen **and PR #85 is merged** — both conditions, per the PR body. Per §2.3 Cloud is
  what the paying segments buy, so dropping task 6 wholesale would remove the gate on the deliverable
  those segments purchase. It needs a brief of its own.
- **Host guides** (were inside task 5). Priority-3 framework authors are the distribution channel, so
  the guides are **retargeted** from HighLevel to the priority-1 frameworks, not deleted.

### 8.1 The substrate constraint — read this before choosing a pack

The priority-1 segment splits into two very different classes for Reelier's evidence model, and the
split does not follow the marketing:

| Action class | Evidence available | Verdict |
|---|---|---|
| CRM rows, calendars, memory stores | read-back tool exists → `attest` proves post-state scope | **strong** |
| Sends, messages, notifications | no post-state → nothing on released code; a pre-dispatch `emit:` commitment once 0.31.0 ships | **weakest** |

`attest` needs a read-back tool, and there is no "get the email you just sent." Note the floor for a
send on **released** code today is no evidence at all: `emit:`, `attest.defer:`, and `reelier resolve`
all live in the unreleased worktree. Even once they ship, `emit:` commits the artifact that left, not
its delivery, and a deferred `attest` proves post-state *at resolution time*, never a delta across the
write (`docs/specs/artifact-attestation-v1.md`, `CLAUDE.md` §7.1).

So *"let your agent send messages while you sleep"* is simultaneously the most resonant pitch in §7
and the thinnest proof Reelier can offer. **Pick a read-back-bearing surface for the first pack.** A
messaging-first pack would put the weakest evidence in front of the most important audience, and
brand invariant #1 forbids presenting that gap as a pass.

The corpus is thinner than it looks, so do not lean on it. Counted live 2026-08-04: `read` 45,
`idempotent-write` 2, `destructive` 2. Of those four non-read steps, three are GBrain
(`examples/gbrain/gbrain-capture-enrich.skill.md`) and one is an HTTP ping in
`examples/trust-ladder-demo.skill.md`. **Exactly one step in the entire corpus is an attested write**
— GBrain's `put_page`, probed by `get_page` with an explicit projection and live-verified in CI. Of
the other two GBrain steps, `extract_entities` carries no `attest`, and `extraction_pending` is a pure
read the file itself documents as over-classified `destructive` by fail-closed default.

GBrain is still a priority-1 framework and still the only attested non-git write, so extending it
remains the cheapest route to a credible write corpus — but the corpus proves one write today, not
four. This also **corrects** `CLAUDE.md` §5; see §10.

## 9. What this doc does not claim

It sets targeting, not capability. §0 is the binding statement of what ships; everything else is
targeting logic written on top of it. In particular this doc does **not** assert that Path C is
purchasable or activatable today, that any pack, host guide, or integration named here exists, that
Reelier scopes or brokers credentials, or that any receipt covers *every* write. Check `AGENTS.md`
and `CLAUDE.md` for shipped-versus-designed state before repeating anything here to a user.

## 10. Open correction — `CLAUDE.md` §5 is stale

Writing §8.1 surfaced a factual error in the pinned capabilities doc. `CLAUDE.md` §5 states *"All 4
write steps are the two gbrain files."* Counted live on 2026-08-04, the four write steps are:

| File | `idempotent-write` | `destructive` |
|---|---|---|
| `examples/gbrain/gbrain-capture-enrich.skill.md` | 1 | 2 |
| `examples/trust-ladder-demo.skill.md` | 1 | 0 |

So it is **three of four**, in one GBrain file plus one non-GBrain file — and only one of the two
GBrain skill files carries writes at all. The effect totals in that section (45 / 2 / 2) are correct.

A second, larger gap sits behind the same sentence: of those four steps only **one** is an attested
write (`put_page`). `extract_entities` has no `attest`, and `extraction_pending` is a pure read that
fail-closed classification marks `destructive`. So the corpus demonstrates one attested non-git write,
not four writes — which makes the demo gap in §5 wider than that section implies, not narrower.

This does not change any conclusion here; §8.1 rests on the single attested GBrain write and that
still holds. It is recorded because `CLAUDE.md` is pinned precisely so it does not go stale, and a
capabilities doc drifting from the corpus it describes is the exact failure class this product exists
to catch. Fixing it should follow the re-verification procedure in `CLAUDE.md` §10, not a one-line
patch.
