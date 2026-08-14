# One-Command Agent Bootstrap and Consequential Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `reelier init <agent-name>` and `reelier up` as a pinned, runtime-neutral composition over existing Paths A/B/C, with independent Outcome Profile certification and tenant activation, truthful route coverage, and no automatic authority creation.

**Architecture:** Preserve bare `reelier init` as the existing inspection-only checkpoint machine and add a separate named-bootstrap transaction that writes closed local project artifacts. Add profile governance as an outer trust layer around existing reviewed Path C packs; do not change the gate/compiler/ledger/dispatch/receipt kernel. `up` validates all pins before process start, composes observable/replay/activated lanes, and supervises only processes it owns while treating external runtimes and remote Authority Cells honestly.

**Tech Stack:** TypeScript 5.5, Node.js 20+, Node test runner, JSON Schema 2020-12/Ajv, RFC 8785 canonical JSON, Ed25519 purpose-bound signatures, existing Reelier Authority/Continuity contracts and conformance runners.

**Spec:** `docs/superpowers/specs/2026-08-14-one-command-agent-bootstrap-design.md`

## Global Constraints

- Before the first RED test, rebase the implementation worktree onto the final independently accepted `codex/continuity-path-c-integration` commit; record that exact SHA in `.superpowers/sdd/2026-08-14-one-command-agent-bootstrap/progress.md` and never silently change it.
- The planning snapshot is `2f7fcc21e785a102527ef6c43ab62f4f51a3c92b`; it is not an implementation or release pin.
- Preserve `INIT_CHECKPOINT_IDS`, the current initialization artifact names, and current `PLAN_DIGEST`; existing `.reelier/init/state.json` must remain readable and byte-stable.
- Preserve bare `reelier init`, `reelier init --dry-run`, and `reelier init --signing` behavior.
- `init` may generate keys, registration requests, drafts, reversible configuration plans, and canary results. It must not generate a trusted identity binding, conformance certification, tenant activation, trust root, topology pass, or Path C authorization.
- `--yes` may approve reversible local file/configuration changes only. It must never sign authority or activate Path C.
- Outcome Profile v1 references existing registered first-party packs. Do not add arbitrary expressions, callbacks, JavaScript, dynamic imports, or a second compiler.
- Runtime launch adapters and Continuity adapters remain separate replaceable boundaries. Eve, Grok/Cursor, Codex, Claude Code, and future harnesses must pass the same public conformance contracts; do not add provider- or model-specific trust semantics to bootstrap or `up`.
- Do not add profile artifacts to `AuthorityKind`, change Authority Contract v1, or widen `AuthorityReceiptBundle`. Use a separate versioned profile-governance contract and outer receipt wrapper.
- The branch-only, unshipped Outcome Profile Contract v1 may change in place for the approved Task 2 independently signed Authority binding. Its generated digest must change with its eight-member descriptor; Authority Contract v1, `AuthorityReceiptBundle`, `src/authority/types.ts`, and the existing inner evidence/verifier remain byte-for-byte unchanged.
- Do not widen `AuthoritySignaturePurpose` for profiles. Use the existing `authority-evidence` outer signature purpose over the closed profile-specific purpose preimage defined in Task 1.
- Keep Path A fail-open recorder semantics, Path B fail-closed replay semantics, and Path C fail-closed gate semantics unchanged.
- Keep provider credentials, workload private keys, operator keys, certifier keys, trust roots, and secret values out of bootstrap reports, runtime manifests, process arguments, environment snapshots, logs, and receipts.
- Managed remote Cell is the founder-facing default on every platform. Named `init` and `up` must never provision a Cell or expose Linux setup in the happy path. Advanced self-hosting may connect to an independently provisioned Linux Cell and must not bypass `assertAuthorityCellHostPlatform`.
- Preserve the ownership split frozen by the Cloud plan at commit `892a91d`: this OSS plan owns profile governance, the governed host composition protocol, remote Cell client/session contracts, route discovery, supervision, and A/B/C conformance; Cloud owns managed provisioning, entitlement, isolated deployment/secret custody, founder UI, pricing, and lifecycle. Cloud consumes an exact accepted OSS package version/integrity and must not reimplement the kernel or verifier.
- Do not start `reelier mcp` or `reelier serve` as independent daemons; their stdio lifecycle belongs to the configured agent host.
- Do not automatically run Path B skills from `up`.
- No automatic retry after send-started ambiguity.
- Every user-visible aggregate is derived from route rows; `unknown`, `uncovered`, `unchecked`, `absent`, and `pending` never render as pass or completeness.
- Every task ends with focused tests, `git diff --check`, an immutable commit, and independent spec-compliance plus code-quality review before the next task starts.
- No live provider credentials, provider writes, workflow dispatch, deployment, push, merge, or external write is authorized by this plan.

## File map and scope allowlist

The `Files:` block under each task is the exhaustive tracked-file allowlist for that task, including generated outputs. An implementer must amend this plan and obtain review before touching a tracked path not listed there.

| Task | Responsibility and owned file units |
|---|---|
| 1 | Outcome Profile schemas/builder/generated digest, standalone verifier, public Authority export allowlist, package scripts, governance tests |
| 2 | Host-only governance loader/admission, shared eligible-contract selector, canonical route projection, general purpose-separated inner-bundle construction, governed immutable receipt publication/recovery, callable governed-Cell composition root, and local gate/runtime regressions |
| 3 | Bootstrap schemas/builder/generated digest, installed-build identity, public `reelier/bootstrap` parser surface, route/runtime record types |
| 4 | Provider-neutral discovery adapter registry, Codex/Claude collector translations, route-level freshness and legacy initialization compatibility |
| 5 | Named bootstrap checkpoint transaction, workload registration, draft generation, reversible install planning, CLI/init compatibility |
| 6 | Runtime supervisor, remote authenticated Outcome client/session binding, `up` CLI, fresh coverage, platform and runtime tests |
| 7 | Public bootstrap conformance kit, hermetic A/B/C/Continuity journey, clean packed consumer |
| 8 | Founder guide, release baseline, capability documentation, static claim falsifiers, private report |

## Fresh-session subagent protocol

1. Start from a fresh isolated worktree using `superpowers:using-git-worktrees`.
2. Read this plan, its spec, `docs/superpowers/specs/2026-08-14-continuity-adapter-conformance-design.md`, `FOUNDATION.md`, `BUILDING-COMPASS.md`, and `AGENTS.md` completely.
3. Create the private progress ledger before code and record the immutable implementation base.
4. For each task, dispatch one fresh implementer with exclusive ownership of the listed files and the instruction that other agents may be active and their edits must not be reverted.
5. Require a separate reviewer first for spec compliance and then for code quality. A maker never reviews or clears its own task.
6. Return blocking findings to the implementer for bounded RED/GREEN remediation. After three unsuccessful fix rounds, use a fresh implementer; do not weaken the assertion.
7. Never run two editing agents concurrently in the same worktree. Read-only reviewers may run only after the implementer commits and the tracked worktree is clean.
8. Record each RED commit, GREEN commit, exact commands, pass/fail/skip counts, limitations, and review verdict in the progress ledger.
9. For every task, commit only the new failing tests and test fixtures immediately after the documented expected failure, before production implementation. Use these exact RED subjects: Task 1 `test(authority): specify outcome profile governance`; Task 2 `test(authority): specify profile admission`; Task 3 `test(bootstrap): specify bootstrap contracts`; Task 4 `test(bootstrap): specify route discovery`; Task 5 `test(cli): specify named initialization`; Task 6 `test(cli): specify pinned runtime supervision`; Task 7 `test(bootstrap): specify one-command conformance`; Task 8 `test(docs): specify one-command claims`. The task's later documented commit is the separate GREEN commit; never squash RED into GREEN during review.

---

### Task 1: Freeze independent Outcome Profile governance

**Files:**
- Create: `contract/outcome-profile/v1/profile-draft.schema.json`
- Create: `contract/outcome-profile/v1/profile-conformance.schema.json`
- Create: `contract/outcome-profile/v1/profile-conformance-report.schema.json`
- Create: `contract/outcome-profile/v1/profile-activation.schema.json`
- Create: `contract/outcome-profile/v1/profile-trust-pin.schema.json`
- Create: `contract/outcome-profile/v1/profile-governance-manifest.schema.json`
- Create: `contract/outcome-profile/v1/profile-governed-receipt.schema.json`
- Create: `contract/outcome-profile/v1/contract-descriptor.json`
- Create: `scripts/build-outcome-profile-contract.mjs`
- Create: `src/authority/outcome-profile-contract.ts` (generated by the contract builder)
- Create: `src/authority/outcome-profile.ts`
- Modify: `src/authority/index.ts`
- Modify: `package.json`
- Create: `test/authority/outcome-profile.test.ts`
- Create: `test/authority/outcome-profile-package.test.ts`
- Modify: `test/authority/package.test.ts`

**Interfaces:**
- Consumes: `authorityCanonicalBytes`, `authorityDigest`, `AuthoritySignature`, `verifyAuthoritySignature`, `StaticPackRegistry`, `definitionRegistrationDigest`, and externally supplied Ed25519 public keys.
- Produces: `OutcomeProfileDraftV1`, `ProfileConformanceReportV1`, `SignedOutcomeProfileConformanceV1`, `SignedTenantProfileActivationV1`, `ProfileTrustPinV1`, `ProfileGovernanceManifestV1`, opaque caller-scoped `ProfileVerificationRootsV1`, inert parsers, `createProfileVerificationRoots`, `verifyProfileGovernanceOffline` returning a non-authorizing `ProfileGovernanceVerificationV1`, and `OUTCOME_PROFILE_CONTRACT_V1_DIGEST`.

- [ ] **Step 1: Write the failing closed-artifact and role-separation tests**

Create `test/authority/outcome-profile.test.ts` with fixtures over the installed GitHub labels definition. The first behavioral test must prove all three artifacts are required and separately signed:

```ts
test("profile governance requires independent conformance and tenant activation", () => {
  const draft = fixtureDraft();
  const report = fixtureConformanceReport(draft);
  const conformance = signConformance(draft, report, certifierPrivateKey);
  const activation = signActivation(draft, conformance, operatorPrivateKey);
  const roots = createProfileVerificationRoots([
    fixtureProfileTrust("tenant_1", "certifier_1", "profile-conformance", certifierPublicKey),
    fixtureProfileTrust("tenant_1", "operator_1", "profile-activation", operatorPublicKey),
  ]);

  const verified = verifyProfileGovernanceOffline({
    tenant: "tenant_1",
    draft,
    report,
    conformance,
    activation,
    trustRoots: roots,
    packs: createFirstPartyPackRegistry(),
    now: new Date("2026-08-14T12:00:00.000Z"),
  });

  assert.equal(verified.profileDigest, authorityDigest(draft));
  assert.equal(verified.conformanceStatus, "verified");
  assert.equal(verified.activationStatus, "verified");
  assert.equal(verified.authorization, "not-conferred");
});
```

Add table-driven refusals for: absent or reordered conformance report, absent certification, absent activation, draft/report extra/accessor/symbol keys, certifier/operator SPKI reuse, certifier/operator purpose confusion, self-signed init key, profile/pack/definition/registration/vector/report/evidence/trust-head substitution, stale/revoked activation, failed or unchecked report/conformance claims, and operator signature attempting to upgrade a conformance claim.

- [ ] **Step 2: Compile and prove the contract is absent**

Run:

```powershell
npx tsc -p tsconfig.test.json
```

Expected: TypeScript fails because `src/authority/outcome-profile.ts` and its exports do not exist.

Commit the failing tests with the Task 1 RED subject before adding production/schema files.

- [ ] **Step 3: Define the exact closed governance types**

Implement these public records in `src/authority/outcome-profile.ts` without adding them to `AuthorityKind`:

```ts
export interface OutcomeProfileDraftV1 {
  readonly v: "reelier.outcome-profile-draft/v1";
  readonly profileId: string;
  readonly profileVersion: string;
  readonly status: "draft";
  readonly authorization: "absent";
  readonly conformance: "unchecked";
  readonly dispatchable: false;
  readonly provider: string;
  readonly packAlias: string;
  readonly packDigest: string;
  readonly definitionDigest: string;
  readonly definitionRegistrationDigest: string;
  readonly accountProbeDigest: string;
  readonly sourceAuthorityDigest: string;
  readonly argumentAuthorityDigest: string;
  readonly semanticIdentityDigest: string;
  readonly responseSemanticsProfileDigest: string;
  readonly reconciliationRecipeDigest: string;
  readonly topologyRequirementsDigest: string;
  readonly conformanceVectorSetDigest: string;
  readonly nonClaims: Readonly<{
    contentCorrectness: "not-proved";
    providerCertification: "not-proved";
    safety: "not-proved";
    trafficCompleteness: "not-proved";
  }>;
}

export interface SignedOutcomeProfileConformanceV1 {
  readonly v: "reelier.outcome-profile-conformance/v1";
  readonly tenant: string;
  readonly profileDigest: string;
  readonly packDigest: string;
  readonly definitionDigest: string;
  readonly definitionRegistrationDigest: string;
  readonly harnessId: string;
  readonly harnessDigest: string;
  readonly vectorSetDigest: string;
  readonly reportDigest: string;
  readonly sourceRevision: string;
  readonly claims: Readonly<{ closure: ClaimStatus; determinism: ClaimStatus; accountBinding: ClaimStatus; noSecrets: ClaimStatus; reconciliation: ClaimStatus }>;
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}

export interface ProfileConformanceReportV1 {
  readonly v: "reelier.outcome-profile-conformance-report/v1";
  readonly profileDigest: string;
  readonly packDigest: string;
  readonly definitionDigest: string;
  readonly definitionRegistrationDigest: string;
  readonly harnessId: string;
  readonly harnessDigest: string;
  readonly vectorSetDigest: string;
  readonly sourceRevision: string;
  readonly checks: readonly Readonly<{ checkId: string; vectorDigest: string; status: "passed" | "failed"; evidenceDigest: string }>[];
  readonly claims: Readonly<{ closure: ClaimStatus; determinism: ClaimStatus; accountBinding: ClaimStatus; noSecrets: ClaimStatus; reconciliation: ClaimStatus }>;
}

export interface SignedTenantProfileActivationV1 {
  readonly v: "reelier.outcome-profile-activation/v1";
  readonly tenant: string;
  readonly activationId: string;
  readonly profileDigest: string;
  readonly conformanceDigest: string;
  readonly jobCardDigest: string;
  readonly contractDigest: string;
  readonly deploymentDigest: string;
  readonly routeAuthorityDigest: string;
  readonly trustHeadDigest: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly state: "activated" | "revoked";
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}

export interface ProfileTrustPinV1 {
  readonly v: "reelier.outcome-profile-trust-pin/v1";
  readonly tenant: string;
  readonly governanceRef: string;
  readonly certifier: Readonly<{ signerId: string; purpose: "profile-conformance"; publicKeySpkiBase64: string }>;
  readonly operator: Readonly<{ signerId: string; purpose: "profile-activation"; publicKeySpkiBase64: string }>;
  readonly currentTrustEvents: readonly Readonly<{ index: number; action: "activate" | "revoke"; keyPurpose: "profile-conformance" | "profile-activation"; keyDigest: string; at: string; previousHeadDigest: string | null }>[];
  readonly currentTrustEventsDigest: string;
  readonly trustHeadDigest: string;
}

export interface ProfileGovernanceManifestV1 {
  readonly v: "reelier.outcome-profile-governance-manifest/v1";
  readonly tenant: string;
  readonly governanceRef: string;
  readonly profileDigest: string;
  readonly conformanceDigest: string;
  readonly activationDigest: string;
  readonly conformanceReportDigest: string;
  readonly trustPinDigest: string;
  readonly trustHeadDigest: string;
}

export interface ProfileGovernanceVerificationV1 {
  readonly v: "reelier.outcome-profile-verification/v1";
  readonly profileDigest: string;
  readonly conformanceReportDigest: string;
  readonly conformanceDigest: string;
  readonly activationDigest: string;
  readonly trustPinDigest: string;
  readonly trustHeadDigest: string;
  readonly verifiedAt: string;
  readonly verificationScope: "caller-supplied-roots";
  readonly conformanceStatus: "verified";
  readonly activationStatus: "verified";
  readonly authorization: "not-conferred";
  readonly dispatchable: false;
}
```

The activation links existing signed authority by digest; it must not duplicate accounts, limits, audiences, or delegation constraints.

Freeze trust replay as a v1 state machine rather than leaving it to the loader. Define:

```ts
const keyDigest = authorityDigest({
  v: "reelier.outcome-profile-trust-key/v1",
  tenant,
  governanceRef,
  signerId: root.signerId,
  purpose: root.purpose,
  publicKeySpkiBase64: root.publicKeySpkiBase64,
});

const eventsDigest = authorityDigest({
  v: "reelier.outcome-profile-trust-events/v1",
  tenant,
  governanceRef,
  events,
});

const eventDigest = authorityDigest({
  v: "reelier.outcome-profile-trust-event/v1",
  tenant,
  governanceRef,
  index: event.index,
  action: event.action,
  keyPurpose: event.keyPurpose,
  keyDigest: event.keyDigest,
  at: event.at,
  previousHeadDigest: event.previousHeadDigest,
});

const nextHeadDigest = authorityDigest({
  v: "reelier.outcome-profile-trust-head/v1",
  tenant,
  governanceRef,
  index: event.index,
  previousHeadDigest: event.previousHeadDigest,
  eventDigest,
});
```

