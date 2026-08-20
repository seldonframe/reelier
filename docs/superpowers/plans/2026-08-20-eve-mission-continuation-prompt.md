# Continuation Prompt — Eve-Governed Production Release of reelier v0.32.1

> Paste this whole file as the opening prompt of a fresh session (any capable dev or agent).
> It contains the mission, the full state, every decision with its reason, what is in flight,
> what remains, and the traps. Written 2026-08-20 (~02:00Z), mid-mission.

## 0. Who you are and what governs you

You are continuing a live, partially-executed mission: ship `reelier@0.32.1` to npm, MCP
Registry, and GHCR through Reelier's own governed release path — one human-signed
authorization, an agent organization doing the work, ONE pre-publish human review
(mission #1 only), receipts proving exactly what changed. This is the company dogfooding its
own product ("Let agents write") as tenant #1.

Binding order: **code and measured evidence > `reelier-cloud/docs/company/FOUNDATION.md` >
BUILDING-COMPASS.md > the plan/spec below > this prompt.** Governing metric: reconciled
Outcomes per human review. Never-list highlights you must not violate: `pending`/`absent`/
`unchecked`/`ambiguous` never render as pass; never let "verified" read as "safe"; receipts
prove scope, never semantic correctness. Tenant-#1 evidence is a demo, never market evidence.

Core docs (read in this order when unsure):
- Spec: `docs/superpowers/specs/2026-08-19-breaker-fixes-and-tasks-6-8-design.md`
- Plan: `docs/superpowers/plans/2026-08-19-breaker-fixes-and-tasks-6-8.md` (Global
  Constraints + Assembler Resolutions R1–R8 bind everything; R1/R2 amended per below)
- **The ledger** (authoritative history, untracked by design):
  `.worktrees/eve-governed-production-release/.superpowers/sdd/2026-08-19-breaker-fixes-and-tasks-6-8/progress.md`
  — every task, review verdict, adjudication, and finding. Trust it over memory.
- Task reports live beside the ledger (`task-*-report.md`).

## 1. State of the world (verified 2026-08-20 ~02:00Z)

**Repo `seldonframe/reelier`:** `main` carries everything — PR #123 (D1 infrastructure,
42 commits, fast-forwarded so `main`'s head is single-parent — REQUIRED because the provider
refuses merge/root commits), PR #124 (R2 amendment), PR #125 (D0 Eve remote binding).
Branch protection: required contexts `test (ubuntu-latest)` + `test (windows-latest)`,
strict; tag ruleset `release-tags` ACTIVE on `v*` (create/update/delete restricted, fixlyai
bypass); environment `production-release` with required reviewer **fixlyai**, admin bypass
OFF — this environment gates ALL THREE publish workflows and is mission #1's single
pre-publish human review. npm Trusted Publisher registered (reelier ↔ seldonframe/reelier,
npm-publish.yml, production-release env). Rehearsal repo: `seldonframe/reelier-release-rehearsal`
(private, disposable; has ≥2 commits + package.json because the provider refuses 0-parent
heads and 404 manifests).

**Live Cell (customer-held):** Fly app `reelier-authority-cell` (org personal, yyz),
machine 850d50b0737368, volume `reelier_authority_data` (1GB encrypted), shared v4
66.241.125.116. Cell id `cell_f677b11a1e47ccc8fad3c3b4`, audience `agent_release`, tenant
`tenant_release`, provider repository currently `seldonframe/reelier-release-rehearsal`.
Volume `/data/authority/` holds the digest-verified bundle (11/11 sha256 match vs stager
manifest), Cell signer PEMs (0600), the smoke grant, and
`principals/smoke-session.token` (0600; sessions expire ~12h — re-issue via
`fly ssh console -C "node /data/authority/cell-register-and-probe.mjs --grant /data/authority/smoke-root-grant.json --new-session"`).
Fly secret `REELIER_RELEASE_GITHUB_PAT` set (fine-grained PAT: rehearsal repo only,
Contents RW + PR RW + Actions RO + Metadata; expires Sep 18; **fine-grained PATs have NO
Checks permission — verified against GitHub docs; that is WHY getChecks reads the Actions
jobs API**). Public probes: no-auth → 401; authenticated → 200 with FOUR jobRefs. Live
provider smoke: **PASS** (read-only, all five surfaces vs real GitHub + real npm, in-Cell).

**⚠ The Cell image predates PRs #124/#125 and every later merge. REDEPLOY FROM MAIN before
any rehearsal** (`flyctl deploy -c infra/fly/authority-cell/authority-cell.toml --app
reelier-authority-cell --yes` from the repo root) — the deployed in-Cell verifier still
enforces pre-amendment contracts. `/app` resets on every deploy (re-upload any in-Cell
scripts); the volume persists.

