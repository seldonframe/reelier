# Ambient Reelier Operator — SDD Implementation Plan

## Global constraints

- Work only in the paired `codex/ambient-operator-oss` and `codex/ambient-operator-cloud` worktrees.
- Preserve the original dirty worktrees and unrelated branches.
- Customer passkey proof is required; Reelier KMS may countersign but cannot create authority alone.
- Prompts are non-authorizing. Mission child grants are strict subsets of a standing authority and expire after at most 12 hours.
- Agents and harnesses never receive GitHub, npm, cloud, KMS, or connector credentials.
- `pending`, `absent`, `unchecked`, and ambiguity are never success.
- Ambiguous provider writes reconcile by authoritative readback and are never automatically resent.
- Do not add a new connector before the GitHub release tracer bullet passes end to end.
- Do not perform production merge, push, provisioning, billing activation, publication, or customer-data writes in this implementation run.

## Tasks

### Task 1: Customer-rooted authority contracts (OSS slice)

Add closed OSS contracts for `CustomerApprovalProofV1`, `StandingAuthorityEnvelopeV1`, `HostedAuthorityEnvelopeV1`, `MissionChildGrantV1`, and `TrustDomainDescriptorV1`. Bind canonical digest, tenant, trust domain, origin/RP ID, nonce, validity, connector identity, limits, and revocation generation. Verify WebAuthn ES256/EdDSA proofs and reject replay, aliasing, expiry, widening, cross-tenant, and KMS-only artifacts. The Cloud passkey ceremony and hosted-envelope issuance are a separate Task 1B consumer task after these OSS vectors are reviewed.

Files touched for this OSS slice: `src/authority/ambient-authority.ts`, `src/authority/index.ts`, `test/ambient-authority.test.ts`, and the SDD report/ledger artifacts.

### Task 1B: Cloud passkey ceremony and hosted issuance

Consume the reviewed OSS vectors without reimplementing canonicalization. Add Cloud passkey registration, trusted credential storage, challenge verification, standing-authority persistence, regional KMS countersigning, revocation generation, and hosted-envelope issuance. The Cloud side must reject KMS-only artifacts and expose no provider credential or signing-key material to agents or the control plane.

### Task 2: Regional trust-domain substrate

Add Cloud regional US/EU tenant state with RLS, regional AWS KMS/Secrets/S3 Object Lock/CloudTrail, OIDC access, and an idempotent provisioning state machine. Provision one Fly Authority Cell, durable ledger, volume, and restricted egress gateway per trust domain. Certify exact image/policy plus unauthenticated 401 and authenticated 200 behavior.

Task 2 Cloud implementation files: `src/lib/ambient-provisioning.ts`, `src/lib/ambient-provisioning-db.ts`, `src/lib/ambient-migration-history.ts`, `src/lib/ambient-authority.ts`, `src/db/schema/ambient-provisioning.ts`, `src/db/schema/index.ts`, `drizzle/0037_ambient_regional_trust_domains.sql`, `drizzle/meta/_journal.json`, `scripts/check-ambient-migration-history.ts`, `package.json`, and the corresponding focused tests/report/ledger artifacts. No provider SDK or live infrastructure write is in scope.

### Task 3: Receipt and lifecycle authority

Make the Cell ledger operational truth, S3 Object Lock immutable receipt storage, Neon rebuildable projections, and offline verification. Preserve explicit four-state outcomes through restart, suspension, decommissioning, billing failure, and control-plane outage. Add no-resend ambiguity tests.

### Task 4: Managed onboarding

Add OSS `reelier init --managed`, `--dry-run`, managed session configuration, `doctor --live`, exact configuration diff, and remote MCP/skill installation. Add Cloud browser login, Stripe Checkout, primary and backup passkey setup, encrypted recovery kit, regional trust-domain selection, GitHub App connection, standing-authority review/signing, provisioning progress, and live certification. Bare `reelier init` remains inspection-only.

### Task 5: GitHub release tracer bullet

Wire the existing four GitHub release Outcomes through hosted authority, credentials, exact candidate/PR/merge/tag reconciliation, npm/MCP/GHCR publication contracts, and immutable receipt graph. Prove duplicate/refusal/timeout/restart/no-resend behavior without live publication.

### Task 6: Eve adapter

Connect Eve to the standard remote MCP endpoint, preserve the eight-agent mission shape, and add two disposable rehearsal scenarios with ambiguity, restart, timeout, and duplicate-request injection. Prove credential absence, zero routine approvals for covered work, and inline Outcome/receipt delivery.

### Task 7: OpenCode adapter

Connect OpenCode using its remote MCP and skill mechanisms. Reuse identical authority, child-grant, provider, and receipt contracts. Run the same two rehearsal scenarios and require equivalent authority and receipt digests for equivalent missions.

### Task 8: Operator billing and launch surfaces

Add the `$49/month` Operator entitlement: one trust domain, unlimited agents, unlimited receipts, and GitHub release connectivity. Keep OSS/local/public receipts and offline verification free. Suspend new grants on payment failure without deleting historical evidence. Update product and pricing documentation only after tests pass.

## Cross-repository acceptance

- Setup-to-first governed read-only proof under ten minutes on Windows, macOS, and Linux.
- Eve and OpenCode use the same adapter-neutral authority and receipt contract.
- Two consecutive rehearsal missions per harness have zero duplicate effects and no routine mid-run approvals.
- Agents never possess provider credentials.
- Every required receipt lane is `verified`; completeness remains explicit `unchecked` unless separately proven.
- Full OSS, Cloud, cross-repository golden-vector, RLS, provisioning-fault, and offline-verifier suites pass.
