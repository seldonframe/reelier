# 0.19/0.20 README + reelier.com refresh — approved design

_2026-07-23. Implements `2026-07-22-v020-launch-brief.md`. All four open decisions were put to Max and approved: full plan go; pillars as plain-language weave (no literal triad in the OSS README); marquee placed after the proof strip; trust-ladder band links the real `vendor-status-sweep` receipt (`/r/Cm8w2wa10NC0XXrgQ9GxxFEv`)._

## Scout facts this design rests on

- CLI verified against shipped `dist/cli.js` (0.20.0): `run --fail N[=status]`, `--ignore-manifest`, `manifest --wrap`, `approve [--all]`, `push --timestamp`, `verify <permalink|file> [--key]`, `init --signing` all exist. Tests: **641/641** (README badge says 233 — stale).
- README already documents the 0.19/0.20 features with correct word discipline; Task A is a delta.
- reelier.com landing (`src/app/page.tsx`) has **zero** 0.19/0.20 messaging. No marquee component exists; animation vocabulary = CSS keyframes in `globals.css` + framer-motion TextAnimate + IntersectionObserver stagger. No host gating.
- Deploy: `.vercel/project.json` = `prj_nn4DSxuBnEvrrneDp1Qv4eW4dNgr` (`reelier-cloud` prod). Manual `npx vercel --prod`. Working tree branches off `origin/main` @ `3cac547`.

## Task A — README delta (branch `docs/v020-readme`)

1. Tests badge 233 → 641.
2. "Three tests, one skill" bullets → table (Test | Command | Answers), Mads Hansen credit kept, link `docs/specs/flight-recorder-v2.md`.
3. Trust-ladder table 4 → **8 rows**, ordered as the receipt page renders them: unaltered-since-push · timestamped · produced-by · tools-verified · writes-approved · cross-checkable refs · CI-attested · corroborated. Existing 4 rows keep their copy; cloud-side rungs (produced-by, corroborated) labeled as accruing/registered on reelier.com. Link `docs/specs/trust-ladder-v1.md`.
4. New "What it means for you" section (after Trust ladder): one line each — solo dev/OSS maintainer, team shipping agent changes, agency, marketplace buyer/seller, audit-facing ops (no "compliance" wording).
5. Pillars stay woven in plain language (honest receipts / MIT+BYOK own-it / 0-token thin replay) — no internal triad naming.

## Task B — website (branch `feat/v020-landing` off `origin/main`)

1. **Hero:** H1 unchanged. Subhead extended with the graded-claims clause (never a blanket ✓).
2. **"One skill, three tests" band** after the three-command How section: Determinism / Drift / Recovery cards with real commands; credit line.
3. **Trust-ladder band:** static 8-row mini-ladder reusing the receipt chip vocabulary (green/amber/grey), each row = claim + how to light it; honest footer (fabrication-resistance, never -proof); links: live receipt `/r/Cm8w2wa10NC0XXrgQ9GxxFEv` + `/replays`.
4. **Use-case marquee** after the proof strip: 7 tiles in order snapshot testing → CI drift → recovery → agencies → marketplaces → GitHub PR receipts → audit trail. Pure CSS keyframe scroll, duplicated aria-hidden track, pause on hover, `prefers-reduced-motion` → static grid. No new deps. PR tile must not imply the (unshipped) sticky-PR-comment App — CI attestation only.

## Copy discipline (hard gate at review)

- "tamper-evident" **only** beside the unaltered-since-push row.
- "compliance-grade", "fabrication-proof" banned everywhere.
- Grey/absent rungs are honest gaps with an upgrade hint, never shame.
- Three-test taxonomy credited to Mads Hansen wherever it appears.
- Nothing documented that the shipped binary doesn't have; roadmap flagged as roadmap.

## Ship path

Implementer subagents (one per repo, parallel) → reviewer subagent (diff + banned-copy grep + truth-vs-specs) → merge (`push HEAD:main` for cloud) → `npx vercel --prod` from the linked dir → smoke www.reelier.com (200, section sentinels, receipt link 200, banned-copy sweep of rendered HTML) → commit summary + memory.

## Definition of done

Brief §7 verbatim: README reflects 0.20.0 with verified commands; website hero/features + marquee live + example receipt linked; deployed to `reelier-cloud` prod; no banned copy; short summary of what changed and why.
