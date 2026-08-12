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
- Required an actual nonempty MCP `advertisedName` matching the signed descriptor; the opaque connection specification name is never accepted as server identity.
- Made the signed Job Card `jobId` the public catalog/load/invoke identity while retaining its signed definition alias only for internal Outcome dispatch.
- Labeled deployment trust output as evidence only and required the host pin to live outside deployment-controlled output. Canonical `realpath` identities, Windows case folding, and link checks close case, junction, and symlink indirection bypasses before the pin is read.
- Preserved empty-workspace discovery/status behavior while refusing unsigned consequential Outcomes.
- Extended hermetic deployment, runtime, route, HTTP, certification, and observation tests for the new boundaries.

Deviations from plan and why

- None. The trust-pin shape was expanded before the unreleased ABI freeze so the builder can verify the complete signed-readiness proof rather than trusting a digest-only snapshot.
- The expensive full suite was deferred until the same reviewer returned `APPROVED` with no findings. The coordinating agent then reran the exact-head Windows suite successfully: 2,826 passing, 0 failing, and 1 skipped. An earlier full run completed with 2,823 passing, 2 failing, and 1 skipped; both failures were the now-fixed empty-workspace behavior.

Test results (verbatim tail)

```text
✔ managed local authority rejects declaration-only topology evidence (2.9792ms)
✔ local runtime creates a root task only for the authenticated sponsor (63.8303ms)
ℹ tests 18
ℹ suites 0
ℹ pass 18
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 13520.8694

> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

Additional verification:

```text
> reelier@0.32.1 build
> tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Exact-head full Windows suite:

```text
tests 2827
pass 2826
fail 0
skipped 1
duration_ms 762583.8885
```

Independent review

```text
Spec compliance: Met through be93a09.
Blocking issues: None.
Non-blocking issues: None.
Verdict: APPROVED.
```

Open risks

- Exact pushed head `4bbffba` passed hosted Ubuntu and Windows CI in GitHub Actions run `31550538611`. Ubuntu also confirmed the canonical README badge at 2,822 passing tests.
- Live adopted connections and provider certification remain gated on operator-owned resources and credentials; these changes establish and test the fail-closed binding, not live-provider certification.
- `.tmp-pack/` was pre-existing and intentionally left untracked and untouched.
