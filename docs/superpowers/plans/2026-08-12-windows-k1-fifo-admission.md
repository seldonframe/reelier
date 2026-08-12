# Windows K1 FIFO Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace barging-prone Windows K1 named-pipe admission with a durable, crash-recoverable FIFO queue that gives every live contender an ordered opportunity to acquire the existing exclusive root mutex.

**Architecture:** A new private host module owns ticket parsing, publication, election, withdrawal, dead-owner recovery, and opaque elected permits. `FsAuthorityLedger` supplies its existing exact root binding and admission ticket, consumes a genuine elected permit, then acquires the unchanged Windows named-pipe mutex; queue state never authorizes a callback or ledger transition. Linux and the public authority ABI remain unchanged.

**Tech Stack:** TypeScript/Node.js 22, `node:fs/promises`, `node:net` named pipes, canonical JSON/JCS digests, Node test runner, real Windows child processes, existing K1 operation-fence and filesystem-identity primitives.

## Global Constraints

- Work only in `C:\Users\maxim\CascadeProjects\reelier\.worktrees\outcomes-delegation-infra`.
- Preserve the pre-existing untracked `.tmp-pack/` and unrelated stat-only certification paths.
- Do not modify, merge, or revert PR #117's badge-only change.
- Public exports remain exactly `reelier/authority`, `reelier/authority/pack`, and `reelier/authority/host`; the FIFO module is never re-exported.
- The existing named pipe remains the exclusive root-epoch mutex; FIFO state only schedules the one process allowed to attempt it.
- Never increase the default 30,000 ms lock timeout, add sleeps to make a test pass, downgrade corruption to `busy`, or infer dead ownership from PID alone.
- A ticket liveness endpoint is the owner-instance proof. PID state is supporting evidence only.
- Ambiguous, foreign, access-denied, substituted, linked, or identity-changing state refuses mutation.
- No queue path may invoke a provider, consume a budget, write a receipt, or enter `before-ledger-operation-callback`.
- Every task uses RED then GREEN commits and receives an independent read-only review before the next task begins.
- Local N100 passes do not close the release gate. Repeated hosted Windows evidence is mandatory.

## File structure

- Create `src/authority/host/windows-k1-fifo.ts`: private closed ticket protocol, exact filesystem and liveness verification, election, withdrawal, recovery, and opaque permit lifecycle.
- Create `test/authority/windows-k1-fifo.test.ts`: pure protocol, filesystem, liveness, substitution, election, withdrawal, and recovery tests.
- Create `test/authority/windows-k1-fifo-child.ts`: one narrowly parameterized real-process fixture for publish/wait/acquire/withdraw/crash scenarios; it is compiled but is not a `*.test.ts` discovery target.
- Modify `src/authority/host/fs-ledger.ts`: Windows-only integration before `acquireWindowsK1RootMutex`, private fault seams, root layout allowance, and no-bypass enforcement.
- Modify `test/authority/ledger.test.ts`: integration, crash matrix, ten-process order, N100 convergence, Linux-regression, and public-ABI assertions.
- Create `scripts/run-windows-fifo-stress.mjs`: cross-platform CI entry point that is a no-op off Windows and runs the exact N100 hosted falsifier five times on Windows.
- Modify `package.json`: add the private `test:windows-fifo-stress` script without changing package exports.
- Modify `.github/workflows/ci.yml`: run the repeated hosted falsifier on the Windows matrix leg after the full suite has compiled the tests.
- Update `.superpowers/sdd/windows-100proc-convergence-report.md`: exact commits, local evidence, hosted run IDs, reviewer verdicts, and remaining risk.

---

### Task 1: Closed ticket vocabulary and deterministic ordering

**Files:**
- Create: `src/authority/host/windows-k1-fifo.ts`
- Create: `test/authority/windows-k1-fifo.test.ts`

**Interfaces:**
- Consumes: an exact K1 root binding with `canonicalRoot`, `rootIdentity`, and `materialDigest`; the already drawn unsigned 64-bit admission ticket.
- Produces:

