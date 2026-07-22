# Directory & awesome-list submission payloads (DO NOT SUBMIT — prepared for Max)

Refreshed 2026-07-22 (WS-D of `distribution-master-plan.md`). Every submission
mechanism below was re-verified against the target's live contribute/submit
page — not recalled from the old file. Nothing here has been submitted; each
target's form/PR/issue still needs a human to open it.

## Copy rules (frozen — apply to every payload)

1. **Lead with the CI/snapshot-test frame:** "CI + snapshot tests for agent
   workflows: record once, replay at 0 tokens, diff for drift." Receipts get a
   mention in every payload. Never lead with pricing or cloud.
2. **AGPL-3.0 stays.** Max's decision. Never promise, hint at, or trade on a
   license change in any payload, PR comment, or maintainer reply.
3. **No per-step assertion claims.** The compiler emits minimal asserts. Say
   "asserted receipt on every run" / "verified against the recorded trace" —
   never "an assertion on every step."
4. Version: **0.14.0** is the release on main (release commit `93b07f3`); npm
   still serves 0.13.0 until Max publishes. Run `npm view reelier version`
   the day you paste anything version-pinned.

### Product facts safe to use (verified in source, 2026-07-22)

- `reelier push <skill.md> --share` prints `Receipt: https://reelier.com/r/<token>`
  plus ready-to-paste badge markdown `[![reelier](<badgeUrl>)](<shareUrl>)`.
  Push is **private by default** — no public receipt without `--share`.
- Every emitted SKILL.md carries provenance: frontmatter
  `recorded_with: reelier vX.Y.Z` + footer
  `_Recorded with [Reelier](https://reelier.com/?utm_source=skill-md) — replay: npx -y reelier run <name>.skill.md_`.
- Benchmark (published, raw data in repo): 1,000/1,000 replays byte-identical,
  0 tokens per replay, ~50x cheaper / ~59x faster than a comparable agent run.
- MCP: official registry `io.github.seldonframe/reelier`; stdio via
  `npx -y reelier serve`. Root `Dockerfile` exists (Glama requirement).
  MCPB bundle source lives at `mcpb/` (manifest.json + index.js).

---

## STATUS — every surface (2026-07-22)

