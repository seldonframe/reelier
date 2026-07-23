# Design-partner outreach sheet — verified leads

_2026-07-23. Every name, issue number, and stat below was verified against fetched sources (GitHub API, npm, Glama, PulseMCP) on this date. Reach surfaces are limited to what each person publicly attaches to their project. The offer everywhere: concierge setup (we PR the workflow), 2 weeks of use, one 15-min call, permission to show their green ladder; they get priority fixes + a verified-org badge._

## The first 10 (recommended batch)

### MCP server authors (drift pain, documented)

1. **Romuald Członkowski (`czlonkowski`) — n8n-mcp** · 22.4k★, 108k npm dl/wk, pushed daily. Pain: [#837](https://github.com/czlonkowski/n8n-mcp/issues/837) (n8n 2.23.2 broke every write tool), [#549](https://github.com/czlonkowski/n8n-mcp/issues/549) (users begging for a compat matrix), [#492](https://github.com/czlonkowski/n8n-mcp/issues/492), [#781](https://github.com/czlonkowski/n8n-mcp/issues/781). Reach: GitHub issues; aiadvisors.pl. Opener: "Your #549 compat-matrix request exists because n8n drifts under you (#837 proved it) — `reelier manifest` fails CI closed the moment your tool surface changes, so consumers find out from your pipeline, not their broken agents."
2. **Christoph Kieslich (`chrisdoc`) — hevy-mcp** · 4.7k dl/wk, pushed daily. **Warmest lead: he's hand-building this feature** — [#608](https://github.com/chrisdoc/hevy-mcp/issues/608) (production output-schema canaries), [#656](https://github.com/chrisdoc/hevy-mcp/issues/656) (shape assertions vs mocked contract in CI), [#554](https://github.com/chrisdoc/hevy-mcp/issues/554). Reach: GitHub; chrisdoc.dev. Opener: "You hand-rolled contract canaries in #608/#656 — that's what `reelier manifest` does generically. Want to compare notes as a design partner?"
3. **Duncan Ogilvie (`mrexodia`) — ida-pro-mcp** · 10.7k★. Pain: [#328](https://github.com/mrexodia/ida-pro-mcp/issues/328) (schema says object, tool returns arrays — strict clients explode), [#144](https://github.com/mrexodia/ida-pro-mcp/issues/144) (IDA 9.0 upstream break), [#379](https://github.com/mrexodia/ida-pro-mcp/issues/379). Reach: X @mrexodia; mrexodia.re. Opener: "#328 is manifest-drift in its purest form — declared schema vs returned shape. Reelier snapshots your manifest and diffs it in CI so that class of bug can't ship."
4. **Stefan Broenner (`sbroenne`) — mcp-server-excel** · 23 tools / ~385 declarations, commits daily. Densest pain: [#672](https://github.com/sbroenne/mcp-server-excel/issues/672) (Gemini 400s on schema shapes), [#607](https://github.com/sbroenne/mcp-server-excel/issues/607), [#473](https://github.com/sbroenne/mcp-server-excel/issues/473), [#343](https://github.com/sbroenne/mcp-server-excel/issues/343)/[#344](https://github.com/sbroenne/mcp-server-excel/issues/344) (param renames reverted after consumer fallout). Reach: profile email (public). Opener: "You renamed parameters and had to revert (#343/#344) — with 385 declarations, a snapshot-diffed manifest in CI is the only way to change schemas without whack-a-mole."
5. **Mert Köseoğlu (`mksglu`) — context-mode** · 19.2k★. Pain: [#623](https://github.com/mksglu/context-mode/issues/623) (his own v1.0.137 silently dropped ctx_* tools from the MCP surface; OpenCode users found it first), [#673](https://github.com/mksglu/context-mode/issues/673). Reach: X @mksglu; profile email (public). Opener: "v1.0.137 shipped with ctx_* gone and users found it before you did (#623) — a manifest gate would have failed that release in CI."

### Repos already running agents in CI

6. **Ably — ably-cli** (`emptyhammond`, `umair-ably`) · Claude autonomously fixes failing Dependabot PRs (`dependabot-claude-fix.yml`, `contents: write`, 3 runs today). **Strongest pain: three hardening rewrites, no regression harness** ([#333](https://github.com/ably/ably-cli/pull/333), [#348](https://github.com/ably/ably-cli/pull/348)). Opener: "You've merged three hardening rewrites of dependabot-claude-fix.yml — Reelier is the regression test between rewrites: record a known-good fix run, replay on every workflow change, fail closed on drift."
7. **CloudWalk — stratus** (`bronzelle-cw`, `carneiro-cw`) · fintech; `dependabot-auto-vet.yml` runs gpt-5-codex vetting every dependency bump against a written policy; they already built "graceful auto-vet fallback". Opener: "gpt-5-codex judges every dep bump against VETTING_POLICY.md — Reelier snapshots that run so a model/prompt change that flips a vet decision fails CI closed instead of shipping silently."
8. **Redis — RediSearch** (`raz-mon`, `kei-nan`) · 6.2k★; Codex performs backports (`task-backport_pr-agent.yml`), month of hardening commits ([MOD-16271]). Their own comment calls the create step "mechanical". Opener: "Your backport agent's create step is 'mechanical' by your own comment — mechanical tool-call sequences are exactly what Reelier replays at 0 tokens and diffs when the agent drifts."
9. **Fedimint** (`elsirion`, X @EricSirion) · 694★; Codex reviews every PR; survived a provider switch ("back to PPQ"). Opener: "codex-review.yml already survived one provider switch — receipts would show exactly what changed in the bot's behavior across it, and pin it going forward."
10. **Mads Hansen — partner #0.** The taxonomy reviewer; the reply draft exists. Post it first; everything above goes out after.

## Bench (verified, use to backfill)

- **Ihor Sokoliuk (`ihor-sokoliuk`) — mcp-searxng** · 7.3k dl/wk; [#93](https://github.com/ihor-sokoliuk/mcp-searxng/issues/93) "Latest release breaks the application". Bio: "Agentic AI & MCP servers".
- **Ahmet Taner Atila (`atilaahmettaner`) — tradingview-mcp** · 3.6k★; [#76](https://github.com/atilaahmettaner/tradingview-mcp/issues/76) mid-flight output-shape migration (5 of ~100 tools done).
- **Martin Vogel (`DeusData`) — codebase-memory-mcp** · 34.5k★; [#786](https://github.com/DeusData/codebase-memory-mcp/issues/786) asks for provenance/freshness evidence — receipts-adjacent.
- **Pocket Casts iOS** (`geekygecko`, co-founder) · shared claude.yml across 3 repos, 9 days old. · **Tenstorrent tt-metal** (`nstamatovicTT`) · Claude review fanning across 3 MCP servers. · **RSSHub** (`DIYgod`, 45k★) · Claude issue-triage loop.

## Quotable third-party validation

[zonlabs/mcp-ts #71](https://github.com/zonlabs/mcp-ts/issues/71) independently specs Reelier's manifest feature: "diff the new tool list against the previously indexed set… including JSON Schema diffs… MCP servers evolve. If a tool gains a new required field… agents holding a cached schema [break]." Too small as a partner (23★); perfect as outreach/positioning evidence that the thesis is felt independently.

## Mechanics

One message per target on their warmest public surface (their own issue thread where the pain lives beats cold email — reply IN #837/#328/#608 etc. where policy-appropriate, offering the PR). Track: contacted → replied → workflow merged → still-green-week-3 (the only column that matters). Kill line: per plan, PR-loop k-factor judged at 6 weeks.