The first event has index `0` and `previousHeadDigest: null`; later indices are contiguous and bind the exact prior computed head. RFC 3339 event times are strictly increasing and no event may be later than the caller-supplied verification time. An `activate` is valid only for the exact declared certifier or operator key tuple while inactive and never previously revoked. A `revoke` is valid only for that exact active tuple. Duplicate activation, revoke-before-activate, reactivation, unknown key/purpose, missing index, reordered events, time regression, and alternate previous head refuse. V1 begins with exactly one activation for each declared purpose; both exact declared keys must remain active at the final head for host admission. Rotation requires a new trust pin/governance manifest; it is not inferred by replay. `currentTrustEventsDigest` equals `eventsDigest`, and `trustHeadDigest` equals the final iterative head. Empty replay refuses.

- [ ] **Step 4: Implement inert parsing, deterministic trust replay, and purpose-bound offline verification**

Use `Reflect.ownKeys` plus own data-descriptor checks before reading values. Canonicalize into detached frozen copies. Store profile trust roots in a private `WeakMap`, with exact purposes `profile-conformance` and `profile-activation`. Compute the profile-specific preimage below, then call the existing `verifyAuthoritySignature(publicKey, "authority-evidence", preimageDigest, signature)`. Do not widen `AuthoritySignaturePurpose`; role separation lives in the inner closed purpose and in the profile trust-root registry.

```ts
const preimageDigest = authorityDigest({
  v: "reelier.outcome-profile-signature-preimage/v1",
  purpose,
  artifactDigest: authorityDigest(unsignedArtifact),
});
```

Require distinct SPKI commitments for certifier and tenant-operator roots; a key cannot occupy both purposes. Require every conformance claim to be `verified`; any other status makes the profile ineligible. `verifyProfileGovernanceOffline` verifies only against the caller's supplied roots and returns a detached frozen `ProfileGovernanceVerificationV1` with exact artifact and replay digests plus `authorization: "not-conferred"`. It must not return, brand, or narrow to the host-admission type. Public code cannot import or construct that host-only type.

Add mutation vectors for every trust replay rule above. Also prove a fully self-authored bundle verified under caller-created roots can produce an offline verification report but cannot satisfy any host admission assertion or dispatch fixture.

- [ ] **Step 5: Freeze schemas and their own contract digest**

Each schema must set `additionalProperties: false`, exact `required`, canonical time/digest/identifier patterns, and closed nested objects. `scripts/build-outcome-profile-contract.mjs` must sort the seven schema paths, hash normalized LF bytes, generate `contract-descriptor.json`, and generate `src/authority/outcome-profile-contract.ts`, consumed by `src/authority/outcome-profile.ts`. Do not add these files to Authority Contract v1.

Update the exact runtime and declaration allowlists in `test/authority/package.test.ts` only for the deliberately public profile parsers, offline verifier, contract digest, artifact types, and the constructor that turns caller-supplied public verification anchors into opaque `ProfileVerificationRootsV1`. Keep signing helpers, host-admission branding, admission assertions, and pack lookup internal to the host boundary. The public root constructor and offline result confer no certification, activation, or runtime authority.

Add:

```json
"check:outcome-profile-contract": "node scripts/build-outcome-profile-contract.mjs --check"
```

