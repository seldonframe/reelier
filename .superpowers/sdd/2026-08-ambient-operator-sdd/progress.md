# SDD ledger — plan: docs/superpowers/plans/2026-08-ambient-operator-sdd.md

## Baseline

- OSS worktree: `C:\Users\maxim\CascadeProjects\reelier-ambient-oss`, branch `codex/ambient-operator-oss`, base `6c2911b0446cb009ad78863ded54a0fb5e4f06e0`.
- Cloud worktree: `C:\Users\maxim\CascadeProjects\reelier-cloud-ambient`, branch `codex/ambient-operator-cloud`, base `98665790121eea58dd931987cc5065cd520dcb6f`.
- Original dirty worktrees preserved.
- Cloud baseline: 1,645 tests passed.
- OSS baseline: clean `npm run build` passed; initial `npm test` required generated `dist/`; rebuilt baseline test is running.

## Preflight task/interface scan

| Tasks | Shared surface | Finding | Ruling |
|---|---|---|---|
| 1/2 | hosted authority envelope and trust-domain identity | Cloud must consume exact OSS canonical digests. | Ruling: OSS contract vectors are authoritative; Cloud may not reimplement canonicalization. Cost if wrong: cross-repo authority rejection. |
| 1/3 | child grant, revocation, receipt identity | Receipt lifecycle must bind the exact signed grant and revocation generation. | Ruling: receipt verification rejects missing or mismatched grant identity. Cost if wrong: evidence could outlive authority. |
| 2/3 | Cell, ledger, regional storage, lifecycle states | Provisioning and receipts have different durability roles. | Ruling: Cell ledger is operational truth; S3 receipt graph is immutable evidence; Neon is rebuildable projection. Cost if wrong: dashboard becomes the sole proof. |
| 2/4 | trust-domain status and certification | Onboarding cannot show ready before topology certification. | Ruling: only `active` after exact 401/200 and policy readback. Cost if wrong: users receive false readiness. |
| 3/5 | receipt graph and GitHub release saga | Every provider transition must be represented before successor effects. | Ruling: no release successor without published receipt confirmation and authoritative head readback. Cost if wrong: unproven release progression. |
| 4/6 | managed remote MCP session and Eve | Eve is an adapter, not an authority root. | Ruling: Eve receives only audience-bound short-lived session material. Cost if wrong: harness credential escape. |
| 4/7 | managed remote MCP session and OpenCode | Both adapters must submit the same closed request shape. | Ruling: adapter differences are configuration/presentation only. Cost if wrong: harness-specific governance drift. |
| 5/6 | GitHub release definitions and rehearsal | Rehearsal must exercise the production composition, not a synthetic runner. | Ruling: live rehearsal remains a prerequisite for production claims. Cost if wrong: false certification. |
| 5/7 | GitHub release definitions and rehearsal | Same provider contract must work through OpenCode. | Ruling: equivalent missions require equivalent authority and receipt digests. Cost if wrong: adapter portability is unproven. |
| 6/8 | Eve rehearsal evidence and Operator entitlement | Billing cannot turn an unverified rehearsal into a launch claim. | Ruling: launch requires two verified rehearsals per harness. Cost if wrong: paid launch on unproven substrate. |
| 7/8 | OpenCode rehearsal evidence and Operator entitlement | Same launch gate as Eve. | Ruling: no harness is first-class until its two-mission corpus passes. Cost if wrong: DHH-grade proof remains anecdotal. |

| Task | Self-consistency scan | Ruling |
|---|---|---|
| 1 | Contract additions and verification tests agree. | Proceed; exact vectors will be generated before Cloud implementation. |
| 2 | Regional provisioning, certification, and lifecycle states agree. | Proceed; no Vercel request may own side effects. |
| 3 | Ledger, immutable evidence, and offline verification roles agree. | Proceed; no Neon-only verification. |
| 4 | Managed onboarding retains honest bare `init` behavior. | Proceed; explicit `--managed` only. |
| 5 | GitHub release scope is bounded to the existing four definitions. | Proceed; no second connector. |
| 6 | Eve work is adapter-only and rehearsal-gated. | Proceed. |
| 7 | OpenCode work is adapter-only and rehearsal-gated. | Proceed. |
| 8 | Pricing and entitlement do not meter receipts. | Proceed; `$49/month`, one trust domain. |

