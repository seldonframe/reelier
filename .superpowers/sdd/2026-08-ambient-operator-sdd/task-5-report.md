Files changed

- `src/authority/host/github-release-hosted-authority.ts`
- `src/authority/host/github-release-runner.ts`
- `test/authority/github-release-runner.test.ts`
- `.superpowers/sdd/2026-08-ambient-operator-sdd/task-5-brief.md`
- `.superpowers/sdd/2026-08-ambient-operator-sdd/progress.md`
- `.superpowers/sdd/2026-08-ambient-operator-sdd/task-5-report.md`

What changed

- `github-release-hosted-authority.ts`: adds an opaque host-only binding created from an already verified customer-rooted authority. It carries no provider credential, requires the GitHub connector/account to equal the signed release repository, strictly validates canonical timestamps and validity ordering, and derives a canonical release-binding digest.
- `github-release-runner.ts`: accepts the optional host binding in the existing authorization context, validates it before any provider read/write, commits its digest to the durable saga root, revalidates that binding during authoritative durable-head restart confirmation, rejects a changed binding on re-entry, and folds it into signed provider-readback evidence.
- `github-release-runner.test.ts`: RED-first test proves an unrecognized binding is refused before any provider call.
- `progress.md`: records the Task 5 handoff status and platform-limited full-suite result.
- `task-5-brief.md`: freezes the exact touched-file allowlist for review.

Deviations from plan

- The bridge is optional in the existing release authorization context to preserve the reviewed legacy local/fixture composition. A context without it is not customer-hosted-bound and must not be claimed as such. Task 3 Cloud must supply this host capability for managed release dispatch; this OSS task does not import Cloud code or alter authority/policy contracts.
- No new npm/MCP/GHCR provider contract was added: those lanes and packed tarball digest commitments remain the existing signed release-contract contract and workflow-owned publication surface.

Test results (verbatim tail)

```text
✔ release runner refuses an unrecognized hosted authority binding before provider dispatch (19.419ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 190.7452

> reelier@0.32.1 build
> node scripts/build-authority-contract.mjs --check && node scripts/build-bootstrap-contract.mjs --check && tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, github_release, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment

Error [AuthorityCellLinuxRequiredError]: Authority Cell hosting requires Linux. Windows is supported as a client; run the Cell through WSL, a Linux container, or a remote Linux Authority Cell.
    code: 'AUTHORITY_CELL_LINUX_REQUIRED'
```

Final focused regression tail (verbatim): `tests 13`, `pass 13`, `fail 0`, `cancelled 0`, `skipped 0`.

Commands run

- `npx tsc -p tsconfig.test.json --pretty false` — pass.
- `node --test --test-concurrency=1 --test-name-pattern="hosted authority binding" dist-test/test/authority/github-release-runner.test.js` — 1 pass, 0 fail.
- `npx tsc --noEmit --pretty false` — pass.
- `npm run build` — pass.
- `npm test` — not green on this Windows host: three Linux-Cell-only `authority-runtime.test.ts` tests failed with `AUTHORITY_CELL_LINUX_REQUIRED`; no release-bridge failure was shown before the harness time limit.

Open risks

- Full-suite verification requires Linux/WSL/remote Authority Cell hosting; this report does not claim a green full suite.
- The host capability is intentionally opaque only within this process. Its source must be `verifyCustomerRootedAuthorityV1` in the managed Cell; TypeScript cannot independently prove that provenance across a process boundary.
- No live GitHub, npm, MCP Registry, GHCR, or credential access occurred. Publication/evidence lanes remain contract-only and their production workflow execution is explicitly unclaimed.