- [ ] **Step 6: Run focused governance and packaging tests**

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/authority/outcome-profile.test.js dist-test/test/authority/outcome-profile-package.test.js dist-test/test/authority/package.test.js
npm run check:authority-contract
npm run check:outcome-profile-contract
```

Expected: all new tests pass; existing Authority Contract digest is unchanged.

- [ ] **Step 7: Commit Task 1**

```powershell
git diff --check
git add -- contract/outcome-profile/v1 scripts/build-outcome-profile-contract.mjs src/authority/outcome-profile-contract.ts src/authority/outcome-profile.ts src/authority/index.ts package.json test/authority/outcome-profile.test.ts test/authority/outcome-profile-package.test.ts test/authority/package.test.ts
git commit -m "feat(authority): separate profile certification and activation"
```

---

### Task 2: Admit governed profiles without changing the Path C kernel

**Files:**
- Create: `src/authority/host/profile-governance.ts`
- Create: `src/authority/host/profile-governance-loader.ts`
- Create: `src/authority/host/governed-cell.ts`
- Create: `src/authority/host/profile-governed-receipt.ts`
- Modify: `src/authority/host/local.ts`
- Modify: `src/authority/host/index.ts`
- Create: `test/authority/profile-governance.test.ts`
- Create: `test/authority/profile-governance-loader.test.ts`
- Create: `test/authority/governed-cell.test.ts`
- Create: `test/authority/profile-governed-receipt.test.ts`
- Modify: `test/authority/local-runtime.test.ts`
- Modify: `test/authority/gate.test.ts`
- Modify: `test/authority/package.test.ts`
- Create: `contract/outcome-profile/v1/profile-authority-evidence.schema.json`
- Modify: `contract/outcome-profile/v1/profile-activation.schema.json`
- Modify: `contract/outcome-profile/v1/profile-governed-receipt.schema.json`
- Modify: `contract/outcome-profile/v1/contract-descriptor.json`
- Modify: `scripts/build-outcome-profile-contract.mjs`
- Modify: `src/authority/outcome-profile-contract.ts`
- Modify: `src/authority/outcome-profile.ts`
- Modify: `src/authority/index.ts`
- Modify: `src/authority/trust.ts`
- Create: `src/authority/host/receipt-authority.ts`
- Modify: `src/authority/certification/lifecycle-receipts.ts`
- Modify: `src/authority/certification/lifecycle-authority.ts`
- Modify: `src/authority/host/dispatch.ts`
- Modify: `src/authority/gate.ts`
- Modify: `src/authority/host/json-https-route.ts`
- Modify: `src/authority/drivers/json-https.ts`
- Modify: `src/authority/certification/github-issue-labels-runner.ts`
- Modify: `test/authority/outcome-profile.test.ts`
- Modify: `test/authority/outcome-profile-package.test.ts`
- Modify: `test/authority/trust.test.ts`
- Create: `test/authority/profile-governance-fixture.ts`
- Create: `test/authority/receipt-authority.test.ts`
- Modify: `test/authority/dispatch-coordinator.test.ts`
- Modify: `test/authority/certification-lifecycle-authority.test.ts`
- Modify: `test/authority/json-https-route.test.ts`
- Modify: `test/authority/config.test.ts`
- Modify: `test/authority/github-account-identity.test.ts`
- Modify: `test/authority/json-https-driver.test.ts`
- Modify: `test/authority/json-https-connector.test.ts`
- Modify: `test/authority/prepared-dispatch.test.ts`
- Modify: `test/authority/native-https-route-join.test.ts`
- Modify: `test/authority/certification-github-issue-labels-runner.test.ts`
- Modify: `docs/superpowers/specs/2026-08-14-one-command-agent-bootstrap-design.md`
- Modify: `docs/superpowers/plans/2026-08-14-one-command-agent-bootstrap.md`

This is the exhaustive 47-path Task 2 fix-wave tracked allowlist: the prior 43 paths plus the
third-amendment prepared-dispatch source/test and lifecycle-authorization source/test paths. The
lifecycle-authorization edit is required to retain the existing lifecycle publication API while
carrying the exact binding and commitment—not merely their digest—from its opaque ceremony material
into the shared constructor. Explicitly
forbidden even if a local implementation would be convenient: `contract/authority/v1/**`,
`scripts/build-authority-contract.mjs`, `src/authority/types.ts`, `src/authority/evidence.ts`,
`src/authority/verify.ts`, `src/authority/adapter-contract.ts`, `src/authority/ledger.ts`, `src/authority/host/receipts.ts`,
`src/authority/host/portable-receipts.ts`, `package.json`, and every lockfile. Do not add or edit
`src/authority/host/config.ts`; the allowed `test/authority/config.test.ts` covers the closed route
surface without authorizing a configuration-module change.
Stop and amend this plan again before touching any other tracked path.

**Interfaces:**
- Consumes: public inert profile artifacts and profile-only offline verification; installed `StaticPackRegistry`; an existing deployment that has passed `loadAuthorityDeployment`; the exact signed Job Card, `JobCardTrustPinV1.signedReadiness`, and parsed `JobCardTrustMaterialV1`; existing `CertificationArtifactKeyBindingV1` plus human commitment; exact parsed state candidates; connector/source/pack/trust registries; canonical native read/write routes with route-owned projection commitment; current profile, Job Card, and Authority trust events; actual prepared-dispatch state/outcome plus the accepted request's persisted `RouteAuthoritySnapshotV1`; exact already signed contract/delegation/gate foundations; six external purpose-bound receipt signers; the separate binding signer; and the unchanged Authority bundle constructor/parser/verifier.
- Produces: host-only opaque `AdmittedProfileGovernanceV1`; a private branded/`WeakMap` runtime provenance containing independently derived installed-pack, eligible-contract, signed-authority, deployment-snapshot, stable-route-scope, current-observation, receipt foundations, artifact-key binding/commitment, and signer bindings; package-internal `selectEligibleAuthorityContract` and `projectRouteScope`; public type-only `ProducedReceiptKindV1`, `PurposeBoundReceiptSignerV1<K>`, `AuthorityReceiptSigningAuthorityV1`, `CertificationArtifactKeyBindingV1`, and `CertificationArtifactKeyBindingCommitmentV1`; package-private `ValidatedAuthorityReceiptSigningAuthorityV1`, its sole validator, `AuthorityReceiptFoundationsV1`, `AuthorityReceiptBundleConstructionInputV1`, and async `constructAuthorityReceiptBundle`; optional compatible `DispatchPublication.publishReservation` and read-only `loadDurableHead`; `AuthorityRouteScopeV1`; `AuthorityDeploymentSnapshotV1`; standalone eighth Outcome Profile member `SignedProfileAuthorityBindingV1`; cold load plus pre-invoke/pre-reserve revalidation; read-only `inspectProfileGovernanceStatus`; public `createGovernedAuthorityCell`; a governed immutable reservation/terminal/reconciliation publication and recovery chain; `ProfileGovernedAuthorityReceiptV1`; and `verifyProfileGovernedAuthorityReceipt` with external profile, Job Card, and Authority trust anchors.

#### Approved Task 2 amendment — independently signed Authority binding

**Approved:** 2026-08-14. The original Task 2 steps below are retained as implementation history.
Where they name activation `routeAuthorityDigest`, a five-edge wrapper, self-contained profile-only
verification, or the original thirteen-file allowlist, the executable fix wave after original Step 6
supersedes them. No other task or invariant is broadened.

##### Approved Task 2 second amendment — complete governed execution seams

**Approved:** 2026-08-14. The first amendment remains immutable decision history. This second
amendment supersedes its incomplete producer, selector, route-projection, current-trust, local-Linux,
range-gate, digest-preimage, and placeholder details. The executable fix wave below is authoritative.
It preserves the original Task 2 commits and both docs-amendment commits; none may be amended or
squashed.

##### Approved Task 2 third amendment — governed prepared-dispatch publication

**Approved:** 2026-08-14. The first two amendments remain immutable decision history. This third
amendment supersedes their unreachable certified-publication seam, four-artifact direct-descriptor
authorization, missing reservation phase, non-durable first-receipt window, and ambiguous publisher
return semantics. The 47-path executable fix wave below is authoritative. It preserves every prior
Task 2 and amendment commit; none may be amended or squashed.

##### Approved Task 2 fourth amendment — durable-head recovery and validated trust handoff

**Approved:** 2026-08-14. All earlier amendments remain immutable decision history. This fourth
amendment supersedes their terminal-storage recovery gap and structural signing-authority handoff,
and freezes the non-self-anchoring offline verifier order. The same 47-path executable fix wave is
authoritative; no implementation, schema, ABI, ledger, package, or test path is added. Preserve every
earlier Task 2 and amendment commit without amend or squash.

- [ ] **Step 1: Write the failing no-dispatch admission matrix**

Add a fixture that uses the real local gate but counts source reads, credential reads, reservations, prepared sends, and provider writes. For each mutation below assert all five counts remain zero:

```ts
for (const mutation of [
  "draft-only",
  "conformance-only",
  "activation-only",
  "self-certified",
  "revoked-activation",
  "profile-pack-substitution",
  "profile-route-substitution",
  "profile-trust-head-substitution",
] as const) {
  await assertProfileRefusesBeforeDispatch(mutation);
}
```

- [ ] **Step 2: Run focused tests and prove admission is missing**

Run `npx tsc -p tsconfig.test.json` and expect missing profile-governance imports/options.

Commit the failing tests with the Task 2 RED subject before adding host admission or loader code.

- [ ] **Step 3: Add the additive admission wrapper**

First implement cold-process loading. Given only `{ tenant, governanceRef, expectedManifestDigest, expectedTrustHeadDigest, homedir, verificationTime }`, resolve the fixed operator-owned directory `<homedir>/.reelier/trust/outcome-profiles/<tenant>/<governanceRef>/`; the project cannot supply a path or verification roots. Confine `trust-pin.json`, `manifest.json`, `profile.json`, `conformance-report.json`, `conformance.json`, and `activation.json` with pre-open/post-open `lstat`/`realpath` identity checks, reject symlink/junction roots and children, parse every closed artifact, compare every manifest digest and the expected trust head, replay the exact Task 1 trust state machine at the external verification time, and verify signatures using only the keys loaded from that confined operator-owned pin. The verifier recomputes the conformance report digest, exact vector/check ordering, and report claims before trusting the certifier's signature. Only after all checks pass, mint a fresh `AdmittedProfileGovernanceV1` registered in a module-private `WeakMap` whose detached payload contains the exact profile, activation, manifest, trust-head, and operator-root digests. No public verifier or caller-supplied roots can mint or assert this brand. Do not export the loader, admission type, assertion, or WeakMap through `src/authority/index.ts`, the package `./authority` surface, or `src/authority/host/index.ts`. Initialization may invoke a separate read-only status helper that returns sanitized `verified | failed | unchecked | absent` findings, but no bootstrap code may receive the admitted handle or create/modify this directory.

Add deterministic cold-restart, alternate-root substitution, revoked-head, manifest/path traversal, accessor, extra-field, symlink/junction, replacement-race, and missing-file tests. Every refusal occurs before source, credential, reservation, or provider counters move.

Implement:

```ts
export interface ProfileGovernedRuntimeInputV1 {
  readonly governance: AdmittedProfileGovernanceV1;
  readonly expectedProfileDigest: string;
  readonly expectedActivationDigest: string;
}

export function assertProfileRuntimeBinding(
  input: ProfileGovernedRuntimeInputV1,
  installed: Readonly<{ packDigest: string; definitionDigest: string; registrationDigest: string }>,
  authority: Readonly<{ contractDigest: string; jobCardDigest: string; deploymentDigest: string; routeAuthorityDigest: string; trustHeadDigest: string }>,
): void;
```

It must call the internal `assertAdmittedProfileGovernance`, compare every digest before creating the gate/runtime, and return no new compiler callbacks. Refactor `local.ts` only enough to add a package-internal `createAdmittedLocalAuthorityRuntime(config, admitted, options)` used by the governed factory; keep public `createLocalAuthorityRuntime(config, options)` and `LocalAuthorityRuntimeOptions` byte/behavior compatible and do not add an admission-handle option to them. Once admitted, the internal path passes the same installed pack and authority objects to the existing local runtime core. Add a direct negative test that a valid `ProfileGovernanceVerificationV1` created from self-rooted public verification cannot be cast, spread, frozen, or otherwise supplied as `AdmittedProfileGovernanceV1`; getters execute zero times and all dispatch counters remain zero.

Keep legacy `authority serve` behavior unchanged. Only the governed Cell composition below can call the package-internal admitted runtime constructor.

- [ ] **Step 4: Add the callable governed Cell composition root**

Create `src/authority/host/governed-cell.ts` and export only this narrow production factory from `reelier/authority/host`:

```ts
export interface GovernedAuthorityCellReferenceV1 {
  readonly v: "reelier.governed-authority-cell-reference/v1";
  readonly tenant: string;
  readonly governanceRef: string;
  readonly expectedManifestDigest: string;
  readonly expectedTrustHeadDigest: string;
}

export interface GovernedAuthorityCellOptionsV1 {
  readonly principalRegistry?: PrincipalRegistry;
  readonly dispatchAdapter?: DispatchAdapter;
  readonly delegation?: DelegationAuthority;
  readonly signedTopologyEvidence?: SignedTopologyEvidenceV1;
  readonly topologySigner?: Readonly<{ signerId: string; publicKey: KeyObject }>;
  readonly signedLease?: SignedAuthorityLeaseV1;
  readonly leaseSigner?: Readonly<{ signerId: string; publicKey: KeyObject }>;
  readonly sourceReadAdapter?: SourceReadAdapter;
  readonly connectionRoutes?: OpaqueConnectionRouteRegistry;
  readonly secretResolver?: SecretResolver;
  readonly routeAuthority?: (input: Readonly<{ tenant: string; requester: string; definitionAlias: string; connectorId: string; accountId: string; endpointId: string; authorityGeneration: string; authorityExpiresAt: string }>) => RouteAuthoritySnapshotV1 | undefined;
  readonly authenticatedProviderIdentity?: () => Promise<AuthenticatedProviderIdentityV1>;
  readonly verifyAuthenticatedProviderIdentity?: CertifiedIdentityVerifier;
  readonly certifiedDispatch?: CertifiedDispatchOptions;
  readonly portableReceiptPublication?: DispatchPublication;
  readonly latencyRecorder?: AuthorityLatencyRecorder;
}

export async function createGovernedAuthorityCell(
  config: AuthorityHostConfig,
  reference: GovernedAuthorityCellReferenceV1,
  options: GovernedAuthorityCellOptionsV1,
): Promise<AuthorityHostServer>;
```

The production factory first calls `assertLinuxAuthorityCellHost`, derives the operator trust home internally from `os.homedir()` (no caller-supplied profile root/path/public key), requires `reference.tenant === config.tenant`, cold-loads and admits the exact reference at the host's current external time, calls the package-internal admitted runtime constructor, then creates the existing authenticated host server. It returns only `AuthorityHostServer`; the admission handle and detached payload never escape.

Parse `reference` and `options` as exact own-data records with `Reflect.ownKeys`; reject accessors, symbols, non-enumerable extras, prototype substitution, unknown keys, and invalid paired dependencies before invoking a getter/callback or reading the trust directory. The exact options above are the complete host capability allowlist. Provider/source/transport/identity capabilities are replaceable maker-side dependencies already constrained by the unchanged gate, prepared-dispatch, and receipt verifier; they are never used to verify or mint profile admission. `topologySigner`, `leaseSigner`, and `CertifiedIdentityVerifier` retain their existing distinct trust purposes. The options contain no profile roots, governance bytes, homedir, admitted handle, profile-verification callback, activation signer, or clock. Pair requirements mirror the existing local runtime: signed topology with topology signer, signed lease with lease signer, and native route authority with provider identity, identity verifier, and certified dispatch.

This is the OSS composition root consumed by managed Cloud deployment infrastructure and by an advanced already-provisioned self-hosted Linux service. Cloud owns provisioning, entitlement, isolation, secret custody, UI, and lifecycle; this factory owns only the Path C host admission seam. It does not provision Linux, listen automatically, mint activation, or change legacy `authority serve`. A deployer chooses when and where to call `server.listen()` through existing service machinery.

Add tests proving: the exact factory and exact options declarations are present in the declared `reelier/authority/host` runtime/declaration allowlist; the loader/admission constructor/assertion are absent; options accessors/symbols/extras/prototype substitution and unpaired capabilities refuse without invocation; the factory refuses Windows before filesystem/dependency access; a self-rooted public offline result cannot be supplied; missing/revoked/stale/operator-path-substituted governance refuses before ledger directories/server creation; and valid operator-owned governance returns an authenticated server for existing authenticated routes. Positive Linux tests run the public factory in a child process with isolated `HOME`/`USERPROFILE` and a temporary operator directory; fixtures derive validity boundaries around the child's observed current time, while separate pure replay tests use an explicit fixed verification time. No test-only home/clock API is added to runtime or declarations. Task 6 owns the new session-binding endpoint; Task 7 proves the same factory from the packed tarball.

- [ ] **Step 5: Wrap receipts without widening the inner bundle**

Implement:

```ts
export interface ProfileGovernedAuthorityReceiptV1 {
  readonly v: "reelier.profile-governed-authority-receipt/v1";
  readonly profileDraft: OutcomeProfileDraftV1;
  readonly profileConformanceReport: ProfileConformanceReportV1;
  readonly profileConformance: SignedOutcomeProfileConformanceV1;
  readonly profileActivation: SignedTenantProfileActivationV1;
  readonly authorityReceiptBundle: AuthorityReceiptBundle;
  readonly edges: Readonly<{
    profileDigest: string;
    conformanceReportDigest: string;
    conformanceDigest: string;
    activationDigest: string;
    innerReceiptDigest: string;
  }>;
}
```

The original requirement remains that the unchanged authority receipt verifier must succeed before
any outer claim is returned, followed by profile governance and exact edge comparisons. Because the
four artifact roots are carried provisionally by the outer envelope, the executable fourth-amendment
order in Fix Step 7 strictly parses that envelope first solely to derive candidate roots, runs the
unchanged inner verifier, then externally authorizes those roots before any verified result escapes.
Mutation tests must prove the wrapper cannot self-anchor, upgrade, or rewrite an inner claim.

- [ ] **Step 6: Run kernel regression and commit**

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/authority/profile-governance.test.js dist-test/test/authority/profile-governance-loader.test.js dist-test/test/authority/governed-cell.test.js dist-test/test/authority/profile-governed-receipt.test.js dist-test/test/authority/local-runtime.test.js dist-test/test/authority/gate.test.js dist-test/test/authority/package.test.js
npm run check:authority-contract
npm run check:outcome-profile-contract
git diff --check
```

Expected: profile tests pass; existing Path C tests remain green; Authority Contract v1 stays unchanged.

Commit:

```powershell
git add -- src/authority/host/profile-governance.ts src/authority/host/profile-governance-loader.ts src/authority/host/governed-cell.ts src/authority/host/profile-governed-receipt.ts src/authority/host/local.ts src/authority/host/index.ts test/authority/profile-governance.test.ts test/authority/profile-governance-loader.test.ts test/authority/governed-cell.test.ts test/authority/profile-governed-receipt.test.ts test/authority/local-runtime.test.ts test/authority/gate.test.ts test/authority/package.test.ts
git commit -m "feat(authority): admit independently governed profiles"
```

#### Executable Task 2 review fix wave

This fix wave begins at candidate `cc529e5e4136eb9e58cd5f39816798f9636bb715` only after the
four docs-only amendment commits have passed independent review. It fixes the five original Task 2
blockers, all eight first-amendment review findings, all five second-amendment review findings, and
both third-amendment Critical findings as one trust-boundary unit. The original RED/GREEN and all
four amendment commits remain in history; do not amend or squash them.

- [ ] **Fix Step 1: Add the strict RED review-gap suite and fixture-only module**

Move every shared governance builder, signing key fixture, operator-directory writer, valid inner
bundle builder, real dependency counter, and child-process harness into
`test/authority/profile-governance-fixture.ts`. This module exports helpers only and calls no
`test()`/suite registration API. Change every Task 2 test to import it; assert each named test is
registered exactly once.

Write a real governed-admission matrix. Each row must mutate one independently signed artifact or
runtime binding, invoke `createGovernedAuthorityCell`/the package-internal governed composition over
the real local gate, and read the fixture's actual counters:

```ts
for (const mutation of [
  "draft-only",
  "conformance-only",
  "activation-only",
  "self-certified",
  "revoked-activation",
  "profile-pack-substitution",
  "profile-contract-substitution",
  "profile-job-card-substitution",
  "profile-deployment-substitution",
  "profile-route-scope-substitution",
  "profile-authority-trust-head-substitution",
  "profile-trust-head-substitution",
  "configured-definition-substitution",
] as const) {
  const result = await assertProfileRefusesBeforeDispatch(mutation);
  assert.deepEqual(result.counts, {
    sourceReads: 0,
    credentialReads: 0,
    reservations: 0,
    preparedSends: 0,
    providerWrites: 0,
  }, mutation);
}
```

The counter fixture must increment at the real `SourceReadAdapter`, `SecretResolver`, ledger
reservation, dispatch `prepare`, and dispatch/send boundary. A literal zero object is forbidden.
Also assert no ledger/decision/receipt/key directory and no HTTP server exist after every refusal.

Add loader tests for alternate physical root, root rename/replacement between every pair of the six
reads, mixed-generation artifacts, child replacement before/open/after read, root/child file and
directory symlinks, Windows junctions where supported, traversal, case aliases, missing file,
accessor/symbol/non-enumerable/extra/prototype inputs, revoked/future/stale trust, reordered report
checks, repeated vector/evidence digests, report-claim rewrite, certifier/operator/signature
substitution, and a public self-rooted verification object attempted by cast/spread/freeze/proxy.
Every hostile accessor/callback counter remains zero.

Add governed-factory option tests for every allowed field, unknown/symbol/non-enumerable/accessor/
prototype records, and every incomplete pair. Add `receiptSigningAuthority` and
`authorityBindingSigner` as one all-or-nothing pair. Prove all seven signer IDs/public keys/sign
callbacks remain unread/uninvoked before Linux, exact records, pair completeness, operator
governance, deployment, route joins, and current trust validate. Register the public-factory Linux
test on every platform. On Linux, run a child with isolated `HOME`/`USERPROFILE`, let it observe its
current time, write validity around that observation, import only `reelier/authority/host`, call the
public factory, exercise an authenticated route, close the server, and assert no automatic
listen/provisioning. On non-Linux, register an explicit platform-gated skip whose exact reason is
`requires an already-available Linux Node executor`; never count it as a pass. This Windows host has
only a WSL kernel with no Linux Node and has no running Docker daemon; install/start/download is not
authorized. Task 7/CI Linux execution remains mandatory
and the Task 2 report must retain the limitation.

Add direct selector parity tests that compare governed preflight with both existing gate selection
sites for every audience, refusal ordering, one eligible candidate, zero eligible candidates, and
ambiguity; assert the package-internal selector is absent from every barrel. Add route tests for the
required nonzero SHA-256 `projectionSchemaDigest`, canonical digest sensitivity, read/write
equivalence, driver equality, connector-registration digest parity, exactly-one-write selection,
contextual `tenant`/`definitionAlias` projection, and every provider/account/definition/endpoint/
schema mismatch. Add receipt-authority tests for six exact purpose records, cross-purpose key reuse,
inactive/wrong-purpose direct keys, hostile returned signatures, and all five construction phases:
`reservation`, `dispatch`, `cancelled`, `ambiguous`, and `reconcile`. Freeze exact existing lifecycle
bytes for the reservation result preimage/receipt ID, reserved-only timeline, null dispatched request,
not-attempted reconciliation/null projection, absent dispatch claim, unchecked claims, static
foundations, signatures, and null prior. Cover recovered static artifacts, exact prior joins,
three-node restart recovery, and no-resend after publication failure.

Exercise the existing artifact-key binding/commitment verifier using the exact external signed
readiness/current events. Mutate binding, commitment, each of four entries, validity boundaries,
parent evidence descriptor/status, human signer/readiness digest, Adapter Contract, Cell/task,
schedule, callback key ID/SPKI/purpose, missing/duplicate entries and keys, reordered entries,
revocation, restart recovery, and every outer-evidence copy. Prove the four artifact purposes are
never passed to `parseAuthorityKeyDescriptor`, while direct current descriptor replay remains
mandatory for inner evidence/receipt and the separate outer binding signer. Preserve every existing
certification lifecycle authority and lifecycle receipt assertion and registration unchanged; add
the retained-copy/substitution cases only to the authority test, and continue running the receipt
three-node/restart/no-resend cases once as regression gates.

Add receipt-authority brand falsifiers: raw callbacks plus a valid binding cannot construct;
cast/spread/freeze/proxy/structural copies of a validated handle cannot construct; changing current
events, observation time, expected Cell/task, signed readiness, any signer ID/SPKI/purpose, or any
distinctness relation before validation refuses without invoking `sign`. Only the sole validator may
mint a handle, and a handle is consumed only through its private `WeakMap` state. Prove the lifecycle
adapter can mint through the same validator only from its already consumed opaque lifecycle material
and exact retained binding/commitment copies.

In `test/authority/dispatch-coordinator.test.ts`, add the canonical certified prepared path and cuts:
before reservation-root storage, after root storage/before `consumePreparedDispatch`, after provider
apply/before terminal storage, after terminal storage/before ledger transition, and after ledger
transition. Assert pre-send construction/signature/
verification/storage failure produces zero provider calls; once the prepared CAS succeeds, restart
never resends. Before-root recovery refuses; root-only recovery publishes exactly one ambiguity;
terminal-head recovery performs the matching ledger transition without publishing; and an already
terminal ledger is unchanged. Require terminal and reconciliation nodes to join the stored
reservation root into one unforked chain. Add phase/terminal mismatch, identity conflict, wrong
reservation/effect/route/request/root/prior, tamper, invalid signature, multiple-head, fork, and
publisher-throws cases; all refuse without transition, publication, reconciliation, or send. Add
two-node and restart falsifiers whose inner prior comparison fails if any outer receipt digest is
returned or used as `priorReceiptDigest`. With `publishReservation`/`loadDurableHead` absent, assert
legacy certified trace bytes/call order remain unchanged.

Add expiry/revocation-after-server-start cases at both freshness boundaries. Before local
`outcome`/`invoke`, assert the first filesystem-rooted revalidator refuses with all source,
credential, reservation, prepare, and provider counters zero. Between that check and reservation,
mutate the profile head, Job Card trust, Authority head, signer activity, activation validity, or
dynamic route scope and assert `beforeReserve` refuses before `ledger.reserve`. With the hook absent,
pin legacy gate output/trace bytes exactly.

Build one fully valid `ProfileGovernedAuthorityReceiptV1` and mutation tables for every profile
artifact, signed Job Card, artifact-key binding and human commitment field, signed-readiness join,
deployment field, scope stable field, dynamic-only route field, current Authority trust
event/key/status, binding scalar/digest/signature/signer/purpose, every edge, and
every inner claim. Prove unrelated valid governance/inner bundles refuse, activation contract equals
the inner contract digest, and no outer field can upgrade/rewrite an inner claim. Add a
self-consistent forged artifact binding/commitment plus four matching forged inner signatures; it
may satisfy candidate-root cryptography but must fail external readiness/current-parent
authorization. Independently substitute every signed inner artifact signer ID/SPKI/purpose, revoke
or expire the human/parent/direct receipt/outer signer at binding time or verifier time, and prove no
candidate receipt-carried root escapes as verified authority.

Run:

```powershell
npx tsc -p tsconfig.test.json
```

Expected RED: compilation fails only on the new activation/scope/deployment/binding/evidence,
validated-signing-authority, and durable-head APIs and exact governed options, or focused tests fail
on the approved review gaps. Commit tests and
test fixtures only:

```powershell
git add -- test/authority/profile-governance-fixture.ts test/authority/profile-governance.test.ts test/authority/profile-governance-loader.test.ts test/authority/governed-cell.test.ts test/authority/profile-governed-receipt.test.ts test/authority/receipt-authority.test.ts test/authority/dispatch-coordinator.test.ts test/authority/certification-lifecycle-authority.test.ts test/authority/local-runtime.test.ts test/authority/gate.test.ts test/authority/package.test.ts test/authority/outcome-profile.test.ts test/authority/outcome-profile-package.test.ts test/authority/trust.test.ts test/authority/json-https-route.test.ts test/authority/config.test.ts test/authority/github-account-identity.test.ts test/authority/json-https-driver.test.ts test/authority/json-https-connector.test.ts test/authority/prepared-dispatch.test.ts test/authority/native-https-route-join.test.ts test/authority/certification-github-issue-labels-runner.test.ts
git commit -m "test(authority): expose governed admission review gaps"
```

- [ ] **Fix Step 2: Amend the branch-only Outcome Profile contract without changing Authority Contract v1**

Change `SignedTenantProfileActivationV1` and `profile-activation.schema.json`: retain
`trustHeadDigest` with its current profile-governance meaning; add required
`authorityTrustHeadDigest`; replace required `routeAuthorityDigest` with `routeScopeDigest`. Do not
accept both route fields and do not add migration fallback because v1 is unshipped.

Define and strictly parse these closed, detached, frozen records in `src/authority/outcome-profile.ts`:

```ts
export interface AuthorityRouteScopeV1 {
  readonly v: "reelier.authority-route-scope/v1";
  readonly tenant: string;
  readonly definitionAlias: string;
  readonly connectorRegistrationDigest: string;
  readonly operatorConfigurationDigest: string;
  readonly routeDigest: string;
  readonly providerId: string;
  readonly connectorId: string;
  readonly accountId: string;
  readonly providerAccountIdentity: string;
  readonly endpointId: string;
  readonly credentialSlotId: string;
  readonly sourceReadRouteDigest: string;
  readonly projectionSchemaDigest: string;
}

export interface AuthorityDeploymentSnapshotV1 {
  readonly v: "reelier.authority-deployment-snapshot/v1";
  readonly tenant: string;
  readonly jobCardDigest: string;
  readonly jobCardAuthorityDigest: string;
  readonly authorityStateDigest: string;
  readonly connectorRegistryDigest: string;
  readonly trustRootSetDigest: string;
  readonly connectionDescriptorsDigest: string;
  readonly connectionAdoptionsDigest: string;
  readonly enforcementDigest: string;
  readonly routeScopeDigest: string;
}

export interface SignedProfileAuthorityBindingV1 {
  readonly v: "reelier.profile-authority-binding/v1";
  readonly purpose: "profile-authority-binding";
  readonly tenant: string;
  readonly profileDigest: string;
  readonly activationDigest: string;
  readonly innerReceiptDigest: string;
  readonly jobCardDigest: string;
  readonly artifactKeyBindingDigest: string;
  readonly artifactKeyBindingCommitmentDigest: string;
  readonly contractDigest: string;
  readonly deploymentDigest: string;
  readonly routeScopeDigest: string;
  readonly routeAuthoritySnapshotDigest: string;
  readonly authorityTrustHeadDigest: string;
  readonly observedAt: string;
  readonly signerId: string;
  readonly signature: AuthoritySignature;
}
```

`profile-authority-evidence.schema.json` is the eighth standalone Outcome Profile contract member
and freezes `SignedProfileAuthorityBindingV1` under absolute ID
`https://reelier.dev/contracts/outcome-profile/v1/profile-authority-evidence.schema.json`.
`contract-descriptor.json`, `scripts/build-outcome-profile-contract.mjs`, and generated
`src/authority/outcome-profile-contract.ts` must sort/hash all eight members. Export only inert
types/parsers and public offline verification helpers from `src/authority/index.ts`; no signer,
host brand, private provenance, key object, or admission maker becomes public.

Sign and verify the binding with existing crypto purpose `authority-evidence` over:

```ts
const preimageDigest = authorityDigest({
  v: "reelier.profile-authority-binding-signature-preimage/v1",
  purpose: "profile-authority-binding",
  artifactDigest: authorityDigest(unsignedBinding),
});
```

Do not change `AuthorityKind`, `AuthoritySignaturePurpose`, Authority schemas, or the inner bundle.

- [ ] **Fix Step 3: Extract the general full-bundle constructor and the sole eligible-contract selector**

Create `src/authority/host/receipt-authority.ts`. Export the three new types below plus type-only
re-exports of existing `CertificationArtifactKeyBindingV1` and
`CertificationArtifactKeyBindingCommitmentV1` through `src/authority/host/index.ts`; their
functions and private brands remain package-internal:

```ts
export type ProducedReceiptKindV1 =
  | "sourceBundle"
  | "compiledCapability"
  | "transportEffect"
  | "evidence"
  | "receipt"
  | "packManifest";

export type PurposeBoundReceiptSignerV1<K extends ProducedReceiptKindV1> = Readonly<{
  purpose: Readonly<{
    sourceBundle: "source-bundle";
    compiledCapability: "compiled-capability";
    transportEffect: "transport-effect";
    evidence: "authority-evidence";
    receipt: "authority-receipt";
    packManifest: "pack-manifest";
  }>[K];
  signerId: string;
  publicKey: KeyObject;
  sign(input: Readonly<{
    purpose: Readonly<{
      sourceBundle: "source-bundle";
      compiledCapability: "compiled-capability";
      transportEffect: "transport-effect";
      evidence: "authority-evidence";
      receipt: "authority-receipt";
      packManifest: "pack-manifest";
    }>[K];
    digest: string;
  }>): Promise<AuthoritySignature>;
}>;

export interface AuthorityReceiptSigningAuthorityV1 {
  readonly artifactAuthorization: Readonly<{
    binding: CertificationArtifactKeyBindingV1;
    commitment: CertificationArtifactKeyBindingCommitmentV1;
  }>;
  readonly sourceBundle: PurposeBoundReceiptSignerV1<"sourceBundle">;
  readonly compiledCapability: PurposeBoundReceiptSignerV1<"compiledCapability">;
  readonly transportEffect: PurposeBoundReceiptSignerV1<"transportEffect">;
  readonly evidence: PurposeBoundReceiptSignerV1<"evidence">;
  readonly receipt: PurposeBoundReceiptSignerV1<"receipt">;
  readonly packManifest: PurposeBoundReceiptSignerV1<"packManifest">;
}
```

`AuthorityReceiptSigningAuthorityV1` is a public type-only structural input. It is itself an exact own-data record with
`artifactAuthorization` plus those six signer keys and no symbols/accessors/non-enumerable/extra/
inherited fields. `artifactAuthorization` is an exact own-data `{ binding, commitment }` record.
Each signer is an exact own-data record
containing only `purpose`, `signerId`, `publicKey`, and `sign`. It is never sufficient to construct or
sign an artifact.

Define these package-private interfaces/functions in the already allowed
`src/authority/trust.ts`, `src/authority/host/receipt-authority.ts`, and
`src/authority/certification/lifecycle-authority.ts`. Do not export them from any barrel:

```ts
declare const validatedSigningAuthorityBrand: unique symbol;
type ValidatedAuthorityReceiptSigningAuthorityV1 = Readonly<{
  readonly [validatedSigningAuthorityBrand]: true;
}>;

interface AuthorityReceiptSigningAuthorityValidationInputV1 {
  readonly tenant: string;
  readonly authorityCellId: string;
  readonly taskId: string;
  readonly observedAt: Date;
  readonly jobCardTrustPin: JobCardTrustPinV1;
  readonly signingAuthority: AuthorityReceiptSigningAuthorityV1;
  readonly authorityBindingSigner?: AuthorityBindingSignerV1;
}

function validateAuthorityReceiptSigningAuthority(
  input: AuthorityReceiptSigningAuthorityValidationInputV1,
): ValidatedAuthorityReceiptSigningAuthorityV1;
```

The validator strictly parses `jobCardTrustPin.signedReadiness`, `keyDescriptors`,
`readinessTrustEvents`, and `currentTrustEvents`, and first runs existing
`verifySignedCertificationReadiness` with the pin's exact readiness candidate, preflight, and human
root. Those pin fields are the required external signed readiness plus current descriptors/events;
none may be sourced from the binding or signer capabilities. The validator
requires every relevant descriptor active and unrevoked at the single intrinsic `observedAt`; calls
existing `verifyCertificationArtifactKeyBinding` with the exact retained binding/commitment and
readiness; requires binding/commitment validity, human signer activity, expected tenant/Cell/task,
Adapter Contract, readiness, active direct parent, and signature joins; and validates each Ed25519
public key without accepting a private key. Match `sourceBundle`, `compiledCapability`,
`transportEffect`, and `packManifest` ID/SPKI/purpose/key digest to the four exact unique binding
entries without parsing them as `AuthorityKeyDescriptorV1`. Match `evidence` to the active direct
`authority-evidence` parent and `receipt` to a separately active direct `authority-receipt`
descriptor. When `authorityBindingSigner` is present, require a separately active direct
role-`authority-cell`/purpose-`authority-evidence` descriptor and all governed segregation rules.
All six inner keys are unique by ID and SPKI, and the optional outer key is distinct from them and
all already forbidden roles. Reject future/expired/revoked/missing/duplicate/substituted material
before invoking a callback.

Successful validation creates a fresh frozen proxy handle and stores the exact detached parsed
authorization plus six callbacks and optional outer signer only in a module-private `WeakMap`.
Casts, spreads, freezes, proxies, structural copies, and caller-created brands cannot populate the
map. No public assertion or snapshot exposes this state. The governed factory calls this sole
validator after its fresh external trust observation; the lifecycle adapter may call it only while
holding already consumed genuine `CertificationLifecycleAuthorityMaterial` with exact detached
binding/commitment copies. Raw callback/binding records never reach a constructor.

Ownership is exact: `src/authority/trust.ts` owns the current descriptor/event replay view;
`src/authority/host/receipt-authority.ts` owns the brand, handle `WeakMap`, sole validator, and
constructor lookup; `src/authority/certification/lifecycle-authority.ts` registers each genuine
material object returned by `consumeCertificationLifecycleAuthority` in its existing private
authority state and exposes only a package-internal adapter that can derive the six structural
capabilities plus exact detached binding/commitment from such a registered object. The lifecycle
receipt producer passes that derived input and external validation context to the same validator.
Unregistered structural maps/material are rejected. This adds no public lifecycle API, signing
shortcut, second validator, or importable handle assertion.

Keep these construction types package-private:

```ts
export interface AuthorityReceiptFoundationsV1 {
  readonly contract: SignedAuthorityArtifact<"outcome-contract">;
  readonly delegation: readonly SignedAuthorityArtifact<"delegation-grant">[];
  readonly gateEvent: SignedAuthorityArtifact<"gate-event">;
  readonly packManifest: AuthorityWireByKind["pack-manifest"];
}

export interface AuthorityReceiptBundleConstructionInputV1 {
  readonly phase: "reservation" | "dispatch" | "cancelled" | "ambiguous" | "reconcile";
  readonly state: DispatchRequestState;
  readonly outcome: DispatchOutcome;
  readonly observedAt: string;
  readonly foundations: AuthorityReceiptFoundationsV1;
  readonly signingAuthority: ValidatedAuthorityReceiptSigningAuthorityV1;
  readonly priorReceipt?: AuthorityReceipt;
  readonly recovered?: AuthorityReceiptBundle;
}

export async function constructAuthorityReceiptBundle(
  input: AuthorityReceiptBundleConstructionInputV1,
): Promise<AuthorityReceiptBundle>;
```

The constructor first requires the handle in the module-private `WeakMap`; no raw signer record or
`{ binding, commitment }` overload exists. It uses `observedAt` for every generated timeline time. It recovers exact static
contract/delegation/gate foundations only when their digests and effect/prior joins match. It builds
the source bundle, compiled capability, transport effect, authority evidence, receipt, and pack
manifest using existing parsers/constructors, asks only the matching signer to sign each parsed
artifact digest, verifies every returned signature against that signer's public key, and calls the
existing `createAuthorityReceiptBundle`. It does not publish, persist, recover storage, send,
reconcile, verify a completed bundle, or create trust roots.

The governed outer-binding publisher retrieves the separately validated outer signer from the same
private handle. It cannot accept `AuthorityBindingSignerV1` directly. Inner construction rejects a
handle validated for lifecycle-only use if governed outer publication is requested.

For `phase: "reservation"`, preserve the existing certification lifecycle bytes exactly:

```ts
const reservationOutcome = Object.freeze({
  kind: "ambiguous" as const,
  resultDigest: authorityDigest({
    reservationId: state.reservation.reservationId,
    phase: "reservation",
  }),
  reconciliationStatus: "not-attempted" as const,
  normalizedProjectionDigest: null,
});
const receiptId = `receipt_${authorityDigest({
  reservationId: state.reservation.reservationId,
  phase: "reservation",
  result: reservationOutcome.resultDigest,
}).slice(7, 31)}`;
```

Emit exactly one `reserved` timeline node; set `dispatchedRequestDigest` and provider response to
null; set reconciliation to `not-attempted` with null normalized projection; set dispatch to
`absent`, authorization/source completeness to `verified`, and provider acknowledgment,
reconciliation, topology, and completeness to `unchecked`; require `priorReceipt` absent and inner
`priorReceiptDigest: null`. Recovered foundations and all six returned signatures must be byte-equal
to the existing lifecycle path. No other phase changes its current result, receipt ID, timeline,
claim, signature, or prior semantics.

Refactor `src/authority/certification/lifecycle-receipts.ts` without changing its exported API,
local-first composition, storage/recovery, extensions, controlled cuts, or receipt ID/prior-chain
semantics. Adapt its existing lifecycle keys to the six public signer capabilities and delegate only
after the same validator has minted the private handle from the already consumed genuine lifecycle
material, its external readiness/descriptors/events, expected Cell/task, and observation time; then
delegate only the pure bundle construction above, including its synthetic reservation root. Modify
`src/authority/certification/lifecycle-authority.ts` only so its already opaque consumed
`CertificationLifecycleAuthorityMaterial` retains the exact binding and human commitment alongside
the existing `bindingDigest`; do not change the ceremony/consume/public-descriptor API or any
signature/preimage. Its focused authority test must prove the retained values are exact detached
copies and cannot be substituted. The current lifecycle three-node/restart/no-resend test must run
unchanged.

The exact retained addition is optional only for byte-compatible reads of legacy material and is
closed when present:

```ts
readonly artifactAuthorization?: Readonly<{
  binding: CertificationArtifactKeyBindingV1;
  commitment: CertificationArtifactKeyBindingCommitmentV1;
}>;
```

New governed publication requires it; absence refuses before constructing a reservation receipt.

In `src/authority/gate.ts`, define this package-internal-only function and never export it from a
barrel:

```ts
export function selectEligibleAuthorityContract(input: Readonly<{
  snapshot: AuthorityStateSnapshot;
  tenant: string;
  requester: string;
  definitionAlias: string;
  now: Date;
  trustRoots: TrustRoots;
  packs: StaticPackRegistry;
  sources: SourceRegistry;
  connectors: ConnectorRegistry;
}>): Readonly<{
  selected?: Readonly<{
    validated: ValidatedContract;
    candidate: AuthorityStateCandidate;
    contractDigest: string;
  }>;
  reason?: GateRefusalReason;
  contractDigest: string | null;
}>;
```

Move the current `evaluate`/`evaluateCandidate` bodies into this function byte-semantically
unchanged. `createAuthorityGate` calls it at both existing planning and within-current-state sites.
Governed preflight calls it for every exact Job Card audience using the same loaded snapshot,
registries, and observation time; every result must select the same unique digest and it must equal
activation `contractDigest`. Zero selection, differing audience results, refusal-order drift, or
ambiguity refuses before gate construction.

- [ ] **Fix Step 4: Put the stable projection commitment on canonical native routes**

Add required `projectionSchemaDigest` to `JsonHttpsRouteV1`, its exact key list/parser, canonical
route digest, and read/write equivalence. Require the nonzero lowercase SHA-256 pattern already used
for `egressPolicyDigest`. Do not derive it from `projectionSchemaId`, grounded pointers, a callback,
or request-time authority.

In `src/authority/certification/github-issue-labels-runner.ts`, compute the existing closed GitHub
labels projection-schema digest before constructing routes, write that exact digest onto both the
read and write routes, and copy `writeRoute.projectionSchemaDigest` into the dynamic
`RouteAuthoritySnapshotV1`. In both stable and dynamic code, compute connector registration with the
existing exact function:

```ts
connectorRegistrationDigest(registry, tenant, connectorId, accountId)
```

Update `src/authority/drivers/json-https.ts` to require the dynamic snapshot's
`projectionSchemaDigest` to equal the parsed canonical write route before materialization or send.
All affected closed-route fixtures named in the 47-path allowlist receive the explicit field; no
default or compatibility fallback exists because the route contract is branch-only.

Derive stable scope only from verified tenant, the Job Card's single definition alias, the one
selector result, the same installed definition/connector registry used by the gate, and the parsed
canonical native routes. Require exactly one governed write endpoint, select its exact write route
and referenced GET route, and join profile provider, selected contract provider/connector/account,
definition alias/digest, connector registration, both endpoint IDs, provider account identity,
credential slot, and projection schema. Unsupported or ambiguous route substrates refuse.

Populate scope fields exactly: verified tenant and Job Card alias; connector registration digest
from the four-argument helper above; `operatorConfigurationDigest` from that same parsed connector
registration; `routeDigest = jsonHttpsRouteDigest(writeRoute)`; provider/connector/account/account
identity/write endpoint/credential slot from the canonical write route after contract and connector
joins; `sourceReadRouteDigest = jsonHttpsRouteDigest(readRoute)`; and
`projectionSchemaDigest = writeRoute.projectionSchemaDigest` after exact equality with the read
route. No caller record supplies any field.

Define this package-internal export in `src/authority/host/profile-governance.ts`; do not re-export it
from `src/authority/host/index.ts` or `src/authority/index.ts`:

```ts
export function projectRouteScope(
  snapshot: RouteAuthoritySnapshotV1,
  context: Readonly<{ tenant: string; definitionAlias: string }>,
): AuthorityRouteScopeV1;
```

The two contextual fields come only from verified request/gate context because the dynamic snapshot
does not carry them. Every other field is copied from the strictly parsed snapshot. Parse the result,
compare canonical bytes and `authorityDigest` with the activated stable scope before reservation,
and never call this a thirteen-field projection of the snapshot alone.

- [ ] **Fix Step 5: Freeze externally anchored Authority trust and actual deployment provenance**

Use the existing `AuthorityKeyDescriptorV1`/`TrustEventV1` replay semantics. Extend
`src/authority/trust.ts` only with a narrow opaque Authority-binding trust view whose constructor
takes independently supplied, already parsed key descriptors, current trust events, tenant, and
external verification time. It stores public keys and active/revoked state in a private `WeakMap`,
returns only the computed current head digest/status, and verifies that the selected binding signer
has role `authority-cell`, purpose `authority-evidence`, exact signer ID/SPKI, and is active at the
external time. The same view uses direct current descriptor/event replay only for the inner `authority-evidence` parent, inner
`authority-receipt` signer, and separate outer `authority-evidence` binding signer. It must not parse
or admit the four artifact subkeys as `AuthorityKeyDescriptorV1`. Instead, call existing
`verifyCertificationArtifactKeyBinding(binding, commitment, { descriptors:
jobCardTrustPin.keyDescriptors, signedReadiness: jobCardTrustPin.signedReadiness, now })`, match its
four unique entries to the four structural signer capabilities only inside the sole validator, and
require the parent evidence descriptor and human readiness descriptor active under the external
current events. Require the six inner signer keys mutually distinct and the outer binding signer
distinct from all six. The trust view itself never returns a signing handle or public key object;
only `validateAuthorityReceiptSigningAuthority` may consume it internally and mint the private
handle described in Fix Step 3. The current head is the digest of the last parsed current Authority trust event; an
empty, future, reordered, forked, unknown-key, or revoked selection refuses. Receipt verification
receives this trust view/current observation and the existing external `JobCardTrustPinV1`; neither
anchor may be sourced from `authorityBindingEvidence`. The receipt-carried binding/commitment are
portable claims checked against those anchors, never self-anchoring roots.

Refactor `src/authority/host/local.ts` into a load/core split without changing the public
`createLocalAuthorityRuntime(config, options)` bytes or behavior:

```ts
loadLocalAuthorityComposition(config, options)
  -> Promise<LoadedLocalAuthorityCompositionV1>

createLocalAuthorityRuntimeCore(config, loaded, options)
  -> Promise<LocalAuthorityRuntime>
```

The governed path calls the deployment loader once. From that parsed load, it calls the shared
selector for every exact Job Card audience at one intrinsic host verification time, requires one
common eligible signed contract digest equal to activation, and derives these exact values:

- installed pack/definition/registration digests from the same `StaticPackRegistry` passed to the gate;
- `jobCardDigest` with `signedJobCardDigest(loaded.jobCard)`;
- `jobCardAuthorityDigest = authorityDigest(parsed JobCardTrustMaterialV1)`;
- `authorityStateDigest = authorityDigest(exact selected parsed AuthorityStateSnapshot)`;
- `connectorRegistryDigest = authorityDigest(sorted exact connectorRegistrationDigest strings)`;
- `trustRootSetDigest` via the existing trusted-root registry for the tenant;
- `connectionDescriptorsDigest = authorityDigest(parsed descriptor array in parsed order)`;
- `connectionAdoptionsDigest = authorityDigest(parsed adoption array in parsed order)`;
- `enforcementDigest = authorityDigest(parsed enforcement record)`;
- `AuthorityRouteScopeV1` from the same connector registration and reviewed native route data that can produce the request-time route snapshot.

Call `parseAuthorityRouteScope` and set `routeScopeDigest = authorityDigest(parsedScope)`. Then call
`parseAuthorityDeploymentSnapshot` and set
`deploymentDigest = authorityDigest(parsedDeploymentSnapshot)` only after all derivations. Freeze
exact-vector tests for every function/preimage above; do not substitute `digestAuthorityState` for
the declared snapshot digest. The activation must equal the actual profile, installed pack, configured
single definition, selected contract, signed Job Card, deployment snapshot, route scope, profile
head, and independent Authority head before `createAuthorityGate`, ledger directory creation,
credential/source access, or server creation. Unsupported legacy/remote route substrates without a
closed equivalent route scope refuse governed dispatch.

Store the admitted profile, exact loaded objects/digests, binding-signer identity, and publication
inputs in a new package-private branded object backed by `WeakMap`. Structural copies, casts,
freezes, public offline results, caller digest records, callbacks, or project roots cannot mint it.
Pass the same loaded pack/state/connector/trust objects into `createLocalAuthorityRuntimeCore`; do
not reload or reconstruct equivalents.

Add a filesystem-rooted governed revalidator that cannot be supplied by callers. Invoke it once
before local `outcome`/`invoke` and again through `AuthorityGateDependencies.beforeReserve` after the
actual dynamic snapshot and complete `ReservationIntent` exist but immediately before
`ledger.reserve`:

```ts
export interface AuthorityGateDependencies {
  readonly trustRoots: TrustRoots;
  readonly packs: StaticPackRegistry;
  readonly sources: SourceRegistry;
  readonly connectors: ConnectorRegistry;
  readonly state: AuthorityStatePort;
  readonly ledger: AuthorityLedger;
  readonly localGatePolicyDigest: string;
  readonly decisionSink: GateDecisionSink;
  readonly signer: GateDecisionSigner;
  readonly eventId: () => string;
  readonly capabilityId: () => string;
  readonly routeAuthority?: (input: Readonly<{
    tenant: string;
    requester: string;
    definitionAlias: string;
    connectorId: string;
    accountId: string;
    endpointId: string;
    authorityGeneration: string;
    authorityExpiresAt: string;
    authenticatedProviderIdentity?: AuthenticatedProviderIdentityV1;
  }>) => RouteAuthoritySnapshotV1 | undefined;
  readonly authenticatedProviderIdentity?: () => Promise<AuthenticatedProviderIdentityV1>;
  readonly latencyRecorder?: AuthorityLatencyRecorder;
  readonly beforeReserve?: (intent: Readonly<ReservationIntent>) => Promise<void>;
}
```

This hook is package-internal plumbing, not a new public option. Absence must produce byte- and
trace-identical legacy behavior. A hook failure maps to the existing unavailable/internal-integrity
path and never reserves. Do not widen `ReservationIntent`, `StoredReservationIntent`, or any ledger
record and do not modify `src/authority/ledger.ts`. Each invocation captures one intrinsic `observedAt`, cold reloads the fixed
profile directory with its physical-root checks, rereads the external Job Card trust pin/current
Authority key descriptors and trust events, and requires unchanged root/manifest/profile/
activation/deployment/route bindings, both current trust heads, activation validity, and all six
receipt-signing capabilities plus the binding signer properly authorized and distinct at that same
time by rerunning the sole validator: replay the human-signed artifact-key commitment against its
exact current signed readiness; require the four artifact capabilities to match the binding entries
and its active direct `authority-evidence` parent; and require the receipt and outer-binding signers
current under their separate direct Authority descriptors. Replace the prior private handle with
the newly validated handle keyed to this exact capability/observation; never mutate a handle or
invoke `sign` during revalidation. The pre-reserve call also
requires `projectRouteScope(intent.routeAuthority!, { tenant: intent.tenant,
definitionAlias: intent.definitionAlias })` to match activated scope canonically and by digest.
Require `activation.validFrom <= observedAt < activation.validUntil`; receipt verification also
requires every signer active at binding `observedAt` and verifier time.

Store the accepted observation behind the private runtime provenance keyed to the exact capability
digest so same-process publication can consume it once. Do not claim restart durability for this
map. Restart loads signed stored outer evidence, revalidates its exact chain, performs fresh
reconciliation, and never automatically resends.

- [ ] **Fix Step 6: Pin the physical operator root and add both signer capabilities**

Open/pin the physical operator governance directory before reading artifacts. Retain its canonical
path plus device/inode (and Windows volume/file identity when available), verify it is a real
directory and not a symlink/junction/reparse indirection, and revalidate that same identity before
and after each of all six child reads and once after the complete set. Each child is opened with
no-follow semantics where supported and receives pre-open/open-handle/post-open identity checks.
Any root rename/replacement, mixed generation, child replacement, canonical-path change, or
unsupported identity check refuses. `operatorRootDigest` commits the stable physical identity and
canonical path only after the final revalidation.

Add these exact governed options and no profile/path/clock/root alternative:

```ts
export interface AuthorityBindingSignerV1 {
  readonly signerId: string;
  readonly publicKey: KeyObject;
  readonly sign: (input: Readonly<{
    purpose: "authority-evidence";
    digest: string;
  }>) => Promise<AuthoritySignature>;
}

export interface GovernedAuthorityCellOptionsV1 {
  readonly principalRegistry?: PrincipalRegistry;
  readonly dispatchAdapter?: DispatchAdapter;
  readonly delegation?: DelegationAuthority;
  readonly signedTopologyEvidence?: SignedTopologyEvidenceV1;
  readonly topologySigner?: Readonly<{ signerId: string; publicKey: KeyObject }>;
  readonly signedLease?: SignedAuthorityLeaseV1;
  readonly leaseSigner?: Readonly<{ signerId: string; publicKey: KeyObject }>;
  readonly sourceReadAdapter?: SourceReadAdapter;
  readonly connectionRoutes?: OpaqueConnectionRouteRegistry;
  readonly secretResolver?: SecretResolver;
  readonly routeAuthority?: (input: Readonly<{
    tenant: string;
    requester: string;
    definitionAlias: string;
    connectorId: string;
    accountId: string;
    endpointId: string;
    authorityGeneration: string;
    authorityExpiresAt: string;
  }>) => RouteAuthoritySnapshotV1 | undefined;
  readonly authenticatedProviderIdentity?: () => Promise<AuthenticatedProviderIdentityV1>;
  readonly verifyAuthenticatedProviderIdentity?: CertifiedIdentityVerifier;
  readonly certifiedDispatch?: CertifiedDispatchOptions;
  readonly portableReceiptPublication?: DispatchPublication;
  readonly latencyRecorder?: AuthorityLatencyRecorder;
  readonly receiptSigningAuthority?: AuthorityReceiptSigningAuthorityV1;
  readonly authorityBindingSigner?: AuthorityBindingSignerV1;
}
```

For governed dispatch, `receiptSigningAuthority` and `authorityBindingSigner` are required as an
all-or-nothing pair. Exact option validation rejects either alone before filesystem reads or
callbacks. After cold external governance/readiness/descriptors/events validate, pass both raw
options exactly once to `validateAuthorityReceiptSigningAuthority`; store only its opaque handle in
private governed provenance. The validator enforces the four binding-entry matches, active direct
parent/receipt/outer descriptors, all time/revocation/uniqueness rules, and segregation from profile
certifier/operator, Job Card human, local-gate, topology, lease, and identity keys. Invoke the six
receipt signers only through the handle inside pure inner-bundle construction; invoke the binding
signer only through that same governed handle after the actual inner bundle has passed the unchanged
verifier and the exact persisted dynamic route snapshot is available. The factory still asserts Linux first, derives
`os.homedir()`/wall time internally, returns only `AuthorityHostServer`, and never provisions,
listens, activates, or adds the Task 6 session endpoint.

- [ ] **Fix Step 7: Produce, persist, recover, and verify the independently joined outer receipt**

Use this amended outer shape and update `profile-governed-receipt.schema.json` accordingly:

```ts
export interface ProfileGovernedAuthorityReceiptV1 {
  readonly v: "reelier.profile-governed-authority-receipt/v1";
  readonly profileDraft: OutcomeProfileDraftV1;
  readonly profileConformanceReport: ProfileConformanceReportV1;
  readonly profileConformance: SignedOutcomeProfileConformanceV1;
  readonly profileActivation: SignedTenantProfileActivationV1;
  readonly authorityReceiptBundle: AuthorityReceiptBundle;
  readonly authorityBindingEvidence: Readonly<{
    signedJobCard: SignedJobCardV1;
    artifactKeyBinding: CertificationArtifactKeyBindingV1;
    artifactKeyBindingCommitment: CertificationArtifactKeyBindingCommitmentV1;
    deploymentSnapshot: AuthorityDeploymentSnapshotV1;
    routeScope: AuthorityRouteScopeV1;
    routeAuthoritySnapshot: RouteAuthoritySnapshotV1;
    binding: SignedProfileAuthorityBindingV1;
  }>;
  readonly edges: Readonly<{
    profileDigest: string;
    conformanceReportDigest: string;
    conformanceDigest: string;
    activationDigest: string;
    innerReceiptDigest: string;
    authorityBindingDigest: string;
  }>;
}
```

Preserve the existing `publish` method exactly and add these two optional compatibility seams in
`src/authority/host/dispatch.ts`:

```ts
export type DurableDispatchPublicationHeadV1 = Readonly<{
  v: "reelier.durable-dispatch-publication-head/v1";
  reservationId: string;
  tenant: string;
  requestDigest: string;
  capabilityDigest: string;
  effectDigest: string;
  routeAuthorityDigest: string;
  receiptRef: string;
  evidenceDigest: string;
  reservationReceiptRef: string;
  dispatchedRequestDigest: string | null;
  priorReceiptRef: string | null;
} & (
  | Readonly<{
      phase: "reservation";
      terminalKind: null;
      dispatchedRequestDigest: null;
      priorReceiptRef: null;
    }>
  | Readonly<{
      phase: "dispatch";
      terminalKind: "acknowledged" | "definitive-failure" | "ambiguous";
      dispatchedRequestDigest: string;
      priorReceiptRef: string;
    }>
  | Readonly<{
      phase: "ambiguous";
      terminalKind: "ambiguous";
      dispatchedRequestDigest: string;
      priorReceiptRef: string;
    }>
  | Readonly<{
      phase: "reconcile";
      terminalKind: "reconciled";
      dispatchedRequestDigest: string;
      priorReceiptRef: string;
    }>
)>;

export interface DispatchPublication {
  publish(input: Readonly<{
    phase: "dispatch" | "cancelled" | "ambiguous" | "reconcile";
    state: DispatchRequestState;
    outcome: DispatchOutcome;
    dispatchedRequestDigest: string | null;
    priorReceiptDigest?: string | null;
  }>): Promise<Readonly<{ receiptRef: string; evidenceDigest: string }>>;
  publishReservation?(input: Readonly<{
    phase: "reservation";
    state: DispatchRequestState;
    outcome: DispatchOutcome;
    dispatchedRequestDigest: null;
    priorReceiptDigest: null;
  }>): Promise<Readonly<{ receiptRef: string; evidenceDigest: string }>>;
  loadDurableHead?(input: Readonly<{
    state: DispatchRequestState;
  }>): Promise<DurableDispatchPublicationHeadV1 | null>;
}
```

Every scalar is an exact own-data property; parse with `Reflect.ownKeys` and reject symbols,
accessors, extras, inherited/non-enumerable fields, invalid discriminated pairs, noncanonical or zero
digests, and prototype substitution. `reservationReceiptRef === receiptRef` for a reservation head;
every terminal head's `reservationReceiptRef` identifies the verified root and
`priorReceiptRef` identifies the immediately preceding inner receipt. `routeAuthorityDigest` is
`authorityDigest(state.reservation.intent.routeAuthority)`. `loadDurableHead` is read-only: before
returning it, the governed publisher strictly verifies the unique immutable inner/outer chain and
fresh external profile, Job Card, readiness, and Authority anchors. It never calls a signer,
publisher, adapter, reconciler, ledger method, source, credential, or provider.

Legacy publishers omit both optional methods and retain exact behavior. The governed factory requires
its private publisher to implement both. On the certified `adapter.prepare &&
ledger.commitPreparedDispatch` branch, call it only after successful prepared CAS and before
`consumePreparedDispatch`. Supply the exact synthetic reservation outcome defined in Fix Step 3.
Construction/signature/unchanged-inner-verifier/outer-verifier/immutable-store failure propagates
before `consumePreparedDispatch`, so provider send count remains zero. Do not call this method on any
legacy/non-certified/cancel path.

Recovery branches on `loadDurableHead` presence. When it is absent, the coordinator executes the
pre-amendment recovery path with identical calls, transitions, results, and traces; it never probes a
store or synthesizes a head. `publishReservation` presence alone does not enable durable-head
adoption.

The accepted request must persist the exact dynamic `RouteAuthoritySnapshotV1` already carried by
`state.reservation.intent.routeAuthority`; do not reconstruct it from activation or provider
response. The governed publication consumes the exact capability-keyed private provenance/current
observation and its freshly minted `ValidatedAuthorityReceiptSigningAuthorityV1`; it calls
`constructAuthorityReceiptBundle` with that handle, immediately runs unchanged
`verifyAuthorityReceiptBundle` using only external direct roots plus the four roots held in validated
private state,
creates and verifies the signed outer binding, and stores the complete outer receipt immutably. For
the reservation phase, durable outer storage must succeed before provider send. For terminal
dispatch, publish after the provider outcome/evidence is known and before terminal ledger
transition, with `priorReceiptDigest` equal to the reservation inner receipt-value digest. Only after
durable outer storage succeeds may it forward the optional existing
`portableReceiptPublication`; the portable result cannot replace or verify the governed receipt.

At certified restart, the coordinator calls `loadDurableHead({ state })` only for a ledger
reservation still in `dispatched` or `ambiguous`. It independently compares reservation ID, capability/effect/route
digests, tenant/request and dispatched-request identity, root reference, and exact prior chain to recovered ledger
state. A verified terminal head performs only the matching ledger transition with
`resultDigest: head.receiptRef`; no publication or resend occurs. The closed mapping is:

- `phase: "dispatch"` plus terminal kind `acknowledged`, `definitive-failure`, or `ambiguous` maps to
  that exact ledger state;
- `phase: "ambiguous"` requires and maps only `ambiguous`;
- `phase: "reconcile"` requires and maps only `reconciled`, and is adoptable only from an
  `ambiguous` ledger row whose stored inner result is its exact prior;
- `phase: "reservation"` has `terminalKind: null` and is never itself adopted as terminal;
- `cancelled` is not a legal dispatched durable head.

From `dispatched`, only a verified root-only reservation head may cause the coordinator to publish one ambiguity child
and then transition `dispatched -> ambiguous` with that child's inner `receiptRef` as result. A null
head, missing root, multiple heads, fork, invalid outer/inner verification, phase/terminal mismatch,
wrong reservation/capability/effect/route/request/root/prior identity, stale/revoked anchors, or any
read failure refuses recovery without publishing, transitioning, reconciling, or sending. An
already-terminal ledger row is untouched. A reconcile head presented for `dispatched`, or a
dispatch/root head presented for `ambiguous`, is a state/phase conflict and refuses. The coordinator is the sole ledger lifecycle owner;
`publishReservation`, `publish`, and `loadDurableHead` never transition it.

For an adopted ambiguous terminal head, later `reconcile(reservationId)` reads
`reservation.resultDigest === head.receiptRef` and uses that exact inner reference as
`priorReceiptDigest`. For a root-only ambiguity child it similarly uses the child's inner reference.
An acknowledged/definitive terminal head gets no ambiguity sibling. Maker and verifier remain
different roles; a verifier constructs the verified receipt graph rather than trusting maker flags.

Freeze the crash behavior exactly: a cut before root storage leaves no send and recovery refuses; a
cut after root storage/before send or after provider apply/before terminal storage sees a verified
root only and publishes one ambiguity child; a cut after terminal storage/before ledger transition
adopts that terminal head with no new receipt; a cut after ledger transition is a no-op. A cut after
reconciliation storage/before its ledger transition similarly adopts the verified reconcile head
from `ambiguous`. Failure of optional portable forwarding after governed storage is treated as the
matching after-storage cut, never as permission to publish a sibling or resend.

Every `publishReservation`/`publish` result is exactly:

```ts
Object.freeze({
  receiptRef: authorityDigest(inner.receipt.value),
  evidenceDigest: inner.evidence.digest,
});
```

Index the immutable outer object by reservation ID, effect digest, and that inner receipt reference.
Its outer digest is storage/evidence identity only. Never return it from `DispatchPublication`, put
it in a ledger result, or use it as an inner `priorReceiptDigest`. A terminal node uses the
reservation `receiptRef`; a reconciliation node uses the immediately preceding inner `receiptRef`.

`verifyProfileGovernedAuthorityReceipt` takes external profile roots, external current Job Card
trust/readiness, external direct Authority trust roots, and external current Authority descriptors/
events. It performs exactly this order:

1. Strictly parse the closed outer envelope, its signed profile-authority binding, the artifact-key
   binding, and the human commitment. Parse only; none is trusted and no verified result or roots
   escape.
2. From the four closed binding entries, derive provisional `TrustRootEntry` candidates only for
   `source-bundle`, `compiled-capability`, `transport-effect`, and `pack-manifest`, with the verified
   envelope tenant. Combine them with caller-supplied external direct roots solely as the input to
   the unchanged inner verifier. Never derive candidate roots for contract, delegation, gate,
   evidence, receipt, or outer binding.
3. Run unchanged `verifyAuthorityReceiptBundle` with that temporary combined set and retain its
   exact claims/digest provisionally. Failure stops. Success does not authorize the four candidates.
4. Run profile governance verification using profile trust only, then verify `signedJobCard` and its
   exact `signedReadiness` against the existing external current Job Card pin.
5. Call existing `verifyCertificationArtifactKeyBinding` against that external signed readiness at
   binding `observedAt` and verifier time. Replay external current descriptors/events and require the
   human readiness signer and direct parent evidence descriptor active/unrevoked at both times;
   require exact Cell/task/Adapter Contract/readiness/validity/parent/commitment joins.
6. For each of the four signed inner artifacts, match its actual kind/purpose, `signerId`, signature,
   and the candidate root's exact SPKI to the one unique authorized binding entry. Reverify its
   signature with that SPKI. Missing, duplicate, reordered-purpose, substituted, or extra matches
   refuse. There are no callbacks in an offline receipt.
7. Prove every other inner artifact was verified only by caller-supplied external direct roots.
   Replay current external Authority descriptors/events for the inner direct evidence/receipt keys
   and the separate outer binding key, require all activity/revocation/time/segregation rules at
   binding `observedAt` and verifier time, and verify the domain-separated outer binding signature.
   Candidate roots cannot satisfy this step.
8. Strictly parse/digest `deploymentSnapshot` and `routeScope`; parse/digest the dynamic route
   snapshot; call `projectRouteScope(snapshot, { tenant: verifiedTenant, definitionAlias:
   verifiedDefinitionAlias })`; and require canonical equality/digest equality with `routeScope`.
   Dynamic slot instance/version, identity/materialized-request digests, generation, and expiry
   remain receipt-time only. Require `activation.validFrom <= observedAt < activation.validUntil`.
9. Compare activation `jobCardDigest`, `contractDigest`, `deploymentDigest`, `routeScopeDigest`, and
   `authorityTrustHeadDigest` to independently derived values; compare activation
   `trustHeadDigest` only to the profile head; compare activation contract directly to
   `inner.bundle.contract.digest`.
10. Compare binding profile, activation, inner receipt, Job Card, artifact-key binding/commitment,
    contract, deployment, route scope, dynamic route snapshot, and Authority-head digests exactly,
    then compare all six outer edges including `authorityBindingDigest`. Only now return the
    unchanged inner verified claims and outer verification status.

The four provisional receipt-carried roots are implementation-local candidate material, never an
external anchor or returned trust view. A self-consistent forged binding/commitment and inner bundle
must fail Steps 5–7 without valid external readiness, current parent/human authority, and exact signed
inner-artifact authorization.

Never rewrite or upgrade authorization, dispatch, acknowledgment, reconciliation, topology, or
completeness.

- [ ] **Fix Step 8: Run exact gates, prove unchanged Authority ABI, and commit**

Run all commands from repository root:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/authority/outcome-profile.test.js dist-test/test/authority/outcome-profile-package.test.js dist-test/test/authority/trust.test.js dist-test/test/authority/profile-governance.test.js dist-test/test/authority/profile-governance-loader.test.js dist-test/test/authority/governed-cell.test.js dist-test/test/authority/profile-governed-receipt.test.js dist-test/test/authority/receipt-authority.test.js dist-test/test/authority/dispatch-coordinator.test.js dist-test/test/authority/certification-lifecycle-authority.test.js dist-test/test/authority/local-runtime.test.js dist-test/test/authority/gate.test.js dist-test/test/authority/package.test.js dist-test/test/authority/json-https-route.test.js dist-test/test/authority/config.test.js dist-test/test/authority/github-account-identity.test.js dist-test/test/authority/json-https-driver.test.js dist-test/test/authority/json-https-connector.test.js dist-test/test/authority/prepared-dispatch.test.js dist-test/test/authority/native-https-route-join.test.js dist-test/test/authority/certification-github-issue-labels-runner.test.js
npm run check:authority-contract
npm run check:outcome-profile-contract
npm run build
node --test --test-concurrency=1 dist-test/test/authority/outcome-profile.test.js dist-test/test/authority/outcome-profile-package.test.js dist-test/test/authority/trust.test.js dist-test/test/authority/profile-governance.test.js dist-test/test/authority/profile-governance-loader.test.js dist-test/test/authority/governed-cell.test.js dist-test/test/authority/profile-governed-receipt.test.js dist-test/test/authority/receipt-authority.test.js dist-test/test/authority/dispatch-coordinator.test.js dist-test/test/authority/certification-lifecycle-authority.test.js dist-test/test/authority/local-runtime.test.js dist-test/test/authority/gate.test.js dist-test/test/authority/package.test.js dist-test/test/authority/json-https-route.test.js dist-test/test/authority/config.test.js dist-test/test/authority/github-account-identity.test.js dist-test/test/authority/json-https-driver.test.js dist-test/test/authority/json-https-connector.test.js dist-test/test/authority/prepared-dispatch.test.js dist-test/test/authority/native-https-route-join.test.js dist-test/test/authority/certification-github-issue-labels-runner.test.js
git diff --exit-code cc529e5e4136eb9e58cd5f39816798f9636bb715 -- contract/authority/v1 scripts/build-authority-contract.mjs src/authority/types.ts src/authority/evidence.ts src/authority/verify.ts src/authority/adapter-contract.ts src/authority/ledger.ts src/authority/host/receipts.ts src/authority/host/portable-receipts.ts src/authority/host/config.ts package.json package-lock.json pnpm-lock.yaml yarn.lock
git diff --check
git diff --check cc529e5e4136eb9e58cd5f39816798f9636bb715..HEAD
```

Record the Authority adapter digest before RED with
`node -e "import('./dist/authority/adapter-contract.js').then(m=>console.log(m.AUTHORITY_ADAPTER_CONTRACT_V1_DIGEST))"`
and run the same command after the final build; require exact string equality. Require Authority
Contract v1 check/digest unchanged, Outcome Profile Contract v1 check green with exactly eight
members and its newly generated digest, no duplicate test registrations, the certification
lifecycle three-node/restart/no-resend test unchanged and green, and the Task 2 Linux test reported
honestly: executed on Linux or an explicit skip with exact reason
`requires an already-available Linux Node executor` on non-Linux. The skip is not a pass; Task 7/CI
must still supply Linux evidence.

Verify the exhaustive allowlist mechanically:

```powershell
$base = 'cc529e5e4136eb9e58cd5f39816798f9636bb715'
$changed = @(git diff --name-only $base --)
$allowed = @(
  'contract/outcome-profile/v1/profile-authority-evidence.schema.json'
  'contract/outcome-profile/v1/profile-activation.schema.json'
  'contract/outcome-profile/v1/profile-governed-receipt.schema.json'
  'contract/outcome-profile/v1/contract-descriptor.json'
  'scripts/build-outcome-profile-contract.mjs'
  'src/authority/outcome-profile-contract.ts'
  'src/authority/outcome-profile.ts'
  'src/authority/index.ts'
  'src/authority/trust.ts'
  'src/authority/host/receipt-authority.ts'
  'src/authority/certification/lifecycle-authority.ts'
  'src/authority/certification/lifecycle-receipts.ts'
  'src/authority/host/dispatch.ts'
  'src/authority/gate.ts'
  'src/authority/host/json-https-route.ts'
  'src/authority/drivers/json-https.ts'
  'src/authority/certification/github-issue-labels-runner.ts'
  'src/authority/host/profile-governance.ts'
  'src/authority/host/profile-governance-loader.ts'
  'src/authority/host/governed-cell.ts'
  'src/authority/host/profile-governed-receipt.ts'
  'src/authority/host/local.ts'
  'src/authority/host/index.ts'
  'test/authority/profile-governance-fixture.ts'
  'test/authority/receipt-authority.test.ts'
  'test/authority/dispatch-coordinator.test.ts'
  'test/authority/certification-lifecycle-authority.test.ts'
  'test/authority/outcome-profile.test.ts'
  'test/authority/outcome-profile-package.test.ts'
  'test/authority/trust.test.ts'
  'test/authority/profile-governance.test.ts'
  'test/authority/profile-governance-loader.test.ts'
  'test/authority/governed-cell.test.ts'
  'test/authority/profile-governed-receipt.test.ts'
  'test/authority/local-runtime.test.ts'
  'test/authority/gate.test.ts'
  'test/authority/package.test.ts'
  'test/authority/json-https-route.test.ts'
  'test/authority/config.test.ts'
  'test/authority/github-account-identity.test.ts'
  'test/authority/json-https-driver.test.ts'
  'test/authority/json-https-connector.test.ts'
  'test/authority/prepared-dispatch.test.ts'
  'test/authority/native-https-route-join.test.ts'
  'test/authority/certification-github-issue-labels-runner.test.ts'
  'docs/superpowers/specs/2026-08-14-one-command-agent-bootstrap-design.md'
  'docs/superpowers/plans/2026-08-14-one-command-agent-bootstrap.md'
)
$unexpected = @($changed | Where-Object { $_ -notin $allowed })
if ($unexpected.Count -ne 0) { throw "Unexpected Task 2 paths: $($unexpected -join ', ')" }
```

Commit only the expanded Task 2 allowlist with:

```powershell
git add -- contract/outcome-profile/v1/profile-authority-evidence.schema.json contract/outcome-profile/v1/profile-activation.schema.json contract/outcome-profile/v1/profile-governed-receipt.schema.json contract/outcome-profile/v1/contract-descriptor.json scripts/build-outcome-profile-contract.mjs src/authority/outcome-profile-contract.ts src/authority/outcome-profile.ts src/authority/index.ts src/authority/trust.ts src/authority/host/receipt-authority.ts src/authority/certification/lifecycle-authority.ts src/authority/certification/lifecycle-receipts.ts src/authority/host/dispatch.ts src/authority/gate.ts src/authority/host/json-https-route.ts src/authority/drivers/json-https.ts src/authority/certification/github-issue-labels-runner.ts src/authority/host/profile-governance.ts src/authority/host/profile-governance-loader.ts src/authority/host/governed-cell.ts src/authority/host/profile-governed-receipt.ts src/authority/host/local.ts src/authority/host/index.ts test/authority/profile-governance-fixture.ts test/authority/receipt-authority.test.ts test/authority/dispatch-coordinator.test.ts test/authority/certification-lifecycle-authority.test.ts test/authority/outcome-profile.test.ts test/authority/outcome-profile-package.test.ts test/authority/trust.test.ts test/authority/profile-governance.test.ts test/authority/profile-governance-loader.test.ts test/authority/governed-cell.test.ts test/authority/profile-governed-receipt.test.ts test/authority/local-runtime.test.ts test/authority/gate.test.ts test/authority/package.test.ts test/authority/json-https-route.test.ts test/authority/config.test.ts test/authority/github-account-identity.test.ts test/authority/json-https-driver.test.ts test/authority/json-https-connector.test.ts test/authority/prepared-dispatch.test.ts test/authority/native-https-route-join.test.ts test/authority/certification-github-issue-labels-runner.test.ts docs/superpowers/specs/2026-08-14-one-command-agent-bootstrap-design.md docs/superpowers/plans/2026-08-14-one-command-agent-bootstrap.md
git commit -m "fix(authority): bind governed profiles to verified authority"
```

After the GREEN commit, run the same exact gates from the clean committed tree. Then run whitespace
checks over every immutable amendment/RED/GREEN commit and the complete fix range:

```powershell
$base = 'cc529e5e4136eb9e58cd5f39816798f9636bb715'
$subjects = @(
  'docs: amend governed authority evidence'
  'docs: complete governed authority execution seams'
  'docs: complete governed dispatch publication'
  'docs: close governed recovery and trust handoff'
  'test(authority): expose governed admission review gaps'
  'fix(authority): bind governed profiles to verified authority'
)
foreach ($subject in $subjects) {
  $commit = git log --format=%H --fixed-strings --grep=$subject -1 "$base..HEAD"
  if (-not $commit -or (git show -s --format=%s $commit) -ne $subject) {
    throw "Missing immutable Task 2 commit: $subject"
  }
  git show --check --oneline $commit
  if ($LASTEXITCODE -ne 0) { throw "Whitespace failure in $commit ($subject)" }
}
git diff --check "$base..HEAD"
if ($LASTEXITCODE -ne 0) { throw 'Task 2 range whitespace failure' }
```

Dispatch a fresh read-only reviewer for ordered spec-compliance then code-quality verdicts. Do not
begin Task 3 until both verdicts clear all five original blockers, all eight first-amendment review
findings, every second-amendment execution seam, and both third-amendment Critical findings.

---

### Task 3: Freeze the bootstrap project, route coverage, and runtime contracts

**Files:**
- Create: `contract/bootstrap/v1/agent-project.schema.json`
- Create: `contract/bootstrap/v1/route-coverage.schema.json`
- Create: `contract/bootstrap/v1/runtime-descriptor.schema.json`
- Create: `contract/bootstrap/v1/bootstrap-report.schema.json`
- Create: `contract/bootstrap/v1/supervisor-status.schema.json`
- Create: `contract/bootstrap/v1/authority-cell-session-binding.schema.json`
- Create: `contract/bootstrap/v1/contract-descriptor.json`
- Create: `scripts/build-bootstrap-contract.mjs`
- Create: `src/bootstrap/types.ts`
- Create: `src/bootstrap/normalize.ts`
- Create: `src/bootstrap/project.ts`
- Create: `src/bootstrap/build-identity.ts`
- Create: `src/bootstrap/contract.ts` (generated by the contract builder)
- Create: `src/bootstrap/index.ts`
- Create: `src/routes/types.ts`
- Create: `src/routes/normalize.ts`
- Create: `src/runtime/types.ts`
- Create: `src/runtime/manifest.ts`
- Modify: `package.json`
- Create: `test/bootstrap-contract.test.ts`
- Create: `test/bootstrap-build-identity.test.ts`
- Create: `test/bootstrap-package.test.ts`
- Create: `test/route-coverage.test.ts`
- Create: `test/runtime-manifest.test.ts`

**Interfaces:**
- Consumes: exact package version, canonical installed-build digest, optional external tarball-integrity digest, Authority/Continuity/Profile contract digests, existing initialization-report digest, and non-secret route evidence.
- Produces: `AgentProjectV1`, `RouteCoverageV1`, `RuntimeDescriptorV1`, `BootstrapReportV1`, `SupervisorStatusV1`, `AuthorityCellSessionBindingV1`, strict parsers, and `BOOTSTRAP_CONTRACT_V1_DIGEST`.

- [ ] **Step 1: Write failing schema and inertness tests**

Create mutation tables proving accessors, symbols, non-enumerable extras, prototype substitution, duplicate route IDs, secret-looking fields, raw environment values, floating versions, shell command strings, and unknown enum values refuse before any getter executes. For `AuthorityCellSessionBindingV1`, independently mutate Authority/adapter contract digest, grant ID/digest, expiry, observation/freshness ordering, principal-session agreement, and an external verification time at either boundary; stale, expired, widened, or substituted bindings refuse.

Run `npx tsc -p tsconfig.test.json`; expect missing `src/bootstrap`, `src/routes`, and `src/runtime` modules. Commit the RED tests with the Task 3 subject before creating schemas or production files.

- [ ] **Step 2: Define the closed runtime-neutral records**

Use these core shapes:

```ts
export interface AgentProjectV1 {
  readonly v: "reelier.agent-project/v1";
  readonly agentName: string;
  readonly projectId: string;
  readonly tenant: string | null;
  readonly reelierVersion: string;
  readonly installedBuildDigest: string;
  readonly packageTarballIntegrityDigest: string | null;
  readonly authorityContractDigest: string;
  readonly continuityContractDigest: string;
  readonly outcomeProfileContractDigest: string;
  readonly bootstrapContractDigest: string;
  readonly initializationReportDigest: string;
  readonly runtimeDescriptorDigest: string;
  readonly routeCoverageDigest: string;
  readonly profileGovernanceRef: string | null;
  readonly profileGovernanceManifestDigest: string | null;
  readonly profileTrustHeadDigest: string | null;
  readonly authorityMode: "unconfigured" | "managed-cell" | "self-hosted-linux-cell";
}

export interface RuntimeDescriptorV1 {
  readonly v: "reelier.runtime-descriptor/v1";
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly adapterDigest: string;
  readonly launchMode: "local-process" | "externally-managed";
  readonly command: string | null;
  readonly args: readonly string[];
  readonly cwd: string | null;
  readonly connectionRef: string | null;
  readonly environmentAllowlist: readonly string[];
  readonly authenticatedBinding: "bearer-file" | "loopback-session" | "host-private";
  readonly shutdown: "signal-owned-child" | "external";
}

export interface RouteCoverageV1 {
  readonly v: "reelier.route-coverage/v1";
  readonly routeId: string;
  readonly hostId: string;
  readonly discoverySource: "host-config" | "plugin-manifest" | "composio" | "native-config" | "openapi" | "host-private" | "direct-http" | "writable-browser" | "unknown";
  readonly transport: "mcp-stdio" | "mcp-http" | "https" | "opaque-host" | "browser" | "unknown";
  readonly observation: "observed" | "partially-observed" | "uncovered" | "unknown";
  readonly replay: "available" | "candidate" | "unavailable" | "unknown";
  readonly outcome: "activated" | "outcome-capable" | "shadow-only" | "unsupported" | "unknown";
  readonly enforcement: "verified" | "failed" | "unchecked" | "absent";
  readonly observedAt: string;
  readonly freshUntil: string;
  readonly evidenceDigest: string;
  readonly topologyEvidenceDigest: string | null;
  readonly evidenceRefs: readonly string[];
  readonly reasonCodes: readonly string[];
}

export interface AuthorityCellSessionBindingV1 {
  readonly v: "reelier.authority-cell-session-binding/v1";
  readonly cellId: string;
  readonly adapterContractDigest: string;
  readonly authorityContractDigest: string;
  readonly tenant: string;
  readonly principalId: string;
  readonly taskId: string;
  readonly runtimeSessionId: string;
  readonly jobId: string;
  readonly jobCardDigest: string;
  readonly grantId: string;
  readonly grantDigest: string;
  readonly allocationId: string;
  readonly profileDigest: string;
  readonly activationDigest: string;
  readonly profileTrustHeadDigest: string;
  readonly expiresAt: string;
  readonly bindingObservedAt: string;
  readonly bindingFreshUntil: string;
  readonly topologyEvidenceDigest: string | null;
  readonly topologyFreshUntil: string | null;
}
```

No record may contain command output, provider tool-call arguments, endpoint URLs, credential references, tokens, environment values, provider bodies, or private receipt graphs. `RuntimeDescriptorV1.args` contains only the closed launcher arguments approved for the pinned runtime adapter. `connectionRef` is an opaque host-owned connection alias, never an endpoint or secret reference. Project-relative paths must be normalized, traversal-free, and confined to the project; user-private key paths are never serialized into these records.

The session-binding parser takes an externally supplied observation time. It requires `bindingObservedAt <= observationTime < bindingFreshUntil <= expiresAt`, and a principal session whose exact `grantId`, `principalId`, `tenant`, and `expiresAt` agree with the host registry. A revoked bearer token or principal session refuses at authentication and produces no binding. The binding is a sanitized statement produced only by an already admitted Cell runtime; it cannot activate governance or extend any contract/session lifetime.

- [ ] **Step 3: Generate the separate bootstrap contract**

Mirror the sorted-member/digest behavior of `build-authority-contract.mjs`, but write only `contract/bootstrap/v1/contract-descriptor.json` and generated `src/bootstrap/contract.ts`. Add `check:bootstrap-contract`; do not modify Authority Contract membership.

Implement `computeInstalledBuildDigest(packageRoot)` over a canonical record containing the exact package version and every shipped regular file selected by the package `files` contract: normalize relative paths to POSIX form, sort by UTF-8 byte order, reject symlinks and duplicate/case-colliding paths, hash raw file bytes, exclude `node_modules`, caches, temporary files, and the digest record itself, then hash the closed file list with `authorityDigest`. Both `init` and `up` resolve the executing package root from their own module URL and recompute this digest. `packageTarballIntegrityDigest` is populated only from an independently supplied lock/registry artifact; absence stays `null` and never becomes a fabricated tarball claim.

Add a closed `./bootstrap` package export backed by `src/bootstrap/index.ts`. Export only contract constants, inert parsers/verifiers, and public record types. Keep filesystem writers, discovery collectors, launcher construction, process handles, and supervisor mutation APIs internal. `test/bootstrap-package.test.ts` must pin the exact runtime and declaration export sets from a clean installed consumer.

- [ ] **Step 4: Run focused tests and commit**

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/bootstrap-contract.test.js dist-test/test/bootstrap-build-identity.test.js dist-test/test/bootstrap-package.test.js dist-test/test/route-coverage.test.js dist-test/test/runtime-manifest.test.js
npm run check:authority-contract
npm run check:outcome-profile-contract
npm run check:bootstrap-contract
git diff --check
```

Commit the listed Task 3 files with `feat(bootstrap): freeze project and runtime contracts`.

---

### Task 4: Produce route-level discovery without false completeness

**Files:**
- Create: `src/routes/adapters.ts`
- Create: `src/routes/discovery.ts`
- Create: `src/routes/hosts/codex.ts`
- Create: `src/routes/hosts/claude-code.ts`
- Modify: `src/coverage.ts`
- Modify: `src/initialization.ts`
- Create: `test/route-discovery.test.ts`
- Modify: `test/coverage.test.ts`
- Modify: `test/coverage-claude-code.test.ts`
- Modify: `test/initialization.test.ts`

**Interfaces:**
- Consumes: existing `CoverageServer`, `PluginCoverage`, `CoverageView`, connection inventory, Path B candidates, and Path C classifications.
- Produces: opaque `RouteDiscoveryAdapterRegistryV1`, `discoverRouteCoverage(input): Promise<readonly RouteCoverageV1[]>`, and a named-bootstrap-only route artifact. Existing initialization checkpoints and report remain unchanged.

- [ ] **Step 1: Write the bypass and unreadable-surface RED tests**

Fixtures must include: same-name config and plugin routes, remote URL MCP, plugin-private MCP, direct HTTP, writable browser, unreadable registry, OpenAPI-only route, host-private connection, reviewed MCP route, and activated native route. Assert every fixture remains a separate row and conservative aggregate.

```ts
assert.deepEqual(rows.map(row => [row.routeId, row.observation, row.enforcement]), [
  ["config:gmail.send", "observed", "unchecked"],
  ["plugin:gmail.send", "uncovered", "absent"],
  ["direct-http:gmail.send", "uncovered", "absent"],
]);
```

Use an injected wall clock. Assert expired evidence, a changed host-config digest, an unreadable previously observed source, and a missing previously observed route all produce a current `unknown` or `uncovered` row rather than preserving the initialization-time status.

Run `npx tsc -p tsconfig.test.json`; expect missing route discovery adapter/module exports. Commit the RED tests with the Task 4 subject before implementation.

- [ ] **Step 2: Implement host adapters over existing collectors**

Define a closed `RouteDiscoveryAdapterV1` with pinned `sourceId`, `sourceVersion`, `sourceDigest`, and a read-only `discover` method that returns inert route candidates without credentials or provider bodies. Store installed adapters in a private registry; models and project files cannot register executable discovery code. Do not copy parsers from `coverage.ts`. Built-in host adapters translate existing collector results into `RouteCoverageV1`. Unknown/unreadable inputs become `unknown`, never zero. OpenAPI or third-party catalog metadata may create a discovery row through a future independently installed adapter, but cannot create a verified `ConnectionDescriptorV1` or activated Outcome.

Tests must prove two different adapter sources that describe the same provider method remain separate evidence rows, and that importing a route catalog cannot upgrade observation, enforcement, identity, topology, or profile activation. This is the extension point for large tool ecosystems; do not add a provider-specific connector catalog to Reelier core.

- [ ] **Step 3: Preserve existing initialization state**

Do not add to `INIT_CHECKPOINT_IDS`. Named bootstrap calls route discovery after `initializeInspection` completes and stores its artifact outside `.reelier/init/`, under `.reelier/bootstrap/route-coverage.json`. Add only reusable exported translation functions to `initialization.ts` if needed; do not change existing report bytes.

Every route row receives `observedAt`, a source-specific bounded `freshUntil`, and an `evidenceDigest`. Static file/config sources commit canonical bytes plus file identity; live sources commit only sanitized observations. No adapter may issue an unbounded or permanent freshness interval.

- [ ] **Step 4: Run tests and commit**

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/route-discovery.test.js dist-test/test/route-coverage.test.js dist-test/test/coverage.test.js dist-test/test/coverage-claude-code.test.js dist-test/test/initialization.test.js
npm run check:bootstrap-contract
git diff --check
```

Expected: all focused tests and the bootstrap contract check pass. Stage only the Task 4 allowlist and commit with `feat(bootstrap): report route-level coverage`.

---

### Task 5: Add named initialization as a reversible preparation transaction

**Files:**
- Create: `src/bootstrap/initialize.ts`
- Create: `src/bootstrap/workload-registration.ts`
- Create: `src/bootstrap/profile-drafts.ts`
- Create: `src/bootstrap/install.ts`
- Modify: `src/init.ts`
- Modify: `src/wrap.ts`
- Modify: `src/cli.ts`
- Create: `test/bootstrap-initialize.test.ts`
- Create: `test/bootstrap-install.test.ts`
- Modify: `test/init-cli.test.ts`
- Modify: `test/init-signing-cli.test.ts`
- Modify: `test/wrap.test.ts`
- Modify: `test/cli-entrypoint.test.ts`

**Interfaces:**
- Consumes: unchanged `initializeInspection`, route discovery, bootstrap contract parsers, `planInstall`/`applyInstall`, installed pack registry, and read-only governance references resolved from the fixed operator-owned trust directory.
- Produces: `initializeAgentProject(options): Promise<BootstrapReportV1>` and CLI behavior for `reelier init <agent-name>`.

- [ ] **Step 1: Pin backward compatibility before adding named mode**

Add tests that snapshot bare `init` output and file set, prove positional `my-agent` currently has no meaning, and require named mode to use a separate `.reelier/bootstrap/` directory. Keep `init --signing` unchanged. In a clean directory with no global Reelier executable, run the named initializer fixture and assert it prints and persists exactly `npx reelier@<exact-version> up`. Task 5 tests only command construction and persistence because `up` does not exist yet. `reelier up` is documented only as shorthand when the exact version is already installed; the real clean-installed command is executed from the packed artifact in Task 7.

- [ ] **Step 2: Prove maker/checker separation behaviorally**

The RED suite must assert:

```ts
const report = await initializeAgentProject(fixtureOptions({ yes: true }));
assert.equal(report.actions.profileDrafted, true);
assert.equal(report.actions.profileCertified, false);
assert.equal(report.actions.authorityActivated, false);
assert.equal(report.pathC, "unavailable-no-activation");
await assert.rejects(() => dispatchFromBootstrap(report), /validated profile activation required/);
```

Generate the workload key through the existing signing primitives in a project-scoped subdirectory of the user's private Reelier home, never in the repository. Prove the private key and its filesystem path appear in no project artifact, log, report, process argument, or environment snapshot; only the public-key commitment appears in the unsigned registration request. Prove the generated key is never inserted into trust roots and cannot verify conformance or activation. Record the existing Windows ACL limitation honestly rather than claiming POSIX mode bits provide Windows isolation.

Add crash cuts after every checkpoint, concurrent initializer lock contention, stale-lock recovery, configuration-write rollback, malicious project-relative traversal, symlink/junction parent and child substitution, case-colliding agent names, and partial imported-governance files. Restart must resume the exact plan without regenerating the workload key or upgrading a prior finding.

Run `npx tsc -p tsconfig.test.json`; expect the named-bootstrap module/API assertions to fail while the legacy init assertions stay green. Commit the RED tests with the Task 5 subject before implementation.

- [ ] **Step 3: Implement the durable preparation phases**

Use a new closed ordered checkpoint list under `.reelier/bootstrap/`:

```ts
export const BOOTSTRAP_CHECKPOINT_IDS = Object.freeze([
  "inspection-link",
  "runtime-descriptor",
  "route-coverage",
  "workload-registration-request",
  "profile-drafts",
  "imported-governance",
  "configuration-plan",
  "installation-canary",
  "project",
  "report",
] as const);
```

Reuse the durable atomic/checkpoint/lock pattern from initialization, but keep a separate plan digest. Imported governance is verified using externally configured profile roots; initialization never creates those roots.

The `imported-governance` checkpoint stores only `governanceRef`, manifest digest, trust-head digest, and verification status. It never copies trust pins or public-key files into the project. If no operator-installed governance exists, record `absent` and continue observation-ready.

- [ ] **Step 4: Add exact-version proxy planning**

Do not rewrite legacy installed entries. For named bootstrap only, generate:

```ts
{ command: "npx", args: ["-y", `reelier@${exactVersion}`, "mcp", "--wrap", wrapCommand] }
```

Plan all changes first, display each wrapped/unwrapped/unwrappable surface, require explicit consent, use existing backup/atomic replacement behavior, and record partial success honestly. `--yes` can select this mechanical branch only.

- [ ] **Step 5: Add the CLI branch and parser corrections**

In `cmdInit`, route exactly one positional agent name to `initializeAgentProject`; reject more than one. Bare positional absence continues to call `initializeInspection`. Named initialization prints the managed-Cell connection command when no activation is local. That documented command is currently unusable because the root parser drops its values, so add only the connection values consumed by the existing connection contract (`--endpoint`, `--token-ref`, `--cell-id`, `--adapter-contract-digest`) with a focused regression test. Do not describe `--trust-pin` as a connection option; profile trust is loaded separately from the fixed operator-owned governance directory.

- [ ] **Step 6: Run tests and commit**

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/bootstrap-initialize.test.js dist-test/test/bootstrap-install.test.js dist-test/test/init-cli.test.js dist-test/test/init-signing-cli.test.js dist-test/test/wrap.test.js dist-test/test/cli-entrypoint.test.js dist-test/test/authority/authority-cell-connection.test.js
npm run check:authority-contract
npm run check:outcome-profile-contract
npm run check:bootstrap-contract
git diff --check
```

Expected: bare init remains green, named mode prints and persists the exact pinned command without executing it, and named mode produces no activated authority. Stage only the Task 5 allowlist and commit with `feat(cli): prepare an agent with one init command`.

---

### Task 6: Implement the pinned runtime-neutral `up` supervisor

**Files:**
- Create: `src/runtime/adapters.ts`
- Create: `src/runtime/supervisor.ts`
- Create: `src/up.ts`
- Create: `src/authority/client/outcomes.ts`
- Modify: `src/authority/client/http.ts`
- Modify: `src/authority/host/governed-cell.ts`
- Modify: `src/authority/ingress/http.ts`
- Modify: `src/authority/host/server.ts`
- Modify: `src/cli.ts`
- Create: `test/runtime-supervisor.test.ts`
- Create: `test/up-cli.test.ts`
- Create: `test/runtime-eve.test.ts`
- Create: `test/runtime-external.test.ts`
- Modify: `test/authority/authority-client.test.ts`
- Modify: `test/authority/http.test.ts`
- Modify: `test/authority/host-server.test.ts`
- Modify: `test/authority/authority-cell-connection.test.ts`
- Modify: `test/authority/authority-serve.test.ts`

**Interfaces:**
- Consumes: `AgentProjectV1`, `RuntimeDescriptorV1`, cold-loaded host-only `AdmittedProfileGovernanceV1 | null`, existing Authority Cell client/server, `ContinuityRuntimeAdapterV1`, and freshly observed route coverage.
- Produces: `AuthorityCellSessionBindingV1`, a remote `OutcomeRequesterV1`/`OutcomeStatusRequesterV1`, `RuntimeAdapterV1`, `createSupervisor`, `runAgentProject`, `cmdUp`, and closed `SupervisorStatusV1`.

- [ ] **Step 1: Write the no-spawn-before-validation tests**

For each mutation—Reelier version, package digest, Authority/Continuity/Profile/Bootstrap contract digest, adapter version/digest, route coverage digest, project extra key, runtime shell string, profile/activation/trust substitution—assert the spawn fake records zero calls.

Add a managed-Cell matrix that independently mutates cell ID, Authority/adapter contract digests, tenant, principal, task, runtime session, job/Job Card, grant ID/digest, allocation ID, profile, activation, trust-head, binding observation/freshness/expiry, and topology-evidence digest/freshness. Include an expired principal session, revoked bearer credential, stale binding, future observation, and binding lifetime wider than the authenticated session. Assert the Outcome requester is never exposed and provider/source/credential/reservation/send counters remain zero. Add request-body attempts to supply `tenant`, `requester`, `principalId`, `workloadId`, `runtimeSessionId`, `grantId`, `grantDigest`, `allocationId`, `profileDigest`, `accountId`, and `endpoint`; all refuse before the gate.

Construct the server through `createGovernedAuthorityCell` and assert its binding carries the exact private admission snapshot without exposing that snapshot elsewhere. The same endpoint on legacy `createAuthorityHostServer` without the governed provider must refuse/404, and no public `ProfileGovernanceVerificationV1` can populate it. This is the first test that asks the governed server to emit `AuthorityCellSessionBindingV1`; Task 2 tests only existing server routes.

Run `npx tsc -p tsconfig.test.json`; expect missing supervisor, remote requester, and session-binding APIs. Commit the RED tests with the Task 6 subject before implementation.

- [ ] **Step 2: Define the supervisor adapter**

```ts
export interface RuntimeAdapterV1 {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly adapterDigest: string;
  validate(descriptor: RuntimeDescriptorV1): Readonly<{ status: "accepted" | "refused"; reasonCode: string }>;
  detect(descriptor: RuntimeDescriptorV1): Promise<Readonly<{ status: "available" | "unavailable"; reasonCode: string }>>;
  start(input: Readonly<{ descriptor: RuntimeDescriptorV1; environment: Readonly<Record<string, string>> }>): Promise<OwnedRuntimeV1>;
  health(owned: OwnedRuntimeV1): Promise<Readonly<{ status: "healthy" | "unhealthy"; reasonCode: string }>>;
  stop(owned: OwnedRuntimeV1): Promise<void>;
}
```

`OwnedRuntimeV1` and `RuntimeAdapterRegistryV1` are opaque and stored in private `WeakMap`s. The supervisor selects an installed adapter from that registry, compares its ID/version/digest, and calls `validate` before reading environment or spawning. Each adapter owns the closed executable/argument grammar it accepts; a project descriptor cannot turn an adapter into a generic shell launcher. Local start uses `spawn(command, args, { shell: false, cwd, env: explicitAllowlist })`; it never inherits all of `process.env`. External adapters return status without a process handle.

- [ ] **Step 3: Implement ordered startup and shutdown**

Validate all artifacts, inspect or cold-reload profile governance from the fixed operator trust directory only when that local reference is configured, re-run route discovery, and downgrade stale rows before starting anything. With no governance/Cell configuration, start or attach only the observation-ready runtime and expose no Outcome requester. With a configured Cell, check connectivity and the current Authority/adapter contract digests; start or attach the runtime with the Outcome requester withheld, obtain `AuthenticatedWorkloadV1` from the installed conformance-checked Continuity adapter, fetch the bearer-authenticated `AuthorityCellSessionBindingV1`, and require exact cell/tenant/principal/task/runtime-session/job/Job-Card/grant/allocation/profile/activation/trust-head agreement. Require `bindingObservedAt <= now < bindingFreshUntil <= expiresAt`, agreement with the authenticated principal session's exact `grantId` and expiry, and a non-revoked credential. The grant ID/digest and allocation ID remain Cell-issued authority inputs carried into Continuity/evidence; neither the project nor request body may choose them. Only then attach the Outcome requester and report readiness. On any mismatch stop only owned children; an externally managed runtime remains unattached and refused.

Use `managed-cell` by default on Windows, macOS, and Linux. Permit `self-hosted-linux-cell` only as an explicit advanced reference to an already provisioned Cell; neither `init` nor `up` provisions, configures, or launches its Linux host. Legacy `authority serve` remains unchanged and is not the founder-facing launcher. Managed Cloud infrastructure and advanced self-hosted services call Task 2's public `createGovernedAuthorityCell`. In this task, modify that factory so it calls the internal `profileGovernanceAdmissionSnapshot(admitted)` while the opaque handle is still in scope and passes only the resulting detached profile/activation/manifest/trust-head digests into the new server session-binding provider. The server endpoint cannot accept governance fields from HTTP input or reconstruct them from a public verification result. Task 6 adds the sanitized binding endpoint/client but no alternate admission path. When a Cell claims enforced coverage, return the current signed topology artifact alongside the session binding; the client runs the existing topology verifier, checks its digest and `freshUntil`, and otherwise downgrades enforcement. Implement the client requester over the existing pinned-DNS/total-deadline/token-reference machinery. The definition alias is selected by the host-loaded signed job/profile and is passed separately to `POST /v1/outcomes/<alias>`; the `OutcomeRequest` body cannot select it. Status uses the matching authenticated GET path. Do not call authority init/bootstrap/sign/certify/connect/deploy, do not start MCP stdio servers, and do not run Path B skills.

Shutdown exact owned children in reverse order on SIGINT/SIGTERM. Externally managed processes are never signaled. Repeated `up` must either attach to the same healthy owned state or refuse an active lock; it must not duplicate children.

- [ ] **Step 4: Implement honest lane status**

The compact output is derived from route rows and must include:

```text
Observed routes=<n> partial=<n> uncovered=<n> unknown=<n>
Replay  available=<n> candidates=<n> (manual only)
Outcomes activated=<n> unavailable=<n> enforced=<n>
Runtime local-process|externally-managed
Completeness not-proved
```

The default first line is `Observed`, not `Path A`; the literal `Path A/B/C` labels are reserved for `--verbose` diagnostics. Counts come only from the just-refreshed route rows. If rediscovery fails, current rows become `unknown`; `up` never presents the initialization baseline as fresh.

No activated profile means Path C host is not started and Outcome invocation returns a deterministic pre-dispatch refusal.

- [ ] **Step 5: Add CLI dispatch/help and run focused tests**

Add `case "up"`, help copy, and tests for signal forwarding, child exit, startup rollback, Windows never self-hosting the Cell, managed-Cell default selection on every platform, external runtime honesty, exact version recovery command, and no automatic replay/resend. `runtime-eve.test.ts` consumes the already pinned Eve conformance candidate as one local durable positive case. `runtime-external.test.ts` uses a provider-neutral externally managed candidate shaped like Grok/Cursor without naming private APIs; both must pass the same runtime/Continuity contracts and neither may add harness-specific trust rules.

Run:

```powershell
npx tsc -p tsconfig.test.json
node --test --test-concurrency=1 dist-test/test/runtime-supervisor.test.js dist-test/test/runtime-manifest.test.js dist-test/test/up-cli.test.js dist-test/test/runtime-eve.test.js dist-test/test/runtime-external.test.js dist-test/test/authority/authority-client.test.js dist-test/test/authority/http.test.js dist-test/test/authority/host-server.test.js dist-test/test/authority/authority-cell-connection.test.js dist-test/test/authority/authority-serve.test.js
npm run check:authority-contract
npm run check:outcome-profile-contract
npm run check:bootstrap-contract
npm run check:agent-adapter
npm run check:continuity-adapter
git diff --check
```

Expected: all focused tests and contracts pass, with platform skips reported exactly. Stage only the Task 6 allowlist and commit with `feat(cli): supervise pinned agent runtimes`.

---

### Task 7: Prove the complete A/B/C tracer bullet and restart behavior

**Files:**
- Create: `conformance/bootstrap/v1/README.md`
- Create: `conformance/bootstrap/v1/candidate.schema.json`
- Create: `conformance/bootstrap/v1/report.schema.json`
- Create: `conformance/bootstrap/v1/check.mjs`
- Create: `conformance/bootstrap/v1/fixtures/core-candidate.mjs`
- Create: `test/bootstrap-conformance.test.ts`
- Create: `test/one-command-agent-journey.test.ts`
- Create: `test/packed/one-command-agent.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: the public bootstrap, profile-governance, Authority, Continuity, agent-adapter, and continuity-adapter contracts.
- Produces: `checkBootstrapCandidate`, `npm run check:bootstrap`, and a packed offline journey.

- [ ] **Step 1: Write the failing black-box conformance assertions**

The candidate checker must run only public APIs and require:

- bare init remains inspection-only;
- named init produces drafts but no activation;
- init-generated signing material cannot verify certification/activation;
- unknown Path A write remains unchecked;
- Path B manifest drift refuses before dispatch;
- unactivated Path C refuses with zero source/credential/reservation/send/provider counters;
- activated hermetic GitHub-label Outcome crosses send-started once, reconciles exact provider state, and emits a valid profile-governed receipt;
- crash after provider apply plus restart performs zero second provider writes and preserves `reconcile-before-retry`;
- two concurrent equal semantic requests converge on one reservation/effect while distinct attempts remain separately observable;
- revocation before reservation refuses with zero sends, revocation after durable send-started preserves ambiguity and reconciles without resend;
- provider partial completion remains partial/ambiguous until authoritative state proves the exact projection;
- reconciliation unavailable or conflicting never becomes acknowledged, exact, complete, or safe-to-retry;
- direct HTTP/plugin/browser bypass rows prevent enforced completeness;
- externally managed runtime is never reported as locally owned.

Run `npx tsc -p tsconfig.test.json` followed by the new black-box test; expect missing bootstrap checker/package APIs. Commit the RED tests and fixtures with the Task 7 subject before implementing the checker.

- [ ] **Step 2: Implement the closed checker and mutation corpus**

Add mutations for automatic activation, self-certification, evidence upgrade, missing bypass, floating version, shell launch, identity from request, concurrent budget amplification, post-start revocation loss, partial-as-complete, reconciliation-failure-as-acknowledged, duplicate send, replay-on-up, fabricated topology, receipt wrapper mutation, and canary-as-certification. Every mutation must fail a named check.

- [ ] **Step 3: Add the clean packed consumer**

`test/packed/one-command-agent.mjs` must pack the current repository, install the exact `.tgz` into a temporary clean consumer, run named init with fixture-only adapters, import externally prepared profile governance, invoke `up` in bounded `--once` fixture mode, verify the receipt offline, and print only:

```text
bootstrap=verified
providerWrites=1
reconciliation=matched
completeness=not-proved
```

It must use no network, live provider, credential, deployment, or workflow.

The packed test must capture the exact recovery command printed by named init and assert it equals `npx reelier@<packed-version> up`. With no global Reelier executable, the temporary consumer installs only the exact packed tarball, sets npm to offline mode, and launches that exact captured command plus the bounded fixture option. It must not substitute `node dist/...`, a repository checkout, an unversioned binary, or a synthetic package. This is the first task that executes the real clean-installed command; Task 5 only pins its construction.

From the same installed tarball, import `reelier/authority/host` and require `createGovernedAuthorityCell` while refusing any loader, admission handle constructor/assertion, or private deep subpath. The packed fixture may exercise the factory only under the existing Linux host test boundary; Windows proves typed pre-access refusal and uses the remote client path.

- [ ] **Step 4: Run the cross-path gate and commit**

Run:

```powershell
npx tsc -p tsconfig.test.json
npm run build
npm run check:authority-contract
npm run check:outcome-profile-contract
npm run check:bootstrap-contract
npm run check:agent-adapter
npm run check:continuity-adapter
npm run check:bootstrap
node --test --test-concurrency=1 dist-test/test/bootstrap-conformance.test.js dist-test/test/one-command-agent-journey.test.js
node test/packed/one-command-agent.mjs
git diff --check
```

Commit with `test(bootstrap): prove one-command governed agency`.

---

### Task 8: Document migration, non-claims, and release evidence

**Files:**
- Create: `docs/guides/one-command-agent.md`
- Create: `docs/release/one-command-agent-baseline.md`
- Modify: `README.md`
- Modify: `SPEC.md`
- Modify: `AGENTS.md`
- Create: `test/one-command-docs.test.ts`
- Create: `.superpowers/sdd/2026-08-14-one-command-agent-bootstrap/task-8-report.md` (ignored/private progress artifact)

**Interfaces:**
- Consumes: accepted Tasks 1–7 commits and exact test artifacts.
- Produces: copy-paste onboarding, explicit advanced-command mapping, truthful coverage language, and a release baseline with exact commit/digests.

- [ ] **Step 1: Add documentation falsifier tests**

Static tests must reject documentation that says or implies: all tools covered, all traffic intercepted, verified means safe/correct, init activates authority, canary certifies profiles/topology, Windows hosts a Cell, Path B runs automatically, ambiguity retries, or externally managed means locally controlled.

Run `npx tsc -p tsconfig.test.json` and the emitted documentation test; expect missing guide/baseline assertions. Commit the RED documentation test with the Task 8 subject before writing user-facing docs.

- [ ] **Step 2: Write the user guide around the two commands**

The guide starts with:

```powershell
npx reelier@latest init my-agent
npx reelier@<printed-pinned-version> up
```

Explain that first bootstrap may fetch latest, while every subsequent run is pinned. Show observation-ready behavior with no activation, the separate operator activation ceremony, per-route coverage output, external runtime behavior, rollback/uninstall, and the advanced A/B/C commands without requiring users to learn path names.

- [ ] **Step 3: Record exact release evidence**

The baseline records public commit, package/tarball digest, Authority/Continuity/Profile/Bootstrap contract digests, conformance checker identities, focused/packed counts, supported platforms, and explicit non-claims. Do not claim hosted, provider, topology, or live credential evidence unless separately run and retained.

- [ ] **Step 4: Run final gates and request independent batch review**

Run:

```powershell
npx tsc -p tsconfig.test.json
npm run build
npm run check:authority-contract
npm run check:outcome-profile-contract
npm run check:bootstrap-contract
npm run check:agent-adapter
npm run check:continuity-adapter
npm run check:bootstrap
node --test --test-concurrency=1 dist-test/test/one-command-docs.test.js dist-test/test/bootstrap-conformance.test.js dist-test/test/one-command-agent-journey.test.js dist-test/test/authority/outcome-profile.test.js dist-test/test/authority/profile-governance.test.js dist-test/test/authority/profile-governed-receipt.test.js dist-test/test/continuity/conformance-runner.test.js dist-test/test/continuity/kill-resume.test.js
node test/packed/one-command-agent.mjs
git diff --check
npm test
```

Attempt the full suite exactly once. If native Windows host gates prevent green, report the exact failures and run the bounded Linux matrix recorded by the accepted Continuity branch. Never translate a skip or timeout into a pass.

Commit docs with `docs: explain one-command governed agency`.

Then dispatch a fresh read-only batch reviewer over the exact implementation range. The reviewer must re-run these falsifiers:

1. `init` key/draft/canary self-trust.
2. Certifier/operator purpose and key substitution.
3. Automatic activation through `--yes` or `up`.
4. Unknown/plugin/direct/browser completeness upgrade.
5. Runtime/package/contract/profile pin substitution before spawn.
6. Identity supplied in model/request fields.
7. Restart after send-started causing a second effect or budget consumption.
8. Inner receipt claim upgraded by the outer profile wrapper.
9. Windows local Cell hosting or external-process ownership misstatement.
10. Bare-init, Path A/B/C, Continuity, candidate, live-runner, and Gate 4 regressions.

The batch verdict must be `SHIP` before merge, push, release, workflow dispatch, live provider test, or external installation.
