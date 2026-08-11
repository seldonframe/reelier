# Reelier Authority Cell Certification Train — 0.32.1

## Goal and constraints

Complete the selected certification estate before permitting certification writes:

- Fly topology
- GitHub issue-label replacement
- Cloudflare DNS replacement
- Slack private-channel topic replacement
- Cloudflare token → Vercel confidential injection
- Vercel staged-deployment promotion
- Neon migration rehearsal/application
- Ten-principal Codex dogfood

HubSpot is deferred and must not appear as a required placeholder. No live certification write is allowed until every selected runner is implemented, hermetically tested, configured, and included in a human-signed readiness manifest.

Use broad agent preparation with narrow authority exits. Provider acknowledgement is never reconciliation. Ambiguous writes never resend. Universal completeness remains `unchecked`.

The public product starts with one resumable `reelier init`. It must inspect Paths A, B, and C, inventory existing connections, and create shadow candidates without requiring provider credentials or performing writes. Existing-connection adoption is the default. Credential transfer is an explicit upgrade for exclusive unattended autonomy, not onboarding.

## One-command onboarding principle

Apply Vercel DeepSec's one-command, isolated, checkpointed onboarding pattern to both public initialization and certification.

`reelier init` creates only Reelier's conventional local workspace, discovers supported harnesses and connections, backs up configurations before any later rewrite, validates observation adapters, generates sanitized coverage and task-shape context, and resumes from the last completed checkpoint. It never creates credentials, reads secret values, performs live writes, signs authority, or silently broadens a scenario.

The public flow is:

- `reelier init [--dry-run]`
- `reelier discover`
- `reelier connections`
- `reelier deploy [candidate]`
- `reelier doctor [--live]`

`reelier init` reports three independent facts for each surface: Path A observation coverage, Path C Outcome capability, and declared-surface exclusive enforcement. It may recommend Path B freezing when deterministic replay is useful, but never freezes judgment-heavy preparation automatically.

The private certification initializer uses the same checkpointing discipline with expert commands:

The initializer must make the first successful certification path obvious while preserving expert controls:

- `authority certify init --config authority/certification.local.json`
- `authority certify preflight`
- `authority certify seal-readiness`
- `authority certify run --scenario <id>|--all`

Both generated contexts are local and sanitized. They record provider surfaces, declared write routes, source/read-back coverage, task graph, topology requirements, and missing setup without raw prompts, values, secrets, or provider bodies.

## Connection adoption modes

### Observe

No provider credential is required. Reelier installs reversible observation adapters, discovers repeated action graphs, and reports uncovered or unknown surfaces honestly.

### Adopt an existing connection — default

When the sidecar can call an existing MCP, plugin, CLI, or supported host connection, Reelier wraps or proxies that callable route, verifies its provider account and schema using read-only operations, and binds it through `ConnectionDescriptorV1` and `ConnectionAdoptionV1`. Reelier receives a callable route or opaque connection handle; it does not copy the underlying secret.

The connection may immediately serve local bounded Outcomes. If the agent still retains a raw write route or credential, bypass coverage and completeness remain `unchecked`; this does not block useful local operation.

### Secure for unattended autonomy

For managed autonomy, `reelier deploy` offers `Secure this connection`. Provider OAuth, a provider-native grant, or a one-time masked handoff moves only that selected connection behind the Authority Cell. The raw consequential tool is removed or refused for the declared surface while approved reads remain available.

Managed dispatch refuses when equivalent raw write routes remain reachable. Universal completeness remains `unchecked`, because declared-surface enforcement never proves every possible external route.

Discovery never scrapes secrets from source code, environment files, process memory, transcripts, or host configuration. Host-private connections that the sidecar cannot call remain shadow-only until the user supplies a callable or managed fallback.

## Task sequence and stacked PRs

### Task 1 — Repair the OSS base

Fix the three Linux failures in PR #115 as deterministic concurrency defects:

- Every concurrent decision append reaches a terminal classification.
- Ledger client/server lifecycle prevents spurious connection resets.
- Marker-only dead-owner recovery is deterministic across preparation-retired acknowledgement windows.

Do not increase sleeps or skip Linux assertions. Pass the complete suite on Ubuntu and Windows under stress.

### Task 2 — Certification configuration and resumable initializer

Implement public `reelier init` as the checkpointed Path A/B/C inspection flow. Add closed `ConnectionDescriptorV1` and `ConnectionAdoptionV1`, connection inventory, read-only account/schema verification, coverage reporting, reversible config backup, and local shadow-candidate generation. Do not access secret values or change write routing during initialization.

Add closed `reelier.certification-operator-config/v2` with explicit scenario selection, non-secret resource identifiers, Fly topology, Codex home/profile metadata, cleanup commitments, and named secret references. Remove HubSpot requirements when HubSpot is not selected. These secret references belong only to the private certification harness.

Add config migration, `authority certify init`, preflight, readiness sealing, export, and verify. Failed validation leaves no partial deployment. Generated task, Job Card, grant, Cell, and signer identifiers are never manually entered.

### Task 3 — Authority Cell signing and scenario registry

