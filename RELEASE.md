# Release checklist

Dev setup, build, and test commands are documented in [CONTRIBUTING.md](./CONTRIBUTING.md) —
this file only covers cutting and shipping a release.

## Pre-release

1. `npm run preflight` — must pass all checks. It verifies:
   - working tree is clean
   - you're on `main` and synced with `origin/main`
   - the current `package.json` version is not already published on npm
   - `npm run build` succeeds
   - `npm test` passes AND the README tests badge matches the actual pass count
2. `npm run test:coverage` — note the coverage %. Don't regress it.
3. `npm run test:mutation` — optional, run on any core file you touched
   (`src/runner.ts`, `src/writeback.ts`, `src/skill.ts`, etc.).

Do not proceed to Publish until `npm run preflight` exits 0.

## Publish

1. Bump the version: `npm version patch` (or `minor`/`major` as appropriate).
   This commits and tags.
2. Push the commit and tag: `git push && git push --tags`.
3. Publish from a **clean checkout at the tip of `main`** — never from a
   feature branch or a tree with local changes:
   ```
   npm publish --otp=<code>
   ```
4. Verify it actually landed: `npm view reelier version` must match the
   version you just bumped to.

## Post-release

1. If `action.yml` or the GitHub Action's runtime behavior changed, move the
   `@v1` tag to the new release commit. This is a **deliberate,
   public-behavior-affecting change** — don't do it reflexively for every
   release, only when the Action itself changed.
2. Update `CHANGELOG.md` with the new version's entry.
3. Update the README tests badge if the suite size changed (the preflight
   check catches drift here going forward, but do it manually too if you
   bypass preflight for any reason).
