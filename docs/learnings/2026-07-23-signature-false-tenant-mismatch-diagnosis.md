# signature_verified=false with a valid signature — isolate the rung, then the registry

**The problem, in one line.** CI-pushed receipts landed with `signature_verified: false` even though the signing key, payload, and cloud verification code were all individually correct.

**The approach.**
1. Read what DID verify on the same receipts: the RFC-3161 timestamp imprint (`tsa_imprint_ok: true`). Both signature and timestamp are computed over the SAME canonical record digest — so a passing imprint proves the digest matched, eliminating canonicalization/serialization as the cause.
2. Cross-verify from the other side of the seam: `reelier verify <permalink> --key <pub.pem>` recomputes offline. It reported the signature VALID — so the signature bytes were good and the failure had to be inside the cloud's registry lookup (`findSigningKey(tenantId, keyId)`).
3. Check the stored public key row byte-for-byte (length, real newlines vs literal `\n`) — clean.
4. The only remaining input was `tenantId`: query which tenant the receipts actually landed under. They belonged to a different tenant than the one the key was registered to — the push API key's tenant and the key-registration tenant disagreed.
5. Fix by moving the key registration to the pushing tenant, then RE-RUN the real pipeline (a second CI run) so the system verifies end-to-end — never hand-set `signature_verified=true` in the DB, even when you know it would be true.

**Judgment calls.** Did not touch the crypto or canonicalization code at all once the imprint check cleared them — the passing sibling rung is the fastest bisector. Did not backfill the 12 false-signature receipts by SQL; they were left as-is pending an explicit decision, because a verification column should only ever be written by the verifier.

**The reusable rule, one line.** When one trust rung fails and a sibling rung over the same bytes passes, the failure is in identity/lookup (who), not integrity (what) — check which tenant/principal each side of the seam actually resolved before touching any crypto.