Implement existing-connection adoption as the default deployment route. A signed local deployment may use an adopted callable route while reporting bypass coverage honestly. `Secure this connection` performs explicit OAuth/provider-native/masked transfer for managed autonomy and requires measured declared-surface exclusivity.

Create the certification Authority Cell scaffold, purpose-separated human and Cell keys, trust activation records, principal registry, durable stores, provider endpoint manifests, signed Job Card/root-task flow, conserved budget, and readiness barrier. Human signing is interactive and never auto-signs scaffold output.

### Task 4 — Provider runners

Implement a common lifecycle: prepare → authoritative read → compile → reserve → reread/recompile → dispatch → controlled cut → reconcile → receipt → cleanup → export → offline verify.

Implement GitHub labels, Cloudflare DNS, Slack topic, Cloudflare token creation, Vercel environment secret setting, Vercel promotion, and Neon rehearsal/application. Include normal, ambiguity, redaction, account-binding, stale-state, and cleanup tests for each.

### Task 5 — Fly topology and leases

Deploy credential-free agent runtime, Authority Cell, private durable Postgres, and egress gateway. Measure and sign runtime identity, credential isolation, provider egress separation, raw-write reachability, read coverage, and declared-surface enforcement. Require fresh six-claim topology evidence and a ≤60-second lease bound to its digest.

### Task 6 — Ten-principal dogfood

Generate ten distinct Codex profiles and scoped sessions. Mint narrower child grants, preserve zero-effect preparation grants, enforce depth/fan-out/duration/budget limits, test duplicate collapse, conflict refusal, partial completion, root revocation, and offline task-graph verification.

### Task 7 — Release train

Create candidate and final signed release-evidence manifests. Test Cloud against the exact packed `reelier@0.32.1` tarball. Merge the OSS stack only after evidence is green, publish once, update Cloud to the exact package, apply migrations manually, deploy Cloud, run Cloud E2E, and publish the final manifest.

## Private certification estate

The following setup exists only to certify every selected adapter. It is not the customer onboarding flow, and no user is asked to connect every provider merely to start Reelier.

The certification operator creates disposable resources before the signed readiness window:

- Private GitHub repository `fixlyai/reelier-certification`, issue #1, two labels, and a repository-scoped Issues read/write token.
- Unproxied Cloudflare A record in a test-safe zone, plus separate DNS and token-creation credentials.
- Private Slack channel with a test app that can read the channel and write its topic.
- Dedicated Vercel project with current and staged deployments and a generated `.vercel.app` domain.
- Dedicated Neon project with a rehearsal branch, main branch, database, role, API key, and database URL.

Only identifiers, names, domains, IDs, deployment references, schema/permission IDs, Fly metadata, and secret-reference names go in `authority/certification.local.json`. Tokens, URLs containing credentials, passphrases, session files, generated secrets, and OAuth grants never do.

Secret references are exactly:

`REELIER_GITHUB_TOKEN`, `REELIER_CLOUDFLARE_DNS_TOKEN`, `REELIER_CLOUDFLARE_BOOTSTRAP_TOKEN`, `REELIER_SLACK_TOKEN`, `REELIER_VERCEL_TOKEN`, `REELIER_NEON_API_KEY`, and `REELIER_NEON_DATABASE_URL`.

The masked Fly helper imports those references without echoing or persisting values. Dedicated Codex authentication is interactive and remains outside the repository. Normal users see a provider authorization step only for the single selected job when no usable connection exists or when they choose exclusive managed autonomy.

## Acceptance

- Complete Windows/Linux suite is green.
- A clean user can run `reelier init` without adding any provider credential and receive honest Path A/B/C coverage and connection inventory.
- A supported existing callable connection can be adopted without copying its credential.
- Local adopted mode reports reachable bypasses and `completeness=unchecked`.
- Managed autonomy refuses until the selected credential is isolated and equivalent raw writes on the declared surface are refused.
- All selected runners pass hermetic shared conformance and controlled ambiguity tests.
- Readiness refuses missing resources, stale topology, stale leases, missing trust, missing cleanup authority, or missing credentials without revealing values.
- All six topology claims are measured and verified for managed dispatch.
- Secret injection never exposes generated plaintext outside the Cell.
- Ten principals produce one duplicate dispatch, one conflict, one partial exception, and cascading revocation.
- Exported task/receipt graph verifies offline.
- Cloud builds against the exact candidate tarball and accepts idempotent receipt retries while rejecting substitutions.
- `reelier@0.32.1` is published exactly once only after the final evidence manifest is signed.

## Compass and curriculum updates

Distill Chapter 7 into `BUILDING-COMPASS.md` and register the complete chapter plus primary readings in the Cloud knowledge index/evidence log. Add checks that CRDT convergence, TTL, bandit routing, auctions, token buckets, recursion limits, fairness, quorum, and evidence diversity never become authorization by themselves.

The Compass review for onboarding must explicitly answer: what painful setup or supervision is removed; what bypasses remain; whether agent freedom is preserved outside the consequential exit; whether the connection survives model/harness/provider/substrate replacement; and what measurement would falsify an exclusive-enforcement claim.
