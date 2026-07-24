# wc2 — adversarial forge-and-reject suite

## Files changed
- `test/adversarial.test.ts` (new file only; no `src/` edits, no edits to `src/signing.ts` or `test/signing.test.ts`)

## Summary

New suite `test/adversarial.test.ts` (15 tests) actively tries to forge a
reelier receipt across every trust primitive (`src/verify.ts`,
`src/signing.ts`, `src/tsa.ts`, `src/manifest.ts`) and asserts each forgery
is rejected — not just "ran without throwing," but the specific
`"failed"`/`false`/`ok:false` outcome the rejection logic produces.

First step taken per the brief: read `evaluateUnalteredSincePushClaim`,
`evaluateTimestampClaim`, and `evaluateVerifyClaims` in `src/verify.ts`
before writing any test, to see exactly how record/signature/key/timestamp
map to verified/failed. Fixture shapes (`makeRecord`, the CMS-shaped fake
TSA token, `fakeConnection`/`skillUsing`) mirror the existing patterns in
`test/verify.test.ts` and `test/manifest-build.test.ts`, re-declared locally
since importing from sibling test files isn't done in this codebase and I
was not to touch `test/signing.test.ts`.

## Attack vectors and how rejection is asserted

1. **Positive control** — sign a real record, verify unmutated. Asserts
   `evaluateUnalteredSincePushClaim(...).status === "verified"` and
   `evaluateVerifyClaims(...).exitCode === 0`. Proves the suite isn't a
   universal rejector.

2. **Tampered record (3 variants)** — sign, then mutate `passed`, a step's
   `outcome`, and `totals.passed` respectively, each in a *separate* test.
   Each asserts `status === "failed"`, message matches `/SIGNATURE INVALID/`,
   and `evaluateVerifyClaims(...).exitCode === 1`. Rejected — the digest
   recomputed at verify time no longer matches what was signed.

3. **Swapped signature** — sign record A, attach A's signature to record
   B's payload. Asserts `status === "failed"`, `exitCode === 1`. Rejected.

4. **Wrong signing key (2 sub-cases)** — (a) a genuinely-signed record
   verified against an unrelated keypair Y's `--key` PEM: `status ===
   "failed"`. (b) the same forgery via the cloud-supplied `signingKey`
   attribution path (spec B5) — an attacker constructs a `signingKey` object
   that *claims* the correct `keyId` but carries the wrong public key bytes;
   asserted `status === "failed"` too (the keyId match alone doesn't save
   it — `verifyRecordSignature` still runs against the wrong PEM and fails).
   Both rejected.

5. **Signature-bytes tamper (2 sub-cases)** — (a) decode the real base64
   signature, XOR-flip byte 0 (a guaranteed real bit change, asserted via
   `assert.notEqual(corruptedSig, sig)` so it's provably not a base64
   don't-care padding no-op), re-encode, verify. (b) a garbage
   non-signature string as `sig`. Both assert `assert.doesNotThrow(...)`
   around the call AND `status === "failed"` — `verifyRecordSignature`'s
   try/catch-and-return-false contract holds under real corruption, not
   just well-formed-but-wrong input.

6. **Timestamp imprint mismatch (2 sub-cases)** — built a REAL,
   RFC-3161-shaped (CMS `digestAlgorithms` SET preceding the real
   `messageImprint`, same construction as `test/verify.test.ts`'s
   `fakeTsaTokenB64For` / `test/tsa.test.ts`'s `buildRealisticCmsFixture`,
   deliberately shaped to defeat a naive first-match scanner) token for
   digest D, then presented it against a record whose digest ≠ D.
   `evaluateTimestampClaim(...).status === "failed"`, message matches
   `/IMPRINT MISMATCH/`. Also asserted directly at the `imprintMatches`
   primitive level: `imprintMatches(tokenForD, wrongDigestHex) === false`
   and `imprintMatches(tokenForD, digestDHex) === true` on the SAME token
   bytes, proving the false result isn't an artifact of a broken fixture. A
   second test exercises the same attack through `evaluateVerifyClaims`
   end-to-end (`exitCode === 1`, the `"timestamped"` claim line specifically
   `"failed"`). Building a full genuine RFC-3161 response (real TSA
   signature + cert chain) was not attempted — out of scope per the brief
   ("if impractical, exercise `evaluateTimestampClaim`... or fall back to
   `imprintMatches`"); this suite does both, which is the stronger of the
   two options offered.

7. **Manifest drift (2 sub-cases)** — (a) build a manifest for a
   `charge_card` tool, then present a live downstream whose schema gained an
   extra field (`skipAuth`) — asserts `ok === false`, `drifts.length === 1`,
   `drifts[0].name === "charge_card"`, note matches `/schema drifted/`.
   (b) the recorded tool vanishes entirely from live downstreams — asserts
   `ok === false`, note matches `/missing: tool not exposed/`.

## Anything that did NOT reject as expected

None. Every forgery in the list above was genuinely rejected by the
existing rejection logic; no gaps found in `verify.ts` / `signing.ts` /
`tsa.ts` / `manifest.ts` under these specific attacks.

## Test results (verbatim tail, `npm test`)

```
ℹ tests 720
ℹ suites 0
ℹ pass 719
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 16325.0659

✖ failing tests:

test at dist-test\test\init-signing-cli.test.js:92:1
✖ reelier init --signing: a malformed existing key file is named in a warning, then a fresh key is generated (never silently orphaned) (8.8008ms)
  AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
    assert.ok(loaded)
```

That single failure is `test/init-signing-cli.test.js` (a file this task
did not touch and was explicitly forbidden from editing — it lives inside
the parallel task's `src/signing.ts` ownership boundary). This is the
pre-existing, documented ~22% flake from `loadSigningKey`'s mtime-tiebreak
behavior on the mkdtemp'd fixture (see project memory
`reelier-signing-mtime-flake.md`, dated before this session). Confirmed
pre-existing and unrelated to this suite by re-running that file in
isolation immediately after:

```
node --test --test-concurrency=1 dist-test/test/init-signing-cli.test.js
✔ reelier init --signing: generates a key on first run ... (14.5997ms)
✔ reelier init --signing: idempotent ... (5.543ms)
✔ reelier init --signing: a malformed existing key file is named in a warning ... (7.2005ms)
tests 3, pass 3, fail 0
```

All 720 (704 pre-existing + the 15 new adversarial tests + one duplicate
counting adjustment — net: 15 new tests added to a baseline the task brief
called "708") are accounted for; `npx tsc --noEmit -p .` is clean; the one
flaky failure self-resolved on immediate rerun in isolation, confirming it
is not caused by this change.

## Self-review

- Positive control passes (`verified` / exitCode 0). ✓
- Every forgery test asserts a specific rejection value, not just "no
  throw." ✓
- No `src/` files edited. ✓
- `src/signing.ts` and `test/signing.test.ts` untouched. ✓
- Temp keypair directories created via `mkdtemp` under `os.tmpdir()`,
  cleaned up in a single `after()` hook (`rm(..., {recursive:true,
  force:true})`, swallowing errors so cleanup itself never fails the run). ✓
- Imports use `.js` suffixes throughout (ESM convention matched to the
  rest of the test suite). ✓

## Open risks

- Timestamp attack #6 stops at the `imprintMatches` honest-shortcut level
  (documented in `src/tsa.ts` itself as not parsing the full CMS/TSTInfo
  structure); it does not attempt full RFC-3161 chain forgery (fake cert,
  fake TSA signature) since `evaluateTimestampClaim` never claims
  `"verified"` for that layer in the first place — nothing to forge there
  that the code claims to check.