```ts
export interface WindowsK1FifoBinding {
  readonly canonicalRoot: string;
  readonly rootIdentity: Readonly<{ dev: string; ino: string; mode: string }>;
  readonly materialDigest: `sha256:${string}`;
}

export interface WindowsK1FifoTicketRecord {
  readonly v: "reelier.windows-k1-fifo-ticket/internal-v1";
  readonly rootMaterialDigest: `sha256:${string}`;
  readonly ticket: string; // exactly 16 lowercase hexadecimal characters
  readonly hostDigest: string; // exactly 64 lowercase hexadecimal characters
  readonly pid: number;
  readonly nonce: string; // exactly 64 lowercase hexadecimal characters
  readonly livenessDigest: `sha256:${string}`;
}

export type ParsedWindowsK1FifoName =
  | Readonly<{ kind: "preparation"; orderKey: string; name: string }>
  | Readonly<{ kind: "ticket"; orderKey: string; name: string }>
  | Readonly<{ kind: "retired"; orderKey: string; name: string }>
  | Readonly<{ kind: "withdrawal"; orderKey: string; name: string }>;

export function parseWindowsK1FifoTicketRecord(bytes: Buffer): WindowsK1FifoTicketRecord;
export function parseWindowsK1FifoName(name: string): ParsedWindowsK1FifoName | null;
export function compareWindowsK1FifoTickets(left: WindowsK1FifoTicketRecord, right: WindowsK1FifoTicketRecord): number;
```

- [ ] **Step 1: Write closed-vector and substitution tests**

Add tests that accept one canonical record/name of each kind and reject extra keys, missing keys, uppercase hex, ticket `0000000000000000`, ticket overflow, unsafe PID, zero digest, wrong root digest, broad prefixes, suffixes, path separators, control characters, and duplicate total-order identities.

```ts
const canonical: WindowsK1FifoTicketRecord = {
  v: "reelier.windows-k1-fifo-ticket/internal-v1",
  rootMaterialDigest: `sha256:${"1".repeat(64)}`,
  ticket: "0000000000000001",
  hostDigest: "2".repeat(64),
  pid: 41001,
  nonce: "3".repeat(64),
  livenessDigest: `sha256:${"4".repeat(64)}`,
};
assert.deepEqual(parseWindowsK1FifoTicketRecord(canonicalBytes(canonical)), canonical);
assert.throws(() => parseWindowsK1FifoTicketRecord(canonicalBytes({ ...canonical, extra: true })));
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx tsc -p tsconfig.test.json --pretty false
```

Expected: `TS2307` or `TS2305` for the absent private FIFO module/functions.

- [ ] **Step 3: Implement canonical record parsing, names, and comparison**

Use exact key equality and byte-canonical parsing. Derive the order key without locale-sensitive comparison:

```ts
const orderKey = `${record.ticket}-${record.hostDigest}-${record.pid.toString(10).padStart(10, "0")}-${record.nonce}`;
const ticketName = `.ticket-${orderKey}`;
const preparationName = `.ticket-prep-${orderKey}.tmp`;
```

`compareWindowsK1FifoTickets` compares ticket as `BigInt("0x" + ticket)`, then host digest, PID, and nonce using ordinary code-unit comparison. It returns zero only for an identical total-order identity.

Define liveness identity without a digest cycle. `livenessDigest` commits to the identity material excluding itself, and the named-pipe name is derived from that digest:

```ts
const livenessDigest = authorityDigest({
  v: "reelier.windows-k1-fifo-liveness-material/internal-v1",
  rootMaterialDigest: binding.materialDigest,
  ticket: ticketHex,
  hostDigest,
  pid,
  nonce,
});
```

The exact liveness response may additionally commit to the canonical complete ticket-record digest. Neither digest may include itself directly or indirectly.

- [ ] **Step 4: Prove the pure protocol GREEN**

Run:

```powershell
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/authority/windows-k1-fifo.test.js
npm run check:authority-contract
```

Expected: all Task 1 tests pass; the authority contract reports no public drift.

- [ ] **Step 5: Commit RED and GREEN separately**

```powershell
git add -- test/authority/windows-k1-fifo.test.ts
git commit -m "test(ledger): specify Windows FIFO ticket vocabulary"
git add -- src/authority/host/windows-k1-fifo.ts
git commit -m "feat(ledger): add closed Windows FIFO ticket protocol"
```

### Task 2: Exact publication and opaque ticket lease

**Files:**
- Modify: `src/authority/host/windows-k1-fifo.ts`
- Modify: `test/authority/windows-k1-fifo.test.ts`

