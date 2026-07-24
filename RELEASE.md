# Release checklist

Dev setup, build, and test commands are documented in [CONTRIBUTING.md](./CONTRIBUTING.md) —
this file only covers cutting and shipping a release.

## Pre-release

1. `npm test` — green.
2. `npm run test:coverage` — note the coverage %. Don't regress it.
3. `npm run test:mutation` — the full trust-critical core (10 modules). It's
   **incremental** (`reports/stryker-incremental.json`), so the first run is slow
   but subsequent runs only re-test mutants in code that changed — feasible as a
   per-release gate. Investigate every survivor: it's either a real test gap to
   close, or a provably-equivalent mutant to annotate with `// Stryker disable
   next-line <Mutator>: <reason>` (see `src/canonical-json.ts` for the pattern).
   Target: keep the score in the green band (≥90).
4. Update `CHANGELOG.md` with the new version's entry.

## Cut the release

1. **Bump the version first:** `npm version patch` (or `minor`/`major`). This
   commits and tags — so preflight in the next step validates the version you're
   actually about to ship, not the previous one.
2. **Gate:** `npm run preflight` — must exit 0 before you publish. It **hard-fails**
   on:
   - working tree not clean
   - the (just-bumped) `package.json` version is already published on npm
   - `npm run build` fails
   - `npm test` fails, or the README tests badge ≠ the actual pass count
   It also prints **advisory warnings** (these do NOT block) if you're not on
   `main` or not yet synced with `origin/main` — both are expected right after a
   local `npm version` bump, before you push.
3. Push the commit and tag: `git push && git push --tags`.
4. Publish from a **clean checkout at the tip of `main`** — never from a feature
   branch or a tree with local changes:
   ```
   npm publish --otp=<code>
   ```
5. Verify it landed: `npm view reelier version` must match the version you bumped to.

## Post-release

1. If `action.yml` or the GitHub Action's runtime behavior changed, move the
   `@v1` tag to the new release commit. This is a **deliberate,
   public-behavior-affecting change** — don't do it reflexively for every
   release, only when the Action itself changed.
2. The README tests badge drift is caught by preflight going forward; if you ever
   bypass preflight, update the badge manually.
