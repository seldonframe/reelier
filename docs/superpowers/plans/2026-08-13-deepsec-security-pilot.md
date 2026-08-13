# DeepSec Security Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an optional, non-blocking DeepSec PR-review workflow and operator guidance without changing Reelier’s build or runtime dependencies.

**Architecture:** GitHub Actions runs a pinned DeepSec CLI in a read-only analysis job for same-repository pull requests, then uploads any generated comment/report artifact. A separate Markdown guide explains setup and review boundaries. DeepSec remains outside `package.json` and the normal CI workflow.

**Tech Stack:** GitHub Actions YAML, pinned `npx` package invocation, Markdown documentation.

## Global Constraints

- Do not add DeepSec to `package.json`, `package-lock.json`, or the production bundle.
- Do not alter the existing build/test workflow.
- Do not run PR-controlled code in a job with write permissions or automatic comment privileges.
- Skip fork pull requests and skip cleanly when the model secret is absent.
- Keep the check advisory and bounded by a 30-minute job timeout.

### Task 1: Add the DeepSec workflow

**Files:**
- Create: `.github/workflows/deepsec.yml`

- [ ] Add `pull_request` and `workflow_dispatch` triggers, same-repository guard, read-only permissions, Node setup, and a pinned DeepSec invocation using `process --diff origin/<base>`.
- [ ] Make the job non-blocking and upload `comment.md`/scan output only when present.
- [ ] Validate YAML structure and inspect the diff.

### Task 2: Add operator guidance

**Files:**
- Create: `docs/security/deepsec.md`

- [ ] Document enabling the secret, local/manual use, Reelier-specific review targets, cost bounds, credential isolation, artifact handling, and human adjudication.
- [ ] State explicitly that DeepSec is advisory and does not attest runtime write coverage or replace deterministic checks.

### Task 3: Verify isolation and regressions

**Files:**
- Test: `.github/workflows/deepsec.yml`, `docs/security/deepsec.md`, existing project test suite

- [ ] Confirm only the intended files are staged/changed.
- [ ] Run `npm test` and inspect the final diff with `git diff --check`.
- [ ] Confirm no DeepSec dependency or modification to `.github/workflows/ci.yml`.
