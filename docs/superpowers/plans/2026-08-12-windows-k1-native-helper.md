# Windows K1 Native Helper Implementation Plan

> **SUPERSEDED 2026-08-12. Do not implement or resume this plan.** The founder explicitly rejected expanding the trusted computing base with a native Windows helper. The approved direction is Windows as a first-class client with the consequential Authority Cell hosted on Linux. See `2026-08-12-windows-client-linux-authority-cell.md`. Preserve existing experimental files as uncommitted evidence until their owner disposes of them; never ship them.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship x64 and ARM64 Rust Node-API binaries that give Reelier an anchored, reparse-rejecting Windows filesystem capability for K1 FIFO publication and lifecycle mutation.

**Architecture:** A small Rust crate owns Windows handles and exposes a closed opaque Node-API session/artifact interface. A private TypeScript loader selects and verifies the packaged binary, adapts its closed results into the FIFO host, and fails closed when native support is absent or invalid; the existing named-pipe mutex, TypeScript election policy, Linux behavior, and public authority ABI remain unchanged.

**Tech Stack:** Rust 1.88 pinned with `rust-toolchain.toml`, napi-rs/Node-API, `windows-sys` WDK/Win32 bindings, TypeScript/Node.js 20+, GitHub Actions `windows-latest` x64 and `windows-11-arm` ARM64 runners.

## Global Constraints

- Work only in `C:\Users\maxim\CascadeProjects\reelier\.worktrees\outcomes-delegation-infra`.
- Preserve the pre-existing untracked `.tmp-pack/` and unrelated stat-only certification paths.
- Do not modify, merge, or revert PR #117's badge-only change.
- The unsafe pathname implementation in `src/authority/host/windows-k1-fifo.ts` must be deleted or made unreachable on Windows; no pathname or direct-mutex fallback is permitted.
- The addon is private and absent from `reelier/authority`, `reelier/authority/pack`, `reelier/authority/host`, and every public package export.
- The addon accepts no arbitrary paths, raw handles, access masks, callbacks, provider data, tenant/task data, credentials, budgets, or receipts.
- Root and child mutations use anchored handles; every component rejects reparse points before use.
- Native sessions and artifacts are opaque, owner-bound, nonserializable, process-local, and permanently invalidated on close/consume.
- Native panics must not unwind across Node-API; all Windows handles close through RAII on every exit.
- Closed results are only `created`, `existing-identical`, `busy`, `corruption`, or `unsupported`; raw Windows paths/messages/handles never cross the boundary.
- Ship both `win32-x64` and `win32-arm64` prebuilt binaries. Installation performs no build, postinstall download, or network access.
- Both architectures must execute their integration corpus on matching hardware. Cross-compilation alone cannot satisfy the release gate.
- Missing, wrong-architecture, ABI-incompatible, or digest-mismatched binaries fail closed on Windows while preserving read-only status/export.
- Linux and macOS never resolve or load a `.node` file and retain byte-for-byte existing ledger behavior.
- Every task uses TDD with separate RED/GREEN commits and an independent review before the next task.
- Do not resume FIFO election or ledger integration until this plan's final native/packed-artifact gate is green.

## File structure