**Operator keys** (`C:\Users\maxim\.reelier-release-keys` — NEVER move, print, or upload;
back it up): release-authority (signs authorization bundles, offline), job-signer,
readiness-signer, deployment-operator, deployment-contract (mint/sign the deployment),
journal+evidence signers (their private PEMs are the only key material ON the Cell volume).
Committed trust pin: `release/trust/release-authorization-signer.json`
(signer `reelier.release-authority.2026`). Ed25519 everywhere.

**Eve:** real Eve 0.39.0 fixture at `conformance/continuity-adapter/v1/eve-fixture/` now has
a REMOTE Cell mode (env `REELIER_CELL_URL` + `REELIER_CELL_TOKEN`; token scrubbed at throw
site; fresh app root per run — a warm `eve dev` host answers from ITS OWN startup env, which
once produced a false PASS off a stale token). `npm run smoke:remote` = real Eve agent doing
jobs.search → load. Eve runs fine on win32 (the Linux-only constraint is the CELL's, i.e.
`authority serve`). The LIVE Eve smoke (operator token + fly.dev URL) was handed to the
operator and may or may not have been run — check with them.

## 2. What was done and WHY (causal chain, compressed)

1. **Task-5 terminal breaker** ("Do not ship") named three falsifiers. Fixed as A1–A3,
   each RED-first + independently reviewed, then A4 scoped re-review issued **Lift**:
   - A1 receipts integrity: evidence digest was format-checked only (tamper accepted);
     no parent-dir fsync (silent dirent loss = silent head rollback). Fix: recompute +
     bind all head fields to the digest-bound preimage; `syncDirectory` (hard on Linux);
     temp+rename in writeImmutable; expectation param `expect: "terminal"|"root-or-terminal"`
     (R1) so dispatched-state readers refuse a rolled-back head while crash recovery (the
     two legitimate reservation-only windows) still works.
   - A2 id seam: fs-ledger mints raw `sha256:<hex>`; new durable/journal code expected
     `reservation_<hex>`; recovery stranded pre-dispatch. Fix: ONE shared
     `normalizeReservationPublicationId`, applied at every seam; fs-ledger untouched (its
     format is durable on-disk state). Lesson institutionalized: **real-artifact fixtures**
     — the defect survived 168 green tests built on fabricated ids.
   - A3 serve injection: the documented CLI path never constructed the release runner.
     Fix: closed `--release-runner-config` (v1 schema, PEM key FILES, discriminated provider
     union), explicit-argument injection (options-record runner is refused), startup
     refusals BEFORE any disk write (tree-equality pinned in tests).
2. **Release surface (B-lane):** B1 found neither spec transport fits frozen contracts →
   operator chose **out-of-band ref** `refs/reelier/release-authorizations/<tag>` (sound
   because artifacts are self-authenticating: Ed25519 + digest + committed trust pin;
   transport untrusted by construction). B2 offline verifier (refuses env trust knobs and
   `--from-tag`; `--help` argv[0]-only per operator decision — a value-position `--help`
   was a dormant bypass). B3 npm-publish.yml (OIDC, no tokens, SHA-pinned actions,
   exact-tarball publish, never-resend reconcile with bounded poll). B4 wires verifier +
   `production-release` environment into mcp/docker workflows (tags-only conditions keep
   non-tag paths working; the dispatch-path env gate is INTENTIONAL — without a tag there
   is no verifier, so the human gate is the only control there). B5 live HTTPS provider
   (14 closed methods, SecretResolver refs only, fixed User-Agent, single-page degrade-closed).
3. **Live-only defects the barrier caught** (the reason rehearsal fidelity matters):
   GitHub 403s UA-less requests (hermetic fixtures never required UA); Node 24.19.0 added
   `net.BoundSocket` whose constructor binds (network-oracle inventory extended); the
   rehearsal repo's root commit and missing package.json refused; fine-grained PATs cannot
   hold Checks (→ getChecks re-sourced to Actions jobs API — job names ARE Actions check
   names; external check suites fail closed by name-set inequality).
4. **R2 amendment** (operator exception): `RELEASE_BASE` constant deleted — a constant
   cannot pin its own merge commit. Base now carried by the signed bundle; safety =
   runner's live `heads/main == plan.baseCommit` at candidate publication (:278), re-read
   before EVERY provider write (:435), direct-parent ancestry (:307/:377). Adversarially
   reviewed 6/6, Approved.
