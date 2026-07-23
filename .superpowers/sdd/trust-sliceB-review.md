# Trust Ladder Slice B — Standard Review

**Verdict: FIX REQUIRED** (one correctness/never-lies bug in B1 imprint verification; everything else ships).

Scope: commits c75eeee, f596403, 69cb841, dc719ee, 36b6e6b, 2030678, 0b9c0c5 on feat/trust-ladder.
Tests: `npm test` = **633 pass / 0 fail** (624 + the 9-test standalone file; matches implementer claim).

## Spec compliance
- MET: B1 DER writer scoped + documented; B2 header/body allowlists exact (requestIdentifier excluded) + refs threaded to StepRecord on reads AND L2 re-dispatch + redaction-wins wired + omitted-when-empty; B3 audience "reelier.com", Bearer header, no token logging, fail-open; B5 three branches + --key precedence + keyId-mismatch loud fail; docs word-split ("tamper-evident" only beside unaltered-since-push), Action snippet has `id-token: write`, CHANGELOG accurate, no version bump (stays 0.19.0).
- MISSING: none material.
- EXTRA: B5 adds a 4th "KEY MISMATCH" branch beyond the spec's 3 — correct and desirable.

## Blocking issues (ranked)
1. src/tsa.ts:198-209 — `imprintMatches` searches for the FIRST sha256-OID occurrence, but in a real RFC-3161/CMS `TimeStampResp` the `digestAlgorithms` SET (a sha256 AlgorithmIdentifier) precedes the eContent/messageImprint in DER byte order. The first OID is therefore digestAlgorithms, whose following bytes are NOT the 32-byte OCTET STRING → returns **false** on genuine tokens. Consequence: `reelier verify` grades the timestamp row `failed` and **exits 1 with "✗ IMPRINT MISMATCH" on an honestly-timestamped receipt** — a false tamper accusation (never-lies violation) on the feature's own happy path. Probe (realistic CMS layout with digestAlgorithms before the imprint) returns false; synthetic fixture returns true. The justifying comment (tsa.ts:176-185) is itself wrong — it reasons about certificates/signerInfos coming AFTER eContent but omits digestAlgorithms coming BEFORE. Fix: iterate ALL sha256-OID occurrences and accept the first whose (optional-NULL then) OCTET STRING(32) equals the expected digest (digestAlgorithms has no such octet string; messageImprint does; signerInfo.digestAlgorithm won't match the digest).
2. Reason #1 shipped green: both imprint fixtures — test/tsa.test.ts:63-69 (`fakeTsaResponseWithImprint`) and test/verify.test.ts:22-25 (`fakeTsaTokenB64For`) — wrap a bare MessageImprint/TimeStampReq TLV in a few junk bytes with NO surrounding CMS `digestAlgorithms`. They validate the parser against its own shortcut, so the imprint-match test **cannot fail** on the real structure it claims to model. Add a fixture with a leading sha256 AlgorithmIdentifier (or a captured real freetsa.org token) — it will fail until #1 is fixed.

## Non-blocking issues
- src/verify.ts:40 — `signingKey.verified`/`revoked` are declared on the type but never consulted in evaluateUnalteredSincePushClaim (confirmed not half-wired). Correct for OSS (revocation display is cloud/C's job) but they are dead fields; add a one-line "cloud-only, intentionally not consulted here" note or drop them.
- src/tools.ts:90 & src/mcp-tool.ts:44 — `redact(value)` is called with keyName undefined, so redact's HEX32-in-a-token-named-key rule can't apply to ref values; only sk-/Bearer/env-mask redaction runs. Fine (request-ids aren't secrets, and the env-mask/sk/Bearer paths still fire), but the "passes through redaction like everything else" claim is slightly narrower than the body path.
- src/push.ts:477 — computeSignature/computeTimestamp run OUTSIDE pushOneRecord's per-record try/catch. computeTimestamp is internally fail-open and detectCiOidc is fail-open, so the third-party paths are safe; a signRecordDigest throw (only possible on a corrupt already-validated key) would propagate rather than degrade to unsigned. Practically unreachable; note only.
- Multi-key signing (newest-by-mtime, no stderr note naming the signing keyId) deliberately deferred — documented in commit 0b9c0c5. OK.

## Fail-open audit (focus 1) — PASS
Every new third-party/throw path returns null + exactly one stderr line and never blocks the push: tsa.ts requestTimestamp (build-throw caught, network, non-2xx, empty, body-read), push.ts detectCiOidc (network, non-2xx, non-JSON, no value). --timestamp opt-in; tsaUrl only resolved when passed. CI attestation zero-config and silent-on-absence.

## Counts
npm test: 633 pass / 0 fail / 0 skipped (tsc + node --test, ~3.2s). Matches claimed 633.

---

# Re-verification (commits c7c3b0e, ea09921) — APPROVED

Tests: `npm test` = **637 pass / 0 fail / 0 skipped** (matches claimed 637). A node test-runner IPC flake ("Unable to deserialize cloned data") prints for manifest-cli.test.js *after* the aggregate summary; it does not register as a failure (known standalone flake).

1. **Scan-all fix (src/tsa.ts:205-240) — CORRECT.** Probe with a realistic CMS layout (digestAlgorithms sha256 AlgId before the real messageImprint) now returns true; old first-anchor returned false. ✗ direction sound: wrong digest → no occurrence's OCTET STRING(32) matches → indexOf exhausts → false (confirmed on both fixtures and the real token). Residual (crafted non-CMS blob embedding the digest) stated honestly in the doc comment; positive still graded `"unchecked"` at verify.ts (never `"verified"`).
2. **Real-token fixture — genuine, but does NOT exercise the scan (non-blocking honesty nit).** test/fixtures/freetsa-token.b64 is a real freetsa RFC-3161 TimeStampResp (valid DER, signedData + id-ct-TSTInfo OIDs present; digestHex == sha256(digestInput) verified). Provenance meta complete. HOWEVER: freetsa signs its SignedData with **SHA-512** (digestAlgorithms OID ends `02 03`), so the token contains exactly ONE sha256 OID — the imprint itself. The OLD first-anchor code ALSO passes this token, so the real-token test would NOT fail on a first-anchor regression — contrary to the commit/test-comment claim that it "proves the scan-all fix holds against a genuine TSA response." The genuine regression guard is the hand-built `buildRealisticCmsFixture` test (test/tsa.test.ts) — verified to fail first-anchor and pass scan-all. The real-token test still earns its keep (works-on-real-data + wrong-digest→false) and is not a can't-fail test; the claim is just overstated. Note also this explains the original finding's blast radius: the default freetsa path wouldn't have hit the bug (SHA-512 signature), but any SHA-256-signing TSA would — the fix is correct and necessary regardless.
3. **Doc comment CMS byte-order (src/tsa.ts:177-189) — correct now** (digestAlgorithms precedes eContent/TSTInfo, no octet string attached).
4. **ea09921 fail-open wrap (src/push.ts:476-503) — CORRECT.** computeSignature + computeTimestamp each in their own try/catch; a throw degrades that ONE record to unsigned/untimestamped with one stderr line, push still succeeds. Test uses a real x25519 key that genuinely throws on sign() (not a mock); asserts pushedCount===1, body.signature undefined, exactly one warning.

Verdict: **APPROVED.**