**Interfaces:**
- Consumes: Task 1 records/names plus injected monotonic runtime and internal fault observer.
- Produces:

```ts
export interface WindowsK1FifoRuntime {
  readonly monotonicNow: () => number;
  readonly delay: (milliseconds: number) => Promise<void>;
}

export type WindowsK1FifoEnterResult =
  | Readonly<{ ok: false; reason: "busy" | "corruption" }>
  | Readonly<{ ok: true; permit: WindowsK1FifoPermit }>;

export function createWindowsK1FifoHost(input: Readonly<{
  root: string;
  binding: WindowsK1FifoBinding;
  runtime: WindowsK1FifoRuntime;
  faultInjector?: (point: string) => void;
}>): WindowsK1FifoHost;

export interface WindowsK1FifoHost {
  enter(input: Readonly<{ ticket: bigint; pid: number; nonce: string; deadline: number }>): Promise<WindowsK1FifoEnterResult>;
  withdraw(permit: WindowsK1FifoPermit): Promise<"withdrawn" | "busy" | "corruption">;
  close(permit: WindowsK1FifoPermit): Promise<void>;
}
```

`WindowsK1FifoPermit` is a non-serializable empty frozen object whose state exists only in a module-private `WeakMap`.

- [ ] **Step 1: Write RED publication-boundary tests**

Cover exclusive queue creation, preparation creation, ticket file creation, one-byte prefix, complete write, file sync, preparation-directory sync, rename, queue-directory sync, and final exact validation. At every boundary, hard-exit a child and assert that only one typed recoverable artifact remains.

Also assert:

```ts
assert.deepEqual(Object.keys(result.permit), []);
assert.equal(JSON.stringify(result.permit), "{}");
await assert.rejects(() => unrelatedHost.withdraw(result.permit));
```

- [ ] **Step 2: Run RED**

Run:

```powershell
npx tsc -p tsconfig.test.json --pretty false
```

Expected: compile errors for `createWindowsK1FifoHost`, `WindowsK1FifoPermit`, and `enter`.

- [ ] **Step 3: Implement link-confined publication**

Create `.authority-ledger-k1-fifo` beneath the exact root, verify every existing ancestor with `lstat`, forbid symlinks/reparse-point traversal, and verify `realpath`/identity containment. Publish with `mkdir`, `open("wx", 0o600)`, write-all, `FileHandle.sync`, directory sync, exact byte reread, and atomic rename. Map unexplained `ENOENT` after exclusive creation to corruption.

Store permit state only after the final committed ticket has been revalidated:

```ts
const permit = Object.freeze({}) as WindowsK1FifoPermit;
permitBindings.set(permit, {
  status: "queued",
  ticketName,
  ticketIdentity,
  ticketFileIdentity,
  ticketBytes,
  livenessServer,
});
```

- [ ] **Step 4: Run publication and confinement tests**

Run:

```powershell
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 --test-name-pattern="Windows K1 FIFO publication|Windows K1 FIFO confinement|opaque FIFO permit" dist-test/test/authority/windows-k1-fifo.test.js
```

Expected: every focused test passes; external link targets remain byte-identical.

- [ ] **Step 5: Commit**

```powershell
git add -- test/authority/windows-k1-fifo.test.ts
git commit -m "test(ledger): specify durable Windows FIFO publication"
git add -- src/authority/host/windows-k1-fifo.ts
git commit -m "feat(ledger): publish opaque Windows FIFO tickets"
```

### Task 3: Exact liveness identity and non-barging election

**Files:**
- Modify: `src/authority/host/windows-k1-fifo.ts`
- Modify: `test/authority/windows-k1-fifo.test.ts`

**Interfaces:**
- Consumes: Task 2's queued permit.
- Adds:

```ts
export interface WindowsK1FifoHost {
  enter(input: Readonly<{ ticket: bigint; pid: number; nonce: string; deadline: number }>): Promise<WindowsK1FifoEnterResult>;
  awaitTurn(permit: WindowsK1FifoPermit): Promise<"elected" | "busy" | "corruption">;
  commitAcquired(permit: WindowsK1FifoPermit): Promise<"committed" | "corruption">;
  withdraw(permit: WindowsK1FifoPermit): Promise<"withdrawn" | "busy" | "corruption">;
  close(permit: WindowsK1FifoPermit): Promise<void>;
}
```