5. **C-lane:** key ceremony (operator-side, 3+4 keypairs); bundle stager
   (`scripts/stage-cell-bundle.mjs` — self-verifies before writing; refuses pasted
   credentials pre-write after a review found the leak); Fly deploy (bootstrap image first
   for a stable sftp target — **flyctl sftp refuses piped stdin on Windows; upload via
   chunked base64 over `fly ssh console`, then verify remote sha256 against local**);
   in-Cell principal registration + authenticated catalog probe
   (`scripts/sign-root-grant.mjs` + `scripts/cell-register-and-probe.mjs`).
6. **Ceremony signer** `scripts/sign-release-authorization.mjs` (rehearsal-harness branch,
   9/9): composes + signs the full seven-file artifact set, self-verifies via
   `verifyReleaseAuthorizationBundleV1` before writing a byte. **Not yet reviewed** — review
   before it signs anything real.

## 3. Operator decisions on record (do not relitigate; reasons attached)

| Decision | Choice | Why |
|---|---|---|
| Mission #1 publish gate | Pre-publish human review via `production-release` env on all three workflows; removed after two clean missions | Evidence-led widening (FOUNDATION); 5 review rounds each caught forgery-class defects green gates missed; costs 0 on the metric |
| Hotfix timing | Coupled to mission; **auto-decouple Sep 1**: if v0.32.1 unshipped, cherry-pick the Task-1 CLI-help fix to main, ship plain, mission re-points 0.32.2 | Pre-committed kill threshold beats sunk-cost reasoning |
| Cell topology | Fly.io, customer-held ("like a real customer") | Operator's explicit call; Compass reference topology |
| Auth transport | Out-of-band ref | Neither spec carrier fit frozen contracts; artifacts self-authenticating |
| `--help` semantics | argv[0]-only | Value-position `--help` = dormant bypass token (legal git refname) |
| R2 base unpin | Signed-bundle authority | Constant can't contain its own merge hash; runtime checks bind |
| R3 repo unpin (2026-08-20, IN FLIGHT) | Repository only moves to signed bundle | Real-GitHub rehearsals on the rehearsal repo; safety = `requireConfiguredRepository` (operator-config gate the signer can't influence — STRONGER than R2's case); branch/tag/version/paths/workflows stay pinned |
| Invoke transport (IN FLIGHT) | ADD the HTTP invoke route (jobRef-scoped, sharing MCP's handler.invoke path) | Four Outcomes were MCP-only; alias-direct HTTP refusal (local.ts:213) must remain pinned |
| Verdaccio | Workflow `npm --registry` arg ONLY; provider `npmRegistryBaseUrl` stays real npm (https-only validation) | Rehearsal preflight then checks the REAL registry — honest |
| Smoke-review waivers | Smoke tooling (956b4337..) consciously un-reviewed (fail-closed both ways); D0 and stager WERE reviewed | Recorded in ledger |

## 4. In flight RIGHT NOW (check these first)

1. **R3 implementer** — worktree `.worktrees/rehearsal-harness`, branch
   `codex/rehearsal-harness` (has ceremony signer at 02a1b3ae + R3 on top when done).
2. **HTTP invoke implementer** — worktree `.worktrees/http-invoke`, branch `codex/http-invoke`.
3. Both need **adversarial review (strong model) before merging** — frozen-contract and
   kernel-ingress class respectively. Then rebase → PR → merge (badge! see traps).
4. **Live Eve smoke** — with the operator (token in their shell; may have run; ask).
5. Ceremony-signer review — owed.

## 5. What remains, in order (each gate named)

1. Review + land R3 and HTTP-invoke (adversarial reviews; badge count WILL change).
2. **Redeploy the Cell from main** (see §1 warning). Re-upload in-Cell scripts; re-issue session.
3. **Rehearsal driver** (`scripts/run-release-rehearsal.mjs` — Tasks 2–3 of
   task-D3-harness-report.md, now unblocked): drives the four governed jobs IN ORDER over
   authenticated HTTP against the rehearsal repo; hermetic proof vs local serve + loopback
   provider first. Then the **fault corpus** (plan Task C4): injected timeouts, duplicate
   invocations, machine restart mid-dispatch, tampered evidence digest → refusal, lost
   terminal dirent → refusal, absent/lookalike runner → startup refusal.
4. **Rehearsals ×2 consecutive clean** on Fly vs the rehearsal repo (real GitHub post-R3).
   Any failure resets the counter. Rehearsal is prerequisite evidence, never production-pass.
   npm leg: Verdaccio as workflow arg; MCP lane dry-run **recorded as dry-run**.
5. **Mission #1** (plan §7 + D4): quality evidence generated pre-signing (full suite,
   coverage, mutation ≥9000bp bound to candidate head — mind the 12h window, evidence
   BEFORE signing); operator signs via `sign-release-authorization.mjs` (base = live main
   head; repository = seldonframe/reelier — requires re-pointing the CELL config repository
   + a mission PAT scoped to seldonframe/reelier: mint NEW fine-grained PAT, same shape as
   rehearsal's); agents build the 3-file candidate (`src/cli.ts`,
   `test/cli-subcommand-help.test.ts`, `CHANGELOG.md` — ≤64KiB; the help-fix content
   already exists from old Task 1); four governed transitions; tag fires three workflows;
   they QUEUE on production-release; **operator reviews once and approves**; reconcile;
   fresh Windows+Ubuntu installs run the help matrix; receipt graph verifies offline
   (15 lanes `verified`, completeness forever `unchecked`); post-release review.
   Mission principal: audience must equal the invoking principal (bundle admits exactly
   one; default `agent_release`); allocation id must NOT be `"root"` (unique across the
   delegation root — smoke used it).