- Create `native/windows-k1-helper/Cargo.toml`: pinned private `cdylib` crate and minimal features.
- Create `native/windows-k1-helper/build.rs`: invoke the pinned `napi-build` setup only.
- Create `native/windows-k1-helper/src/lib.rs`: Node-API resource classes and closed public-native operation wrappers only.
- Create `native/windows-k1-helper/src/names.rs`: exact FIFO basename grammar and bounded canonical input validation.
- Create `native/windows-k1-helper/src/status.rs`: closed status/error mapping and redacted diagnostics.
- Create `native/windows-k1-helper/src/windows.rs`: Windows anchored-handle implementation, identity checks, exclusive child mutation, flush, rename, and RAII.
- Create `native/windows-k1-helper/tests/windows_integration.rs`: native x64/ARM64 substitution, collision, crash, identity, and lifecycle tests.
- Create `rust-toolchain.toml`: pin Rust `1.88.0` with `rustfmt` and `clippy`.
- Create `scripts/build-windows-k1-native.mjs`: build/copy the current Windows architecture binary into the exact `dist/native` path.
- Create `scripts/verify-windows-k1-native.mjs`: PE architecture, digest manifest, package-content, and no-postinstall verification.
- Create `scripts/windows-k1-native-digests.json`: exact x64/ARM64 SHA-256 commitments populated only from executable CI artifacts.
- Create `src/authority/host/windows-k1-native.ts`: private loader, digest/architecture validation, and closed TypeScript adapter.
- Create `test/authority/windows-k1-native.test.ts`: loader, tamper, absence, wrong-arch, ownership, redaction, and non-Windows tests.
- Modify `src/authority/host/windows-k1-fifo.ts`: replace Windows pathname publication/lifecycle with the native adapter and remove unsafe fallback.
- Modify `test/authority/windows-k1-fifo.test.ts`: prove native-only Windows publication, exact crash residues, capability invalidation, and no external writes.
- Modify `package.json` and `package-lock.json`: pin native build tooling, scripts, and package verification without adding public exports or install hooks.
- Modify `.github/workflows/ci.yml`: retain existing x64 matrix and add the native build/integration/pack gate.
- Create `.github/workflows/windows-native-arm64.yml`: matching-hardware ARM64 build, test, artifact, and packed-install gate using `windows-11-arm`.
- Modify `.gitignore`: ignore Rust build output but not `Cargo.lock`, native sources, scripts, or committed release digest manifest.
- Update `.superpowers/sdd/2026-08-12-windows-k1-fifo-admission/progress.md`: link the resolved blocker and native-plan evidence.

---

### Task 1: Native crate scaffold and closed validation vocabulary

**Files:**
- Create: `rust-toolchain.toml`
- Create: `native/windows-k1-helper/Cargo.toml`
- Create: `native/windows-k1-helper/build.rs`
- Create: `native/windows-k1-helper/Cargo.lock`
- Create: `native/windows-k1-helper/src/lib.rs`
- Create: `native/windows-k1-helper/src/names.rs`
- Create: `native/windows-k1-helper/src/status.rs`
- Modify: `.gitignore`

**Interfaces:**
- Produces the private crate `reelier_windows_k1` as a `cdylib` with Node-API resource shells.
- Produces exact internal validators:

```rust
pub(crate) enum NativeStatus { Created, ExistingIdentical, Busy, Corruption, Unsupported }
pub(crate) struct TicketNames { pub preparation: String, pub committed: String }
pub(crate) struct LifecycleNames { pub marker: String, pub acknowledgement: String }
pub(crate) fn parse_ticket_names(preparation: &str, committed: &str) -> Result<TicketNames, NativeStatus>;
pub(crate) fn parse_lifecycle_names(marker: &str, acknowledgement: &str) -> Result<LifecycleNames, NativeStatus>;
pub(crate) fn validate_ticket_bytes(bytes: &[u8], expected_sha256_hex: &str) -> Result<(), NativeStatus>;
```

Lifecycle names are exactly disposition-bound to the same canonical `orderKey`:

```text
withdrawn marker: `.ticket-withdrawal-${orderKey}`
withdrawn acknowledgement: `.ticket-withdrawal-ack-${orderKey}.json`
dead-owner marker: `.ticket-retired-${orderKey}`
dead-owner acknowledgement: `.ticket-retired-ack-${orderKey}.json`
```

`parse_lifecycle_names` accepts only one of those two matching pairs. Cross-paired dispositions,
different order keys, missing `.json`, stage suffixes, and broader prefixes refuse.

- [ ] **Step 1: Write Rust RED tests for closed inputs and opaque shells**

In `names.rs`, add `#[cfg(test)]` vectors for exact Task 1 FIFO names and reject separators, `..`, colon/ADS syntax, NUL/control characters, uppercase identities, broad prefixes, zero components, mismatched order keys, and names above 255 UTF-16 code units. In `status.rs`, assert only the five closed status strings serialize. In `lib.rs`, add compile-time/resource tests that raw handle fields are private and no arbitrary path method is exported.

