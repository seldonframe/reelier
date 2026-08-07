# Observed Work Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first production-quality OSS-to-Arena vertical slice for discovering observed work, consenting to a sanitized bundle, reviewing/correcting the job, auditioning the supported Slack → Notion → Linear workflow, and exporting an honest portable agent pack.

**Architecture:** OSS adds a pure discovery/fingerprint/bundle module over the existing session adapters and classifier, plus `discover` and `init` integration. Cloud adds a tenant-owned discovery table and validation/intake/review/confirm/export routes, then composes the confirmed supported fingerprint with the existing Arena fixture and blind vote flow. Unsupported work is recipe-only and `not_evaluated`.

**Tech Stack:** TypeScript, Node test runner, Next.js App Router, Drizzle/Postgres, existing Reelier Ed25519 signing, existing Arena fixture/worker/vote code, existing monochrome CSS.

## Global Constraints

- Never upload credentials, environment values, raw prompts, raw tool arguments/responses, private traces, unrelated sessions, or absolute home-directory paths.
- Never describe a Reelier skill as an autonomous agent; it is an evaluation/baseline input.
- Never render `absent`, `unchecked`, or `not_evaluated` as a pass.
- Supported Arena execution remains behind `REELIER_ARENA_CANONICAL_EXECUTION` and existing certification/publication gates.
- Do not modify the user’s dirty checkouts or existing Arena worktree.
- Do not deploy production or publish npm.

---

### Task 1: OSS discovery model and deterministic fingerprinting

**Files:**
- Create: `src/discovery.ts`
- Test: `test/discovery.test.ts`

**Interfaces:**
- Consumes: `ScannedSession`, `summarizeSession`, `parseSessionTranscriptForFormat`, `buildTraceFromSession`, `classifyEffect`, and `loadSigningKey`.
- Produces: `discoverOpportunities`, `buildDiscoveryBundle`, `formatDiscoveryPreview`, `signDiscoveryBundle`, `validateDiscoveryBundle`, and the exported `AgentDiscoveryBundleV1`/`AgentOpportunity` types.

- [ ] Write tests for stable fingerprints when argument values change, changed fingerprints when tool order/effects change, aggregation by frequency/recency, read-back/evaluation potential, side-effectful approval labeling, and source-agent preservation.
- [ ] Run `npm test` after adding the tests and confirm the new tests fail for missing exports.
- [ ] Implement exact normalized workflow-shape clustering: ordered `{server, tool, argKeys, effect, ok, approvalLike}` steps, no values; derive a read-back signal from later read tools and preserve only a sanitized dataflow relation.
- [ ] Implement deterministic ranking from count, recency, duration availability, stable sequence, read-back availability, and configured server availability; use tool-based labels when semantic intent is unavailable.
- [ ] Implement versioned bundle validation/redaction/signing using Ed25519 over canonical JSON and reject restricted fields, raw paths, unknown fields, invalid sizes, and missing signatures.
- [ ] Run `node --test dist-test/test/discovery.test.js` and confirm all new tests pass.
- [ ] Commit `feat: add observed-work discovery and signed bundles`.

### Task 2: OSS CLI `discover`, consent preview, upload, and `init` reuse

**Files:**
- Modify: `src/cli.ts`
- Modify: `src/init.ts`
- Modify: `src/scan.ts`
- Modify: `src/push.ts` or create `src/discovery-client.ts` for authenticated upload/config reuse
- Test: `test/discover-cli.test.ts`, `test/init.test.ts`

**Interfaces:**
- Consumes: Task 1 discovery APIs and existing `resolvePushConfig`, login config, scan roots, and init selection flow.
- Produces: `reelier discover [--select N] [--upload] [--yes] [--out FILE]`; Step 0 discovery output in `reelier init`; private import URL output after successful upload.

- [ ] Add CLI tests for preview exactness, default refusal without consent, `--yes` upload, no raw values/credentials/prompts/absolute paths, and authenticated request headers.
- [ ] Run the targeted CLI tests and confirm they fail before wiring the command.
- [ ] Add a small discovery client that resolves the existing Cloud URL/key chain and posts JSON to `POST /api/arena/discoveries` without logging the key or body.
- [ ] Add command parsing/help/dispatch and deterministic noninteractive errors; `discover` must still list opportunities locally when no API key exists.
- [ ] Call the same engine from `cmdInit` Step 0, keeping existing scan selection, compile, receipt, signing, and demo fallback behavior intact.
- [ ] Run targeted CLI tests plus the existing init/session/scan suites.
- [ ] Commit `feat: expose observed-work discovery from the CLI`.

### Task 3: Cloud discovery persistence, validation, and authenticated intake

**Files:**
- Create: `src/db/schema/arena-discoveries.ts`
- Modify: `src/db/schema/index.ts`
- Create: `drizzle/0029_arena_discoveries.sql` and matching metadata
- Create: `src/lib/arena/discovery.ts`
- Create: `src/app/api/arena/discoveries/route.ts`
- Test: `test/arena-discovery.test.ts`, `test/arena-discovery-route.test.ts`

**Interfaces:**
- Consumes: `authenticateRequest`, existing tenant schema, Ed25519 verification patterns, Arena catalog/fixture identifiers.
- Produces: `validateAgentDiscoveryBundle`, `verifyAgentDiscoverySignature`, `persistAgentDiscovery`, `getAgentDiscoveryByAccessToken`, `confirmAgentDiscovery`, and `POST /api/arena/discoveries` returning `{ id, importUrl }`.