- [ ] **Step 1: Write RED liveness and ordering tests**

Publish ten tickets in deliberately shuffled process-start order. Assert `awaitTurn` elects only the lowest total-order record. Hold the oldest permit while continuously adding later tickets and assert no later permit returns `elected`.

Test the liveness response:

```ts
const expected = `reelier-windows-k1-fifo-liveness/internal-v1 ${recordDigest}\n`;
assert.equal(await probeTicketLiveness(record), "same");
assert.equal(await probeTicketLiveness({ ...record, livenessDigest: other }), "foreign");
```

Reject accessor-backed records, response overrun, timeout, partial response, wrong digest, PID reuse with a different endpoint, and endpoint rebinding.

- [ ] **Step 2: Run RED**

Run:

```powershell
npx tsc -p tsconfig.test.json --pretty false
```

Expected: missing `awaitTurn`, `commitAcquired`, and liveness probe types.

- [ ] **Step 3: Implement stable two-snapshot election**

`awaitTurn` must:

1. enumerate the queue twice;
2. parse and exact-validate every reserved entry;
3. require identical names and filesystem identities;
4. sort committed tickets by Task 1 ordering;
5. return `elected` only for the oldest exact permit;
6. otherwise wait for bounded progress and repeat until `deadline`.

Start the unique liveness named pipe before filesystem publication. Its name is derived from the root material digest and the non-circular `livenessDigest` defined in Task 1; its response commits to the canonical complete ticket-record digest, is exact, and is capped at 256 bytes.

`commitAcquired` is permitted only from `elected`. It exact-revalidates and removes the caller's own ticket after the existing root mutex has been acquired, syncs the queue directory, then marks the permit `acquired`.

- [ ] **Step 4: Prove non-barging GREEN**

Run:

```powershell
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 --test-name-pattern="FIFO liveness|FIFO election|later arrivals cannot barge" dist-test/test/authority/windows-k1-fifo.test.js
```

Expected: ten-ticket order is exact; later arrivals remain queued; only one permit is elected.

- [ ] **Step 5: Commit**

```powershell
git add -- test/authority/windows-k1-fifo.test.ts
git commit -m "test(ledger): require non-barging Windows FIFO election"
git add -- src/authority/host/windows-k1-fifo.ts
git commit -m "feat(ledger): elect the oldest live Windows ticket"
```

### Task 4: Owner withdrawal and dead-ticket recovery

**Files:**
- Modify: `src/authority/host/windows-k1-fifo.ts`
- Modify: `test/authority/windows-k1-fifo.test.ts`

**Interfaces:**
- Consumes: Task 3 ticket permits and liveness probes.
- Produces typed internal lifecycle names and idempotent `withdraw`, plus recovery performed within `awaitTurn` before election.

- [ ] **Step 1: Write RED lifecycle tests**

Cover owner withdrawal from queued/elected states, exact replay, deadline during withdrawal, partial marker/ack writes, dead predecessor, live predecessor, foreign endpoint, access denied, two vacant observations separated by delay, PID reuse, same-name replacement, original-name reappearance, and competing recovery.

Pin this authority rule:

```ts
assert.deepEqual(await recoverWith({ pipe: "vacant", pid: "alive" }), "progress");
assert.deepEqual(await recoverWith({ pipe: "unknown", pid: "dead" }), "busy");
assert.deepEqual(await recoverWith({ pipe: "foreign", pid: "dead" }), "busy");
```

The first case is allowed only after two exact vacant pipe observations and unchanged closed snapshots. PID alone never authorizes cleanup.

- [ ] **Step 2: Run RED**

Run:

```powershell
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 --test-name-pattern="FIFO withdrawal|FIFO dead-ticket recovery" dist-test/test/authority/windows-k1-fifo.test.js
```

Expected: new lifecycle assertions fail because typed retirement/acknowledgement handling is absent.

- [ ] **Step 3: Implement monotonic retirement and cleanup**

Use typed lifecycle artifacts:

```ts
type TicketRetirementAck = Readonly<{
  v: "reelier.windows-k1-fifo-retirement-ack/internal-v1";
  disposition: "withdrawn" | "dead-owner";
  originalName: string;
  markerName: string;
  ticketDigest: `sha256:${string}`;
  ticketIdentity: Readonly<{ dev: string; ino: string; mode: string; nlink: string }>;
  ticketFileIdentity: Readonly<{ dev: string; ino: string; mode: string; nlink: string }>;
}>;
```

