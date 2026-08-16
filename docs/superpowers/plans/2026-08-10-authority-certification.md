# Authority Certification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a guarded `authority certify` workflow that preflights resources, runs explicit provider/Fly/Codex certification adapters, signs release evidence, and verifies the exported graph offline.

**Architecture:** Keep provider execution behind a closed adapter registry and injected Authority Cell operations. The CLI orchestrates preflight, run, and verify; it never reads secret values or invents provider identity. Evidence is canonical, signed, append-only, and independently verifiable.

**Tech Stack:** TypeScript, Node.js built-in crypto/fs, existing authority wire/JCS/signing utilities, Node test runner, Ed25519 signatures.

## Global Constraints

- Live certification requires explicit acknowledgement and non-secret references.
- Credentials never appear in process output, evidence, receipts, manifests, or Cloud metadata.
- Ambiguous provider writes are reconciled and never automatically resent.
- `verified` never means safe, correct, complete, or universally enforced.
- Existing hermetic tests remain runnable without live credentials.

---

### Task 1: Add closed certification contracts

**Files:**
- Create: `src/authority/host/certification.ts`
- Test: `test/authority/certification.test.ts`
- Modify: `src/authority/host/index.ts`

**Interfaces:**
- `CertificationProviderId`, `CertificationScenario`, `CertificationPreflightReport`, `CertificationEvidence`, and `ReleaseEvidenceManifest`.
- `createCertificationPreflight(input)` returns a redacted deterministic report.
- `createReleaseEvidenceManifest(input)` returns a canonical manifest-ready object.

- [ ] Write tests for redacted references, missing resources, and closed provider IDs.
- [ ] Run the focused test and confirm the new tests fail because the module is absent.
- [ ] Implement validation, redaction, stable sorting, and independent claim states.
- [ ] Run the focused test and confirm it passes.
- [ ] Commit: `feat: add certification evidence contracts`.

### Task 2: Implement provider adapter registry and guarded runner

**Files:**
- Create: `src/authority/host/certification-runner.ts`
- Test: `test/authority/certification-runner.test.ts`
- Modify: `src/authority/host/index.ts`

**Interfaces:**
- `CertificationAdapter` with `id`, `provider`, `preflight`, `run`, and `cleanup` methods.
- `runCertification(input)` refuses without explicit live acknowledgement, missing cleanup, unknown adapters, failed cleanup, or non-positive writes.

- [ ] Write failing tests for acknowledgement, adapter lookup, ambiguity/no-resend, cleanup, and redacted output.
- [ ] Run tests and verify the expected failures.
- [ ] Implement the registry and sequential runner with immutable evidence events.
- [ ] Run tests and verify green.
- [ ] Commit: `feat: add guarded certification runner`.

### Task 3: Add Fly reference manifests and active probe executor

**Files:**
- Create: `infra/fly/authority-cell/README.md`
- Create: `infra/fly/authority-cell/authority-cell.toml`
- Create: `src/authority/host/fly-certification.ts`
- Test: `test/authority/fly-certification.test.ts`

**Interfaces:**
- `FlyCertificationOperations` and `runFlyCertification(input)`.
- The executor delegates to the existing `runFlyTopologyProbe`, binds runtime/image/network/schema digests, and emits signed redacted evidence.

- [ ] Write failing tests for all six probe claims and stale digest refusal.
- [ ] Run tests and confirm red failure.
- [ ] Implement the executor and reference manifest with no provider secrets.
- [ ] Run tests and confirm green.
- [ ] Commit: `feat: add Fly Authority Cell certification adapter`.

### Task 4: Add Codex dogfood launcher and graph export

**Files:**
- Create: `src/authority/host/codex-certification.ts`
- Test: `test/authority/codex-certification.test.ts`
- Modify: `src/authority/host/index.ts`

**Interfaces:**
- `CodexCertificationOperations` (`startProfile`, `stopProfile`, `readEvents`, `revokeRoot`).
- `runCodexCertification(input)` materializes all ten profiles, rejects duplicate principals/sessions, records revocation and duplicate/conflict/partial events, and returns a `TaskReceiptGraphV1` export.

- [ ] Write failing tests for ten profiles, body-supplied identity rejection, root revocation, duplicate collapse, conflict, and partial exception.
- [ ] Run tests and confirm red failure.
- [ ] Implement the launcher against injected process operations; do not assume a Codex binary is installed.
- [ ] Run tests and confirm green.
- [ ] Commit: `feat: add Codex swarm certification runner`.

### Task 5: Add CLI subcommands

**Files:**
- Modify: `src/authority/cli.ts`
- Modify: `src/cli.ts`
- Test: `test/authority/certify-cli.test.ts`

**Interfaces:**
- `authority certify preflight` prints JSON and exits nonzero when required references are missing.
- `authority certify run --adapter <id> --out <dir>` requires `REELIER_LIVE_CERTIFY=1` and writes redacted evidence.
- `authority certify verify --input <manifest>` performs offline verification.

- [ ] Write failing CLI tests for the three subcommands and exit codes.
- [ ] Run tests and verify red failure.
- [ ] Implement parsing, output, and file handling using existing authority signing/verification utilities.
- [ ] Run tests and confirm green.
- [ ] Commit: `feat: expose authority certification commands`.

### Task 6: Build signed release evidence and offline verifier

**Files:**
- Create: `src/authority/host/release-evidence.ts`
- Test: `test/authority/release-evidence.test.ts`
- Modify: `src/authority/host/index.ts`

**Interfaces:**
- `signReleaseEvidenceManifest(input)` and `verifyReleaseEvidenceManifest(input)`.
- Verification rejects digest substitution, signature-purpose confusion, missing linked evidence, and invalid claim transitions.

- [ ] Write failing tests for valid manifests and each tampering class.
- [ ] Run tests and verify red failure.
- [ ] Implement canonical digest/signature binding and claim-state validation.
- [ ] Run tests and confirm green.
- [ ] Commit: `feat: sign and verify release evidence`.

### Task 7: Refresh operator documentation and release artifacts

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`
- Create: `docs/release/0.32.0-certification.md`
- Create: `docs/runbooks/live-certification.md`
- Create: `docs/runbooks/provider-cleanup.md`
- Create: `docs/runbooks/merge-checklist.md`

- [ ] Update version, shipped capabilities, and known live blockers from verified code.
- [ ] Document commands, required non-secret references, cleanup, and honest claim semantics.
- [ ] Add release notes and merge checklist requiring live evidence before merge.
- [ ] Run documentation consistency checks and inspect diffs.
- [ ] Commit: `docs: document authority certification and 0.32 release`.

### Task 8: Full verification and PR preparation

**Files:**
- Modify: no source files unless verification finds a defect.

- [ ] Run `npm run build`.
- [ ] Run focused certification tests.
- [ ] Run the full `npm test` suite.
- [ ] Run `npm pack --dry-run` and inspect package contents.
- [ ] Push the branch and prepare the OSS PR URL.
- [ ] Prepare the Cloud PR URL and verify its exact `0.32.0` dependency.
- [ ] Do not merge until guarded live evidence and ten-agent graph evidence exist.
