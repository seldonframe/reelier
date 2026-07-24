# Reelier Distribution Master Plan
_Audited + written 2026-07-21. Strategy: distribution maximization — OSS free forever, cloud free to drive adoption. Every claim below was live-verified today (repo audit + external listing checks), not recalled from memory._

## Ground truth (2026-07-21 audit)

### Live placements (verified)
| Surface | Status | Evidence |
|---|---|---|
| Official MCP registry | LIVE v0.13.0 (published today) | registry.modelcontextprotocol.io `io.github.seldonframe/reelier` |
| GitHub Actions Marketplace | LIVE ("Reelier replay") | marketplace search |
| cursor.directory | LIVE (plugin, scanStatus safe) | cursor.directory/plugins/reelier |
| mcp.so | LIVE | mcp.so/servers/reelier |
| skills.sh | LIVE (1 install) | skills.sh/seldonframe/reelier |
| ClawHub | LIVE | clawhub.ai/skills/reelier |
| npm `reelier` + ghcr image + GH topics (16) | LIVE | — |

### Open PRs to shepherd (respond to maintainer feedback within 24h)
- punkpeye/awesome-mcp-servers **#10588**
- docker/mcp-registry **#4506**
- e2b-dev/awesome-ai-sdks **#292**
- Prat011/awesome-llm-skills **#190**
- ComposioHQ/awesome-claude-skills **#1400**

### Absent (external)
Smithery · PulseMCP · Glama (all empty despite official-registry entry — recheck sync 48h, then direct-submit) · awesome-claude-code · awesome-ai-agents (proper repo — our PR went to awesome-ai-sdks) · awesome-selfhosted (eligibility gate 2026-07-26) · AlternativeTo · DevHunt · Homebrew · LibHunt/StackShare · **Hacker News (zero footprint ever)** · Product Hunt (deprioritized by prior memo).

### Product-side: built vs broken
**Built:** GitHub Action · MCPB/Smithery bundle · Claude plugin manifest (`.claude-plugin/plugin.json`) · badge markdown snippet + permalink copy (dashboard `RunsFeed.tsx`) · private per-tenant skill upload (`POST /api/v1/skills`) · programmatic SEO (12 learn + 8 vs + 8 for + 5 skills + blog + calculator + ticker) · syndication drafts (dev.to/HackerNoon/Medium — committed, NOT yet posted).

**Broken/missing (the loops):**
1. `reelier push` prints only `pushed id=<id>` — **no shareable URL** (`src/cli.ts:1078`). The attach point of the whole viral loop is dark.
2. Emitted SKILL.md has **zero provenance** — no "Recorded with Reelier", no install command, no link-back (`src/compile.ts:666-721`).
3. `reelier install` = MCP-server wrap, **not** skill install. No registry client exists.
4. **No public skill registry** — `/skills/*` pages are 5 static files; the `skills` table is private-per-tenant, upload-only.
5. **Zero analytics** on reelier.com; `/r/[token]` and `/badge/[token]` record no views. Every loop is invisible.
6. No GitHub App (Action ≠ App; Apps install org-wide and comment on PRs).
7. No Homebrew/scoop/winget. No marketplace.json for Claude plugin marketplaces.
8. No ecosystem example PRs (Anthropic cookbook, Vercel AI SDK templates, framework docs).
9. model-release-radar scheduled but has produced no public artifact yet. No Show HN draft exists.

---

## The ranked backlog (pillar → supporting)

**P0 — structural loops (build; these compound, everything else is linear)**
1. **Close the attach point** — push prints a live receipt permalink; SKILL.md carries provenance + install one-liner; replay CLI output hints the badge snippet. Every existing user becomes a distributor. (Days of work, highest leverage-per-hour on the board.)
2. **Make loops observable** — analytics on reelier.com, view counters on /r/ and /badge/, weekly loop-metrics report (npm trend, stars, SKILL.md-in-the-wild via GH code search, badge renders, permalink views). Dogfood: the weekly report should itself be a Reelier skill (read-only — perfect fit).
3. **Public skill registry + one-line consume** — the npm loop: publish free, every published skill = a public page + a reason to install Reelier. Seed ~25 read-only skills. THE quarter bet.

