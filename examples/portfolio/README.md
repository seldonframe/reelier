# The replay portfolio

**Twelve real, read-only** skills against live public APIs — no accounts, no
keys, no writes. Five originals plus seven recipes (each a runnable example of
a recurring job, with a "point it at YOUR project" personalization hook).
Anyone can replay every one of them on their own machine, right now, with one
command each:

```bash
# the five originals
npx -y reelier@latest run examples/portfolio/npm-download-radar.skill.md
npx -y reelier@latest run examples/portfolio/github-repo-health.skill.md
npx -y reelier@latest run examples/portfolio/hn-mention-radar.skill.md
npx -y reelier@latest run examples/portfolio/vendor-status-sweep.skill.md
npx -y reelier@latest run examples/portfolio/registry-latest.skill.md

# the seven recipes
npx -y reelier@latest run examples/portfolio/nightly-deploy-check.skill.md
npx -y reelier@latest run examples/portfolio/api-contract-drift-watch.skill.md
npx -y reelier@latest run examples/portfolio/data-pull-report.skill.md
npx -y reelier@latest run examples/portfolio/cms-content-audit.skill.md
npx -y reelier@latest run examples/portfolio/weekly-metrics-digest.skill.md
npx -y reelier@latest run examples/portfolio/release-radar.skill.md
npx -y reelier@latest run examples/portfolio/seo-indexability-snapshot.skill.md
```

Each run is a Level-0 deterministic replay: the same HTTP calls, the same
assertions, **zero LLM tokens, $0.00** — and it emits a receipt (a run
record in `.reelier/runs/`) that says exactly which assertions held.

| Skill | What it proves, every run |
| --- | --- |
| `npm-download-radar` | npm's downloads API answers with a numeric weekly count |
| `github-repo-health` | GitHub's repo API answers with non-negative counters and the right identity |
| `hn-mention-radar` | The Algolia HN search API answers with a well-formed hits array |
| `vendor-status-sweep` | npm's and GitHub's public status APIs both answer with a status indicator |
| `registry-latest` | The npm registry serves a latest version that looks like semver |
| `nightly-deploy-check` | Each route of a live deployment answers 200 and still serves its expected body content |
| `api-contract-drift-watch` | A public JSON API still answers with its documented schema — required fields present and correctly typed |
| `data-pull-report` | The Frankfurter open-data API answers with the euro as base and each reported rate as a number |
| `cms-content-audit` | A public sitemap answers as a complete urlset that still enumerates its canonical URL |
| `weekly-metrics-digest` | Three public sources — npm downloads, GitHub, and the npm registry — all answer in a single read-only run |
| `release-radar` | GitHub's releases API answers with a real published release tag and a numeric id |
| `seo-indexability-snapshot` | A public page serves the core on-page SEO signals in its server-rendered HTML — title, meta description, canonical, Open Graph |

The assertions pin **shape and identity, never values** — download counts,
star counts, and version numbers change; a healthy replay doesn't.

## HONESTY RULE

These skills are authored against live public APIs and verified by real
replays — every receipt in this portfolio (including the seed receipts
below) comes from an actual `reelier run` against the actual endpoint on
the stated date. **Receipts are never fabricated**: no step is generated
that was not really executed, no assertion is silently rewritten, and a
failing endpoint produces an honestly failing receipt, not a retried-until-
green one. (The GitHub skills, for example, will honestly fail with a 403 if
the unauthenticated rate limit is hit — that failure is a real receipt too.)

## The standing public proof

`.github/workflows/portfolio-replay.yml` replays **every** skill in
`examples/portfolio/` every 6 hours (plus on demand) — it globs the
directory, so a new skill file joins the standing proof automatically. Every
green run appends to a public, dated, third-party-hosted audit log — the
Actions tab — so the proof accumulates on its own: **N replays, N passing,
$0.00 in tokens.** No secret is needed for that; if a `REELIER_CLOUD_KEY`
secret is present, each receipt is additionally pushed to the receipt ledger
on reelier.com.

## Point these at YOUR project

The skill grammar deliberately has **no default-value syntax** for
`{{var}}` template holes — an unbound `{{var}}` is an explicit error, never
a guessed fallback — so these files ship with literals that replay green
with zero flags. Personalizing is one command: rewrite the literal, then
replay.

```bash
# your npm package instead of reelier:
sed 's/reelier/YOUR-PACKAGE/g' examples/portfolio/npm-download-radar.skill.md > my-download-radar.skill.md \
  && npx -y reelier@latest run my-download-radar.skill.md

# your GitHub repo instead of seldonframe/reelier:
sed 's#seldonframe/reelier#YOUR-ORG/YOUR-REPO#g' examples/portfolio/github-repo-health.skill.md > my-repo-health.skill.md \
  && npx -y reelier@latest run my-repo-health.skill.md
```

