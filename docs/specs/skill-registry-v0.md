# Reelier Public Skill Registry — v0 Spec (FINAL)

**Thesis.** The registry is the npm loop: publish free → every skill mints a public SEO/GEO page → the one-line consume command requires the CLI. But this is a never-lies brand: one malicious or silently-write-heavy skill on reelier.com is brand-fatal. v0 ships a machine-triaged registry where the safety label is **computed from the skill file, never claimed by the publisher**, read-only skills flow at npm speed, and a human gates only the tail where the brand is at stake.

## Decisions (contradictions resolved in synthesis)

1. **Moderation = effect classifier, not all-manual.** The winning draft gated *every* submission behind a human; the judges' graft wins: clean read-only skills auto-list instantly, anything else queues for manual approval — *with the full machine triage (secret scan included) bolted in front of the auto path*. Why: machine speed for the safe majority, human attention only where the brand can die; the all-manual gate taxes exactly the skills that are safe.
2. **Data model = head table + insert-only `registry_versions` ledger** (npm-parity's shape), replacing the winning draft's single table with a frozen copy. Why: an append-only ledger is *structurally* immune to the private-re-upload-mutates-public-page seam and left-pad-proof by construction, not by discipline.
3. **Versioning = server-assigned integers + `@sha256:` pins.** Authors never type a version number; `@N` and `@sha256:` both fetch exact frozen bytes. Why: no semver ceremony for one markdown file, and pinning survives regardless.
4. **Takedown = tombstone page + 410 machinery, merged.** The winning draft said "410 page"; judges kept "page stays up with a notice." Resolution: the HTML page stays up as a tombstone (reason shown, no content, no get command — link equity and honesty preserved); the `.md` twin, the fetch API, and `get` return 410 with the same reason. Content-hash blocklist applies to **policy takedowns only** — an author who self-unpublishes may republish their own bytes. Why: blocklists target abuse, not authors.
5. **License required** (winning draft) over npm-parity's optional-with-"not specified". Why: a never-lies page cannot distribute content whose license it shrugs at.
6. **Landing path = `./skills/<skill>.skill.md`** (winning draft) with npm-parity's same-hash no-op grafted into collision handling. Why: matches how `run` takes a path today; owner-scoped dirs are deferred until name collisions are a real problem.
7. **Ranking signal = recency + cross-tenant receipt count, nothing else.** `get_count` is displayed but never ranks. Why: a receipt pushed by a non-owner cannot be faked without actually doing the work — the most on-brand growth number possible; download counts are gameable.
8. **Public grade is binary and conservative:** READ-ONLY / WRITES. Unknown verbs count as writes; an UNKNOWN badge is never shown publicly. Why: the only honest posture for the brand.
9. **Consume copy block = `npx -y reelier@latest get <owner>/<skill>`** (judges) — gated on Max confirming the unscoped npm publish state (question 3 below). Why: one paste installs Reelier and fetches the skill in the same breath; time-to-first-get is the funnel metric.
10. **Publish verb = `reelier push <skill> --public`** (winning/growth-loop) over npm-parity's new `publish` verb. Why: extends the existing upload seam exactly like `--share` extended runs; one fewer verb to teach.
11. **Zero CLI telemetry, ever.** All counting is server-side bumps on the existing view-counter pattern, and the absence of telemetry is advertised as a trust feature. Badge/receipt embeds carry UTM tags so PostHog attribution comes free.
12. **Both activation metrics adopted:** supply-side (cross-tenant receipt matching a listing) and demand-side (`get` → pushed receipt for that skill within 7 days).
13. **Claim hygiene:** `get` NEVER executes (fetch and run stay two explicit steps behind the existing `--allow-writes` seatbelt), and with no signing shipped, no "tamper-evident" claims anywhere — per the established ship-now/HOLD word split.

---

## 1. Consume UX

```
reelier get <owner>/<skill>[@<N> | @sha256:<hex>]     # default: latest listed version
```

- **`get` is a new verb** — free in `cli.ts` (taken: run, bench, mcp, serve, trace, compile, push, diff, init, from-session, scan, install, uninstall; `install` is MCP-wrapping and stays that way; `add` would collide with skills.sh semantics).
- **No auth, no signup.** `GET /api/v1/registry/<owner>/<skill>` is anonymous → `{skillMd, version, contentSha256, effectGrade, license, endpoints}`. Public reads never see a login; the API key stays a publish-side concept.
- **Lands at `./skills/<skill>.skill.md`** (`--dir` overrides). Collision semantics: existing file with **identical sha256 → "already up to date", exit 0** (no-op). Different content → hard error naming the hash mismatch, suggesting `reelier diff`, requiring `--force`. Never silently clobber.
- **Integrity:** CLI verifies the body's sha256 against the API's `contentSha256` (and against an explicit `@sha256:` pin) before writing — a mismatch writes nothing and errors loudly.
- **After write, print the trust block:** effect grade, per-step effects, every endpoint the file hits, license, content hash, and the next command (`reelier run ./skills/<skill>.skill.md`). Grade WRITES additionally prints: *"Replay re-executes. This skill performs writes; `reelier run` will require `--allow-writes`."* The runner's existing gate is the enforcement; `get` says it out loud. **`get` never executes anything.**

## 2. Publish UX

- **CLI:** `reelier push <skill> --public` — extends the existing push (env `REELIER_CLOUD_URL/KEY`, upsert-by-tenant+name path untouched); adds `public: true` to the skills POST, which enters the submission pipeline. Response includes `{pageUrl, getCommand, status}`.
- **Dashboard:** a "Submit to registry" toggle on `/dashboard/skills/[name]` — same pipeline, second door for already-uploaded skills.
- **Namespace = GitHub login**, via the existing GitHub OAuth. **Explicit tenant→GitHub linking step:** an API-key tenant and an OAuth identity are not automatically the same thing (the known fixlyai-vs-seed mismatch proves it) — until the tenant is linked, `--public` errors with the exact dashboard URL to complete the link. Reserved names (`reelier`, `admin`, route words) blocklisted; `reelier` is the house owner.
- **Versioning:** server-assigned integers, auto-bumped on any content-hash change. Listings are **immutable per content hash**: republishing identical bytes is a no-op; changed bytes mint version N+1 and **re-enter moderation** (a v1 read-only skill must not silently become a v2 write skill — grade recomputed and re-gated per hash). Old listed versions stay fetchable by `@N`/`@sha256:`.
- **License:** frontmatter grows one field, `license:` (SPDX id), **required for `--public`**. The CLI prompts with a default of `MIT`; absent license = 400 at submit, never a guessed default. AGPL applies to the CLI, not user skills.

## 3. Public pages

- **URL: `/skills/[owner]/[skill]`** — two segments, zero collision with the five single-segment curated static portfolio pages, which remain the hand-curated top shelf.
- **SSR with ISR**, revalidated on listing/version/takedown events — registry content is DB-backed and changes only at those moments, so cache hard. Slug = frontmatter `name`, validated `[a-z0-9-]`.
- **Shown** (portfolio-page philosophy: the file is the artifact, every number parsed via the `portfolio-pages.ts` parser, never hand-typed): full rendered SKILL.md; derived step/assertion counts; the parsed endpoint list; **effect-grade badge** (green READ-ONLY / amber WRITES with the replay-re-executes warning — never a third state); provenance box (owner → GitHub profile, `recorded_with`, version history with hashes, license); the copy-button block **`npx -y reelier@latest get <owner>/<skill>`**; and **real receipts only** — shared receipt permalinks (`/r/[token]`) pushed for this skill with pass rate, or nothing. No fake activity, ever. Plus a README-embeddable badge snippet (reusing `/badge/[token]` where a shared receipt exists), UTM-tagged.
- **Machine twins day one:** `/skills/[owner]/[skill]/md` route (matching the existing `/skills/[slug]/md` convention, serving the verbatim file), sitemap entries, llms.txt section. This *is* the GEO payload.
- **Tombstones:** a removed skill's HTML page stays up showing the removal reason and nothing else; twin and API return 410.

## 4. Trust & safety (the core)

- **Effect grade is computed server-side** at submit: parse with `parseSkill` (already imported by the upload route), then per step take `max(declared effect, classifyEffect(toolName))` using the shared ladder in `reelier/src/effect-verbs.ts` — **publisher annotations carry zero authority here** (0.13.0's invariant: hints only ever tighten). Unknown verbs classify as writes. Skill grade = worst step. **Understatement** (declared `read` on a verb the ladder calls a write) = automatic rejection naming the exact step.
- **Machine triage runs on every submission:** parse-clean, ≤512KB, effect audit, **secret scan** (bearer tokens, creds-in-URLs — reuse `redact.ts` patterns; recorded skills are the exact artifact class that leaks credentials, and this check ships regardless of everything else), endpoint extraction (the reviewer — human or log — sees every domain the skill will hit), name/description profanity+impersonation lint. Any failure = instant 400 with reasons.
- **Gating policy:** triage-clean **read-only → listed instantly**, npm-speed, no human. Any write-grade step, any triage flag, or any destructive/unknown verb → **status `pending`, manual approve** in a dashboard admin queue. Version bumps re-enter this same gate. Tripwire to revisit staffing: 7-day approval backlog.
- **Write-heavy skills are listable but labeled**, never hidden: amber badge, warning copy, and the CLI's existing `--allow-writes` gate as the enforcement backstop. **Destructive-grade skills are not listable in v0.**
- **Integrity:** sha256 pin on every fetch (§1). No signing in v0 → no "tamper-evident" language anywhere (ship-now/HOLD word split).
- **Takedown:** "Report" link on every page → `POST /api/v1/registry/report` (rate-limited, writes a moderation row). Admin sets `removed` → tombstone page, 410 on twin/API, `get` refuses with the same reason, and — for policy takedowns — the content hash goes on a blocklist so the content cannot be republished under a new name. Author self-unpublish tombstones without blocklisting.

## 5. Data model

One migration, two tables + one column. The private per-tenant `skills` table is untouched (it stays the mutable working copy).

- `tenants.github_login text unique null` — the claimed namespace (if OAuth doesn't already persist it).
- `registry_skills(id, skill_id fk, tenant_id fk, owner_slug, name, status enum[pending|listed|rejected|removed], moderation_note, latest_version int, get_count int default 0, submitted_at, listed_at)` — `unique(owner_slug, name)`; index `(status, listed_at)`.
- `registry_versions(id, registry_skill_id fk, version int, skill_md text, content_sha256 text, effect_grade enum[read_only|writes], license text, status enum[pending|listed|rejected|removed], published_at)` — `unique(registry_skill_id, version)`; **rows are insert-only**. The frozen `skill_md` here is what pages and `get` serve — a private re-upload can never mutate a listed page, by construction.
- `registry_blocklist(content_sha256 unique, reason, created_at)` — anti-resurrection for policy takedowns.

## 6. Search / browse

`/skills` hub gains a "Community" section below the curated five: newest-listed first with **cross-tenant receipt count as the only other sort signal**, one filter chip (**"read-only" — default ON**), plain ILIKE over name+description. No tags, no facets, no ranking model, no owner profile pages (owner name links to a filtered query). `get_count` displays on pages but never ranks.

## 7. Seed plan

House account `reelier` (GitHub org). The 5 portfolio skills publish **through the real pipeline** (push --public → triage → listed) — dogfooding the gate is the gate's first test, and read-only ones exercise the auto-list path. Curated static pages stay canonical and gain the `reelier get reelier/<name>` block, cross-linking their registry twins. Then ~20 new read-only seeds (status sweeps, registry/API-shape radars for popular dev tools — the portfolio formula generalized), each recorded, replayed green, and pushed with `--share` so its page ships with a genuine receipt; published staggered over ~5 days for sitemap freshness.

## 8. Metrics

All server-side; **the CLI sends zero telemetry, ever** — stated on the pages as a trust feature.

- **PQL:** unique fetches of the registry GET (bump `get_count` fire-and-forget, exactly the `receiptViews`/`badgeRenders` pattern) — a `get` proves CLI installed + intent.
- **Activation, supply-side (THE flywheel number):** a receipt pushed (`POST /api/v1/runs`) matching a listed skill's name+hash **from a tenant other than the owner** — someone else replayed your skill and it produced a receipt. Cannot be faked without doing the work.
- **Activation, demand-side (THE conversion):** a `get` followed by a pushed receipt for that same skill within 7 days.
- Page views via existing counter infra; badge/receipt embeds rendered on registry pages carry `utm_source=registry&utm_campaign=<owner>-<skill>`; PostHog dashboards read counters + UTMs.

## 9. Non-goals (v0)

No ratings/comments, no paid skills, no org/team namespaces, no lockfile or auto-update, no semver ranges or dist-tags, no skill dependencies, no web editor, no `{{var}}` parameterization UI, no destructive-grade listings, no ML moderation, no skills.sh federation (stay format-compatible; don't build the bridge), no sandboxed replay service, no cryptographic signing or "tamper-evident" claims, no private registries, no rename/transfer, no CLI telemetry. Ship shape: 1 migration, 2 API routes + 1 body flag, 2 page routes + md twin, 1 CLI verb, 1 push flag, dashboard toggle + admin queue.

---

## Build plan (~2 weeks, 1–2 implementer agents; cloud repo = reelier-cloud, CLI repo = reelier)

**Week 1 — spine (publish → grade → fetch):**

1. **Migration** (cloud): `tenants.github_login` + `registry_skills` + `registry_versions` (insert-only) + `registry_blocklist`, per §5.
   *Verify:* drizzle migration applies clean on a Neon branch; journal in sync; duplicate `(owner_slug, name)` and `(registry_skill_id, version)` inserts fail; rollback tested.
2. **Tenant→GitHub link step** (cloud): dashboard surface to bind the API-key tenant to the OAuth GitHub login; publish path 403s with the link URL until bound. Reserved-name blocklist.
   *Verify:* integration test — unlinked tenant `--public` → 403 with URL in body; linked tenant proceeds; `reelier` owner rejected for non-house tenants.
3. **Triage + grading module** (cloud): `parseSkill` + import the effect ladder from the CLI package; `max(declared, classifyEffect)` per step, unknown→writes, understatement→reject naming the step; secret scan reusing `redact.ts` patterns; endpoint extraction; size/name lint; sha256.
   *Verify:* unit fixtures — clean read-only grades `read_only`; lying frontmatter rejected with step name; bearer-token fixture rejected; unknown-verb fixture grades `writes`; endpoint list matches fixture exactly.
4. **Publish API** (cloud): `public: true` on the existing skills POST → pipeline: triage → auto-list (clean read-only) or pending; server-assigned versions; same-hash no-op; hash-bump re-moderation; frozen copy into `registry_versions`.
   *Verify:* route-level integration tests — read-only publish returns `listed` + pageUrl instantly; write skill returns `pending`; same bytes re-push → no-op; changed bytes → v2 `pending` while v1 stays listed; private re-upload after listing does NOT change the frozen `skill_md`.
5. **Fetch API** (cloud): `GET /api/v1/registry/[owner]/[skill]` with `@N`/`@sha256:` resolution, `get_count` bump, 410+reason for removed, blocklist enforcement at publish.
   *Verify:* curl matrix — latest / version pin / sha pin / removed→410-with-reason / blocklisted-hash republish→400; counter increments exactly once per fetch.
6. **CLI `get`** (reelier): fetch, client-side sha verify, land `./skills/<skill>.skill.md`, collision semantics (same-hash no-op exit 0, diff-hash hard error + `reelier diff` hint, `--force`), trust block print, never executes.
   *Verify:* unit tests on collision/hash paths; a tamper test (server body mutated) writes nothing; live round-trip against a preview deploy; `run` on a fetched WRITES fixture still demands `--allow-writes`.

**Week 2 — surface (pages → moderation → seeds → live):**

7. **Public pages** (cloud): `/skills/[owner]/[skill]` ISR + `/md` twin + sitemap + llms.txt; badges per §3; tombstone rendering; `npx -y reelier@latest get` copy block (held behind task 13's npm confirmation); receipt section from `/r/` permalinks.
   *Verify:* build green; preview smoke — every displayed count parse-derived and matching the file; twin serves verbatim bytes; tombstoned page shows reason and no get command; sitemap/llms.txt contain the entries.
8. **Dashboard toggle + admin moderation queue** (cloud): submit-from-dashboard; queue shows triage results incl. full endpoint list; approve/reject/remove with note; remove → tombstone + blocklist (policy) path.
   *Verify:* end-to-end — dashboard submit → pending → approve → page live within one revalidate; remove → page tombstones, API 410s, `get` refuses with reason, same-hash republish under a new name blocked.
9. **Report endpoint** (cloud): `POST /api/v1/registry/report`, rate-limited, writes moderation rows surfaced in the queue.
   *Verify:* report creates a row; flood → 429; queue displays it.
10. **/skills hub Community section** (cloud): newest + receipt-count sort, read-only chip default ON, ILIKE search.
    *Verify:* seeded rows render in correct order; WRITES skill hidden until chip toggled; search hits name and description.
11. **Metrics wiring** (cloud): cross-tenant receipt-match activation (name+hash join, non-owner tenant), get→receipt-in-7d, UTM tags on embeds, PostHog dashboard.
    *Verify:* simulated non-owner receipt push increments activation and appears as the ranking signal on the hub; UTMs present in rendered embed snippets; owner's own receipts never count as activation.
12. **Seed execution:** 5 portfolio skills via the real pipeline under `reelier`, then ~20 read-only seeds each with a `--share`d receipt, staggered ~5 days.
    *Verify:* every seed page live with a real receipt permalink; `reelier get reelier/<name>` round-trips for each; curated pages cross-link; at least one seed exercised the manual queue (a WRITES fixture) before launch.
13. **Production deploy + full-loop smoke:** `npx vercel --prod` from reelier-cloud (NO auto-deploy — known gotcha), README/docs consume section, confirm `npx -y reelier@latest get` works cold on a clean machine.
    *Verify:* scripted production smoke of the entire loop — publish → auto-list → get (cold npx) → run → push receipt from a second tenant → activation counter moves — with each step's output captured.

## Resolved by Max (2026-07-22) — spec APPROVED, build proceeds

1. **Auto-publish: YES.** Triage-clean read-only skills go live with zero human look — the brand bet stands. Max is the sole approver of the writes/flagged queue. **Pending-screen copy (default, reversible — Max may change the number):** *"Most skills list instantly. Skills that perform writes get a human review — usually within 2 business days."* Do NOT print a same-day promise. The 7-day-backlog tripwire from §4 remains.
2. **House org: a dedicated `reelier` GitHub org** (create/confirm — NOT `fixlyai`). Rationale (Max): the owner slug shows on every seed page; `reelier/npm-download-radar` reads as official, `fixlyai/...` does not. ⏳ **Max action:** create the `reelier` GitHub org before seed execution (task 12) — tasks 1–11 only need `reelier` reserved as the house slug, which is already in the reserved-name blocklist (§2). **Legal:** ship v0 WITH a minimal publish-TOS + DMCA/takedown page (new task 7b) — do not hold seeds; a static TOS page is cheap, reversible, and covers the UGC takedown requirement.
3. **npm: PUBLISHED.** `reelier@latest` (0.14.0) is live. The `npx -y reelier@latest get <owner>/<skill>` copy block ships as specified — no install-link fallback needed.

### Task 7b — minimal legal page (folded into Week 2)
Static `/legal/skill-registry-terms` (or reuse an existing legal route if one exists): publisher grants distribution rights, warrants they may share the content, no malware/secrets; a DMCA/takedown contact + process; link it from every registry page footer and the publish confirmation. *Verify:* page renders, linked from a registry page and the dashboard submit flow.