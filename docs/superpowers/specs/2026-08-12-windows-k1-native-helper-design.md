# Windows K1 native filesystem helper

## Decision

Replace the unsafe pathname-based Windows FIFO publication implementation with a small Rust
Node-API addon. Ship prebuilt Windows x64 and ARM64 binaries in the `reelier` npm package. The
addon anchors an exact ledger-root directory handle and performs FIFO filesystem mutations
relative to that handle while refusing reparse points and name substitution.

This specification supersedes only the prepare, publish, rename, and retire filesystem mechanics
in `2026-08-12-windows-k1-fifo-admission-design.md`. Ticket ordering, named-pipe liveness, election,
the existing root mutex, withdrawal policy, dead-owner policy, and the public authority ABI remain
unchanged.

## Why the native boundary is required

The first TypeScript publication implementation validated the FIFO queue pathname before each
mutation and revalidated it afterward. A deterministic Windows junction swap between validation
and `open("wx")` redirected the write outside the bound ledger root. Node v24 on Windows exposes no
descriptor-relative `openat`, `mkdirat`, or `renameat`, no usable `O_NOFOLLOW`, and no `FileHandle`
operation that creates or renames a child relative to an anchored directory handle.

Pre- and post-validation can detect the substitution only after the external write has occurred.
That violates the Authority Cell boundary. The TypeScript implementation must therefore never be
retained as a fallback.

## Trust boundary

TypeScript remains the authority-policy and FIFO-protocol owner. The addon is a narrow filesystem
capability primitive. It receives no tenant, task, Job Card, grant, allocation, provider request,
credential, budget, receipt, or agent-authored content.

At Authority Cell startup:

1. TypeScript resolves the configured ledger root and obtains the expected Windows volume serial
   and 128-bit file identity.
2. The addon opens that exact root without following a reparse point and verifies the supplied
   identity.
3. The addon returns a process-local opaque root session. JavaScript cannot extract, serialize, or
   substitute the underlying handle.
4. FIFO preparation, publication, and lifecycle mutations occur relative to the anchored root and
   queue handles.
5. The existing named pipe remains the exclusive K1 root mutex. Native queue state only determines
   which contender may attempt it.

Missing, incompatible, unsupported, or tampered native code makes Windows `local-fs` authority
unavailable. Read-only status and export remain available. There is no direct-mutex or pathname
fallback.

## Native implementation

The addon is written in Rust and exports Node-API only. It must not depend on V8 or private libuv
ABI. Rust owns every Windows handle through RAII, catches errors at the Node-API boundary, and must
not permit unwinding or panics across that boundary.

The Windows layer uses the minimum required anchored-handle operations:

- open the root and each directory component relative to its already verified parent;
- reject reparse-point traversal and `FILE_ATTRIBUTE_REPARSE_POINT` on every opened component;
- query volume serial, 128-bit file ID, type, attributes, and link information using handle-based
  metadata APIs;
- create directories and files exclusively relative to anchored parent handles;
- write canonical bytes in a progress-checked loop;
- flush file buffers before publication;
- reopen and revalidate exact bytes and identity relative to the same parent handle;
- rename an already-open object relative to the anchored destination-directory handle with
  replacement disabled;
- feature-test directory flush behavior and report unsupported durability honestly;
- close every native handle on every exit path.

The implementation may use the Windows Native API where the Win32 API lacks a handle-relative
operation. Every such call and flag is wrapped behind one internal Rust module and covered by
Windows integration tests.

## Closed Node-API surface

The addon exposes four conceptual operations. The actual Node-API names are internal and are never
re-exported from `reelier/authority` or `reelier/authority/host`.

```ts
openBoundRoot({
  canonicalRoot,
  expectedVolumeSerial,
  expectedFileId,
}): NativeRootSession;

publishTicket(session, {
  preparationName,
  ticketName,
  canonicalBytes,
  expectedDigest,
}): NativeTicketArtifact;

retireTicket(session, artifact, {
  disposition,
  markerName,
  acknowledgementName,
}): NativeLifecycleResult;

closeSession(session): void;
```

`NativeRootSession` and `NativeTicketArtifact` are opaque, nonserializable, process-local, and
owner-bound. Closing or consuming one permanently invalidates it. Forged, foreign, closed, reused,
or type-confused capabilities refuse.

The addon never accepts:

- arbitrary paths, absolute paths, separators, `.` or `..`;
- alternate data stream syntax or control characters;
- arbitrary access masks, share flags, replacement flags, or raw handle numbers;
- callbacks, JavaScript functions, provider data, or unbounded byte arrays.

Names must match the exact FIFO grammar already defined by the TypeScript protocol. The ticket file
name is fixed. Canonical bytes have a small constant maximum and must match `expectedDigest` before
any mutation.

## Closed results and errors

Native operations return a closed status vocabulary:

- `created`;
- `existing-identical`;
- `busy`;
- `corruption`;
- `unsupported`.

Raw Windows paths, handle values, NT status messages, system-formatted strings, and caller-owned
objects do not cross the boundary. Internal diagnostics may retain a closed numeric error class,
operation identifier, and redacted stage name.