- [ ] **Step 2: Run RED**

Run:

```powershell
rustup toolchain install 1.88.0 --profile minimal --component rustfmt clippy
cargo +1.88.0 test --manifest-path native/windows-k1-helper/Cargo.toml
```

Expected: crate/modules/functions are absent or tests fail on permissive parsing.

- [ ] **Step 3: Implement minimal closed parsing and status mapping**

Use byte/UTF-16 length caps before allocation. `validate_ticket_bytes` requires `1..=4096` bytes and a 64-lowercase-hex SHA-256 digest. N-API resource classes contain only private `Option<Arc<...>>` capability state; methods reject after `take()`.

Pin these dependencies exactly in `Cargo.toml` and commit `Cargo.lock`:

```toml
[package]
name = "reelier-windows-k1"
version = "0.1.0"
edition = "2021"
rust-version = "1.88"
publish = false

[lib]
crate-type = ["cdylib"]

[features]
default = []
fault-injection = []

[dependencies]
napi = { version = "=3.12.1", default-features = false, features = ["napi8"] }
napi-derive = "=3.6.3"
sha2 = "=0.11.0"
windows-sys = { version = "=0.61.2", features = ["Wdk_Storage_FileSystem", "Win32_Foundation", "Win32_Storage_FileSystem", "Win32_System_IO"] }

[build-dependencies]
napi-build = "=2.4.1"
```

These versions were verified against crates.io on 2026-08-12. If the registry no longer resolves them, stop and report rather than silently widening ranges. `build.rs` contains only `fn main() { napi_build::setup(); }`.

- [ ] **Step 4: Run GREEN and static gates**

```powershell
cargo +1.88.0 fmt --manifest-path native/windows-k1-helper/Cargo.toml -- --check
cargo +1.88.0 clippy --manifest-path native/windows-k1-helper/Cargo.toml --all-targets -- -D warnings
cargo +1.88.0 test --manifest-path native/windows-k1-helper/Cargo.toml
```

Expected: all tests pass with zero warnings.

- [ ] **Step 5: Commit RED and GREEN separately**

```powershell
git add -- rust-toolchain.toml native/windows-k1-helper .gitignore
git commit -m "test(ledger): specify native Windows K1 vocabulary"
git add -- rust-toolchain.toml native/windows-k1-helper .gitignore
git commit -m "feat(ledger): scaffold native Windows K1 capability"
```

### Task 2: Anchored root session and Windows identity

**Files:**
- Modify: `native/windows-k1-helper/src/lib.rs`
- Create: `native/windows-k1-helper/src/windows.rs`
- Create: `native/windows-k1-helper/tests/windows_integration.rs`

**Interfaces:**
- Consumes canonical absolute root plus expected volume serial and 128-bit file ID.
- Produces:

```rust
#[napi(object)]
pub struct OpenBoundRootInput {
  pub canonical_root: String,
  pub expected_volume_serial: String, // exactly 16 lowercase hex
  pub expected_file_id: String,       // exactly 32 lowercase hex
}

#[napi]
pub struct NativeRootSession { inner: Option<Arc<BoundRoot>> }

#[napi]
pub fn open_bound_root(input: OpenBoundRootInput) -> napi::Result<NativeRootSession>;

#[napi]
impl NativeRootSession {
  #[napi]
  pub fn close(&mut self) -> napi::Result<()>;
}

pub(crate) struct FileIdentity {
  pub volume_serial: u64,
  pub file_id: [u8; 16],
  pub attributes: u32,
  pub links: u32,
}
```

- [ ] **Step 1: Write RED root tests**

Cover exact root, wrong volume, wrong file ID, root symlink/junction, parent junction, final-component reparse, UNC/device/relative roots, trailing-component substitution, mutable JS input after call, double close, foreign session, and handle-count return to baseline after every refusal.

- [ ] **Step 2: Run RED on Windows x64**

