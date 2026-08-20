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