- [ ] Write tests for valid/invalid signatures, replayed nonce, tenant mismatch, restricted fields, unknown fields, oversized bundles, and supported/unsupported fingerprint classification.
- [ ] Run the new Cloud tests and verify they fail before adding the schema/service.
- [ ] Add a tenant-owned discovery table with a unique `(tenant_id, run_nonce)` constraint, hashed private access token, sanitized bundle JSON, status, confirmed job, recipe, winner, and timestamps.
- [ ] Validate exact bundle version, signature/key shape, field caps, redaction report, digest format, nonce length, and canonical signature; never persist raw request text or log payload contents.
- [ ] Add the authenticated intake route with bounded body reads, stable 400/401/409/413 responses, and a private tokenized import URL.
- [ ] Generate the migration with the repository’s Drizzle tooling and update schema metadata without applying production migrations.
- [ ] Run targeted tests and `npm run typecheck`.
- [ ] Commit `feat: add private Arena discovery intake`.

### Task 4: Private import review, intent correction, recipe generation, and export

**Files:**
- Create: `src/app/arena/import/[id]/page.tsx`
- Create: `src/app/api/arena/discoveries/[id]/confirm/route.ts`
- Create: `src/app/api/arena/discoveries/[id]/export/route.ts`
- Create: `src/components/arena/DiscoveryReview.tsx`
- Modify: `src/lib/arena/discovery.ts`
- Test: `test/arena-discovery-review.test.ts`, `test/arena-discovery-export.test.ts`

**Interfaces:**
- Consumes: Task 3 token-scoped discovery access and the `AgentIntentV1`/`AgentRecipeV1` shapes.
- Produces: review page copy, one-sentence correction confirmation, `not_evaluated` unsupported status, supported battle handoff, and export response containing the required pack files.

- [ ] Write tests for import rendering, correction persistence, default approval boundary, supported fixture mapping, unsupported `not_evaluated`, export ownership, and required pack paths.
- [ ] Run the new tests and confirm they fail before implementing the routes/UI.
- [ ] Generate recipes deterministically from sanitized fingerprints with `draft_only` for read-only workflows and `approve_before_write` for side effects; include success checks only from observable read-back/evaluation signals.
- [ ] Implement token-scoped review/confirm/export handlers with same-origin checks and no raw bundle values in pages, JSON, or logs.
- [ ] Implement the pack file map: `instructions.md`, `policy.yml`, `evals/first-task.yml`, `setup/eve/`, `setup/hermes/`, and `REELIER.md`; state clearly that secrets stay local and unsupported adapters need local setup.
- [ ] Build the review page in the existing monochrome system with keyboard-friendly form controls and reduced-motion-safe styling.
- [ ] Run targeted tests, typecheck, and lint.
- [ ] Commit `feat: review and export discovered Arena jobs`.

### Task 5: Prompt-first Arena entry, explore catalog, and supported audition handoff

**Files:**
- Modify: `src/app/arena/page.tsx`
- Create: `src/app/arena/explore/page.tsx`
- Create: `src/app/api/arena/discoveries/[id]/audition/route.ts` if needed by the review flow
- Modify: `src/components/arena/ArenaVotePanel.tsx` only where needed to preserve blind/reveal wording
- Test: `test/arena-entry.test.ts`, `test/e2e/arena-discovery.spec.ts`

**Interfaces:**
- Consumes: Task 4 confirmation status and existing `getPublishedArenaBattle`, blind vote/reveal, and fixture/canonical routes.
- Produces: prompt-first `/arena`, catalog moved to `/arena/explore`, clear supported/unsupported copy, and no fake battle for unsupported workflows.

- [ ] Add tests asserting the dominant prompt/CTA, `/arena/explore` catalog link, supported Slack/Notion/Linear handoff, and unsupported copy.
- [ ] Move the current catalog body to `/arena/explore` without changing its battle URLs.
- [ ] Replace `/arena` with a monochrome prompt-first page that asks what job should be automated and points observed-history users to the CLI discovery command.
- [ ] Add a supported-workflow handoff that links only to the existing Slack/Notion/Linear challenge and keeps the existing kill switch/certification behavior.
- [ ] Verify the vote panel keeps harness/model identity hidden until the vote response and renders four-state evidence honestly.
- [ ] Run Arena unit tests and the Playwright Arena smoke.
- [ ] Commit `feat: make Arena discovery-first`.

### Task 6: Verification, review, push, and staging preview

**Files:**
- Modify only files required by verification fixes; add migration/runbook notes if required by deployment output.

- [ ] Run OSS targeted tests, full `npm test`, `npm run build`, and any CLI e2e suite.
- [ ] Run Cloud discovery/Arena targeted tests, full `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and Playwright smoke with a local fixture/database configuration.
- [ ] Re-read the plan and verify every privacy, ownership, honest-state, unsupported-flow, and kill-switch requirement against code/tests.
- [ ] Perform an independent review pass over the diff for raw-data leakage, route ownership, replay/nonce handling, and blind/reveal ordering; fix findings and rerun affected checks.
- [ ] Commit final verification fixes, push `codex/observed-discovery-oss` and `codex/observed-discovery-cloud`, and report hashes.
- [ ] Deploy Cloud only to the existing Vercel preview/staging target; do not publish npm or production.
- [ ] Report preview URL, migration name, required environment variables, test results, and remaining blockers.