```powershell
cargo +1.88.0 test --manifest-path native/windows-k1-helper/Cargo.toml --test windows_integration -- open_bound_root
```

Expected: absent Windows module/session or substitution tests fail.

- [ ] **Step 3: Implement anchored root opening**

Open each canonical root component without following reparse points. Reject `FILE_ATTRIBUTE_REPARSE_POINT`. Bind the retained root handle to `volume_serial + file_id`. Copy all input strings/identities before the first await/Node-API return. Store only an `OwnedHandle` equivalent in `BoundRoot`; implement `Drop` and permanent `close()` invalidation.

Map access denied, sharing violation, unsupported filesystem, identity mismatch, and reparse observations to the closed status/error vocabulary without raw formatted system messages.

- [ ] **Step 4: Run GREEN**

```powershell
cargo +1.88.0 test --manifest-path native/windows-k1-helper/Cargo.toml --test windows_integration -- open_bound_root
cargo +1.88.0 clippy --manifest-path native/windows-k1-helper/Cargo.toml --all-targets -- -D warnings
```

Expected: root suite passes; handle counts return to baseline.

- [ ] **Step 5: Commit**

```powershell
git add -- native/windows-k1-helper
git commit -m "test(ledger): require anchored Windows root handles"
git add -- native/windows-k1-helper
git commit -m "feat(ledger): bind native Windows root sessions"
```

### Task 3: Handle-relative ticket publication

**Files:**
- Modify: `native/windows-k1-helper/src/lib.rs`
- Modify: `native/windows-k1-helper/src/windows.rs`
- Modify: `native/windows-k1-helper/tests/windows_integration.rs`

**Interfaces:**
- Consumes `NativeRootSession`, closed ticket names, canonical bytes, and expected digest.
- Produces:

```rust
#[napi(object)]
pub struct PublishTicketInput {
  pub preparation_name: String,
  pub ticket_name: String,
  pub canonical_bytes: Buffer,
  pub expected_digest: String, // exactly 64 lowercase hex
}

#[napi(object)]
pub struct PublishTicketResult {
  pub status: String,
  pub artifact: Option<NativeTicketArtifact>,
  pub directory_sync: String, // verified | unchecked
}

#[napi]
pub struct NativeTicketArtifact { inner: Option<Arc<PublishedTicket>> }

#[napi]
impl NativeRootSession {
  #[napi]
  pub fn publish_ticket(&self, input: PublishTicketInput) -> napi::Result<PublishTicketResult>;
}
```

`PublishTicketResult` contains only `{ status, artifact?, directorySync }`, where `directorySync` is `verified` or `unchecked`.

- [ ] **Step 1: Write RED publication/substitution tests**

At every boundary—queue open/create, prep create, ticket create, partial write, write complete, file flush, prep revalidation, rename, queue flush, committed reopen, final validation—attempt queue/prep/ticket junction or identity substitution. Assert the external canary is unchanged, no raw error escapes, and at most one typed direct-child residue exists.

Also cover exact retry (`existing-identical`), committed collision with different bytes (`corruption` and no new prep), prep collision, zero/growth/shrink/same-name replacement, wrong digest, byte cap, and injected process crash.

- [ ] **Step 2: Run RED**

```powershell
cargo +1.88.0 test --manifest-path native/windows-k1-helper/Cargo.toml --test windows_integration -- publish_ticket
```

Expected: publication API absent or external-canary/collision assertions fail.

- [ ] **Step 3: Implement handle-relative publication**

Use retained parent handles for every child create/open/rename. Create exclusively, reject reparse attributes, write in a progress loop, `FlushFileBuffers`, handle-revalidate identity/type/link/bytes, rename the already-open prep relative to retained queue with replacement disabled, reopen committed relative to queue, and mint the artifact only after final validation.

Fault injection is a `#[cfg(feature = "fault-injection")]` native-only closed enum selected by the Rust integration fixture before session creation; production Node-API exports contain no fault argument or callback. Junction construction failure in a Windows security test is a test failure, never a skip. An unsupported directory flush returns `directorySync: "unchecked"` without converting publication failure into success.

