# Outreach wave 2 — 50 verified leads + Fedimint #8792 message

_2026-07-23. Companion to [2026-07-23-design-partner-outreach.md](./2026-07-23-design-partner-outreach.md) (wave 1, all 10 contacted). Verification level: every Category-A repo below was found via GitHub code search on a live agent workflow file (path listed — that file exists on the default branch today); stars/activity fetched from the API today; repos inactive >45 days or with disabled/backup workflows were dropped. **Per-lead pain issues are NOT yet verified** — before messaging anyone, do the wave-1-style pass (find the specific issue where their pain lives, confirm maintainer handle + reach surface). Tone bar: wave-1 rewrite rules apply — lead with their problem, disclose we maintain reelier, offer the PR, invite "feel free to close," one message, zero follow-ups._

## Fedimint #8792 message (post as issue comment)

> This proposal's guardrails section is the part most digest-workflow designs skip — read-only default, idempotent output, explicitly human-owned domains. Two thoughts from building similar scheduled agent jobs:
>
> **1. Split collection from summarization.** Have a plain script run the `gh` queries and emit one JSON state snapshot as the Actions artifact, then feed only that snapshot to the model. Digests become reproducible (same snapshot → comparable output), the model can't wander into queries the guardrails didn't anticipate, and Phase-1 testing gets trivial: commit a fixture snapshot, eyeball the digest it produces.
>
> **2. Guardrails need verification, not just prompt text.** "Do not comment / do not close / read-only" lives in the prompt today — but a scheduled job drifts: model updates, prompt edits, dependency bumps. We maintain an open-source tool for this (reelier, github.com/seldonframe/reelier — disclosure: I'm a maintainer). It records each run's actual tool calls as a diffable receipt, so "read-only by default" becomes checkable per run rather than aspirational, and a prompt/model change that alters the job's behavior fails CI instead of silently changing digest quality. The receipts would slot straight into Phase 1's produce-an-artifact output.
>
> Happy to help build either piece — including PRing the workflow itself if that's welcome. If neither is useful, ignore freely.

## Category A — repos already running agents in CI (25)

Evidence = live workflow file found today. The workflow name usually IS the angle: everything that triages, dedupes, reviews, backports, or releases autonomously has no regression harness between rewrites, and everything scheduled drifts silently on model/prompt changes.

| # | Repo | ★ | Agent evidence (`.github/workflows/`) | Angle |
|---|------|---|----------------------------------------|-------|
| 1 | [openclaw/openclaw](https://github.com/openclaw/openclaw) | 384k | `docs-agent.yml` (codex) | Docs written by an agent on the most-watched repo of the year — drift here is public |
| 2 | [oven-sh/bun](https://github.com/oven-sh/bun) | 95k | `claude-dedupe-issues.yml` (base-action, autonomous) | Dedupe verdicts silently flip on model updates; record a known-good run |
| 3 | [astral-sh/uv](https://github.com/astral-sh/uv) | 88k | `issue-triage.yml` (codex) | High-volume triage; mislabels are invisible until users complain |
| 4 | [metabase/metabase](https://github.com/metabase/metabase) | 48k | `resolve-backport-conflicts.yml` (base-action) | Agent resolves merge conflicts — the RediSearch story, bigger repo |
| 5 | [keras-team/keras](https://github.com/keras-team/keras) | 64k | `gemini-automated-issue-triage.yml` | Scheduled Gemini triage; provider-switch/drift story |
| 6 | [ruvnet/ruflo](https://github.com/ruvnet/ruflo) | 66k | `codex-integration-audit.yml` | An agent auditing integrations — auditor itself unaudited |
| 7 | [code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) | 66k | `publish.yml` (codex exec) | Agent inside the publish pipeline — a bad run ships |
| 8 | [medusajs/medusa](https://github.com/medusajs/medusa) | 35k | `dx-triage-doc-fixes.yml` (base-action) | Agent files doc fixes autonomously |
| 9 | [facebook/rocksdb](https://github.com/facebook/rocksdb) | 32k | `ai-review-analysis.yml` (+ codex exec) | Two agent stacks side by side; no cross-check between them |
| 10 | [ComposioHQ/composio](https://github.com/ComposioHQ/composio) | 29k | `docs.changelog-to-docs.yml` (codex) | Changelog→docs agent; we already integrate Composio — warm |
| 11 | [elastic/kibana](https://github.com/elastic/kibana) | 21k | `reviewer-codex.lock.yml` (gh-aw) | Agent reviewer at enterprise scale, gh-aw lockfile |
| 12 | [OtterMind/Chat2DB](https://github.com/OtterMind/Chat2DB) | 26k | `ai-pr-reviewer.lock.yml` (gh-aw) | Same gh-aw pattern, mid-size org |
| 13 | [dyad-sh/dyad](https://github.com/dyad-sh/dyad) | 21k | `claude-triage.yml` (base-action) | AI app builder using agent triage — audience overlap |
| 14 | [sindresorhus/type-fest](https://github.com/sindresorhus/type-fest) | 17k | `claude-code-review.yml` | Mega-maintainer; if it works for him it spreads across ~1k repos |
| 15 | [apache/doris](https://github.com/apache/doris) | 16k | `code-review-runner.yml` (codex exec) | ASF project with agent review — governance cares about auditability |
| 16 | [OrcaSlicer/OrcaSlicer](https://github.com/OrcaSlicer/OrcaSlicer) | 15k | `dedupe-issues.yml` (base-action) | High-volume dedupe, same story as bun |
| 17 | [567-labs/instructor](https://github.com/567-labs/instructor) | 14k | `oss-issue-deduplicator.yml` (codex) | jxnl's repo; audience = exactly our buyers |
| 18 | [dbcli/pgcli](https://github.com/dbcli/pgcli) | 13k | `codex-review.yml` | Small team, agent review, long-lived project |
| 19 | [MaterializeInc/materialize](https://github.com/MaterializeInc/materialize) | 6.3k | `update-generated-docs.yml` (claude) | Agent regenerates docs — drift = wrong docs shipped |
| 20 | [corsairdev/corsair](https://github.com/corsairdev/corsair) | 5.5k | `plugin-pr-review-loop.yml` (codex exec) | A review *loop* — iteration without a harness |
| 21 | [Expensify/App](https://github.com/Expensify/App) | 5.0k | `codex-review.yml` | Public company running agent review on prod app |
| 22 | [jitsucom/jitsu](https://github.com/jitsucom/jitsu) | 4.8k | `security-fix.yml` (codex) | Agent writes *security fixes* — strongest possible receipts story |
| 23 | [github/gh-aw](https://github.com/github/gh-aw) | 4.8k | `changeset.lock.yml` (codex exec) | GitHub's agentic-workflows team itself — platform partner, not just lead |
| 24 | [JetBrains/youtrackdb](https://github.com/JetBrains/youtrackdb) | 420 | `weekly-beta-release.yml` (base-action) | Agent in a JetBrains *release* pipeline |
| 25 | [stacklok/toolhive](https://github.com/stacklok/toolhive) | 2.0k | `issue-triage.yml` (claude) | MCP tool platform running agent CI — double relevance |

**Bench A:** marktext/marktext 59k (`claude.yml` mention-bot) · flutter/samples 19k (gemini triage) · JabRef/jabref 4.4k · autobrr/qui 4.2k (discussion dedupe, both actions) · facebookincubator/velox 4.2k · qltysh/qlty 3.1k (agent changelog) · MervinPraison/PraisonAI 8.5k · vaadin/flow (`doc-bot.lock.yml`) · worldcoin/orb-software (codex PR review) · tag1consulting/goose 1.0k (gemini review) · goodrain/rainbond 6.2k · freerouting 1.8k · tiann/hapi 4.6k · AI-Hypercomputer/maxtext 2.4k.

## Category B — MCP server authors (25)

All active ≤~30 days unless noted. Angle everywhere: `reelier manifest` snapshots tool names + JSON schemas and fails CI closed on drift; servers wrapping a moving upstream (SaaS API, scraped surface, desktop app) drift on *both* sides.

| # | Repo | ★ | What it is | Drift surface |
|---|------|---|-----------|---------------|
| 1 | [upstash/context7](https://github.com/upstash/context7) | 60k | Docs-for-LLMs platform + MCP | Huge consumer base; any tool change breaks thousands of configs |
| 2 | [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) | 47k | Chrome team's DevTools MCP | Chrome release cadence drives tool surface |
| 3 | [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | 35k | Playwright MCP | Playwright releases ↔ tool schemas |
| 4 | [github/github-mcp-server](https://github.com/github/github-mcp-server) | 32k | GitHub official | Densest, fastest-moving first-party manifest there is |
| 5 | [oraios/serena](https://github.com/oraios/serena) | 27k | Semantic code toolkit | Indie-run at scale; LSP upstream drift |
| 6 | [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) | 25k | Blender ↔ LLM | Blender API versions break tools (ida-pro-mcp pattern) |
| 7 | [googleapis/mcp-toolbox](https://github.com/googleapis/mcp-toolbox) | 16k | DB MCP toolbox | Many DB engines = wide schema matrix |
| 8 | [GLips/Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP) | 15k | Figma → coding agents | Figma API drift, solo maintainer |
| 9 | [xpzouying/xiaohongshu-mcp](https://github.com/xpzouying/xiaohongshu-mcp) | 15k | Xiaohongshu MCP | Scraped upstream = constant breakage |
| 10 | [awslabs/mcp](https://github.com/awslabs/mcp) | 9.5k | AWS servers monorepo | Dozens of servers, one repo — manifest gate scales |
| 11 | [wonderwhy-er/DesktopCommanderMCP](https://github.com/wonderwhy-er/DesktopCommanderMCP) | 8.8k | Terminal/FS control | Popular indie; strict-client breakage class |
| 12 | [CursorTouch/Windows-MCP](https://github.com/CursorTouch/Windows-MCP) | 6.5k | Windows computer use | OS-level drift |
| 13 | [getsentry/XcodeBuildMCP](https://github.com/getsentry/XcodeBuildMCP) | 6.1k | Xcode build MCP (Sentry) | Xcode versions break tools every fall |
| 14 | [sooperset/mcp-atlassian](https://github.com/sooperset/mcp-atlassian) | 5.6k | Jira/Confluence MCP | Two SaaS APIs upstream, indie maintainer |
| 15 | [jacob-bd/notebooklm-mcp-cli](https://github.com/jacob-bd/notebooklm-mcp-cli) | 5.6k | NotebookLM automation | Unofficial surface — breaks whenever Google ships |
| 16 | [mobile-next/mobile-mcp](https://github.com/mobile-next/mobile-mcp) | 5.6k | iOS/Android automation | Device/OS matrix drift |
| 17 | [tradesdontlie/tradingview-mcp](https://github.com/tradesdontlie/tradingview-mcp) | 5.1k | TradingView desktop MCP | Same pain as wave-1 bench namesake |
| 18 | [jgraph/drawio-mcp](https://github.com/jgraph/drawio-mcp) | 4.9k | draw.io MCP | Official vendor server, young |
| 19 | [exa-labs/exa-mcp-server](https://github.com/exa-labs/exa-mcp-server) | 4.8k | Exa search MCP | API product — schema changes hit paying users |
| 20 | [makenotion/notion-mcp-server](https://github.com/makenotion/notion-mcp-server) | 4.6k | Official Notion | Notion API versioning ↔ manifest |
| 21 | [54yyyu/zotero-mcp](https://github.com/54yyyu/zotero-mcp) | 4.4k | Zotero MCP | Academic users, plugin-API drift |
| 22 | [Pimzino/spec-workflow-mcp](https://github.com/Pimzino/spec-workflow-mcp) | 4.3k | Spec-driven dev workflow | Workflow tools = agents depend on exact shapes |
| 23 | [cloudflare/mcp-server-cloudflare](https://github.com/cloudflare/mcp-server-cloudflare) | 4.0k | Official Cloudflare | Many products, fast API surface |
| 24 | [grafana/mcp-grafana](https://github.com/grafana/mcp-grafana) | 3.3k | Official Grafana | Dashboards/API drift; observability org gets receipts instantly |
| 25 | [bytebase/dbhub](https://github.com/bytebase/dbhub) | 3.2k | Token-efficient DB MCP | They already optimize the agent-facing contract — closest worldview |

**Bench B:** IvanMurzak/Unity-MCP 3.6k (Unity versions) · punitarani/fli 3.0k (Google Flights scrape) · antvis/mcp-server-chart 4.3k (stale-ish) · huangjunsen0406/py-xiaozhi 3.4k · KnockOutEZ/wigolo 3.5k · MinishLab/semble 5.7k (code-search for agents) · evalstate/fast-agent 3.9k (framework, partner-shaped).

## Wave-2 first 10 — pain-verified 2026-07-23, openers drafted

Verification swapped out three picks (pgcli, Figma-Context-MCP, blender-mcp — no drift pain found) for corsair, XcodeBuildMCP, notebooklm-mcp-cli (dense verified pain). Final 10 + surface:

1. **metabase/metabase** — new issue. Pain: `resolve-backport-conflicts.yml` (added Apr, PR 71158): Claude, 75 max turns, contents:write; several action/model bumps since, no behavior comparison.
2. **dyad-sh/dyad** — new issue. Pain: 18 commits on `claude-triage.yml`; title updates made "much more conservative" (2888) after over-aggression; Opus 4.8 pin 2 days ago; settings-strip guardrail shows they care.
3. **567-labs/instructor** — new issue (alt: jxnl on X). Pain: dedupe workflow's automatic trigger commented out "after reviewing manual runs" — trust gate with no criterion.
4. **jitsucom/jitsu** — new issue. Pain: `security-fix.yml`: 4 same-day fix commits (Apr 24), disable/re-enable, Claude→Codex switch, June behavior rules ("never downgrade deps").
5. **corsairdev/corsair** — new issue. Pain: `plugin-pr-review-loop.yml`: 8 fixes in 4 days (Azure reasoning off, fork sandbox, round markers).
6. **oraios/serena** — comment IN [issue 1467](https://github.com/oraios/serena/issues/1467) (open: "Schema quality: 9 errors, 47 warnings across 29 tools").
7. **sooperset/mcp-atlassian** — comment IN [issue 626](https://github.com/sooperset/mcp-atlassian/issues/626) (OPEN: "additionalProperties and gemini" — exactly the message's topic; alt: [541](https://github.com/sooperset/mcp-atlassian/issues/541) Copilot retrieved 0 tools, 17 comments). Pain: Vertex AI schema rejections (885/886), compat layer (959), items-schema fix 11 days ago (1487).
8. **wonderwhy-er/DesktopCommanderMCP** — comment IN [issue 79](https://github.com/wonderwhy-er/DesktopCommanderMCP/issues/79) (OPEN: "Gemini not working with DesktopCommanderMCP anymore"; alt: [460](https://github.com/wonderwhy-er/DesktopCommanderMCP/issues/460) v0.2.40 read_file regression). Pain: set_config_value schema missing types (234), Gemini fix follow-up (236).
9. **getsentry/XcodeBuildMCP** — new issue (verified 2026-07-23: repo has ZERO open issues — no thread exists to join). Pain: testRunnerEnv schema vs OpenAI (103), registration.schema.json missing $defs broke all structured tools (419/423).

Open-thread sweep 2026-07-23: metabase, dyad, instructor, jitsu, corsair have NO on-topic open issues (their workflow pain lives in commit history, not the tracker) — new issue confirmed correct for all five.
10. **jacob-bd/notebooklm-mcp-cli** — comment IN [issue 248](https://github.com/jacob-bd/notebooklm-mcp-cli/issues/248) (open: device-bound sessions). Prior breaks: CSRF (105), Chrome 136 (155).

Message texts (no issue-number hashes, first person singular) live in the session log / were delivered to Max 2026-07-23. Rules: one message, zero follow-ups, "feel free to close" on every org-repo issue.

## Mechanics delta from wave 1

- Wave-1 messages were verified down to the pain issue. This sheet is verified down to the *workflow file / repo*. Before any message: find the issue, confirm the maintainer's warmest surface, then apply the wave-1 helpful-tone template.
- Special handling: **github/gh-aw** (they build the agentic-workflow platform — that's an integration conversation, not a lead) and **ComposioHQ** (existing integration relationship — warm intro, not cold issue).
- Raw data (525 CI-agent repos, 195 MCP candidates, all search JSON) preserved in session scratchpad `hunt/` if a deeper cut is wanted.