Withdrawal authority is the genuine permit. Dead-owner retirement authority is a module-private opaque value minted only after stable closed snapshots, two `vacant` liveness probes, and one final exact revalidation. Rename to a typed marker, sync, write canonical ack through an exclusive stage, rename stage to final ack, sync, remove marker, sync, then remove final ack only after the closed terminal is established.

- [ ] **Step 4: Run lifecycle and adversarial tests**

Run:

```powershell
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 --test-name-pattern="FIFO withdrawal|FIFO dead-ticket recovery|FIFO lifecycle substitution" dist-test/test/authority/windows-k1-fifo.test.js
```

Expected: all tests pass; ambiguous liveness performs zero filesystem mutation.

- [ ] **Step 5: Commit**

```powershell
git add -- test/authority/windows-k1-fifo.test.ts
git commit -m "test(ledger): specify FIFO withdrawal and dead-owner recovery"
git add -- src/authority/host/windows-k1-fifo.ts
git commit -m "feat(ledger): recover dead Windows FIFO tickets"
```

### Task 5: Integrate FIFO before the Windows root mutex

**Files:**
- Modify: `src/authority/host/fs-ledger.ts`
- Modify: `test/authority/ledger.test.ts`

**Interfaces:**
- Consumes: `createWindowsK1FifoHost`, `enter`, `awaitTurn`, `commitAcquired`, `withdraw`, and `close` from Tasks 2–4.
- Produces: unchanged `withK1OperationFence` result contract and unchanged public `FsAuthorityLedger` API.

`FsAuthorityLedger` adds exactly one private field and constructs it only after the ledger root has been bound and canonically verified:

```ts
private readonly windowsK1Fifo: WindowsK1FifoHost | null;

this.windowsK1Fifo = process.platform === "win32"
  ? createWindowsK1FifoHost({
      root: this.root,
      binding,
      runtime: { monotonicNow, delay },
      faultInjector: internalFaultInjector,
    })
  : null;
```

`createWindowsK1FifoHost` performs no filesystem or network I/O. `enter` creates or verifies the queue directory under the already verified root. A Windows execution with a missing host is corruption, never a direct-mutex fallback.

- [ ] **Step 1: Write RED integration and no-bypass tests**

Add Windows-emulated private-runtime tests that prove:

- no root-mutex `listen` attempt occurs before genuine election;
- a forged/closed/wrong-host permit cannot reach mutex acquisition;
- one elected permit reaches the existing root-bound named pipe;
- ticket removal occurs only after mutex acquisition and root revalidation;
- failure before mutex acquisition withdraws the exact ticket;
- failure after mutex acquisition cannot admit a second root transition;
- Linux skips queue creation and follows byte-for-byte existing behavior;
- authority barrels and `package.json` exports contain no FIFO symbol.

- [ ] **Step 2: Run RED**

Run:

```powershell
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 --test-name-pattern="Windows K1 FIFO integration|FIFO symbols remain private" dist-test/test/authority/ledger.test.js
```

Expected: the mutex is still attempted directly and the integration-order assertion fails.

- [ ] **Step 3: Integrate only on Windows**

In `withK1OperationFence`, after the in-process fence admission and before `acquireWindowsK1RootMutex`:

```ts
let fifoPermit: WindowsK1FifoPermit | undefined;
if (process.platform === "win32") {
  const entered = await this.windowsK1Fifo.enter({
    ticket: drawn.ticket,
    pid: process.pid,
    nonce: randomBytes(32).toString("hex"),
    deadline,
  });
  if (!entered.ok) return frozen(entered);
  fifoPermit = entered.permit;
  const turn = await this.windowsK1Fifo.awaitTurn(fifoPermit);
  if (turn !== "elected") return frozen({ ok: false, reason: turn });
  windowsRootMutex = await acquireWindowsK1RootMutex(binding, runtime, deadline);
  if (windowsRootMutex === null) return frozen({ ok: false, reason: "busy" });
  if (!await this.revalidateK1OperationFenceRoot(binding)) return frozen({ ok: false, reason: "busy" });
  if (await this.windowsK1Fifo.commitAcquired(fifoPermit) !== "committed") return frozen({ ok: false, reason: "corruption" });
}
```