6. Missions #2–3 clean → remove the environment reviewer (widening earned). Then the
   fan-out ladder / Grok / packaging per the strategy docs — out of scope here.

## 6. Process rules that made this work (keep them)

- **SDD loop per task:** fresh implementer (opus for kernel/trust, sonnet mechanical) →
  adversarial reviewer (fable/strong for trust surfaces — "never cheapen the checker") →
  ONE fixer for Critical+Important → re-review → ledger line. Plan-mandated defects and
  frozen-contract changes go to the OPERATOR, never silently widened.
- RED-first TDD with the exact falsifier; mutation-check your own pins (several "green"
  tests were proven vacuous only by mutation). Real-artifact fixtures at integration seams.
- One writer per worktree, ever. Reviews are read-only and must not build while a writer runs.
- Every external mutation (Fly, GitHub, registries) is operator-confirmed or
  operator-executed; secrets only in the operator's shell or Fly secrets; key material
  never in chat/logs/commits.
- Ledger EVERYTHING in `progress.md` — it is the recovery map after any context loss.

## 7. Traps (each cost real time)

- **flyctl on Windows:** "Error: The handle is invalid" at exit is COSMETIC (output is
  fine); `fly ssh sftp shell` refuses piped stdin → chunked-base64 upload + sha256 verify;
  `fly` alias absent, use `flyctl`; new apps get NO public IP until `fly ips allocate-v4
  --shared` (+ v6); first `.fly.dev` DNS lags — probe with `--resolve` pinning.
- **PowerShell 5.1:** no `&&` — separate lines or `;`.
- **README tests badge:** `scripts/check-badge.mjs` fails Ubuntu CI whenever the pass count
  changes. Count at last green: 3577 (#125). Adding N passing tests → update the badge in
  the same PR or CI goes red after ~9 minutes.
- **GitHub:** rebase-merge can refuse server-side ("branch can't be rebased") — if main
  hasn't moved, fast-forward push the reviewed head (`git push origin HEAD:main`; required
  checks must be green on that exact sha; PR auto-marks merged). Keep main's head
  SINGLE-PARENT (provider refuses merge/root commits). Fine-grained org PATs need the org
  to allow them; no Checks permission exists.
- **Eve:** warm `eve dev` hosts answer from stale env — always fresh app root; loopback
  suite depends on the fixture staying loopback-by-default.
- **In-Cell:** `/app` is image-layer (lost on deploy); the volume persists; no curl in the
  image (use `node -e` with fetch); GitHub requires a User-Agent header.
- Grep the ledger for "Minors to final review" — the accepted-residuals list (e.g.
  writeImmutable POSIX tamper-healing, verifier check-head negatives, durable-node identity
  cross-bind, --emit evidence upload) is real follow-up work, not noise.

## 8. Quick links

PRs: #123 (D1), #124 (R2), #125 (D0) — all merged. Operator status page (artifact):
https://claude.ai/code/artifact/9afb4b6b-964a-494b-95c7-6d147f2e7a6d (stale re: consoles —
the ledger is current). CI: `gh workflow run ci.yml --ref <branch>`; required contexts
`test (ubuntu-latest)`, `test (windows-latest)`.

**First actions for a fresh session:** (1) read the ledger tail; (2) check the two in-flight
branches' state (`git -C .worktrees/rehearsal-harness log --oneline -3`, same for
http-invoke) and run their adversarial reviews if unreviewed; (3) ask the operator whether
the live Eve smoke ran; (4) proceed down §5 in order. Do not start rehearsals before the
Cell redeploy. Honor every gate; when in doubt, refuse loudly and ask the operator.