**P1 — default capture (be in bigger ecosystems' paths)**
4. Finish the directory sweep: Smithery/PulseMCP/Glama (post-sync check), DevHunt, AlternativeTo, LibHunt; shepherd the 5 open PRs to merge; awesome-claude-code + awesome-ai-agents (correct repo) + awesome-selfhosted on 07-26.
5. Ecosystem example PRs: Anthropic cookbook ("snapshot-test your agent"), Vercel AI SDK template, LangChain/CrewAI testing-docs examples, Claude plugin marketplace.json + community marketplaces.
6. Homebrew tap (`seldonframe/homebrew-reelier` first; core formula once notability allows) + winget/scoop (Windows agent devs are underserved).

**P2 — moments (earned attention, unique data)**
7. Drift-report pipeline: model-release-radar output → public blog post + HN submission, per flagship release. This is the repeatable front-page lottery ticket with data nobody else has.
8. Post the 3 syndication drafts; pitch Console.dev + Changelog + TLDR AI around a drift moment.
9. **Show HN: write the draft now, hold it** — fire on the first real drift catch ("Model X shipped and silently broke N real agent workflows — here are the receipts").
10. GitHub App (Codecov loop: receipts as PR comments, org-wide installs) — after the registry.

**P3 — supporting (still important, runs in background via loops)**
11. SEO/GEO batches 3–5 (Wave 2 continues per Max's call).
12. X build-in-public cadence (x-post-engine) + one YouTube demo ("50x cheaper agent, receipts attached").
13. VS Code marketplace — skip unless a real extension emerges (weak fit).

---

## Delegation plan (subagent workstreams)

Rules of engagement: implementers work in **isolated worktrees** (bg agents share the working tree otherwise); **maker ≠ checker** — every build passes an independent reviewer + verify gate before merge; anything touching external accounts (submissions, posting, publishing) is **prepared by agents, executed by Max**.

### WS-A · Close the attach point — `P0.1` — implementer ×1, ~2 days
- A1 Cloud: `POST /api/v1/runs` auto-mints (or returns) a share token; CLI `cmdPush` prints `Receipt: https://reelier.com/r/<token>`.
- A2 CLI: `renderSkillMd` appends provenance block — frontmatter `recorded_with: reelier vX` + footer "Recorded with [Reelier](https://reelier.com) — replay: `npx reelier run <name>`".
- A3 CLI: successful replay output prints the copyable badge-markdown hint.
- **DoD:** fresh `record → push` prints a working public URL; emitted SKILL.md carries provenance; tests green. **Gate:** reviewer diff-review → verify-runner → smoke-runner against prod (`npx vercel --prod` deploy — reelier-cloud does NOT auto-deploy).

### WS-B · Loop observability — `P0.2` — implementer ×1, ~1 day
- B1 Vercel Analytics (zero-config) or PostHog on reelier.com.
- B2 View counters on `/r/[token]` + `/badge/[token]` (increment column or events table; badge route = image request, count it server-side).
- B3 `loop-metrics` weekly report as a **Reelier skill** (npm API, GH API star/code-search, cloud counters) → markdown receipt. Schedule it.
- **DoD:** one dashboard/report shows all loop numbers weekly. **Gate:** reviewer + smoke on prod.

### WS-C · Public skill registry — `P0.3` — scout → spec (Max approves) → 2 implementers in worktrees → reviewer → verify/smoke, ~2–3 weeks
- C1 Scout+spec: publish flow (from CLI push and dashboard), public pages `/skills/<owner>/<name>` (SSR + .md twins + sitemap), search, moderation/trust-ladder reuse, **consume verb decision** (`reelier install` is taken by MCP-wrap → likely `reelier get <owner>/<skill>`), AGPL/licensing note per skill.
- C2 Cloud implementer: registry tables (extend existing `skills` schema with public flag/owner slug), pages, publish endpoint, search.
- C3 CLI implementer: `reelier get` fetch/verify/run from registry.
- C4 Seed 25 read-only skills (portfolio 5 + 20 new: repo-health, release-radar, price-sweeps, status checks, report generators) — each is a landing page AND a demo.
- **DoD:** an outside user can publish a skill and a second user can run it in under 2 minutes from a cold machine. **Gate:** full verify-build + smoke + vision-grader on the public pages.

### WS-D · Default capture — `P1` — scout prepares 100%, **Max executes submissions**
- D1 48h after MCP-registry publish: recheck Smithery/PulseMCP/Glama auto-sync; where absent, agent drafts direct submissions → Max clicks.
- D2 Daily PR-shepherd loop: monitor the 5 open PRs, draft responses to maintainer feedback within 24h.
- D3 Submission payloads for awesome-claude-code, awesome-ai-agents (correct repo this time), awesome-selfhosted (2026-07-26 gate), DevHunt, AlternativeTo, LibHunt — payloads exist in `submissions.md`; agent freshens, Max submits.
- D4 Implementer: `seldonframe/homebrew-reelier` tap + formula; winget manifest.
- D5 Scout drafts ecosystem example PRs (Anthropic cookbook, Vercel AI SDK template, LangChain/CrewAI docs) as ready-to-open branches; Max reviews + opens from his account.
- D6 Implementer: `marketplace.json` + community Claude plugin marketplace submissions prep.
- **DoD:** every surface in the Absent list is either LISTED, PR-OPEN, or explicitly rejected-with-reason.

### WS-E · Moments machine — `P2` — content agents draft, **Max posts**
- E1 Wire model-release-radar output → public blog post (reelier-blog-style skill) + prepared HN submission. Trigger: next flagship release.
- E2 Post the 3 committed syndication drafts (dev.to, HackerNoon, Medium) — Max's accounts.
- E3 Draft pitches: Console.dev, Changelog News, TLDR AI — hold until first drift artifact exists (pitch with data, not existence).
- E4 Write the Show HN draft NOW (title variants + first-comment). HOLD until first real drift catch. One shot.
- **DoD:** drafts exist in `docs/strategy/launch/`; firing conditions written next to each.

### WS-F · GitHub App — `P2`, after WS-C — scout spec → implementer, weeks 4–6
- Receipt-as-PR-comment App (org-wide install, Codecov model). Reuses WS-A share tokens.
- **DoD:** installing the App on a repo with the Action posts the receipt comment on the next PR.

### Cadence
- **Daily:** PR-shepherd check (WS-D2).
- **Weekly:** loop-metrics receipt (WS-B3) reviewed against: npm weekly trend, SKILL.md-in-the-wild count, badge renders, permalink views, registry installs (once live), stars.
- **Per model release:** WS-E1 fires.

### Sequencing
Week 1: WS-A + WS-B complete, WS-D1–D3 executed, WS-C spec approved, WS-E4 draft written.
Weeks 2–3: WS-C build + seed. WS-D4–D6 land.
Weeks 4–6: WS-F. First WS-E1 firing whenever a flagship ships.
