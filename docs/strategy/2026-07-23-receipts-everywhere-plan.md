# Receipts everywhere — the distribution plan

_2026-07-23. First-principles plan to make Reelier the default for: GitHub PR receipts, CI drift-detection, snapshot testing, audit trail, agencies, marketplaces. Written after 0.20 shipped and the trust ladder went live on real receipts. Honors settled calls: drift-CI read-only wedge (2026-07-21), ONE Show HN held for the undeniable moment, downloads-retention over stars, reputation-only trust._

## First principles

1. **The receipt IS the distribution.** Every receipt is a URL with a badge. Products whose artifact travels — Vercel preview links, Looms, Figma files — grow with usage because the k-factor lives in the object, not the marketing. Every move below maximizes receipts-seen-by-non-users.
2. **Attach to rituals that already exist.** PRs, CI runs, publishes, and client invoices happen anyway. Reelier wins where a receipt is one line added to an existing ritual; it loses anywhere it demands a new habit.
3. **Defaults beat persuasion.** Nobody "decided" to use preview deployments; they were the default. Equivalents: the Action snippet ships with `id-token: write` (done), `reelier ci` scaffolds the whole workflow, SF deployments ship receipts default-ON.
4. **Trust compounds superlinearly; content doesn't anymore.** 39 SEO pages exist. From here, the compounding asset is the receipt graph — corroboration, streaks, verified orgs. Network beats marginal content.
5. **Probabilities with kill criteria, not roadmap theater.** Every bet gets p × payoff ÷ effort, one leading metric, and an explicit kill/scale line. Cheap parallel probes; concentrate on measured retention.

## The two numbers that matter

- **WARR** — weekly active repos/machines replaying (retention, the Phase-0 metric).
- **Stranger-views/week** — receipt pages viewed by people who didn't push them (the loop input).

## The six surfaces, ranked by p × payoff ÷ effort

### 1. GitHub PR receipts — build the App now (bet #1)
The sticky-PR-comment GitHub App: a check-run + comment rendering the ladder on agent PRs. The PR comment is read by **reviewers — non-users, in work context, staring at a green ladder**. This is the Vercel-preview-comment loop; it's the only bet with structural virality. CI attestation shipped 2026-07-23; the App is rendering + auth (~1–2 weeks).
- Motion: GitHub Marketplace listing (free surface) + docs page "receipts on every agent PR" + the App linked from every receipt.
- p(meaningful adoption in 90d) ≈ 0.4 — highest variance, highest payoff. Rank 1 anyway: k-factor > certainty.
- Metric: PRs-with-receipts/week; comment→install CTR.
- Kill: <20 external repos after 6 weeks live → it's a feature, not a loop; stop investing.

### 2. CI drift-detection — the settled wedge; finish the on-ramp
The 2026-07-21 verdict stands and wave-2 named the lever: onboarding, not more content.
- Motion: `reelier ci` one-command scaffolder (workflow with manifest preflight + diff gate + optional push); hand-onboard 10 design partners from the existing funnel (dev.to thread, Discord, npm installers); Action Marketplace listing rides bet #1.
- p ≈ 0.55 for 10 retained repos in 90d (hand-onboarding makes this mostly execution).
- Metric: repos with green scheduled runs ≥3 consecutive weeks.
- Kill: none — this is the product; only re-scope.

### 3. Snapshot testing — the front door; spend little, convert better
Already the pitch, already 60-second `reelier init`, already content. Marginal spend goes to conversion: post the Mads reply (still pending), and hold the ONE Show HN until the PR App + animated-receipt landing make the demo undeniable (weeks 9–10 below).
- p ≈ 0.7 baseline continues; near-zero marginal effort.
- Metric: init-completion → first-push rate.

### 4. Agencies — SeldonFrame is captive distribution (bet #2)
We own both sides. Ship **proof-of-delivery receipts inside SF**: every deployed client agent pushes receipts to a client-visible page; invoices link them — "the agent booked these 40 jobs," signed and timestamped, verifiable by the client. Each client portal becomes a receipts showroom; agencies start selling WITH receipts.
- Motion: SF integration, default-ON for new agent deployments (principle 3); agency-facing one-pager.
- p ≈ 0.6 — integration risk only.
- Metric: SF workspaces with receipts enabled; client-page stranger-views.

### 5. Marketplaces — seed corroboration, don't market it
Reviews-that-can't-be-astroturfed needs distinct tenants — a cold-start network. Don't push it; seed it honestly: the 10 drift-CI partners replaying the same public portfolio skills produce byte-identical corroboration legitimately. Registry pages already surface counts; add verified-replay badges to MCP-registry listings (Glama etc.).
- p ≈ 0.3 in 90d (network-gated), near-zero marginal build.
- Metric: skills with ≥2-tenant corroboration.
- Gate: treat as byproduct until ~25 pushing tenants exist; revisit then.

### 6. Audit trail — inbound-only until pulled
Shipped and real (write receipts, idempotency keys, refs), but the buyer is compliance-adjacent and slow. Publish ONE honest "audit-facing ops" page (stating limits; never "compliance-grade"), capture inbound, do nothing else.
- p ≈ 0.2 near-term; cost ≈ one page.
- Standing rule: no outbound until 3 organic inbound asks.

## 90-day sequence

- **Wks 1–2:** PR App MVP + Marketplace listing + post the Mads reply.
- **Wks 3–4:** `reelier ci` scaffolder; hand-onboard first 5 drift-CI partners.
- **Wks 5–8:** SF proof-of-delivery integration (default-ON); onboard next 5.
- **Wks 9–10:** the ONE Show HN — animated real-receipt landing + live PR-comment demo.
- **Wks 11–12:** corroboration seeding + registry badges; measure everything; kill or double per criteria above.

## Deliberate non-moves

More SEO waves (sufficient; lever is onboarding) · paid acquisition · numeric trust scores (settled) · sybil-flavored corroboration growth (the rung's integrity IS the moat) · Reddit beyond hand-posts · a second Show HN.

## Outside-the-box additions

- **"Receipts or it didn't happen"** — the meme-able ask on every agent-built PR; badge in the comment.
- **Public streaks** — /replays already shows the ledger; surface longest-green-streak per skill (standing proof beats testimonials).
- **Docs-as-distribution** — get "record your run" into agent-framework docs and MCP server READMEs (the Action snippet is copy-paste).
- **Every receipt sells the next one** — the receipt page's "Replay this yourself" block is the only CTA that matters; keep it above the fold on mobile.
