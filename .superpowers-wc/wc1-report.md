# Property-based tests over canonical-json digest + Ed25519 signing

## Files changed
- `test/canonical-json.property.test.ts` (new)
- `test/signing.property.test.ts` (new)

No `src/` files touched. `src/signing.ts` and `test/signing.test.ts` (owned by the parallel task) were not edited.

## Invariants covered

### canonical-json.property.test.ts (5 properties)
1. **Determinism** — `canonicalJson(x) === canonicalJson(x)` over `fc.anything()`-style recursive JSON values (custom `jsonValueArb`, depth 3).
2. **Key-order independence → same digest** — a `unicodeKeyObjectArb` (unicode/emoji/space/empty keys included) is deep-shuffled (reversed key-insertion order, recursively into nested objects/arrays — arrays keep element order since order is meaningful there) and asserted to produce identical `canonicalJson` and `digestSha256`.
3. **Digest format** — `digestSha256(x)` always matches `/^sha256:[0-9a-f]{64}$/`.
4. **Idempotent re-canonicalization** — using `fc.jsonValue()` (guaranteed JSON-round-trippable), `canonicalJson(JSON.parse(canonicalJson(x))) === canonicalJson(x)`.
5. **Distinct canonical form → distinct digest** — for a generated pair `(a, b)`, filtered with `fc.pre(canonicalJson(a) !== canonicalJson(b))`, asserts `digestSha256(a) !== digestSha256(b)` (no accidental collisions in the sha256 digest over the sample space fast-check explores).

### signing.property.test.ts (4 properties)
Setup: one Ed25519 keypair (A) generated once in a temp dir via `before()`, a second keypair (B) in a second temp dir for the wrong-key case; both temp dirs cleaned up in `after()`. No keygen inside any property — only sign/verify runs per case, keeping the suite fast (~20-30ms per property despite thousands of generated payloads via `fc.jsonValue()`).
1. **Round-trip** — for arbitrary JSON payloads, `verifyRecordSignature(publicPemA, digestSha256(payload), signRecordDigest(privateKeyA, digest))` is always `true`.
2. **Digest tamper → reject** — for two payloads with differing digests (`fc.pre(d1 !== d2)`), a signature made over `d1` never verifies against `d2`.
3. **Wrong key → reject** — a signature made with keypair A's private key never verifies against keypair B's public PEM.
4. **Signature tamper → reject, never throws** — flips one base64 character of the signature (mapped to a guaranteed-different char) and asserts `verifyRecordSignature` returns `false` and does not throw.

## Interesting fast-check finding (real, not a false alarm)

The signature-tamper property initially failed intermittently with counterexample `[[], <large nat>]`. Root cause: Ed25519 signatures are 64 bytes → base64 with a 1-byte leftover group, encoded as 2 meaningful base64 chars + `==` padding. That group carries 12 encodable bits for only 8 meaningful bits, so the low 4 bits of the *last non-padding character* are "don't-care" — a flip landing entirely inside those unused bits changes the **string** but decodes to the **identical signature bytes**, so `verifyRecordSignature` correctly still returns `true`. This was a bug in my test's tamper guard (it compared strings, not decoded bytes), not in `signing.ts`. Fixed by filtering with `fc.pre(!Buffer.from(tampered,"base64").equals(Buffer.from(sig,"base64")))` instead of a string-inequality guard. Confirmed green across 3 consecutive full-suite runs after the fix.

## Sanity check (deliberately broken invariant)
Temporarily inverted the wrong-key assertion (`=== true` instead of `=== false`) and reran — fast-check immediately found and reported a counterexample (`Property failed after 74 tests`, shrunk to `[{}, 2147483623]`), confirming the properties assert real invariants, not tautologies. Reverted before final run.

## Test results (verbatim tail, final run)
```
ℹ tests 708
ℹ suites 0
ℹ pass 708
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
Baseline was 699 (per brief); +9 new property tests (5 canonical-json + 4 signing) = 708. Confirmed stable across 3 consecutive `npm test` runs.

## Concerns / open items
- None outstanding. No `src/` edits. `signing.ts` / `signing.test.ts` untouched (verified via `git status` / `git diff --stat -- src/`).
- Property test runtimes are small (~20-30ms each for the signing suite, since keygen is hoisted out of the property loop); overall suite stayed well within the existing ~16s total.