- [ ] **Step 4: Run GREEN and leak stress**

```powershell
cargo +1.88.0 test --manifest-path native/windows-k1-helper/Cargo.toml --test windows_integration -- publish_ticket
cargo +1.88.0 test --manifest-path native/windows-k1-helper/Cargo.toml --release --test windows_integration -- handle_leak_stress
```

Expected: all substitution canaries unchanged; 10,000 create/refuse/close cycles have bounded handle count.

- [ ] **Step 5: Commit**

```powershell
git add -- native/windows-k1-helper
git commit -m "test(ledger): pin native ticket publication boundaries"
git add -- native/windows-k1-helper
git commit -m "feat(ledger): publish tickets through anchored handles"
```

### Task 4: Handle-relative lifecycle and permanent invalidation

**Files:**
- Modify: `native/windows-k1-helper/src/lib.rs`
- Modify: `native/windows-k1-helper/src/windows.rs`
- Modify: `native/windows-k1-helper/tests/windows_integration.rs`

**Interfaces:**
- Consumes genuine `NativeTicketArtifact`, exact disposition, marker, acknowledgement, and canonical acknowledgement bytes/digest.
- Produces `NativeLifecycleResult { status, directorySync }` and permanently consumes the artifact on a terminal transition.

```rust
#[napi(object)]
pub struct RetireTicketInput {
  pub disposition: String, // withdrawn | dead-owner
  pub marker_name: String,
  pub acknowledgement_name: String,
  pub acknowledgement_bytes: Buffer,
  pub expected_digest: String,
}

#[napi(object)]
pub struct NativeLifecycleResult {
  pub status: String,
  pub directory_sync: String, // verified | unchecked
}

#[napi]
impl NativeTicketArtifact {
  #[napi]
  pub fn retire_ticket(&mut self, input: RetireTicketInput) -> napi::Result<NativeLifecycleResult>;

  #[napi]
  pub fn close(&mut self) -> napi::Result<()>;
}
```

- [ ] **Step 1: Write RED lifecycle tests**

Cover owner withdrawal and dead-owner retirement as distinct dispositions; forged/foreign/closed/reused artifacts; marker/ack collision; every substitution boundary; crash before/after marker rename, ack write/flush/rename, marker removal; exact replay; and handle leak stress. Every ambiguous case leaves the external canary unchanged and performs no broad cleanup.

- [ ] **Step 2: Run RED**

```powershell
cargo +1.88.0 test --manifest-path native/windows-k1-helper/Cargo.toml --test windows_integration -- retire_ticket
```

Expected: lifecycle API absent or invalidation/recovery assertions fail.

- [ ] **Step 3: Implement lifecycle mutation**

Consume the artifact state before the first terminal mutation, retain native handles needed for idempotent completion, revalidate relative to anchored queue, rename with replacement disabled, publish canonical ack exclusively, and advance only exact typed state. A failed nonterminal attempt must restore only the same owner capability; a terminal/ambiguous attempt invalidates it.

- [ ] **Step 4: Run GREEN**

```powershell
cargo +1.88.0 test --manifest-path native/windows-k1-helper/Cargo.toml --test windows_integration -- retire_ticket
cargo +1.88.0 test --manifest-path native/windows-k1-helper/Cargo.toml
```

Expected: lifecycle and complete native suite pass.

- [ ] **Step 5: Commit**

```powershell
git add -- native/windows-k1-helper
git commit -m "test(ledger): specify native ticket retirement"
git add -- native/windows-k1-helper
git commit -m "feat(ledger): retire tickets through native capabilities"
```

### Task 5: Private TypeScript loader and fail-closed adapter

**Files:**
- Create: `src/authority/host/windows-k1-native.ts`
- Create: `test/authority/windows-k1-native.test.ts`
- Create: `scripts/windows-k1-native-digests.json`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes platform, architecture, expected manifest digest, and private native module.
- Produces:

```ts
export type WindowsK1NativeSupport =
  | Readonly<{ status: "available"; host: WindowsK1NativeHost }>
  | Readonly<{ status: "unsupported"; reason: "not-windows" | "unsupported-architecture" | "missing-binary" | "digest-mismatch" | "abi-mismatch" }>;

export function loadWindowsK1NativeHost(options?: Readonly<{
  platform?: NodeJS.Platform;
  architecture?: NodeJS.Architecture;
  packageRoot?: string;
}>): WindowsK1NativeSupport;
```

- [ ] **Step 1: Write RED loader/ownership tests**

Cover non-Windows no-load, x64/ARM64 exact path, missing binary, wrong PE architecture, digest mismatch, ABI/export mismatch, require/cache substitution, accessor/callback input, raw native thrown string redaction, forged/foreign/closed JS wrapper, and absence from public barrels/package exports.

- [ ] **Step 2: Run RED**

```powershell
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/authority/windows-k1-native.test.js
```

Expected: loader module absent or permissive loading assertions fail.

- [ ] **Step 3: Implement private loader and adapter**

Read and hash the binary before loading; verify the manifest entry and PE machine (`0x8664` x64, `0xAA64` ARM64); resolve only the exact package-relative path; copy/freeze inputs before native calls; map only closed native results; redact all other failures; cache only a successfully verified module identity. Do not export the loader from a barrel.

The committed digest manifest starts with explicit `pending` entries. A pending entry makes support unavailable; only Task 7 may replace it with a digest from a matching-architecture executed artifact.

- [ ] **Step 4: Run GREEN and contract gate**

```powershell
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/authority/windows-k1-native.test.js
npm run check:authority-contract
```

Expected: loader tests pass; no public contract drift.

- [ ] **Step 5: Commit**

```powershell
git add -- test/authority/windows-k1-native.test.ts scripts/windows-k1-native-digests.json
git commit -m "test(ledger): require fail-closed native addon loading"
git add -- src/authority/host/windows-k1-native.ts package.json package-lock.json
git commit -m "feat(ledger): load verified Windows K1 binaries privately"
```

### Task 6: Replace unsafe TypeScript publication with native-only Windows flow

**Files:**
- Modify: `src/authority/host/windows-k1-fifo.ts`
- Modify: `test/authority/windows-k1-fifo.test.ts`
- Modify: `test/authority/windows-k1-native.test.ts`

**Interfaces:**
- Consumes `loadWindowsK1NativeHost` and native opaque sessions/artifacts.
- Produces the existing private `WindowsK1FifoHost` API without a Windows pathname mutation path.

- [ ] **Step 1: Write RED no-fallback tests**

Assert Windows `enter` refuses before any filesystem write when the binary is pending/missing/tampered/wrong-arch; source-level assertions reject `mkdir`, `open`, `rename`, `rm`, `writeFile`, or `realpath` usage in the Windows publication/lifecycle path; non-Windows tests retain current behavior. Port Task 2 tests for immutable construction input, final validation, closed/double-close permits, real `lstat` residue identity, exact canonical prefix, collision-with-no-second-artifact, and external canary.

- [ ] **Step 2: Run RED**

```powershell
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/authority/windows-k1-native.test.js dist-test/test/authority/windows-k1-fifo.test.js
```

Expected: unsafe pathname code or fallback assertions fail.

- [ ] **Step 3: Delete the unsafe path and adapt native capabilities**

Capture construction-time binding/runtime values immutably. On Windows, obtain one verified native host/session and delegate publication/lifecycle. Translate native artifacts into the existing module-private permit WeakMap. `close` deletes state before closing native resources; reuse refuses. On unsupported native status, return closed `corruption`/`unsupported` without touching the queue or root mutex.

- [ ] **Step 4: Run GREEN**

```powershell
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/authority/windows-k1-native.test.js dist-test/test/authority/windows-k1-fifo.test.js
npm run build
npm run check:authority-contract
```

Expected: all focused tests pass; build and contract gate pass.

- [ ] **Step 5: Commit**