## Decisions

- Ruling: implement paired repositories in dependency order, OSS contract first and Cloud consumer second — shared digest drift is more expensive than parallel speed.
- Ruling: keep all production side effects outside this implementation run — the approved product plan distinguishes code verification from publication ceremony.
- Ruling: split the original Task 1 into an OSS contract slice and Cloud Task 1B — the OSS verifier must be reviewed before Cloud persists or countersigns its artifacts; the cost if wrong is one extra review boundary, while combining them would hide cross-repository digest drift.

Task 1: fix round 1/5 (credential registry, purpose binding, validity semantics addressed; strict per-field equality open; commits a4a77a94..7c9a0943)
Task 1: fix round 2/5 (strict per-field equality implemented; boundary proof incomplete; commits a5058d3b..f0842269)
Task 1: fix round 3/5 (complete three-boundary numeric/validity matrix; commits acc5283c..288f1f72)
Task 1: complete (commits e8bb9480..288f1f72, review clean)
Task 1B Cloud: complete in paired Cloud worktree (commits a0aefd4..4a20c2c, 2 parked non-production findings; issuance remains fail-closed until exact OSS package and production signer are configured)
Task 2 Cloud: fix rounds 1-5 closed concurrent-create poisoning, fabricated certification evidence, SSRF/setup failure persistence, evidence clearing on every failed transition, malformed durable-resource recovery, and failed-to-pending cleanup (commits 57a01b2..f315545; final review clean). Full Cloud suite 1670/1670, focused provisioning 11/11, tsc and drizzle check pass; schema gate remains unavailable without DATABASE_URL and no live provider/database writes were made.
Task 3 Cloud: brief issued; receipt/lifecycle implementation dispatched in paired Cloud worktree. No live provider/database writes are authorized.
Task 3 Cloud: fix rounds 1-4 complete through `ce40605` (atomic journal append/publication claim, no-resend pending intent, evidence-bound offline receipt/chain verifier, hostile-input totality, schema FK alignment). Final review clean; focused 10/10, full 1680/1680, tsc and drizzle check pass. No live Cell/S3/Neon adapter or external write claimed.
Task 4 OSS: managed init preview complete through `1e946a63`; final review clean after help discoverability fix. `--managed [--dry-run]` is local-only, redacted, non-authorizing, and leaves bare init unchanged. Implementer reported 37 focused tests, tsc, and build green; this worktree currently lacks installed `tsx`, so ad-hoc rerun is unavailable without dependency installation.
Task 4 Cloud: fix rounds 1-4 complete through `cd29dda`; final review clean after strict UTC timestamps, recursive closed evidence parsing, full identity isolation, expiry/revocation checks, credential binding, and durable RLS schema. Focused 15/15, full 1695/1695, tsc/drizzle pass; schema gate remains unavailable without DATABASE_URL and no provider writes were made. Untracked `.tmp-task4-fulltest.log` is disposable test output outside scope.
Task 5 OSS: hosted authority-to-release bridge implemented through `a35007c6..df072ab0`. The opaque host capability binds a verified customer-rooted GitHub account to the signed repository, checks hosted/mission freshness before provider access, commits its digest into the saga journal, and folds it into signed provider-readback evidence confirmed by the existing durable receipt seam. Focused hosted-binding test and type/build gates pass; the Windows full suite is not green because three pre-existing authority-runtime tests refuse Linux-only Cell hosting (`AUTHORITY_CELL_LINUX_REQUIRED`). No provider credentials or external writes were used.
