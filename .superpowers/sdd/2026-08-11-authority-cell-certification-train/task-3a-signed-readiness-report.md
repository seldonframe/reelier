# Files changed

- `contract/authority/v1/authority-key-descriptor.schema.json`
- `contract/authority/v1/trust-event.schema.json`
- `contract/authority/v1/signed-certification-readiness.schema.json`
- `src/authority/certification/authority.ts`
- `src/authority/certification/export.ts`
- `src/authority/certification/readiness.ts`
- `src/authority/cli.ts`
- `src/authority/index.ts`
- `src/authority/types.ts`
- `src/cli.ts`
- `test/authority/certification-authority.test.ts`
- `test/authority/certify-cli.test.ts`
- `test/authority/package.test.ts`
- `.superpowers/sdd/2026-08-11-authority-cell-certification-train/task-3a-signed-readiness-report.md`

# What changed

- Added closed portable schemas for purpose-separated public-key descriptors, append-only trust lifecycle events, and signed certification readiness.
- Added an exact signer matrix: a human-sponsor descriptor can sign only `certification-readiness`; an Authority Cell descriptor carries exactly one later runtime purpose from `gate-event`, `authority-evidence`, `authority-receipt`, `topology-evidence`, or `authority-lease`.
- Added strict parsers and offline verification for descriptor closure, Ed25519 SPKI keys, trust-event sequence/hash-chain/time ordering, final activation state, signer purpose/role, readiness candidate digest, stable configuration root, selection digest, five generated identifiers, scenarios, activated Cell keys, and trust history.
- Enforced canonical Ed25519 signature encoding as exactly 64 decoded bytes in canonical padded Base64, in both the runtime parser and portable schema.
- Replaced separate shallow readiness readers with one internal deep candidate/preflight parser shared by signing, offline verification, and export. It recomputes the exact preflight digest and binds every sanitized resource, cleanup, credential-slot, runner, test, topology, identity, and selection commitment.
- Required distinct canonical SPKI key material across the human signer and every Authority Cell role/purpose, even when key IDs and descriptor digests differ.
- Added content-addressed signing of the existing Task2C2 readiness candidate using a pre-existing Ed25519 private key. The private key is read only after a mandatory review callback approves the exact loaded snapshot and is never persisted in the result.
- The file-signing path reruns live preflight immediately before review, displays the bound sanitized commitments, and reads the published authorization back to verify exact bytes, artifact digest, object identity, and absence of linked-file replacement. Identical publication remains idempotent; conflicting or linked replacement refuses.
- Added `authority certify sign-readiness`. It refuses non-TTY invocation, has no confirmation-bypass flag, prints the exact sanitized review summary, and requires the operator to type the full readiness digest. Its result remains `dispatchable:false` and does not alter any runtime dispatch barrier.
- Added the portable parsing and offline verification functions to the narrow `reelier/authority` export; signing and file-system helpers remain internal.
- Added schema packaging assertions and focused positive/negative tests for purpose confusion, role confusion, inactive/revoked/late-activated keys, malformed/ambiguous trust history, all required substitutions, wrong private key, noninteractive refusal, private-key redaction, and immutable Task2C2 candidate linkage.

# Deviations from plan

- Trust events are not independently signed. The complete ordered trust history digest is inside the human's purpose-bound readiness signature. This preserves the rule that the human key signs readiness authorization only while still making event substitution and reordering detectable offline.
- No Authority Cell private key is generated and no runtime barrier is changed. Task 3A activates only public descriptors for later tasks.

# Test results

Commands:

```text
npm run check:authority-contract
npm run build
npx tsc -p tsconfig.test.json --pretty false
node --test dist-test/test/authority/certification-authority.test.js dist-test/test/authority/certify-cli.test.js dist-test/test/authority/certification-readiness.test.js dist-test/test/authority/certification-export.test.js dist-test/test/authority/crypto.test.js dist-test/test/authority/package.test.js
```

Verbatim tail:

```text
✔ sign-readiness refuses noninteractive invocation and has no auto-sign path (0.2978ms)
✔ authority signatures are purpose-bound and refuse tampering (2.6603ms)
✔ frozen vectors carry deterministic Ed25519 signatures (2.223ms)
✔ standing-authority signatures bind sponsor, audience, target, projection, limits, and policy bytes (1.4152ms)
✔ public production export parses DecisionContext and its portable evidence against packaged schemas (289.4794ms)
ℹ tests 30
ℹ suites 0
ℹ pass 30
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1841.9628
```

# Open risks

- Signed readiness is intentionally not a signed Job Card, root task, grant, lease, topology proof, or dispatch authorization. Those remain later Task 3/5 gates.
- Portable Node filesystem checks can reject links and observed identity changes but cannot prove absence of hostile concurrent same-user mutation. Managed autonomy still requires the isolated Authority Cell topology.
- The successful interactive TTY ceremony is exercised through its exact file-signing/review function; automated CLI coverage verifies fail-closed noninteractive behavior because CI has no trusted human TTY.
- Revocation is final in this v1 trust history. Re-activation would require a new descriptor/key rather than reusing a revoked descriptor.
