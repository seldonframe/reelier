# The replay portfolio

Five **real, read-only** skills against live public APIs — no accounts, no
keys, no writes. Anyone can replay every one of them on their own machine,
right now, with one command each:

```bash
npx -y reelier@latest run examples/portfolio/npm-download-radar.skill.md
npx -y reelier@latest run examples/portfolio/github-repo-health.skill.md
npx -y reelier@latest run examples/portfolio/hn-mention-radar.skill.md
npx -y reelier@latest run examples/portfolio/vendor-status-sweep.skill.md
npx -y reelier@latest run examples/portfolio/registry-latest.skill.md
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

The assertions pin **shape and identity, never values** — download counts,
star counts, and version numbers change; a healthy replay doesn't.

## HONESTY RULE

These skills are authored against live public APIs and verified by real
replays — every receipt in this portfolio (including the seed receipts
below) comes from an actual `reelier run` against the actual endpoint on
the stated date. **Receipts are never fabricated**: no step is generated
that was not really executed, no assertion is silently rewritten, and a
failing endpoint produces an honestly failing receipt, not a retried-until-
green one. (The GitHub skill, for example, will honestly fail with a 403 if
the unauthenticated rate limit is hit — that failure is a real receipt too.)

## The standing public proof

`.github/workflows/portfolio-replay.yml` replays all five skills every 6
hours (plus on demand). Every green run appends to a public, dated,
third-party-hosted audit log — the Actions tab — so the proof accumulates
on its own: **N replays, N passing, $0.00 in tokens.** No secret is needed
for that; if a `REELIER_API_KEY` secret is present, each receipt is
additionally pushed to the receipt ledger on reelier.com.

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

## Seed receipts — 2026-07-21

Replayed for real with the published CLI (`npx -y reelier@latest`,
resolved to `reelier@0.12.1`) on 2026-07-21. Verbatim output; run records
confirm `passed: true` and 0 LLM tokens (input + output) for all five.

```
=== npm-download-radar ===
✓ Step 1 — Last-week downloads [passed] 167ms

PASSED: 1/1 steps ok, 0 failed, 167ms total

=== github-repo-health ===
✓ Step 1 — Repo metadata and counters [passed] 1677ms

PASSED: 1/1 steps ok, 0 failed, 1677ms total

=== hn-mention-radar ===
✓ Step 1 — Search HN for mentions [passed] 411ms

PASSED: 1/1 steps ok, 0 failed, 411ms total

=== vendor-status-sweep ===
✓ Step 1 — npm status [passed] 150ms
✓ Step 2 — GitHub status [passed] 85ms

PASSED: 2/2 steps ok, 0 failed, 235ms total

=== registry-latest ===
✓ Step 1 — Latest dist-tag from the registry [passed] 152ms

PASSED: 1/1 steps ok, 0 failed, 152ms total
```