The actual implementation must withdraw an uncommitted genuine permit in `finally`, close its liveness server, then close the root mutex. Add `.authority-ledger-k1-fifo` to the exact root allowlist without adding it to `isK1ReservedName`; the permanent subdirectory is inert to legacy/K1 graph classification.

Update the private fault-boundary documentation/count in `FsAuthorityLedgerOptions` to match the actual boundary set after adding FIFO seams. Do not expose those seams through a public package export.

- [ ] **Step 4: Run integration, ledger, and Linux regression tests**

Run:

```powershell
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 --test-name-pattern="Windows K1 FIFO integration|K1 operation fence|authority ledger root rejects" dist-test/test/authority/ledger.test.js
npm run check:authority-contract
```

Expected: all focused tests pass and public contract drift remains empty.

- [ ] **Step 5: Commit**

```powershell
git add -- test/authority/ledger.test.ts
git commit -m "test(ledger): require FIFO before the Windows root mutex"
git add -- src/authority/host/fs-ledger.ts
git commit -m "feat(ledger): serialize Windows admission through FIFO"
```

### Task 6: Crash matrix and real-process fairness

**Files:**
- Create: `test/authority/windows-k1-fifo-child.ts`
- Modify: `test/authority/windows-k1-fifo.test.ts`
- Modify: `test/authority/ledger.test.ts`

**Interfaces:**
- Consumes: fully integrated private FIFO protocol.
- Produces: deterministic real-process evidence and a reusable child fixture with this closed input:

```ts
type ChildCommand = Readonly<{
  v: "reelier.windows-k1-fifo-child/v1";
  root: string;
  command: "reserve" | "hold-before-mutex" | "crash-at-boundary";
  boundary: string | null;
  releaseFile: string | null;
}>;
```

- [ ] **Step 1: Write RED crash and fairness tests**

Add one test per durable boundary: liveness bound, preparation created, ticket file created, partial write, file sync, preparation sync, committed rename, queue sync, elected, mutex acquired, ticket removed, withdrawal marker, retirement marker, cleanup stage, cleanup ack, marker removal, and final sync.

Add real-process tests:

```ts
assert.deepEqual(acquisitionOrder, sortedPublishedTicketOrder);
assert.equal(results.filter(result => result.dispatchEligible).length, 1);
assert.equal(results.every(result => result.ok), true, JSON.stringify(results.filter(result => !result.ok)));
```

The starvation test starts one oldest ticket, then continuously starts later arrivals while the first mutex holder releases. It fails if any later ticket acquires before the oldest waiter.

- [ ] **Step 2: Run RED**

Run:

```powershell
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 --test-name-pattern="FIFO crash matrix|later process cannot barge|100 real processes converge" dist-test/test/authority/windows-k1-fifo.test.js dist-test/test/authority/ledger.test.js
```

Expected: missing child fixture/protocol boundary handling or an ordering assertion fails.

- [ ] **Step 3: Complete only the recovery logic required by observed REDs**

Use the typed artifacts and opaque authorities from Tasks 2–4. Do not add a second queue, broker, wall-clock lease, or fallback direct-mutex path. Each crash recovery must either advance one authenticated lifecycle step, return `busy`, or return `corruption`; it may never delete an unclassified path.

- [ ] **Step 4: Run repeated local stress**

Run:

```powershell
npx tsc -p tsconfig.test.json --pretty false
1..10 | ForEach-Object {
  node --test --test-concurrency=1 --test-name-pattern="100 real processes converge" dist-test/test/authority/ledger.test.js
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
node --test --test-concurrency=1 --test-name-pattern="FIFO crash matrix|later process cannot barge|predecessor crash" dist-test/test/authority/windows-k1-fifo.test.js
```

Expected: ten N100 passes, each with one reservation and one dispatch-eligible winner; every crash test converges without raw filesystem errors.

- [ ] **Step 5: Commit**

```powershell
git add -- test/authority/windows-k1-fifo-child.ts test/authority/windows-k1-fifo.test.ts test/authority/ledger.test.ts src/authority/host/windows-k1-fifo.ts src/authority/host/fs-ledger.ts
git commit -m "test(ledger): certify crash-safe Windows FIFO admission"
```

