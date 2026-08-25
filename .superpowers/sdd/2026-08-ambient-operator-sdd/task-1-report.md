Files changed

- `src/authority/ambient-authority.ts`
- `src/authority/index.ts`
- `test/ambient-authority.test.ts`
- `.superpowers/sdd/2026-08-ambient-operator-sdd/task-1-report.md`

What changed per file

- `src/authority/ambient-authority.ts`: adds closed, canonical OSS parsers and a verifier for trust-domain descriptors, customer approval proofs, standing and hosted authority envelopes, and mission child grants. The verifier binds JCS digests, tenant, trust domain, RP ID/origin, nonce, validity windows, connector/account, limits, and revocation generation. It verifies WebAuthn ES256 and EdDSA assertions, requires user presence, validates the RP ID hash and client-data challenge/origin, enforces strict attenuation and the 12-hour mission cap, and consumes approval nonces through an explicit replay protector. Hosted envelopes require a customer-proof digest, so KMS/hosted issuance alone cannot establish authority.
- `src/authority/index.ts`: exports the new public OSS contract types, parsers, replay protector, and verifier from the `reelier/authority` entrypoint.
- `test/ambient-authority.test.ts`: adds focused ES256 and EdDSA WebAuthn positive cases plus replay, cross-tenant, origin, expiry/tamper, and child-limit-widening refusal coverage.
- `.superpowers/sdd/2026-08-ambient-operator-sdd/task-1-report.md`: this completion report.

Design decisions

- The proof challenge is the base64url form of the UTF-8 canonical authority digest. This keeps the customer signature directly bound to the same JCS digest vocabulary used by the existing authority contracts.
- Replay protection is injected as a required verifier dependency, keeping durable replay storage an integration concern and preventing a stateless verifier from silently accepting a replay.
- This task adds no Cloud routes, hosted issuance API, KMS call site, credentials, or connector implementation; it only supplies the portable OSS authority boundary requested for Task 1.

Deviations from the plan

- The high-level task brief mentions matching Cloud ceremony and issuance APIs. Per the assigned OSS-only scope, those are intentionally not implemented here.

Test results (verbatim tail)

Command: `npx tsc -p tsconfig.json --noEmit`

Result: exit 0 (no output).

Command: `npm run check:authority-contract`

