Files changed

- `.superpowers/sdd/2026-08-11-authority-cell-certification-train/task-3b-fix-round-report.md`
- `contract/authority/v1/authority-key-descriptor.schema.json`
- `contract/authority/v1/signed-certification-readiness.schema.json`
- `src/authority/certification/authority.ts`
- `src/authority/host/config.ts`
- `src/authority/host/deploy.ts`
- `src/authority/host/deployment.ts`
- `src/authority/host/index.ts`
- `src/authority/host/local.ts`
- `src/authority/host/server.ts`
- `src/authority/ingress/http.ts`
- `src/authority/job.ts`
- `src/cli.ts`
- `src/connections.ts`
- `test/authority/certification-authority.test.ts`
- `test/authority/connection-adoption.test.ts`
- `test/authority/deploy.test.ts`
- `test/authority/host-server.test.ts`
- `test/authority/http.test.ts`
- `test/authority/local-e2e.test.ts`
- `test/observation-contracts.test.ts`

What changed

- Added signed Job Card adoption commitments and exact descriptor/adoption-set verification.
- Added a dedicated `human-sponsor/signed-job-card` signature purpose and readiness activation commitment.
- Removed deployment-candidate self-anchoring. Deployment creation now requires a separately supplied trust pin whose signed readiness, trust root, activation history, and current non-revoked state are verified cryptographically.
- Added a host-configurable Job Card trust-pin path and made `deploy` consume the reviewed pin outside the candidate. The CLI now derives the deployment alias from `jobCard.jobId`.
- Required signed Job Cards to bind exactly to installed reviewed first-party pack digests and rejected duplicate signed arrays.
- Bound runtime jobs, definitions, audiences, descriptors, accounts, schemas, and route endpoints to the signed deployment.
- Required HTTP requests to authenticate through the existing scoped, hashed, expiring `PrincipalRegistry`; stdio retains its process-scoped host identity.
- Sanitized adopted-route resolution and verification failures so provider and credential details cannot enter public errors.
- Preserved empty-workspace discovery/status behavior while refusing unsigned consequential Outcomes.
- Extended hermetic deployment, runtime, route, HTTP, certification, and observation tests for the new boundaries.

Deviations from plan and why

- None. The trust-pin shape was expanded before the unreleased ABI freeze so the builder can verify the complete signed-readiness proof rather than trusting a digest-only snapshot.
- The expensive full suite was not rerun after the final focused fixes because the coordinating agent explicitly requested waiting for review. The same reviewer returned `APPROVED` with no findings. Earlier in the fix round, the full suite completed with 2,823 passing, 2 failing, and 1 skipped; both failures were the now-fixed empty-workspace behavior and their focused regressions pass.

Test results (verbatim tail)

```text
✔ local runtime creates a root task only for the authenticated sponsor (37.2217ms)
✔ public production export parses DecisionContext and its portable evidence against packaged schemas (349.8499ms)
ℹ tests 21
ℹ suites 0
ℹ pass 21
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5393.435

> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

Additional verification:

```text
> reelier@0.32.1 build
> tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Independent review

```text
Spec compliance: Met through 7af427f.
Blocking issues: None.
Non-blocking issues: None.
Verdict: APPROVED.
```

Open risks

- The repository-wide suite should still be rerun by the coordinating release train after all parallel branch work has settled.
- Live adopted connections and provider certification remain gated on operator-owned resources and credentials; these changes establish and test the fail-closed binding, not live-provider certification.
- `.tmp-pack/` was pre-existing and intentionally left untracked and untouched.