### Task 7: Independent review, hosted Windows falsifier, and closure evidence

**Files:**
- Create: `scripts/run-windows-fifo-stress.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Update: `.superpowers/sdd/windows-100proc-convergence-report.md`
- Modify only if a reviewer finds a defect: files already owned by Tasks 1–6.

**Interfaces:**
- Consumes: all prior commits and the exact packed branch.
- Produces: review verdict, hosted CI URLs/run IDs, and an honest release-gate decision.

- [ ] **Step 1: Run the complete local verification gate**

Run:

```powershell
npm run build
npx tsc -p tsconfig.test.json --pretty false
node --test --test-concurrency=1 dist-test/test/authority/windows-k1-fifo.test.js
node --test --test-concurrency=1 dist-test/test/authority/ledger.test.js
npm run check:authority-contract
git diff --check
```

Expected: zero failures; only the pre-existing `.tmp-pack/` and known empty-diff stat paths remain unstaged.

- [ ] **Step 2: Request two-stage independent review**

The specification reviewer checks every safety property and rejected approach. The code-quality reviewer checks filesystem identity, liveness ambiguity, ticket ordering, crash recovery, no public export, and no direct-mutex bypass. Any blocker returns to a new RED/GREEN pair and the same reviewers re-review the exact fix range.

- [ ] **Step 3: Add an executable hosted Windows stress gate**

Create `scripts/run-windows-fifo-stress.mjs` as a no-op on non-Windows hosts. On Windows it must spawn the Node test runner five sequential times against the exact compiled N100 test and fail on the first non-zero exit:

```js
import { spawnSync } from "node:child_process";

if (process.platform === "win32") {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const result = spawnSync(process.execPath, [
      "--test",
      "--test-concurrency=1",
      "--test-name-pattern=100 real processes converge",
      "dist-test/test/authority/ledger.test.js",
    ], { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
```

Add `"test:windows-fifo-stress": "node scripts/run-windows-fifo-stress.mjs"` to `package.json`. Add a Windows-only step to `.github/workflows/ci.yml` immediately after `Run tests`:

```yaml
- name: Repeat Windows FIFO N100 falsifier
  if: runner.os == 'Windows'
  run: npm run test:windows-fifo-stress
```

The workflow step is mandatory and may not be marked `continue-on-error`. Test the script on Linux as a no-op and on Windows through the hosted matrix; add a source-level workflow/script test if repository conventions require workflow pinning assertions to be updated.

- [ ] **Step 4: Commit the hosted gate and push the implementation branch without merging**

```powershell
git add -- scripts/run-windows-fifo-stress.mjs package.json .github/workflows/ci.yml
git commit -m "test(ledger): repeat Windows FIFO falsifier in CI"
```

```powershell
git push origin codex/outcomes-delegation-infra
```

Expected: push succeeds; no tag, npm publication, Cloud deployment, or merge occurs.

- [ ] **Step 5: Run hosted Windows acceptance**

Require, on the exact pushed commit:

- the full Windows suite green;
- the full Ubuntu suite green;
- the canonical badge gate green;
- at least five hosted Windows N100 repetitions under CPU/filesystem pressure;
- FIFO crash matrix and later-arrival starvation tests green;
- no skipped fairness, liveness, or recovery assertion.

Do not rerun an unchanged failure indefinitely. One unchanged-tree failure reopens the corresponding protocol task with its exact event trace.

- [ ] **Step 6: Update and commit the evidence report**

The report must state exact commit, run/job URLs, pass counts, reviewer verdicts, remaining skips, and whether the hosted falsifiers are closed. It must preserve this sentence unless every hosted requirement passed:

```text
Windows FIFO admission remains a release blocker; local evidence does not close the hosted falsifier.
```

Commit:

```powershell
git add -f -- .superpowers/sdd/windows-100proc-convergence-report.md
git commit -m "docs(ledger): record Windows FIFO certification evidence"
git push origin codex/outcomes-delegation-infra
```

- [ ] **Step 7: Resume Task 4B only after closure**

When and only when Task 7 hosted evidence and both reviews are green, update the certification-train plan to mark Windows ledger admission complete and resume the hermetic GitHub runner review. Do not merge, publish, deploy providers, or claim paid-beta completion in this task.