```text
> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

Result: exit 0.

Command: `npx tsc -p tsconfig.test.json --noEmit; node --test --test-concurrency=1 dist-test/test/ambient-authority.test.js`

```text
✔ customer-rooted authority verifies a WebAuthn approval once and binds all envelopes (5.6618ms)
✔ customer-rooted authority accepts the WebAuthn EdDSA profile (1.0755ms)
✔ authority rejects tenant aliasing, expiry, and any child widening (1.2337ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 161.4441
```

Command: `npm test`

```text
ℹ tests 4
ℹ suites 0
ℹ pass 1
ℹ fail 3
✖ authority runtime authenticates host identity, dispatches once, and returns durable status
✖ authority runtime does not trust identity fields from the request body
✖ shadow runtime returns a report-only lifecycle and never an accepted receipt
Error [AuthorityCellLinuxRequiredError]: Authority Cell hosting requires Linux. Windows is supported as a client; run the Cell through WSL, a Linux container, or a remote Linux Authority Cell.
```

Result: exit 1. The failures are existing Windows host-runtime tests outside this task; the new focused authority contract tests pass.

Open risks

- The in-memory replay protector is suitable for OSS callers and tests, but production Cloud must provide atomic durable nonce consumption before accepting an approval.
- The task does not define attestation/counter semantics, backup credential lifecycle, or Cloud enrollment ceremony persistence; those remain Cloud implementation responsibilities.
- The full repository suite is not green on this Windows worktree because three Authority Cell host-runtime tests require Linux. No unrelated runtime/platform files were changed to alter that behavior.

## Fix round 1

Files changed

- `src/authority/ambient-authority.ts`
- `src/authority/index.ts`
- `test/ambient-authority.test.ts`
- `.superpowers/sdd/2026-08-ambient-operator-sdd/task-1-report.md`

What changed

- Added a required tenant/trust-domain-qualified trusted customer credential resolver. Verification now compares both the credential ID and exact JCS public-key JWK material from the resolver before accepting the WebAuthn signature; a caller-provided key cannot establish authority.
- Added closed `CustomerAuthorityPayloadV1` with the sole accepted purpose `ambient-operator`. The proof carries that payload and its digest; parsing and verification recompute the JCS digest, bind the payload tenant/connector to the proof, and reject purpose substitution or unknown/KMS-only purposes.
- Made every envelope/grant attenuation boundary strict: each child has a strictly shorter window and strictly interior validity range. Equal limits, equal windows, and equality at a validity endpoint now refuse.
- Standing and hosted envelopes are deliberately customer-rooted envelopes, not mission child grants. Their validity is closed by strict containment in both the customer proof and trust-domain window; the 12-hour cap applies to the mission child grant as required by the global constraint. Focused tests exercise an allowed bounded standing/hosted chain and a mission duration over 12 hours.
- Reworked expiry coverage to build a fully digest-linked expired proof/envelope/mission chain, so the refusal reaches the expiry gate rather than failing earlier on a stale digest.

Test results (verbatim tail)

Command: `npx tsc -p tsconfig.json --noEmit`

Result: exit 0 (no output).

Command: `npm run check:authority-contract`

```text
> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

Result: exit 0.

Command: `npx tsc -p tsconfig.test.json --noEmit; node --test --test-concurrency=1 dist-test/test/ambient-authority.test.js`

```text
✔ customer-rooted authority verifies trusted WebAuthn ES256 and EdDSA exactly once (7.9545ms)
✔ customer approval rejects attacker credentials and purpose substitution (1.2209ms)
✔ authority rejects cross-tenant aliasing, strict equality, and correctly bound expiry (3.0345ms)
✔ standing and hosted roots are bounded by proof/domain; only mission grants have a twelve-hour cap (1.8571ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 165.5329
```

Open risks

- The credential resolver contract is deliberately OSS-local. Cloud must implement it with atomic tenant/trust-domain credential lifecycle and revocation handling before using hosted issuance.

## Fix round 2

Files changed

- `src/authority/ambient-authority.ts`
- `test/ambient-authority.test.ts`
- `.superpowers/sdd/2026-08-ambient-operator-sdd/task-1-report.md`

What changed

- `strictLimits` now rejects equality as well as widening for `maxEffectsPerWindow`, `maxEffectsPerSourceTrigger`, and `maxBodyBytes`; `windowSeconds` was already strict. A child must reduce every constrained numeric field at each authority boundary.
- Added independent regression coverage for equality of each numeric limit and for mixed partial attenuation where multiple fields remain equal while others reduce.

Test results (verbatim tail)

Command: `npx tsc -p tsconfig.json --noEmit`

Result: exit 0 (no output).

Command: `npm run check:authority-contract`

```text
> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

Result: exit 0.

Command: `npx tsc -p tsconfig.test.json --noEmit; node --test --test-concurrency=1 dist-test/test/ambient-authority.test.js`

```text
✔ customer-rooted authority verifies trusted WebAuthn ES256 and EdDSA exactly once (8.2831ms)
✔ customer approval rejects attacker credentials and purpose substitution (1.1525ms)
✔ authority rejects cross-tenant aliasing, strict equality, and correctly bound expiry (2.4653ms)
✔ every constrained limit must strictly reduce at every child boundary (1.9242ms)
✔ standing and hosted roots are bounded by proof/domain; only mission grants have a twelve-hour cap (1.9227ms)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 167.2934
```

## Fix round 3

Files changed

- `test/ambient-authority.test.ts`
- `.superpowers/sdd/2026-08-ambient-operator-sdd/task-1-report.md`

What changed

- Added a deterministic rebind helper that rebuilds proof-to-standing, standing-to-hosted, and hosted-to-mission digest edges after each isolated test candidate change.
- Added digest-valid equality refusals for every constrained numeric field (`maxEffectsPerWindow`, `maxEffectsPerSourceTrigger`, `maxBodyBytes`, and `windowSeconds`) at all three child boundaries.
- Added digest-valid `validFrom` and `validUntil` equality refusals at all three child boundaries. Each candidate remains within all outer validity windows and non-expired, so the tests reach the strict attenuation gate rather than a clock or stale-digest gate.

Test results (verbatim tail)

Command: `npx tsc -p tsconfig.json --noEmit`

Result: exit 0 (no output).

Command: `npm run check:authority-contract`

```text
> reelier@0.32.1 check:authority-contract
> node scripts/build-authority-contract.mjs --check
```

Result: exit 0.

Command: `npx tsc -p tsconfig.test.json --noEmit; npx tsc -p tsconfig.test.json; node --test --test-concurrency=1 dist-test/test/ambient-authority.test.js`

```text
✔ customer-rooted authority verifies trusted WebAuthn ES256 and EdDSA exactly once (8.389ms)
✔ customer approval rejects attacker credentials and purpose substitution (1.5148ms)
✔ authority rejects cross-tenant aliasing, strict equality, and correctly bound expiry (2.1027ms)
✔ every constrained limit must strictly reduce at every child boundary (2.3187ms)
✔ every limit equality is refused at every independently rebound child boundary (5.2455ms)
✔ every validFrom and validUntil equality is refused at every independently rebound child boundary (2.947ms)
✔ standing and hosted roots are bounded by proof/domain; only mission grants have a twelve-hour cap (2.1586ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 175.9941
```