| Surface | Status | Mechanism (verified) | Link / notes |
|---|---|---|---|
| Official MCP registry | LISTED | — | `io.github.seldonframe/reelier` (0.13.0; bump on npm publish of 0.14.0) |
| GitHub Actions Marketplace | LISTED | — | "Reelier replay" |
| cursor.directory | LISTED | — | /plugins/reelier |
| mcp.so | LISTED | — | /servers/reelier |
| skills.sh | LISTED | — | /seldonframe/reelier |
| ClawHub | LISTED | — | clawhub.ai/skills/reelier |
| punkpeye/awesome-mcp-servers | PR-OPEN — **BLOCKED on Glama** | PR (bot now requires Glama listing + score badge) | [#10588](https://github.com/punkpeye/awesome-mcp-servers/pull/10588) |
| docker/mcp-registry | PR-OPEN — DECLINED-LIKELY | PR (their policy excludes GPL-family; AGPL stays) | [#4506](https://github.com/docker/mcp-registry/pull/4506) — leave open, do not withdraw |
| e2b-dev/awesome-ai-sdks | PR-OPEN | PR | [#292](https://github.com/e2b-dev/awesome-ai-sdks/pull/292) — correct venue per e2b's own taxonomy (see awesome-ai-agents note) |
| Prat011/awesome-llm-skills | PR-OPEN | PR | [#190](https://github.com/Prat011/awesome-llm-skills/pull/190) |
| ComposioHQ/awesome-claude-skills | PR-OPEN | PR | [#1400](https://github.com/ComposioHQ/awesome-claude-skills/pull/1400) |
| Glama | READY-TO-SUBMIT — **do first** | Web flow: Add Server → Claim → admin Dockerfile checks | Unblocks #10588; check first — may have auto-ingested from official registry |
| Smithery | READY-TO-SUBMIT | smithery.ai/new — public URL or MCPB bundle (or `smithery mcp publish` CLI) | No plain "index my npm stdio server" path — MCPB is our lane |
| PulseMCP | AUTO-SYNC (verify by 2026-07-28) | No form: ingests official MCP registry daily, processes weekly | If absent after a week: hello@pulsemcp.com |
| awesome-claude-code | READY-TO-SUBMIT | **Issue form ONLY — PRs are rejected** (mechanism changed vs old file) | github.com/hesreallyhim/awesome-claude-code → "Recommend a Resource" |
| e2b-dev/awesome-ai-agents | READY-TO-SUBMIT — SCOPE-RISK | PR or Google Form | List is for agents/assistants; tooling belongs in awesome-ai-sdks (where #292 already is). Recommend: Google Form, let maintainers place it |
| AlternativeTo | READY-TO-SUBMIT (account ≥7 days old required) | Logged-in form: "Suggest new application" | If acct created 2026-07-17 per plan, submit from 2026-07-24 |
| DevHunt | READY-TO-SUBMIT | GitHub sign-in → web submission form (free; optional paid expedite) | devhunt.org |
| LibHunt | READY-TO-SUBMIT | URL-only form | libhunt.com/site/project_submit |
| awesome-selfhosted | GATED (plan date 2026-07-26 — **but see eligibility note**) | PR: new `software/reelier.yml` in awesome-selfhosted-data | Verified rule = "first released more than 4 months ago" + must be server software, not a CLI/SDK. HIGH rejection risk — read the note before submitting |

---

## Frozen copy blocks (reuse everywhere)

**One-liner (awesome-list line, no strict cap):**

```
- [Reelier](https://github.com/seldonframe/reelier) - CI + snapshot tests for agent workflows: record a tool-call trace once, replay it deterministically at 0 tokens, diff for drift; every run emits an asserted, shareable receipt. AGPL-3.0.
```

**One-liner (strict caps / short):**

```
- [Reelier](https://github.com/seldonframe/reelier) - Snapshot tests for agent workflows — record once, replay at 0 tokens, diff for drift.
```

**Long description (any surface without a cap):**

Reelier is CI + snapshot tests for agent workflows. Record a live agent
session (MCP tool calls) once, compile it — zero LLM calls — into a
human-editable SKILL.md, and replay it deterministically at 0 tokens,
sub-50ms. Every replay is verified against the recorded trace and emits an
asserted run receipt; `reelier diff` shows exactly what drifted when the
world changes, and an opt-in BYOK escalation ladder (any Anthropic- or
OpenAI-compatible endpoint) patches just the drifted step and writes the fix
back to the skill file, so the same drift never costs an LLM call twice.
`reelier push --share` prints a public receipt permalink plus a README badge,
and every emitted SKILL.md carries provenance (`recorded_with` + a replay
one-liner). Measured, not claimed: 1,000/1,000 replays byte-identical, 0
tokens per replay, ~50x cheaper and ~59x faster than re-running the agent on
our published benchmark (raw data in the repo). AGPL-3.0 — the engine can
never be taken closed; your skills, traces, and receipts are your data.

---

## Payloads — absent surfaces

### 1. Glama — DO FIRST (unblocks awesome-mcp-servers #10588)

**Mechanism (verified):** web flow, no PR. glama.ai/mcp/servers → **Add
Server** → submit the GitHub repo → **Claim** (ownership verification) →
admin → Dockerfile page → ensure checks pass (server must start and answer
introspection). Repo already has the root `Dockerfile`. Glama also ingests
the official MCP registry, so **check for an auto-created listing first**
and claim it rather than double-submitting.

**Steps for Max:**
1. Search glama.ai for `reelier` / `seldonframe`. If a listing exists → Claim it.
2. Else: Add Server → repo URL `https://github.com/seldonframe/reelier`.
3. In admin, confirm the Dockerfile check passes (stdio server: `npx -y reelier serve`).
4. Once live, copy the score badge and **edit the #10588 PR description** to add it after the server description, exactly:

```
[![seldonframe/reelier MCP server](https://glama.ai/mcp/servers/seldonframe/reelier/badges/score.svg)](https://glama.ai/mcp/servers/seldonframe/reelier)
```

(Replace the path if Glama assigns a different owner/slug — copy it from the live listing.)

### 2. Smithery

**Mechanism (verified):** smithery.ai/new. Two lanes: (a) public HTTPS URL of
a hosted server, or (b) publish an **MCPB bundle**. There is no "just index my
npm stdio package" lane. Our lane = MCPB (source at `mcpb/`). CLI alternative:
`smithery mcp publish ./reelier.mcpb -n seldonframe/reelier`.

- **Name:** Reelier
- **Namespace suggestion:** `seldonframe/reelier`
- **Description:**
  CI + snapshot tests for agent workflows over MCP: record a tool-call trace
  once, replay it deterministically at 0 tokens, diff for drift. Tools:
  `reelier_scan`, `reelier_from_session`, `reelier_replay`, `reelier_diff`,
  `reelier_push` (receipt permalink with `--share`). Asserted receipt on
  every run. AGPL-3.0.
- **Repo:** https://github.com/seldonframe/reelier · **Website:** https://reelier.com

### 3. PulseMCP — no action, verify

**Mechanism (verified):** no submission form. PulseMCP ingests the official
MCP registry daily and processes weekly. We published
`io.github.seldonframe/reelier` on 2026-07-21, so the listing should appear
on its own. **Verify by 2026-07-28.** If absent, send:

> Subject: Listing check — io.github.seldonframe/reelier
>
> Hi — we published `io.github.seldonframe/reelier` (npm `reelier`, stdio via
> `npx -y reelier serve`) to the official MCP registry on 2026-07-21 and
> don't see it on PulseMCP yet. Anything on our side blocking ingestion?
> Repo: https://github.com/seldonframe/reelier. Thanks!
>
> → hello@pulsemcp.com

### 4. awesome-claude-code — ISSUE FORM ONLY (mechanism changed)

**Mechanism (verified):** the old file assumed a generic awesome-list PR.
Wrong for this list: "ALL RECOMMENDATIONS MUST BE MADE USING THE WEB UI ISSUE
FORM TEMPLATE" — PRs and `gh`-created issues risk a temp ban. Go to
github.com/hesreallyhim/awesome-claude-code → Issues → New → **Recommend a
Resource**. An automated validator comments on the issue; a maintainer then
approves at their discretion.

Form fields (exact):
- **Display Name:** Reelier
- **Category:** `Skills` (fallback if maintainer reassigns: `Observability & Monitoring`)
- **Link:** https://github.com/seldonframe/reelier
- **Author Name:** seldonframe
- **Author Link:** https://github.com/seldonframe
- **Description** (1–3 sentences, descriptive not promotional, 10–500 chars):

```
CI and snapshot tests for agent workflows. Records an MCP session as a tool-call trace, compiles it into a provenance-stamped SKILL.md, and replays it deterministically at zero tokens. Each replay is verified against the recorded trace, diffed for drift, and can publish a shareable run receipt.
```

- Checklist: tick all three (not already listed / links work / specific to Claude Code).

### 5. e2b-dev/awesome-ai-agents — SCOPE-RISK, read first

**Mechanism (verified):** PR against the README **or** their Google Form
(https://forms.gle/UXQFCogLYrPFvfoUA). Alphabetical order within category.

**Scope warning (new finding):** the README says the list is for AI
assistants/agents only — "SDKs and frameworks" belong in their SDK list,
which is `e2b-dev/awesome-ai-sdks` (same repo as `awesome-sdks-for-ai-agents`
— GitHub redirects; verified). Reelier is agent *tooling*, and our PR
**#292 is already open on the correct list per e2b's own taxonomy**.
Recommendation: submit here via the **Google Form only** (low cost, lets
maintainers place or reject it) — do not open a second PR that invites a
"wrong list" close.

Entry block if they take it (Open-source projects → alphabetical):

```
### [Reelier](https://github.com/seldonframe/reelier)
CI + snapshot tests for agent workflows — record once, replay deterministically at 0 tokens, diff for drift.

<details>

- **Category:** Coding / developer tooling
- **Description:**
  - Records a live MCP agent session as a tool-call trace and compiles it (no LLM calls) into a human-editable SKILL.md with provenance
  - Replays deterministically at 0 tokens; each run is verified against the recorded trace and emits an asserted receipt; `reelier diff` pinpoints drift
  - Opt-in BYOK escalation (any Anthropic/OpenAI-compatible endpoint) patches only the drifted step and writes the fix back
  - `reelier push --share` prints a public receipt permalink + README badge
- **Links:** [GitHub](https://github.com/seldonframe/reelier) · [Website](https://reelier.com) · [npm](https://www.npmjs.com/package/reelier)

</details>
```

### 6. AlternativeTo

**Mechanism (verified):** logged-in web form. User icon → **Suggest new
application** → fill Platforms, License, Descriptions, Tags → Submit.
Moderation: days to a week; they decline "simple tools" and AI wrappers
daily, so the description must read like a real product. **Accounts must be
≥1 week old to submit** — if the account was created 2026-07-17 (per Postiz
playbook), earliest submit = **2026-07-24**.

- **Name:** Reelier
- **Platforms:** Windows · macOS · Linux (CLI, Node.js)
- **License:** Open Source — AGPL-3.0
- **Short description (≤140):**

```
CI + snapshot tests for AI agent workflows: record once, replay at 0 tokens, diff for drift — with shareable, asserted run receipts.
```

- **Full description:** use the frozen long description above.
- **Tags:** ai-agents, testing, snapshot-testing, ci, mcp, developer-tools, cli
- **"Alternative to" anchors (pick 2–3 when the form asks):** promptfoo,
  Langfuse, LangSmith, Braintrust. (Frame: the record/replay + drift-diff
  slice of agent testing/observability — do not claim feature parity.)

### 7. DevHunt

**Mechanism (verified):** sign in with GitHub → submission form on
devhunt.org (free; optional paid expedite). The old "listings via GitHub PR"
model from their repo README is historical — current flow is the web form.
Have logo + screenshots ready (receipt permalink page + a `reelier diff`
terminal shot are the two money screenshots).

- **Name:** Reelier
- **Tagline (≤60):** `CI + snapshot tests for AI agent workflows`
- **Short description (≤200):**

```
Record an AI agent's tool-call workflow once, then replay it in CI at 0 LLM tokens. Snapshot-diff every run for drift and get a shareable, asserted receipt for what actually ran. AGPL-3.0.
```

- **Long description:** frozen long description above.
- **Website:** https://reelier.com · **Repo:** https://github.com/seldonframe/reelier
- **Categories:** Developer Tools · AI/ML · Testing
- **Maker first comment:**

> Built this after watching an agent re-derive the same 3-field JSON
> extraction from the same API response, at the same cost, every run — for a
> task with exactly one correct answer. Reelier is the "compile it once you
> know it works" step: record → SKILL.md → deterministic replay at 0 tokens,
> and `reelier diff` catches drift the way snapshot tests catch regressions.
> Every run writes a receipt you can share (`reelier push --share`). Happy to
> answer questions about the compiler's dataflow recovery or the escalation
> ladder's write-back model.

### 8. LibHunt

**Mechanism (verified):** URL-only form at
https://www.libhunt.com/site/project_submit — paste the repo URL, done.
(Their per-topic "Awesome X" mirrors sync from the awesome lists, so the
open awesome-list PRs feed LibHunt automatically once merged.)

- **URL to paste:** `https://github.com/seldonframe/reelier`

### 9. awesome-selfhosted — GATED + HIGH rejection risk

**Mechanism (verified):** PR adding `software/reelier.yml` to
`awesome-selfhosted/awesome-selfhosted-data` (kebab-case file, one item per
PR, commit message "Add Reelier").

**Eligibility — two problems found in this refresh, read before spending the PR:**
1. **Age rule (verified):** "first released more than 4 months ago." The plan
   date of 2026-07-26 does not match any release evidence we control: npm
   `@seldonframe/reelier` first published 2026-07-18, npm `reelier`
   2026-07-20, repo history starts 2026-07-17. Unless Max can point at an
   older public release, true eligibility is ~**2026-11-17**, not 07-26.
2. **Scope rule (verified):** libraries/SDKs and non-server software are
   excluded. Reelier is a CLI + stdio MCP server, not a self-hostable web
   service. Expect a scope challenge; the honest angle is `reelier serve`
   (long-running server) — it may still be judged a dev tool.

**Recommendation:** do not submit on 07-26. Re-evaluate in November, and only
if there is a genuinely self-hostable server story by then. Payload kept
ready below so nothing needs rewriting.

```yaml
name: "Reelier"
website_url: "https://reelier.com"
source_code_url: "https://github.com/seldonframe/reelier"
description: "Deterministic record/replay and snapshot testing for AI agent workflows (MCP), replaying recorded tool-call skills at zero LLM cost with drift diffs and asserted run receipts."
licenses:
  - AGPL-3.0
platforms:
  - Nodejs
  - Docker
tags:
  - Software Development - Testing
```

(Verify the exact tag string against `tags/software-development---testing.yml`
in awesome-selfhosted-data before opening the PR.)

---

## Shepherd checklist — the 5 open PRs (daily, respond <24h)

Daily check (read-only):

```
gh pr view 10588 --repo punkpeye/awesome-mcp-servers --comments
gh pr view 4506  --repo docker/mcp-registry --comments
gh pr view 292   --repo e2b-dev/awesome-ai-sdks --comments
gh pr view 190   --repo Prat011/awesome-llm-skills --comments
gh pr view 1400  --repo ComposioHQ/awesome-claude-skills --comments
```

### punkpeye/awesome-mcp-servers #10588 — BLOCKED, action known
- **State (2026-07-22):** glama-check bot requires (1) a live Glama listing
  passing checks, (2) the Glama score badge added to the PR. We already
  replied saying the badge comes once the Glama page is live.
- **Action:** complete Glama (payload #1) → edit PR description with the
  badge → comment: *"Glama listing is live and passing checks; score badge
  added to the description as requested."*
- **Watch for:** alphabetical-order or category nits; description-length
  trims. Accept any trim that keeps "record once, replay at 0 tokens, diff
  for drift."

### docker/mcp-registry #4506 — DECLINED-LIKELY, do not withdraw
- **Why:** their policy excludes GPL-family licenses. AGPL stays (Max's
  decision) — so this likely closes. Leaving it open costs nothing and the
  close comment becomes a citable policy reference.
- **If declined, reply (template):**
  > Understood — thanks for the clear policy read. Reelier is AGPL-3.0 by
  > design and that won't change, so we'll close out here. If a lane for
  > copyleft servers ever opens (e.g. a policy tier that separates listing
  > from redistribution), we'd love a ping.
- **Never:** hint the license could change to get in.

### e2b-dev/awesome-ai-sdks #292 — correct venue, defend gently
- **Watch for:** a "is this an SDK?" challenge. Response template:
  > The repo's scope line is "SDKs, frameworks, libraries, and **tools** for
  > creating, **monitoring, debugging** and deploying autonomous AI agents" —
  > Reelier is the testing/replay slice of that: record a tool-call trace,
  > replay deterministically in CI, diff for drift. Happy to move categories
  > if there's a better fit.
- Also watch for alphabetical-order/format nits — fix same day, single commit.

### Prat011/awesome-llm-skills #190
- **Watch for:** template-compliance requests (line format, section) and
  staleness (small list, slow maintainer). If silent 14 days: one polite bump,
  then park.
- **Bump template:** *"Bumping in case this got buried — happy to adjust
  format/section if needed."*

### ComposioHQ/awesome-claude-skills #1400
- **Watch for:** same as #190; Composio repos sometimes batch-merge — no bump
  before 14 days. If they ask for a Composio-hosted variant or extra metadata,
  provide it factually; do not add marketing copy.

### All PRs — response discipline
- Reply within 24h; fixes as a single follow-up commit; never force-push over
  a reviewer's view.
- Keep every reply to facts a maintainer can check (registry entry, npm
  package, benchmark data in-repo).
- When 0.14.0 hits npm: no PR edits needed (no payload pins a version), but
  refresh any PR description that quotes 0.13.0 if a maintainer asks.

---

## Execution order for Max

1. **Glama** (unblocks #10588) → badge onto #10588 same day.
2. **awesome-claude-code issue form** (5 minutes, highest-affinity audience).
3. **Smithery** (MCPB lane) + **LibHunt** (30 seconds).
4. **AlternativeTo** on/after 2026-07-24 (account age gate).
5. **DevHunt** once screenshots exist (receipt permalink + diff terminal).
6. **PulseMCP**: verify auto-sync 2026-07-28; email only if absent.
7. **awesome-ai-agents**: Google Form only (scope-risk).
8. **awesome-selfhosted**: HOLD — see eligibility note (age rule fails until ~2026-11).
