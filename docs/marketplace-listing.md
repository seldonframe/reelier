# GitHub Marketplace listing — Reelier replay

Copy for the Marketplace listing page when `seldonframe/reelier` is published (Settings → Actions → publish this action to Marketplace, on `action.yml` at the repo root). Not published by this change — publishing is a separate, gated step; see "Publishing checklist" at the bottom.

## Listing title

```
Reelier — prove your dependency bumps are safe
```

Note: this is the *listing's* title, written for the Dependabot/Renovate use case specifically, because that's the audience most likely to discover the action from Marketplace search. It is not `action.yml`'s own `name:` field — that stays `"Reelier replay"`, because the same action also runs scheduled drift-CI and plain PR replay, not only bump gating. Marketplace lets a listing's display title diverge from `action.yml`'s `name` field; if it turns out it doesn't, use `"Reelier replay"` verbatim and put this tagline in the description instead.

## Tagline (one line, under the title)

```
Dependabot opens the PR. Reelier proves the bump didn't break anything your test suite can't see.
```

## Description

```
Dependabot and Renovate open the PR and run your test suite — but neither
knows what your agent actually does at runtime: which tools it calls, with
what arguments, and what it expects back. A bumped SDK can rename a field,
change a default, or alter an error shape without failing a single unit
test. That's the check this action adds.

Reelier records a real run of your agent's tool-call workflow once — every
step with its own assertion — then replays it deterministically, 0 LLM
tokens, on every PR. Point this action at your recorded skill(s) in a
Dependabot/Renovate-gated workflow: it installs the bumped dependency,
replays your skill live against it, and fails the check on the exact step
that drifted. A green check is a receipt, not a guess.

Also works unscoped from bump PRs — as a scheduled drift check, or a plain
"replay this skill on every PR" gate. See README.md for both.

Honest scope: at the default max-level (0), Reelier never calls an LLM —
this proves your dependency/MCP-tool-call behavior is unchanged, not that
a model upgrade is safe. It is a bump-safety check, not a model-eval tool.
```

## How it works (for the listing's "How it works" panel)

1. **Record once.** `reelier mcp --wrap "<your tool server>"` (or `reelier init`, or `reelier scan`/`from-session` from an existing agent transcript) captures one real run of your workflow — every tool call, every response — and `reelier compile` turns it into a `.skill.md` with an assertion per step.
2. **Dependabot/Renovate opens a bump PR.** Your existing test suite runs as normal; it has no visibility into tool-call behavior.
3. **This action replays the skill live against the bumped dependency.** `reelier run <skill.md> --max-level 0` re-executes every recorded step for real — 0 LLM tokens, byte-identical intent — and checks each step's own recorded assertion against what actually came back.
4. **Pass or fail, with receipts.** Nothing drifted → green check, sticky PR comment with the pass count. Something drifted → red check, the exact failing step and assertion in the job log, merge blocked if you've made this a required status check.

## Setup steps (for the listing's "Installation" panel)

1. Record and commit at least one `.skill.md` for a workflow you want protected: `reelier init` (guided) or `reelier mcp --wrap "<your tool server>"` + `reelier compile`.
2. Copy [`.github/workflows/reelier-bump-check.yml`](../.github/workflows/reelier-bump-check.yml) from this repo into your own `.github/workflows/`.
3. Edit the `skill:` line to point at your recorded `.skill.md` (copy the whole step once per additional skill).
4. If the skill's tools live behind your own MCP server/process (the common case for testing a bumped SDK your tool code imports), uncomment `wrap:` and give it the command that starts that server.
5. Add the job as a required status check in your branch protection rules, so a drifted replay actually blocks the merge instead of just being visible.
6. Open (or wait for) a Dependabot/Renovate PR — the check runs automatically.

## Positioning notes (not listing copy — context for whoever writes/edits the listing)

- **Audience:** teams already using Dependabot or Renovate who want a check beyond "the test suite still passes" — specifically ones running AI agents / MCP tool servers where a dependency bump can silently change tool-call behavior.
- **The wedge:** "the check Dependabot lacks." Dependabot/Renovate automate opening the PR; they have no mechanism for asserting runtime tool-call behavior. This action is that mechanism, not a replacement for either.
- **Never claim:** that this tests or validates model upgrades, prompt changes, or LLM behavior at any level — replay at `max-level 0` (the setup this recipe uses) makes zero LLM calls. If a listing edit ever adds a claim like "safely upgrade your AI models," that's false for this workflow and must be corrected or scoped to `max-level 1`/`2` explicitly (which requires the reader to supply their own LLM credentials and changes the cost/determinism story).
- **Never claim:** guaranteed detection of every possible breaking change — a replay only catches drift on the specific recorded steps/assertions; it's a regression test for what you recorded, not exhaustive coverage of the bumped package's surface.

## Publishing checklist (for Max)

Not done by this change — publishing to Marketplace is a manual, gated action:

1. Confirm `action.yml`'s `branding` (currently `icon: check-circle`, `color: green`) still reads right next to this listing's title/tagline.
2. On GitHub: repo → Releases → draft a new release off a tag (or reuse the existing `v1` major-version tag flow already in use) → check "Publish this Action to the GitHub Marketplace" → select a category (suggest: "Testing" or "Continuous integration") → paste the title/tagline/description above into the listing form.
3. Verify the rendered listing doesn't silently reintroduce a model-upgrade claim (GitHub's listing form has its own free-text fields, separate from `action.yml`) before hitting publish.