What to swap, per skill:

| Skill | Literal to swap |
| --- | --- |
| `npm-download-radar` | `reelier` → your npm package name |
| `github-repo-health` | `seldonframe/reelier` → your `owner/repo` |
| `hn-mention-radar` | `reelier` → your project name |
| `vendor-status-sweep` | nothing — npm + GitHub are upstream of almost everyone |
| `registry-latest` | `reelier` → your npm package name |
| `nightly-deploy-check` | the three `www.reelier.com` route URLs + each body sentinel → your deploy's routes (edited by hand, not sed'd — each sentinel is page-specific) |
| `api-contract-drift-watch` | `pypi.org/pypi/pip/json` → your JSON endpoint, and the `json.<path> is <type>` asserts → your contract |
| `data-pull-report` | `USD` / `GBP` → the currency codes your report cares about |
| `cms-content-audit` | `www.reelier.com` → your domain (rewrites both the sitemap URL and the canonical-URL assert) |
| `weekly-metrics-digest` | `seldonframe/reelier` (owner/repo, swap first) then `reelier` (npm package) |
| `release-radar` | `seldonframe/reelier` → the `owner/repo` of a dependency you rely on |
| `seo-indexability-snapshot` | `https://www.reelier.com/skills` → your page URL |

## Seed receipts — 2026-07-21

Replayed for real with the published CLI (`npx -y reelier@latest`) on
2026-07-21. Verbatim output; run records confirm `passed: true` and 0 LLM
tokens (input + output) for every skill. The resolved CLI version differs by
cohort — the five originals on `reelier@0.12.1`, the seven recipes on
`reelier@0.14.0` (`seo-indexability-snapshot` on `reelier@0.15.0`).

```
=== npm-download-radar ===        (reelier@0.12.1)
✓ Step 1 — Last-week downloads [passed] 167ms

PASSED: 1/1 steps ok, 0 failed, 167ms total

=== github-repo-health ===        (reelier@0.12.1)
✓ Step 1 — Repo metadata and counters [passed] 1677ms

PASSED: 1/1 steps ok, 0 failed, 1677ms total

=== hn-mention-radar ===          (reelier@0.12.1)
✓ Step 1 — Search HN for mentions [passed] 411ms

PASSED: 1/1 steps ok, 0 failed, 411ms total

=== vendor-status-sweep ===       (reelier@0.12.1)
✓ Step 1 — npm status [passed] 150ms
✓ Step 2 — GitHub status [passed] 85ms

PASSED: 2/2 steps ok, 0 failed, 235ms total

=== registry-latest ===           (reelier@0.12.1)
✓ Step 1 — Latest dist-tag from the registry [passed] 152ms

PASSED: 1/1 steps ok, 0 failed, 152ms total

=== nightly-deploy-check ===      (reelier@0.14.0)
✓ Step 1 — Homepage is up and serving the real tagline [passed] 175ms
✓ Step 2 — Blog index is up with its real heading [passed] 44ms
✓ Step 3 — Docs page is up with its real description [passed] 26ms

PASSED: 3/3 steps ok, 0 failed, 245ms total

=== api-contract-drift-watch ===  (reelier@0.14.0)
✓ Step 1 — Assert the PyPI package-metadata contract holds [passed] 192ms

PASSED: 1/1 steps ok, 0 failed, 192ms total

=== data-pull-report ===          (reelier@0.14.0)
✓ Step 1 — Latest euro reference rates from the open-data API [passed] 248ms

PASSED: 1/1 steps ok, 0 failed, 248ms total

=== cms-content-audit ===         (reelier@0.14.0)
✓ Step 1 — Sitemap is a complete urlset with the canonical URL present [passed] 132ms

PASSED: 1/1 steps ok, 0 failed, 132ms total

=== weekly-metrics-digest ===     (reelier@0.14.0)
✓ Step 1 — npm weekly downloads [passed] 147ms
✓ Step 2 — GitHub stars [passed] 249ms
✓ Step 3 — Latest published version [passed] 85ms

PASSED: 3/3 steps ok, 0 failed, 481ms total

=== release-radar ===             (reelier@0.14.0)
✓ Step 1 — Latest published release from GitHub [passed] 268ms

PASSED: 1/1 steps ok, 0 failed, 268ms total

=== seo-indexability-snapshot === (reelier@0.15.0)
✓ Step 1 — Fetch the page and check its indexability head tags [passed] 239ms

PASSED: 1/1 steps ok, 0 failed, 239ms total
```