An unexplained disappearance after exclusive creation is `corruption`. A collision is classified
before introducing a second artifact. Ambiguous reparse, identity, access, or lifecycle state never
authorizes cleanup. Unsupported directory flush behavior is reported as `unchecked` evidence; it
is never represented as verified power-loss durability.

## Publication flow

1. TypeScript derives the closed ticket identity and canonical record.
2. The addon validates the session, names, byte cap, and digest without filesystem mutation.
3. The addon opens or creates the FIFO queue beneath the anchored root and retains the verified
   queue handle.
4. It classifies any existing committed/preparation artifacts relative to that handle.
5. It exclusively creates the preparation directory and ticket file relative to retained parent
   handles.
6. It writes and flushes canonical bytes, then handle-revalidates identity, type, link state, and
   bytes.
7. It renames the already-open preparation object into the committed ticket name relative to the
   retained queue handle, with replacement disabled.
8. It reopens and validates the committed artifact relative to the retained queue handle.
9. Only after final validation does it mint the opaque native artifact capability.

Test-only fault injection is a closed enum captured when the test addon session is created. No
production JavaScript callback executes inside the mutation sequence.

## Lifecycle flow

Owner withdrawal and dead-owner retirement use distinct TypeScript authority paths but the same
native capability mechanics:

1. TypeScript proves owner-permit or dead-owner retirement authority.
2. The addon validates the opaque artifact and exact closed lifecycle names.
3. It handle-revalidates the artifact and anchored queue.
4. It renames the already-open artifact to the typed marker with replacement disabled.
5. It writes and flushes the canonical acknowledgement through an exclusive handle-relative stage.
6. It advances only exact, typed lifecycle state and invalidates the consumed artifact capability.

The addon does not decide whether a ticket is dead, oldest, expired, or authorized. Those remain
TypeScript protocol decisions.

## Packaging and compatibility

The package contains:

```text
dist/native/win32-x64/reelier_windows_k1.node
dist/native/win32-arm64/reelier_windows_k1.node
```

Both are prebuilt. `npm install` performs no Cargo, Visual Studio, `node-gyp`, postinstall download,
or network operation. Linux and macOS never resolve or load these files.

Build and release requirements:

- pin the Rust toolchain, Cargo dependency graph, Node-API ABI level, and Windows SDK assumptions;
- build x64 and ARM64 artifacts in controlled CI;
- execute the complete native integration corpus on each matching architecture;
- record SHA-256 digests for both binaries in packed-artifact release evidence;
- fail `npm pack` unless both binaries exist, have the expected PE architecture, expose only the
  expected Node-API initialization surface, and match their recorded digests;
- include the binaries through the existing `dist` package allowlist;
- do not publish ARM64 solely from a cross-compile: matching-architecture execution is mandatory.

Node-API provides runtime ABI stability across supported Node versions. The release corpus still
tests the minimum supported Node version and the certification-pinned Node version on Windows.

## Testing

### Rust tests

- exact closed-name grammar and byte caps;
- opaque session/artifact ownership and permanent invalidation;
- handle RAII on every result and injected failure;
- volume/file identity comparison and reparse rejection;
- status and diagnostic redaction;
- panic containment at the Node-API boundary.

### Windows native integration tests

Run on x64 and ARM64:

- root, queue, preparation, ticket, marker, and acknowledgement junction substitution at every
  create/open/write/rename boundary;
- external canary remains byte-identical after every substitution attempt;
- exclusive collision and identical retry;
- partial write, shrink, growth, same-name replacement, and identity change;
- crash after each durable transition;
- directory flush feature detection and honest evidence state;
- missing/tampered/wrong-architecture addon refusal.

### TypeScript integration tests

- immutable construction-time binding;
- forged, foreign, closed, reused, and double-closed capability refusal;
- no production callback surface;
- no TypeScript pathname or direct-mutex fallback;
- collision introduces no second artifact;
- crash residue uses `lstat`, exact identities, direct-child containment, and canonical prefix bytes;
- Linux follows its existing behavior and loads no native module;
- public authority contract contains no native-helper symbol.

### Hosted acceptance

- complete Windows x64 and ARM64 native corpora;
- repeated N100 FIFO convergence;
- later-arrival starvation resistance;
- predecessor and successor crash recovery;
- full Windows and Ubuntu suites;
- exact `npm pack` installation and binary-digest verification.

One unchanged-tree hosted failure reopens the corresponding protocol boundary. Local passes do not
close hosted falsifiers.

## Non-goals and honest claims

- The addon is not a general secure filesystem API.
- It does not make network filesystems or multi-host local ledgers safe.
- It does not authorize a task, grant, Outcome, provider request, or cleanup decision.
- It does not prove the requested action wise, safe, correct, or complete.
- Code signing may be added later, but signatures would authenticate a binary, not its authority;
  packed-artifact digests and the Authority Cell trust boundary remain mandatory.
- Unsupported power-loss durability is `unchecked`, not `verified`.