```powershell
git add -- test/authority/windows-k1-native.test.ts test/authority/windows-k1-fifo.test.ts
git commit -m "test(ledger): forbid Windows pathname publication fallback"
git add -- src/authority/host/windows-k1-native.ts src/authority/host/windows-k1-fifo.ts
git commit -m "fix(ledger): route Windows tickets through native handles"
```

### Task 7: Reproducible x64/ARM64 build, package, and hosted execution

**Files:**
- Create: `scripts/build-windows-k1-native.mjs`
- Create: `scripts/verify-windows-k1-native.mjs`
- Modify: `scripts/windows-k1-native-digests.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.github/workflows/ci.yml`
- Create: `.github/workflows/windows-native-arm64.yml`
- Modify: `.superpowers/sdd/2026-08-12-windows-k1-fifo-admission/progress.md`

**Interfaces:**
- Consumes matching-architecture Rust build outputs and native integration evidence.
- Produces exact package paths:

```text
dist/native/win32-x64/reelier_windows_k1.node
dist/native/win32-arm64/reelier_windows_k1.node
```

- [ ] **Step 1: Write RED packaging/workflow tests**

Add script tests that reject missing binaries, wrong PE machine, pending/wrong digest, unexpected `.node` files, public export exposure, install scripts, and packed tarballs missing either binary. Add source assertions that CI has one matching-hardware x64 job and one `windows-11-arm` ARM64 job, each running native integration tests and a packed-install smoke test.

- [ ] **Step 2: Run RED**

```powershell
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 --test-name-pattern="Windows K1 native package|Windows K1 native workflow" dist-test/test/**/*.test.js
```

Expected: build/verify scripts and ARM64 workflow are absent.

- [ ] **Step 3: Implement reproducible build and verification**

`build-windows-k1-native.mjs` accepts only `win32-x64` or `win32-arm64`, invokes the pinned Cargo target, copies the one expected `.node`, and refuses extra artifacts. `verify-windows-k1-native.mjs` checks PE machine, SHA-256 manifest, exact package paths, no install/postinstall scripts, and `npm pack --dry-run --json` contents.

CI requirements:

- x64: existing `windows-latest`, Node 20 and 22 native smoke/integration matrix, upload exact binary/evidence;
- ARM64: `windows-11-arm`, Node 20 and 22, native smoke/integration tests, upload exact binary/evidence;
- a packaging job downloads both artifacts, writes the digest manifest from those exact executed bytes, builds TypeScript, packs, installs into a clean directory, loads the matching binary on each architecture, and records package/binary digests.

Because a single GitHub job cannot execute both architectures, the final publish-ready digest manifest is assembled from the two successful matching-hardware artifacts and committed in a dedicated evidence commit before release. Until then, local package verification must fail closed.

- [ ] **Step 4: Run local and hosted gates**

Local:

```powershell
npm run build
npm test
npm pack --dry-run --json
npm run check:authority-contract
git diff --check
```

Hosted exact pushed commit:

- x64 Rust unit/integration, Node 20/22 load, packed install;
- ARM64 Rust unit/integration, Node 20/22 load, packed install;
- external canary unchanged for every junction seam;
- no skipped native security assertion;
- full Ubuntu and Windows suites green.

- [ ] **Step 5: Independent review and evidence commit**

Require a Rust/Windows safety review and a package/release review. Replace both `pending` digest entries only with the SHA-256 values of the matching-architecture executed artifacts. Re-run package verification against the exact packed tarball.

```powershell
git add -- native/windows-k1-helper scripts package.json package-lock.json .github/workflows/ci.yml .github/workflows/windows-native-arm64.yml .superpowers/sdd/2026-08-12-windows-k1-fifo-admission/progress.md
git commit -m "build(ledger): certify Windows K1 native binaries"
git push origin codex/outcomes-delegation-infra
```

- [ ] **Step 6: Resume the FIFO admission plan**

Only after both architecture gates and reviews are green, mark the native blocker resolved in the original FIFO ledger and resume `2026-08-12-windows-k1-fifo-admission.md` at its publication review, then election. Do not merge, publish npm, deploy providers, or claim paid-beta completion in this plan.
