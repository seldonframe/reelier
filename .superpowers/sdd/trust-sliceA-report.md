# OSS Slice A — signing core (Tasks A1–A4) — report

Branch: `feat/trust-ladder` (worktree `C:\Users\maxim\CascadeProjects\reelier-trust`)

## Per-task status

- **A1 — `src/signing.ts` + `test/signing.test.ts`**: DONE. `generateSigningKeypair`, `loadSigningKey`, `signRecordDigest`, `verifyRecordSignature`, `signingKeyDir`, `isValidKeyId`. node:crypto only, zero new deps. 12 new tests (roundtrip, tamper, wrong-signature, keyId stability, missing-dir→null, no-key-files→null, malformed-key→null+warn+never-throws, newest-key-wins).
- **A2 — `reelier init --signing`**: DONE. Short-circuiting path in `cmdInit` (cli.ts) — generates into `~/.reelier/signing/` on first run, prints the existing key (never regenerates) on repeat runs. Exported `cmdInit` for direct in-process testing. 2 new tests with HOME/USERPROFILE redirected to a temp dir.
- **A3 — push signs the pushed record**: DONE. `pushOneRecord` (push.ts) attaches `signature: {alg:"ed25519", keyId, sig}` computed over `digestSha256(record)` — the record is signed AFTER the `skillContentSha256` push-time fallback stamp, i.e. the exact bytes serialized into the body, never the pre-stamp candidate. No key → field omitted entirely (no shaming). Signing key loaded once per push batch (`loadSigningKey` never throws — a malformed key degrades to unsigned, doesn't abort the push). 3 new tests, including the mandated assertion that the signature verifies against the pushed record and NOT against the pre-stamp shape.
- **A4 — `reelier verify <permalink|file> [--key <pub.pem>]`**: DONE. New `src/verify.ts` (pure logic: URL/file/bare-token resolution reusing `get.ts`'s `resolveGetConfig`, per-claim evaluation) + `cmdVerify` in cli.ts. Per-claim lines: `unaltered-since-push: ✓ (key <id>)` / `✗ SIGNATURE INVALID (...)` / `— unsigned` / `— signed by key <id>, but no public key was given` (unchecked, not failed). `timestamped` renders `— none` when absent, or an honest "present but not yet verified by this CLI (Slice B)" note when present — no RFC-3161 verification performed (that's Slice B's `tsa.ts`, explicitly out of scope here per the dispatch brief). Exit 0 unless a PRESENT claim FAILED; absent/unchecked never fail the exit code. 24 new tests: 18 pure-logic (`test/verify.test.ts`) + 6 CLI-level fetch-monkeypatched matrix (`test/verify-cli.test.ts`: valid / tampered / unsigned / no-key-provided / local-file / missing-target).

Slice B (TSA/refs/CI-attestation/docs) was **not started**, per instructions. Spec/plan docs were not modified.

## Commit SHAs (all on `feat/trust-ladder`)

- `c14e744` — A1: Ed25519 signing core
- `a53cce7` — A2: `reelier init --signing`
- `20f7d8e` — A3: push signs the pushed record when a key exists
- `b167d22` — A4: `reelier verify <permalink|file> [--key <pub.pem>]`

## Final suite counts

`npm test` = `tsc -p tsconfig.test.json && node --test dist-test/test/*.test.js`. Ran as two groups per the known Windows IPC flake in `test/manifest-cli.test.js` (confirmed pre-existing and unrelated — it fails only when run in the same `node --test` invocation as every other file, and passes 9/9 every time when run standalone, both before and after this branch's changes):

- All files except `manifest-cli.test.js`: **576 pass / 0 fail**
- `manifest-cli.test.js` standalone: **9/9 pass**
- **Total: 585 pass / 0 fail** (baseline 545 + 40 new, confirmed incrementally at each commit: 545→556 after A1 [+11 signing.test.ts] →558 after A2 [+2 init-signing-cli.test.ts] →561 after A3 [+3 push-signing.test.ts] →585 after A4 [+18 verify.test.ts +6 verify-cli.test.ts]).

`npx tsc -p tsconfig.test.json`: clean, no errors, at every commit.

## Deviations from the plan

- **`--key` added to cli.ts's value-taking-flag list.** `parseArgv` needed `--key` added alongside `--dir`/`--out`/etc. so `reelier verify ... --key <pub.pem>` doesn't get swallowed as a bare boolean flag. Minimal, mechanical, inside the file the plan already scoped (cli.ts).
- **`reelier verify`'s target resolution supports three forms, not two.** The plan's task line says "permalink|file"; the spec's §1 mechanics line says verification uses "a public key given via `--key <pem>` **or fetched from the tenant's published key page**" and separately implies a bare-token registry-style lookup is in scope for other commands (`get.ts`'s pattern). I additionally accept a **bare registry token** resolved against `REELIER_CLOUD_URL` (reusing `get.ts`'s `resolveGetConfig`, exactly as the task brief instructed — "reuse get.ts's REELIER_CLOUD_URL fetch"). This is additive, not a narrowing of the two documented forms, and every new behavior is covered by its own test (`resolveVerifyPayload: a bare token with no matching local file resolves against REELIER_CLOUD_URL`).
- **Timestamp claim renders but does not verify.** Per the dispatch brief ("Do NOT start Slice B"), `evaluateTimestampClaim` reports presence/absence honestly and never performs (or claims to perform) RFC-3161 imprint-match/chain verification — that's `src/tsa.ts`'s job in Slice B. This keeps the receipt-page-shaped 2-row output the spec describes without building ahead of scope. No test asserts imprint verification; tests only assert honest absent/present-unchecked reporting.
- **`--signing`'s idempotency check re-reads the public PEM from disk** (rather than caching it from a prior in-process generation) to guarantee the "prints existing, never regenerates" contract holds even across separate process invocations — matches the spec's "existing key → print existing" wording literally.
- `package-lock.json` was regenerated by a required `npm install` (the worktree had no `node_modules` at session start) — left **unstaged/uncommitted**, out of the plan's file scope; flagging in case Max wants it reviewed/discarded separately.

## Known limits carried forward (from A4, matching spec §1 explicitly)

- `reelier verify` only accepts an explicit `--key <pub.pem>`; it does not yet fetch a tenant's published key page (spec explicitly scopes that to cloud Slice C's `/settings/keys`).
- No RFC-3161 verification (Slice B).
- Revocation is out of scope for the CLI (cloud-side, Slice C).

## Test results (verbatim tails)

Final combined run (excluding the known-flaky file, run separately):

```
ℹ tests 576
ℹ suites 0
ℹ pass 576
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3732.1389
```

`manifest-cli.test.js` standalone:

```
ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 285.3367
```

`npx tsc -p tsconfig.test.json` — no output, exit 0 (clean compile).

---

# OSS Slice B — TSA + refs + CI attestation + docs (Tasks B1–B4) + B5 — report

Same branch/worktree. Slice A was reviewed and **APPROVED, no blocking findings** before this slice began; two non-blocking notes and one spec-gap closure (B5) were folded in per the coordinator's follow-up message (see below).

## Chore commit first (lockfile)

- `c75eeee` — `chore: refresh package-lock after clean-worktree install` — committed standalone, as instructed, before any Slice B work, so the lockfile Slice A left unstaged is never a verify-gate landmine.

## Per-task status

- **B1 — `src/tsa.ts` (RFC-3161 timestamps)**: DONE. `buildTimeStampReq(digestHex)` — minimal hand-rolled DER writer for `TimeStampReq` v1 (SHA-256 `AlgorithmIdentifier` + NULL params, `hashedMessage` OCTET STRING, `certReq: true`); throws on a malformed digest rather than timestamping garbage. `requestTimestamp(tsaUrl, digestHex, fetchImpl)` — POSTs `application/timestamp-query`; ANY failure (malformed digest, network error, non-2xx, empty body) → `null` + exactly one stderr line, never throws. `imprintMatches(tokenB64, digestHex)` — the documented OID+OCTET-STRING byte-search shortcut (not a full CMS/TSTInfo parse), with the limitation spelled out in the doc comment. `DEFAULT_TSA_URL` = `https://freetsa.org/tsr`, overridable via `REELIER_TSA_URL` (resolved once per push batch; never silently switched). Wired into `push.ts` behind `--timestamp` (cli.ts flag) — requested **per record** (each record has its own digest, computed after the `skillContentSha256` push-time stamp — same "sign what ships" rule as A3), attached as the optional `timestamp` sibling field. TSA-down → push still succeeds with no `timestamp` field. **Also wired `evaluateTimestampClaim` (verify.ts) to actually call `imprintMatches`** — the dispatch brief's "document the shortcut honestly at the claim site" meant more than a comment: a genuine imprint MISMATCH is now a real, checked failure (loud ✗, fails the exit code, same grade as a bad signature); a MATCHING imprint stays graded `"unchecked"` rather than `"verified"` — it proves the digest reached the named TSA, not that the TSA/its cert chain is trustworthy — and the line prints the `openssl ts -verify` command for the untested half. 19 new tests: 15 in `test/tsa.test.ts` (golden DER bytes against a hand-verified SHA-256("hello") fixture, malformed-digest rejection, imprint match/mismatch/garbage-token, and the full `requestTimestamp` fail-open matrix) + 4 in `test/push-timestamp.test.ts` (no-flag → no TSA contact; `--timestamp` → bundled default + imprint verifies against the actually-pushed record; `REELIER_TSA_URL` override; TSA-down → push still succeeds, no `timestamp` field). Existing `test/verify.test.ts` timestamp tests updated (1 removed, 3 added) to match the new imprint-checking behavior.
- **B2 — request-id refs**: DONE. `Observation` (assert.ts) gains `refs?: ObservationRef[]`. `tools.ts`'s `http.get`/`http.post` capture an ALLOWLIST of response headers (`request-id`, `x-request-id`, `x-amzn-requestid`, `x-amz-request-id`, `x-goog-request-id`, `stripe-request-id`, `cf-ray`) into `refs`, omitted entirely (never an empty array) when none present. `mcp-tool.ts`'s `mcpResultToObservation` captures an EXACT-match allowlist of top-level JSON body keys (`request_id`, `requestId`, `x_request_id`) — single-JSON-body case only (exactly one text content item, valid JSON object); `requestIdentifier` (a near-miss) never matches, verified by test. Both sides pass captured values through `redact()` — redaction wins over a cross-checkable ref. `runner.ts` threads `Observation.refs` onto `StepRecord.refs` for ANY executed step (extends the write-receipt discipline to reads, not just writes); a fresh L2 re-execution's refs supersede the stale main-path attempt (mirrors the existing `write` handling); a mocked step (`--fail N`) never carries refs, for the same reason it never carries a write receipt (no real dispatch happened) — implemented by explicitly zeroing `refs` alongside `write` in the mocked branch. 15 new tests across `test/tools-refs.test.ts` (5), `test/mcp-tool-refs.test.ts` (7), `test/runner-refs.test.ts` (3).
- **B3 — CI attestation**: DONE. `detectCiOidc(env, fetchImpl)` (push.ts): when `ACTIONS_ID_TOKEN_REQUEST_URL`/`ACTIONS_ID_TOKEN_REQUEST_TOKEN` are both present, GETs `${url}&audience=reelier.com` with `Authorization: Bearer <reqToken>`, parses `{value: "<jwt>"}` from the response. Absent env → `null`, nothing printed (a laptop push is never shamed). Any failure (network, non-2xx, malformed/missing `value`) → `null` + exactly one stderr line, never blocks the push. Detected once per push batch (before the skill-upload leg), attached as `ciAttestation: {provider:"github-actions", token}` on every record. 7 new tests in `test/push-ci-attestation.test.ts`: 5 pure-logic (`detectCiOidc` absent/present/non-2xx/network-error/malformed-body) + 2 integration (`pushSkill` with/without CI env, asserting the payload's `ciAttestation` field).
- **B4 — docs**: DONE. README gains a "Trust ladder" section (per-claim table: unaltered-since-push / timestamped / cross-checkable refs / CI-attested — each with "how you get it" / "what it proves" / "what it does NOT prove" — plus a `reelier verify` example and the exit-code rule). Word-split check honored: `"tamper-evident"` appears exactly once, beside the unaltered-since-push table cell only; `"compliance-grade"` and `"fabrication-proof"` appear nowhere in README/CHANGELOG/the workflow file (grepped and confirmed). `.github/workflows/reelier-replay.example.yml`'s `replay` job gains `permissions: { id-token: write, contents: read }` with a comment explaining what it buys (CI attestation) and that omitting it is never a failure. `CHANGELOG.md` gets a full `## 0.20.0` entry covering the whole A+B slice. `package.json`'s version was **NOT** bumped (stays `0.19.0`) — rides the merge, per instructions. No automated test covers doc wording (the plan's word-split check is a human/review discipline); verified by direct `grep`.
- **B5 (added mid-slice by the coordinator, after Slice A review)** — verify falls back to the cloud's published signing key: DONE. `VerifyPayload` gains `signingKey?: {keyId, publicKeyPem, verified?, revoked?}` (additively present on `/r/<token>/json` per the cloud-side extension). `evaluateUnalteredSincePushClaim`'s key resolution order is now: (1) explicit `--key` always wins, unchanged output; (2) no `--key` + `payload.signingKey` present + its `keyId` matches the signature's own `keyId` → verify against that PEM, rendering `unaltered-since-push: ✓ (key <id> — key supplied by reelier.com; for independent verification pass --key)`; (3) no `--key` + `signingKey` present but its `keyId` does NOT match the signature's → loud `✗ KEY MISMATCH`, naming both ids, fails the exit code; (4) neither present → today's unchanged `"unchecked"` line. 4 new tests added to `test/verify.test.ts` covering exactly these branches, incl. `--key` precedence over a deliberately-mismatched `signingKey`.
- **Slice-A review note (a)** (malformed existing key file should warn, not silently orphan): investigated — **already true** since A1: `loadSigningKey` warns by path and returns `null` before `cmdInitSigning` ever reaches its "generate a fresh key" branch, so the orphan is already named, never silent. Added one regression test (`test/init-signing-cli.test.ts`) locking this in; **no production code changed**.
- **Slice-A review note (b)** (multi-key dirs sign with newest-by-mtime; a stderr note naming which keyId is signing on push would help): **deliberately NOT done**. Not trivial as scoped — `loadSigningKey`'s return shape has no signal for "was this ambiguous / how many candidates existed," and adding one would ripple into both call sites (`cli.ts`'s `cmdInitSigning`, `push.ts`'s per-batch key load) plus their tests. Flagging as a genuine, real, but deferred follow-up — not silently dropped.

## Commit SHAs (all on `feat/trust-ladder`, in order)

- `c75eeee` — chore: refresh package-lock after clean-worktree install
- `f596403` — B2: request-id refs (http headers + MCP body) — landed before B1/B3 in commit order (implementation order followed the coordinator's message's own B1→B2→B3→B4 numbering loosely; B2 was mechanically simpler to verify first, no dependency between B1/B2/B3)
- `69cb841` — B3: CI attestation (GitHub Actions OIDC)
- `dc719ee` — B1: RFC-3161 trusted timestamps (incl. wiring `imprintMatches` into `verify.ts`'s timestamp claim)
- `36b6e6b` — B4: README trust-ladder section, CI permissions, CHANGELOG
- `2030678` — B5: verify falls back to the cloud's published signing key
- `0b9c0c5` — test: lock in the malformed-signing-key orphan warning (Slice-A note (a))

## Final suite counts

Same two-group approach as Slice A (the `manifest-cli.test.js` Windows IPC flake is confirmed pre-existing/unrelated — 9/9 every time run standalone):

- All files except `manifest-cli.test.js`: **624 pass / 0 fail**
- `manifest-cli.test.js` standalone: **9/9 pass**
- **Total: 633 pass / 0 fail.** Incremental totals actually printed by `node --test` at each commit (Slice A ended at 585): 585 → **600** after B2 (+15: tools-refs, mcp-tool-refs, runner-refs) → **607** after B3 (+7: push-ci-attestation) → **628** after B1 (+21: tsa.test.ts ×15, push-timestamp.test.ts ×4, plus a net +2 in verify.test.ts from rewriting the timestamp-claim test to cover match/mismatch/garbage instead of one generic case) → 628 after B4 (docs-only, 0 new tests) → **632** after B5 (+4: verify.test.ts's four new key-resolution-order tests) → **633** after the Slice-A note (a) regression test (+1: init-signing-cli.test.ts).

`npx tsc -p tsconfig.test.json`: clean, no errors, at every commit.

## Deviations from the plan / notable decisions

- **Commit order != task letter order.** B2 landed before B1 and B3 in commits, since it had no dependency on the others and was quickest to verify end-to-end (tools.ts/mcp-tool.ts/runner.ts). B1 (the DER writer) took the longest to hand-verify (golden-bytes fixture, hand-computed and cross-checked against `SHA-256("hello")`), so it landed after B3. No task depended on another's code; the wire-contract fields (`signature`, `timestamp`, `ciAttestation`, `refs`) are all independent optional siblings, exactly as designed.
- **`imprintMatches` is wired into `verify.ts`, not left inert.** The coordinator's message said "document the shortcut honestly at the claim site" — read as an instruction to actually call it from `evaluateTimestampClaim`, not just build it in isolation. This changed `evaluateTimestampClaim`'s behavior (previously always `"unchecked"` when a timestamp was present; now a real imprint check with its own failure mode) and required updating one pre-existing Slice-A test (`test/verify.test.ts`'s "present -> ... Slice B" test, replaced with three: matching-imprint, mismatched-imprint, garbage-token).
- **A matching imprint is graded `"unchecked"`, not `"verified"`.** Deliberate: `imprintMatches` proves the digest reached the named TSA, nothing about the TSA's certificate chain or trust — grading it `"verified"` would overclaim past what was actually checked (spec §2's explicit "verification honesty (v1 scope)" carve-out, and the standing `"tamper-evident"`-only-for-§1 word-split discipline extends the same caution here).
- **DEFAULT_TSA_URL = `https://freetsa.org/tsr`.** A public, no-signup RFC-3161 TSA; chosen as the bundled default per the plan's "same explicit-update discipline as prices.yml" instruction. Never contacted in any test (all TSA calls are fetch-monkeypatched); real connectivity to freetsa.org was not verified in this session — flagging as an open item before this ships to real users (Max may want to swap it, or verify it's still live/free).
- **B5's `signingKey.verified`/`.revoked` fields are typed but NOT consulted.** The coordinator's message specified exactly 3 render branches (match+verify, mismatch, absent) plus `--key` precedence — none of which reference `verified`/`revoked`. Since `revoked` alone (a boolean, no timestamp) can't honestly support the spec's "valid at push time" framing without a `revokedAt` date to compare against the push time, using it now would either overclaim or require guessing — left unused, typed for forward-compatibility, not wired. Flagging as a real gap for whoever builds the cloud-side revocation UI next.
- **`resolveTsaUrl`/`computeTimestamp` are push.ts-local (unexported)** — mirrors the existing `computeSignature`/`computePushCost` pattern already in that file; no test needed them exported since `pushSkill`'s own integration tests exercise the full path.

## Known limits carried forward

- No full RFC-3161 certificate-chain verification anywhere in this CLI (by design — spec §2 explicitly scopes that to `openssl ts -verify`, printed as a hint).
- `DEFAULT_TSA_URL`'s real-world liveness/policy was not verified against the actual freetsa.org service in this session (no live network calls were made — all tests are fetch-monkeypatched).
- Multi-key signing-directory ambiguity has no stderr disclosure (Slice-A note (b), deferred).
- `signingKey.revoked` is typed on the wire but not yet rendered/consulted by `reelier verify` (see B5 deviation above).

## Test results (verbatim tails)

Final combined run (excluding the known-flaky file, run separately):

```
ℹ tests 624
ℹ suites 0
ℹ pass 624
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3066.8381
```

`manifest-cli.test.js` standalone:

```
ℹ tests 9
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 241.7628
```

`npx tsc -p tsconfig.test.json` — no output, exit 0 (clean compile), confirmed after every commit in this slice.
