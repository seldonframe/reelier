# Breaker Fixes and Tasks 6–8 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Read **Global Constraints** and **Assembler Resolutions** before your task — resolutions override the lane text where they conflict.

**Goal:** Fix the three Task-5 terminal falsifiers and complete Tasks 6–8 of
`docs/superpowers/plans/2026-08-18-eve-governed-production-release.md`, ending with `reelier@0.32.1`
shipped to npm, MCP Registry, and GHCR through the governed four-definition path.

**Architecture:** Three file-disjoint lanes (A kernel fixes, B release surface, C Fly substrate +
admin) run concurrently on `codex/eve-governed-production-release`, converging at one barrier; then
D-tasks: infra merge → re-pin → Eve smoke → two rehearsals → mission. Spec:
`docs/superpowers/specs/2026-08-19-breaker-fixes-and-tasks-6-8-design.md` (binding above this plan).

**Tech Stack:** TypeScript NodeNext ESM, Node 24, node:test on `dist-test`, Ed25519 signed contracts,
GitHub Actions OIDC/Trusted Publishing, Fly.io Machines + volume, Eve 0.39.0, Verdaccio (rehearsal npm).

## Global Constraints

- Branch `codex/eve-governed-production-release`; worktree `.worktrees/eve-governed-production-release`; base at assembly `6ad09b4d`.
- TDD: RED test → verify FAIL → minimal fix → verify PASS → `git diff --check` → commit. Test commit may precede fix commit (repo precedent).
- `pending` / `absent` / `unchecked` / `ambiguous` / missing evidence never pass; no resend after an ambiguous write.
- No external write (Fly, GitHub, npm, GHCR, MCP Registry, credentials) in Lane A/B tasks; Lane C/D steps that mutate external systems are marked OPERATOR-CONFIRM-FIRST and wait for the operator.
- Real-artifact fixture rule (spec §9): integration-seam tests consume artifacts produced by the real producer code path.
- Tests run on win32 under `__testSetAuthorityCellHostPlatform("linux")`; hard directory-fsync requirements key on the REAL `process.platform`.
- `src/authority/host/fs-ledger.ts` is never modified. `PreparedDispatchDescriptionV1.reservationId` stays raw `sha256:`.
- Frozen Task-4 contract amendments require an explicit operator exception (spec §10) — never a silent widening.
- Mission candidate cap: `src/cli.ts`, `test/cli-subcommand-help.test.ts`, `CHANGELOG.md` only (≤3 files, ≤65,536 bytes).

## Assembler Resolutions (binding; resolve the lane drafters' flagged notes)

- **R1 (amends A1, from laneA note 0):** `loadDurableHead`/`loadDurableChain` take an explicit
  expectation, not an inference from `ledgerState` alone: `expect: "terminal" | "root-or-terminal"`.
  The two callers with a legitimate reservation-only window pass `"root-or-terminal"`:
  `dispatch.ts` `recover()`'s pre-terminal crash branch (root published, terminal about to be
  written) and `github-release-runner.ts:231–232`'s root-publish readback. Every other durable
  readback (adoption, `confirmAuthoritativeHead`, post-crash confirmation) passes `"terminal"` and
  refuses a reservation-phase head with the A1 error text (`/terminal receipt is absent/`). A1's
  unlink test asserts the refusal through a `"terminal"`-expectation reader. This keeps the
  silent-rollback fix without breaking legitimate recovery.
- **R2 (amends D2, from laneC note 0 — pre-identified operator exception):** the spec's re-pin
  sequencing is paradoxical as written: the D2 PR that sets `RELEASE_BASE` advances `main` past its
  own pin, so the runner's `heads/main == plan.baseCommit` check refuses. Recommended resolution,
  to be operator-approved at D2 time as a frozen-contract amendment: relax the
  `baseCommit === RELEASE_BASE` constant-equality in `release-contracts.ts` parsers to
  format+authority checks, letting the Ed25519-signed, operator-reviewed authorization bundle carry
  the exact base; the runner still enforces `heads/main == plan.baseCommit` and main-ancestry at
  publication. Branch/tag/version/path/workflow pins stay constant-pinned. Alternatives (Cell-side
  pin; no-further-merges) are recorded in the D2 task. Do not start D2 before the operator decides.
- **R3 (new task D0, from laneC note 3):** no lane built the Eve mission organization. D0 (after C5
  smoke, before D3): extend `conformance/continuity-adapter/v1/eve-fixture` (real Eve 0.39.0,
  currently loopback-bound via env in `agent/lib/runtime.ts`/`binding.ts`) to a remote-HTTP Cell
  binding, define the root orchestrator + eight single-purpose roles as Eve agents whose root only
  performs `jobs.search`/`load`/`invoke` and evidence collection. Same 2-working-day timebox and
  fallback as C5/§2.5: Codex/Claude Code decomposition against the same signed Job Cards, Eve gap
  recorded as a finding.
- **R4 (amends B3/B4, from laneB note 1):** the verifier's authorization signer trust pin is read
  from a **committed trust-pin file** (`release/trust/release-authorization-signer.json`, landed in
  the D1 infra PR and covered by the workflow digest pins), not from mutable repository variables.
  Repo/environment variables must not be able to change the pin.
- **R5 (amends B4, from laneB note 9):** the verifier step in `mcp-publish.yml` carries the same
  tags-only condition as `docker-publish.yml`, so the pre-existing `workflow_dispatch` path keeps
  working until the mission; tag-triggered runs are always verified.
- **R6 (accepts laneB note 2):** workflows run `npm ci && npm run build` before the verifier step
  (the verifier imports the built barrel). The spec's step order is amended accordingly.
- **R7 (fixes laneA note 6):** A4 appends to the SDD ledger at
  `.superpowers/sdd/2026-08-18-eve-governed-production-release/progress.md` (it exists in this
  worktree; the drafter searched only `docs/`).
- **R8 (seam reconciliation, from laneA note 3 + laneC note 2):** A3's closed
  `reelier.github-release-runner-config/v1` schema is authoritative for config field names; Lane B
  widens its `provider` enum with the live `github-https` kind and `SecretResolver` credential
  references; Lane C's Fly secret names must match A3's parser. Verify this seam as a named item on
  the D1 barrier checklist.

## Execution Order

1. **Lane A sequential:** A1 → A2 → A3 → A4 (scoped re-review). Do not reorder (laneA note 8).
2. **Lane B:** B1 first (contract check; may STOP the transport choice for operator escalation —
   laneB note 0 expects the annotated-tag carrier to NOT fit the frozen `createRef` surface, making
   the operator decision likely); then B2–B5. Runs concurrently with Lane A (disjoint files).
3. **Lane C:** C1–C3 are OPERATOR-CONFIRM-FIRST (Fly/GitHub/npm consoles); C4 anytime; C5 after
   barrier. Runs concurrently.
4. **Barrier (D1):** all lanes green + full Ubuntu suite + R8 seam check → infra PR to `main`.
5. **D2 (operator exception per R2) → C5 smoke → D0 Eve org → D3 rehearsals ×2 → D4 mission → D5 contingencies armed** (Sep 1 auto-decouple).

---

## Lane A — kernel fixes (spec §4.1–§4.4; fix order A1 → A2 → A3, then A4 dispatch)

All paths are relative to the worktree root `C:/Users/maxim/CascadeProjects/reelier/.worktrees/eve-governed-production-release`. Run every command from that directory. Focused test command used throughout: `npx tsc -p tsconfig.test.json && node --test dist-test/test/authority/<file>.test.js` (the repo's canonical suite is `npm test` = `tsc -p tsconfig.test.json && node --test --test-concurrency=1 "dist-test/test/**/*.test.js"`). All tests run on win32 under `__testSetAuthorityCellHostPlatform("linux")` (`src/authority/host/platform.ts:20`); the hard fsync requirement is keyed on the REAL `process.platform`, so the override never makes win32 tests hard-require directory fsync.

### Task A1: Receipt integrity — evidence recompute, head cross-check, ledgerState refusal, directory fsync

**Files:**
- Modify: `src/authority/host/receipts.ts` — `loadDurableChain` (lines 195–220, validation at 204, walk stop 212, return 219), `loadDurableHead` (146–151), `writeImmutable` (184–193), `publishDurable` mkdir (line 134), `legacyPublish` rename (lines 89–98), new module-level seam + `syncDirectory` helper.
- Test: `test/authority/receipts.test.ts` (follow its lines 26–43 template).

**Interfaces:**
- Consumes: `authorityDigest`, `authorityCanonicalBytes` (`src/authority/wire.ts`); `open/rename/unlink/readFile/mkdir/readdir` from `node:fs/promises` (already imported); `__testSetAuthorityCellHostPlatform` (`src/authority/host/platform.ts:20`) as the seam precedent; `DurableDispatchPublicationQueryV1.ledgerState: "dispatched" | "ambiguous"` (`src/authority/host/dispatch.ts:19`).
- Produces: `export type ReceiptsDurabilityProbeEventV1 = Readonly<{ kind: "created" | "synced"; site: "node-create" | "durable-mkdir" | "legacy-rename"; target: string }>` and `export function __testSetReceiptsDurabilityProbe(probe: ((event: ReceiptsDurabilityProbeEventV1) => void) | undefined): () => void` in `receipts.ts` (module-level seam, NOT re-exported from `src/authority/host/index.ts`, mirroring the platform seam); internal `async function syncDirectory(directory: string, site: ReceiptsDurabilityProbeEventV1["site"]): Promise<void>`; the refusal error text `"durable publication terminal receipt is absent for a send-started reservation"` (A2's recovery test and Lane D's rehearsal fault case match on `/terminal receipt is absent/`).

- [ ] **Step 1: Write the RED forged-evidence test.** Add to `test/authority/receipts.test.ts` (extend imports to `import { mkdtemp, readFile, readdir, unlink, writeFile } from "node:fs/promises";`) a chain-publishing helper and the forge test:
```ts
async function publishedDurableChain(root: string) {
  const identity = { v: "reelier.durable-dispatch-publication-identity/v1", reservationId: "r1", tenant: "tenant_1", requestDigest: "sha256:" + "2".repeat(64), capabilityDigest: "sha256:" + "3".repeat(64), effectDigest: state.effectDigest, routeAuthorityDigest: "sha256:" + "4".repeat(64), expectedDispatchedRequestDigest: "sha256:" + "5".repeat(64), reservationIntentDigest: "sha256:" + "6".repeat(64) } as const;
  const publication = createFileReceiptPublication({ rootDir: root });
  const rootReceipt = await publication.publishReservation!({ phase: "reservation", identity, state, outcome: { kind: "ambiguous", resultDigest: "sha256:" + "7".repeat(64) }, dispatchedRequestDigest: null, priorReceiptDigest: null });
  const terminal = await publication.publish({ phase: "dispatch", state, outcome: { kind: "acknowledged", resultDigest: "sha256:" + "8".repeat(64) }, dispatchedRequestDigest: identity.expectedDispatchedRequestDigest, priorReceiptDigest: rootReceipt.receiptRef });
  const durableDir = path.join(root, (await readdir(root)).find(name => name.startsWith("durable-"))!);
  const names = (await readdir(durableDir)).filter(name => /^node-[0-9a-f]{64}\.json$/.test(name));
  const nodes = await Promise.all(names.map(async name => ({ name, node: JSON.parse(await readFile(path.join(durableDir, name), "utf8")) })));
  return { identity, rootReceipt, terminal, durableDir, terminalNode: nodes.find(entry => entry.node.head.phase === "dispatch")! };
}

test("restart validation rejects a forged evidence digest and a forged terminal kind", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const root = await mkdtemp(path.join(tmpdir(), "reelier-durable-forge-"));
  try {
    const { identity, durableDir, terminalNode } = await publishedDurableChain(root);
    const query = { v: "reelier.durable-dispatch-publication-query/v1", identity, ledgerState: "dispatched", sendStarted: true } as const;
    await writeFile(path.join(durableDir, terminalNode.name), JSON.stringify({ ...terminalNode.node, head: { ...terminalNode.node.head, evidenceDigest: "sha256:" + "e".repeat(64) } }));
    await assert.rejects(() => createFileReceiptPublication({ rootDir: root }).loadDurableHead!(query), /invalid or conflicting/);
    await writeFile(path.join(durableDir, terminalNode.name), JSON.stringify({ ...terminalNode.node, head: { ...terminalNode.node.head, terminalKind: "definitive-failure" } }));
    await assert.rejects(() => createFileReceiptPublication({ rootDir: root }).loadDurableHead!(query), /invalid or conflicting/);
  } finally { restore(); }
});
```
Run `npx tsc -p tsconfig.test.json && node --test dist-test/test/authority/receipts.test.js`. Expected FAIL: the forged `evidenceDigest` is well-formed so the line-161 regex passes and `loadDurableHead` RESOLVES — `AssertionError ... Missing expected rejection`.
- [ ] **Step 2: Write the RED lost-terminal-dirent test.** Same file:
```ts
test("a dispatched query refuses a chain whose terminal dirent is lost", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const root = await mkdtemp(path.join(tmpdir(), "reelier-durable-lost-dirent-"));
  try {
    const { identity, durableDir, terminalNode } = await publishedDurableChain(root);
    await unlink(path.join(durableDir, terminalNode.name));
    await assert.rejects(() => createFileReceiptPublication({ rootDir: root }).loadDurableHead!({ v: "reelier.durable-dispatch-publication-query/v1", identity, ledgerState: "dispatched", sendStarted: true }), /terminal receipt is absent/);
  } finally { restore(); }
});
```
Run the same command. Expected FAIL: pre-fix the walk stops at the reservation root and returns it as the head — `Missing expected rejection`.
- [ ] **Step 3: Commit the RED tests** (repo precedent: test commit precedes fix commit, cf. `76efd073` → `2fe9bb5a`): `git diff --check && git add test/authority/receipts.test.ts && git commit -m "test(authority): reject forged durable heads and lost terminal dirents"`.
- [ ] **Step 4: Implement recompute + cross-check + ledgerState threading.** In `receipts.ts` `loadDurableChain`: change the signature to `async function loadDurableChain(root: string, identity: DurableDispatchPublicationIdentityV1, ledgerState?: "dispatched" | "ambiguous")`. Inside the per-node loop (after the existing line-204 check, which stays):
```ts
    const expectedEvidenceDigest = authorityDigest({ v: "reelier.durable-file-publication-evidence/internal-v1", receiptRef: node.head.receiptRef, identity: node.head.identity, phase: node.preimage.phase, terminalKind: node.preimage.terminalKind, providerResultDigest: node.preimage.providerResultDigest });
    if (node.head.evidenceDigest !== expectedEvidenceDigest || node.head.v !== "reelier.durable-dispatch-publication-head/v1" || node.head.phase !== node.preimage.phase || node.head.terminalKind !== node.preimage.terminalKind || node.head.priorReceiptRef !== node.preimage.priorReceiptRef || node.head.reservationReceiptRef !== (node.preimage.phase === "reservation" ? node.head.receiptRef : node.preimage.reservationReceiptRef)) throw new TypeError("durable publication node is invalid or conflicting");
```
(Identity choice per spec: recompute uses `node.head.identity`, already digest-proven equal to the query identity by the line-204 check; `phase`/`terminalKind`/`providerResultDigest` come from the digest-bound `node.preimage` because `authorityDigest(node.preimage) === node.head.receiptRef` is already enforced.) Before the final `return Object.freeze(current.head)` (line 219) add:
```ts
  if (ledgerState !== undefined && current.head.phase === "reservation") throw new TypeError("durable publication terminal receipt is absent for a send-started reservation");
```
In `loadDurableHead` (line 150) change `return loadDurableChain(root, identity);` to `return loadDurableChain(root, identity, query.ledgerState);`. The two loader-internal calls in `publishDurable` (lines 114 and 136) keep passing no `ledgerState` — reservation-phase heads are legitimate there.
- [ ] **Step 5: Run and confirm GREEN.** `npx tsc -p tsconfig.test.json && node --test dist-test/test/authority/receipts.test.js` — all receipts tests pass (the three pre-existing tests query only terminal-phase chains, so the refusal does not fire on them). Commit: `git diff --check && git add src/authority/host/receipts.ts && git commit -m "fix(authority): recompute durable evidence digests and refuse rolled-back heads"`.
- [ ] **Step 6: Write the RED fsync-ordering seam test.** Same test file — add `import { createFileReceiptPublication } ...` alongside `import { __testSetReceiptsDurabilityProbe, type ReceiptsDurabilityProbeEventV1 } from "../../src/authority/host/receipts.js";`:
```ts
test("directory syncs follow node create, durable-dir mkdir, and legacy rename", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const root = await mkdtemp(path.join(tmpdir(), "reelier-durable-fsync-order-"));
  const events: ReceiptsDurabilityProbeEventV1[] = [];
  const restoreProbe = __testSetReceiptsDurabilityProbe(event => events.push(event));
  try {
    const identity = { v: "reelier.durable-dispatch-publication-identity/v1", reservationId: "r1", tenant: "tenant_1", requestDigest: "sha256:" + "2".repeat(64), capabilityDigest: "sha256:" + "3".repeat(64), effectDigest: state.effectDigest, routeAuthorityDigest: "sha256:" + "4".repeat(64), expectedDispatchedRequestDigest: "sha256:" + "5".repeat(64), reservationIntentDigest: "sha256:" + "6".repeat(64) } as const;
    await createFileReceiptPublication({ rootDir: root }).publishReservation!({ phase: "reservation", identity, state, outcome: { kind: "ambiguous", resultDigest: "sha256:" + "7".repeat(64) }, dispatchedRequestDigest: null, priorReceiptDigest: null });
    assert.deepEqual(events.map(event => `${event.kind}:${event.site}`), ["created:durable-mkdir", "synced:durable-mkdir", "created:node-create", "synced:node-create"]);
    events.length = 0;
    await createFileReceiptPublication({ rootDir: root }).publish({ phase: "dispatch", state, outcome: { kind: "acknowledged", resultDigest: "sha256:" + "8".repeat(64) }, dispatchedRequestDigest: "sha256:" + "3".repeat(64) });
    assert.deepEqual(events.map(event => `${event.kind}:${event.site}`), ["created:legacy-rename", "synced:legacy-rename"]);
  } finally { restoreProbe(); restore(); }
});
```
(The second `createFileReceiptPublication` has an empty identities map, so `publish` takes the `legacyPublish` path.) Run the command. Expected FAIL (RED as a compile refusal, acceptable for a seam that cannot pre-exist): `error TS2305: Module '"../../src/authority/host/receipts.js"' has no exported member '__testSetReceiptsDurabilityProbe'`.
- [ ] **Step 7: Implement the seam, syncDirectory, and writeImmutable hardening.** In `receipts.ts` add at module level (near the `DIGEST` const):
```ts
export type ReceiptsDurabilityProbeEventV1 = Readonly<{ kind: "created" | "synced"; site: "node-create" | "durable-mkdir" | "legacy-rename"; target: string }>;

let testDurabilityProbe: ((event: ReceiptsDurabilityProbeEventV1) => void) | undefined;

/** Internal test seam. It is intentionally not re-exported from the host barrel. */
export function __testSetReceiptsDurabilityProbe(probe: ((event: ReceiptsDurabilityProbeEventV1) => void) | undefined): () => void {
  const previous = testDurabilityProbe;
  testDurabilityProbe = probe;
  return () => { testDurabilityProbe = previous; };
}

/** Persists a new directory entry. Hard-required on a real Linux Authority Cell; failure codes are tolerated elsewhere so win32 tests under the platform override still run. */
async function syncDirectory(directory: string, site: ReceiptsDurabilityProbeEventV1["site"]): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    if (process.platform === "linux") throw error;
  }
  testDurabilityProbe?.({ kind: "synced", site, target: directory });
}
```
Replace `writeImmutable` (lines 184–193) with temp-file + fsync + rename + dir-fsync (partial JSON can now only ever exist under a dot-prefixed `.tmp` name, which the `/^node-[0-9a-f]{64}\.json$/` readdir filter at line 199 excludes, so a mid-write crash no longer bricks readback at 202 nor poisons the EEXIST byte-compare at 191):
```ts
async function writeImmutable(file: string, value: unknown): Promise<void> {
  const bytes = Buffer.concat([authorityCanonicalBytes(value), Buffer.from("\n")]);
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.${path.basename(file)}.${randomBytes(8).toString("hex")}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try { await rename(temporary, file); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" && (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
  } finally { await unlink(temporary).catch(() => {}); }
  let existing: Buffer;
  try { existing = await readFile(file); } catch (error) { throw new Error("durable publication node is missing or unreadable", { cause: error }); }
  if (!existing.equals(bytes)) throw new Error("conflicting immutable durable publication");
  testDurabilityProbe?.({ kind: "created", site: "node-create", target: file });
  await syncDirectory(directory, "node-create");
}
```
(Node files are content-addressed — `node-<receiptRef-hex>.json` where `receiptRef = authorityDigest(preimage)` and every head field is derived from the preimage plus the same chain — so a rename over an existing equal file is byte-identical and the post-rename byte-compare preserves the immutability CAS with the same conflict error text.) In `publishDurable`, after `await mkdir(directory, { recursive: true });` (line 134) insert:
```ts
    testDurabilityProbe?.({ kind: "created", site: "durable-mkdir", target: directory });
    await syncDirectory(root, "durable-mkdir");
```
In `legacyPublish`, after the `finally { await unlink(temporary).catch(() => {}); }` block (line 98) and before the readback `try` (line 99) insert:
```ts
      testDurabilityProbe?.({ kind: "created", site: "legacy-rename", target: file });
      await syncDirectory(root, "legacy-rename");
```
- [ ] **Step 8: Run and confirm GREEN, then commit.** `npx tsc -p tsconfig.test.json && node --test dist-test/test/authority/receipts.test.js` — all pass. Then run the adjacent suites that consume this file: `node --test dist-test/test/authority/dispatch-coordinator.test.js dist-test/test/authority/github-release-runner.test.js dist-test/test/authority/profile-governed-receipt.test.js dist-test/test/authority/linux-authority-cell.test.js` — expected all pass (those suites use fake or profile-governed publications, not the file loader's query path). Commit: `git diff --check && git add src/authority/host/receipts.ts test/authority/receipts.test.ts && git commit -m "fix(authority): fsync durable receipt directory entries with an ordering seam"`.

### Task A2: ID seam — `normalizeReservationPublicationId` at every durable/journal boundary

**Files:**
- Create: `src/authority/host/reservation-identity.ts`
- Modify: `src/authority/host/dispatch.ts` (`durableIdentity`, line 332 inline mapping), `src/authority/host/receipts.ts` (the `publishDurable` guard at line 113; `publishReservation` map-set at 143; `publish` map-get at 153), `src/authority/host/github-release-runner.ts` (adapter request at 195 + the raw reconciliation stamp at 196; wrapper map keys at 233/240/250; confirm requestId at 255). **`src/authority/host/fs-ledger.ts` is NOT modified**; `PreparedDispatchDescriptionV1.reservationId` stays raw; `coordinatorPublicationCall`/`consumeCoordinatorPublicationCall` stamps (dispatch.ts:38–50, runner 229/246) stay raw; the portable-wire `sha256.` convention (`src/packs/github-release/source.ts:106`) is not introduced.
- Test: Create `test/authority/reservation-id-seam.test.ts`; Modify `test/authority/github-release-runner.test.ts` (append one test reusing its `releaseAuthorityFixture`/`candidateProvider`/`governedRun` helpers, lines 30–113).

**Interfaces:**
- Consumes: `FsAuthorityLedger` (`src/authority/host/fs-ledger.ts:524 reserve`, `:584 commitPreparedDispatch`, `:616 recover`, `:633 getReservation`; reservation ids are minted as the raw transaction digest `sha256:<64hex>`, line 536); `createDispatchCoordinator` (`dispatch.ts:52`); `createPreparedDispatch` (`prepared-dispatch.ts`); `createReservedDispatchHandle` (`src/authority/gate.ts`); `materializedHttpRequestDigest` + `MaterializedHttpRequestProjectionV1` (`http-response-semantics.ts`); `authenticateOutcomeRequest`, `authenticatedOutcomeRequestState` (`src/authority/keys.ts:35/:69`); `CAPABILITY_LIFETIME_MS`, `ReservationIntent`, `AuthorityLedger`, `LedgerState`, `TransitionEvent` (`src/authority/ledger.ts`); `createSignedJournal` (`signed-journal.ts:28`; request-id regex `/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/` at line 32 is what rejects `sha256:`); `validateRequest` regex (`github-release-runner.ts:439`).
- Produces: `export function normalizeReservationPublicationId(reservationId: string): string` in `src/authority/host/reservation-identity.ts` — `sha256:<64hex>` → `reservation_<64hex>`, everything else passes through unchanged. A3 and Lane D consume nothing else from this task.

- [ ] **Step 1: Write the RED real-ledger dispatch + crash-recovery test.** Create `test/authority/reservation-id-seam.test.ts` (real-artifact fixture rule, spec §9 — the reservation is minted by the real `FsAuthorityLedger`, never fabricated):
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";
import { authenticateOutcomeRequest, authenticatedOutcomeRequestState } from "../../src/authority/keys.js";
import { CAPABILITY_LIFETIME_MS, type AuthorityLedger, type LedgerState, type ReservationIntent, type ReservationSnapshot, type TransitionEvent } from "../../src/authority/ledger.js";
import { FsAuthorityLedger } from "../../src/authority/host/fs-ledger.js";
import { createDispatchCoordinator, type DispatchAdapter } from "../../src/authority/host/dispatch.js";
import { createPreparedDispatch } from "../../src/authority/host/prepared-dispatch.js";
import { materializedHttpRequestDigest, type MaterializedHttpRequestProjectionV1 } from "../../src/authority/host/http-response-semantics.js";
import { createFileReceiptPublication } from "../../src/authority/host/receipts.js";
import { createReservedDispatchHandle } from "../../src/authority/gate.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";

const t0 = Date.parse("2026-08-19T12:00:00.000Z");
const sha = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;
const effect = { v: "reelier.transport-effect/v1", endpointId: "write", method: "POST", path: "/items", query: "", headers: { "Content-Type": "application/json" }, bodyBase64: Buffer.from("{}").toString("base64"), riskClass: "test", idempotency: "native", preconditions: [], reconciliation: { recipeId: "recipe" } } as const;
const projection: MaterializedHttpRequestProjectionV1 = { v: "reelier.materialized-http-request/v1", method: "POST", origin: "https://api.github.test", normalizedPath: "/items", normalizedQuery: "", reviewedHeaders: {}, bodyDigest: sha("1") };
const materializedRequestDigest = materializedHttpRequestDigest(projection);
const routeAuthority = { v: "reelier.route-authority-snapshot/v1" as const, connectorRegistrationDigest: sha("2"), operatorConfigurationDigest: sha("3"), routeDigest: sha("4"), providerId: "github", connectorId: "github", accountId: "account_1", providerAccountIdentity: "github:owner", endpointId: "write", credentialSlotId: "slot_1", slotInstanceId: "instance_1", slotVersion: "1", authenticatedProviderIdentityDigest: sha("5"), sourceReadRouteDigest: sha("6"), projectionSchemaDigest: sha("7"), expectedMaterializedRequestDigest: materializedRequestDigest, authorityGeneration: sha("d"), authorityExpiresAt: new Date(t0 + 60_000).toISOString() };

function releaseIntent(): ReservationIntent {
  const limits = { maxEffectsPerWindow: 2, windowSeconds: 3600, maxEffectsPerSourceTrigger: 1, maxBodyBytes: 4096 };
  const requestWire = { v: "reelier.outcome-request/v1", requestId: "request_1", sourceRefs: { source: "ref_1" }, choices: {} };
  const canonicalRequestBytes = authorityCanonicalBytes(requestWire);
  const requestDigest = `sha256:${createHash("sha256").update(canonicalRequestBytes).digest("hex")}`;
  const scalar = { tenant: "tenant_1", requester: "requester_1", definitionAlias: "definition_1", requestId: "request_1", requestKey: authenticatedOutcomeRequestState(authenticateOutcomeRequest({ tenant: "tenant_1", requester: "requester_1", definitionAlias: "definition_1", request: requestWire })).requestKey, ingressClaimDigest: sha("9"), decisionContextDigest: sha("7"), contractDigest: sha("a"), sourceBundleDigest: sha("b"), sourceSnapshotDigest: sha("c"), authorityStateDigest: sha("d"), limits, limitsDigest: "", capabilityId: "capability_1", outcomeKey: sha("3"), effectDigest: authorityDigest(effect), issuedAt: new Date(t0).toISOString(), expiresAt: new Date(t0 + CAPABILITY_LIFETIME_MS).toISOString(), limitSlots: [{ kind: "contract-window" as const, key: sha("5"), maximum: 2 }, { kind: "source-trigger" as const, key: sha("6"), maximum: 1 }], effectCanonicalBase64: authorityCanonicalBytes(effect).toString("base64"), routeAuthority };
  scalar.limitsDigest = authorityDigest({ v: "reelier.capability-limits/internal-v1", contractDigest: scalar.contractDigest, limits });
  const capabilityBytes = authorityCanonicalBytes({ v: "reelier.compiled-capability/v1", tenant: scalar.tenant, requester: scalar.requester, definitionAlias: scalar.definitionAlias, requestDigest, requestKey: scalar.requestKey, contractDigest: scalar.contractDigest, sourceBundleDigest: scalar.sourceBundleDigest, sourceSnapshotDigest: scalar.sourceSnapshotDigest, authorityStateDigest: scalar.authorityStateDigest, limits, limitsDigest: scalar.limitsDigest, capabilityId: scalar.capabilityId, outcomeKey: scalar.outcomeKey, effectDigest: scalar.effectDigest, issuedAt: scalar.issuedAt, expiresAt: scalar.expiresAt });
  return { ...scalar, canonicalRequestBytes, capabilityBytes, requestDigest, canonicalRequestDigest: requestDigest, capabilityDigest: `sha256:${createHash("sha256").update(capabilityBytes).digest("hex")}` };
}

async function mintRealReservation(ledgerDir: string): Promise<Readonly<{ ledger: FsAuthorityLedger; reservation: ReservationSnapshot; candidate: ReservationIntent }>> {
  const ledger = new FsAuthorityLedger(ledgerDir, { now: () => t0, monotonicNow: () => 0 });
  const candidate = releaseIntent();
  const binding = await ledger.bindIngress(authenticateOutcomeRequest({ tenant: candidate.tenant, requester: candidate.requester, definitionAlias: candidate.definitionAlias, request: JSON.parse(Buffer.from(candidate.canonicalRequestBytes).toString("utf8")) }));
  assert.equal(binding.ok, true);
  const created = await ledger.reserve({ ...candidate, ingressClaimDigest: (binding as { ingressClaimDigest: string }).ingressClaimDigest });
  assert.equal(created.ok, true);
  const reservation = (created as { reservation: ReservationSnapshot }).reservation;
  assert.match(reservation.reservationId, /^sha256:[0-9a-f]{64}$/, "the shipped ledger mints raw sha256 reservation ids");
  return { ledger, reservation, candidate };
}

function preparedAdapter(reservation: ReservationSnapshot): DispatchAdapter {
  const description = { v: "reelier.prepared-dispatch-description/v1" as const, routeDigest: routeAuthority.routeDigest, materializedRequestDigest, projection, authorityGeneration: sha("d"), authorityExpiresAt: routeAuthority.authorityExpiresAt, absoluteDeadlineMs: 60_000, reservationId: reservation.reservationId, allocationId: "unbound" };
  return { async prepare() { return createPreparedDispatch({ description, monotonicNow: () => 0, wallClockNow: () => t0, send: async () => ({ kind: "acknowledged" as const, resultDigest: sha("8") }) }); }, async dispatch() { throw new Error("the prepared path is required"); } };
}

test("a raw ledger-minted reservation publishes its durable root and reaches a terminal receipt", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const root = await mkdtemp(path.join(tmpdir(), "reelier-id-seam-"));
  try {
    const { ledger, reservation, candidate } = await mintRealReservation(path.join(root, "ledger"));
    const publication = createFileReceiptPublication({ rootDir: path.join(root, "receipts") });
    const coordinator = createDispatchCoordinator(ledger, preparedAdapter(reservation), undefined, publication);
    const outcome = await coordinator.dispatch(createReservedDispatchHandle({ reservation, effect, effectCanonicalBase64: candidate.effectCanonicalBase64!, effectDigest: candidate.effectDigest }));
    assert.equal(outcome.kind, "acknowledged");
    assert.match(outcome.receiptRef!, /^sha256:[0-9a-f]{64}$/);
    assert.equal((await ledger.getReservation(reservation.reservationId))?.state, "acknowledged");
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});

test("crash after send-started recovers by adopting the durable terminal without stranding or resending", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const root = await mkdtemp(path.join(tmpdir(), "reelier-id-seam-crash-"));
  try {
    const { ledger, reservation, candidate } = await mintRealReservation(path.join(root, "ledger"));
    const receiptsDir = path.join(root, "receipts");
    const crashing = { getReservation: (id: string) => ledger.getReservation(id), commitPreparedDispatch: (input: Parameters<NonNullable<AuthorityLedger["commitPreparedDispatch"]>>[0]) => ledger.commitPreparedDispatch!(input), recover: () => ledger.recover({ deferTerminal: true }), async transition(reservationId: string, expected: LedgerState, event: TransitionEvent) { if (expected === "dispatched") throw new Error("simulated crash before the terminal ledger transition"); return ledger.transition(reservationId, expected, event); } } as unknown as AuthorityLedger;
    const coordinator = createDispatchCoordinator(crashing, preparedAdapter(reservation), undefined, createFileReceiptPublication({ rootDir: receiptsDir }));
    await assert.rejects(() => coordinator.dispatch(createReservedDispatchHandle({ reservation, effect, effectCanonicalBase64: candidate.effectCanonicalBase64!, effectDigest: candidate.effectDigest })), /simulated crash before the terminal ledger transition/);
    const restarted = new FsAuthorityLedger(path.join(root, "ledger"), { now: () => t0, monotonicNow: () => 0 });
    let sends = 0;
    const recovery = createDispatchCoordinator(restarted, { async dispatch() { sends += 1; throw new Error("recovery must not resend"); } }, undefined, createFileReceiptPublication({ rootDir: receiptsDir }));
    assert.deepEqual(await recovery.recover(), [], "the durable acknowledged terminal is adopted, not re-marked ambiguous");
    assert.equal(sends, 0);
    const adopted = await restarted.getReservation(reservation.reservationId);
    assert.equal(adopted?.state, "acknowledged");
    assert.match(adopted?.resultDigest ?? "", /^sha256:[0-9a-f]{64}$/);
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});
```
(The crash point is after the terminal durable node publish at dispatch.ts:157 and before the ledger terminal transition at :159 — the exact send-started restart window; recovery adopts the durable terminal at dispatch.ts:275–278. The pre-fix strand reproduces the breaker: `publishReservation` throws at receipts.ts:113 after the send-started CAS.) Run `npx tsc -p tsconfig.test.json && node --test dist-test/test/authority/reservation-id-seam.test.js`. Expected FAIL for BOTH tests: `TypeError: durable publication state identity mismatch` (the crash test fails its `/simulated crash/` message assertion with this error instead — the dispatch dies before the injected crash point).
- [ ] **Step 2: Write the RED runner journal-key test.** Append to `test/authority/github-release-runner.test.ts` (after the existing fixture helpers; also add `import { normalizeReservationPublicationId } from "../../src/authority/host/reservation-identity.js";` in the GREEN step — for RED use the literal expected key so the test compiles pre-fix):
```ts
test("release adapter journals a ledger-minted raw reservation id under the canonical colon-free key", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-release-raw-id-"));
  const fixture = releaseAuthorityFixture(), keys = generateKeyPairSync("ed25519");
  try {
    const runner = await createGitHubReleaseRunner({ rootDir: root, journalSigner: { signerId: "release-journal-2026", privateKey: keys.privateKey, publicKey: keys.publicKey }, evidenceSigner: fixture.evidenceSigner, authorizationResolver: async () => fixture.context, provider: candidateProvider(), now: () => new Date("2026-08-18T06:00:00.000Z") });
    const rawReservationId = `sha256:${"4".repeat(64)}`;
    const request = { alias: "github_release_candidate_publish_v1" as const, allocationId: "release-candidate-branch-01", authorizationHandle: "release_auth_1", requestId: rawReservationId, semanticsDigest: authorityDigest({ raw: true }) };
    const result = await governedRun(runner, request);
    assert.equal(result.status, "verified");
    const journal = await createSignedJournal({ rootDir: path.join(root, "journal"), journalId: "github-release", signerId: "release-journal-2026", privateKey: keys.privateKey, publicKey: keys.publicKey });
    assert.deepEqual(await journal.listRequestIds(), [`reservation_${"4".repeat(64)}`], "journal keys and confirmAuthoritativeHead load the same colon-free identity");
    assert.equal((await governedRun(runner, request)).status, "verified", "restart-shaped replay finds its request under the same key");
  } finally { await rm(root, { recursive: true, force: true }); }
});
```
Run `npx tsc -p tsconfig.test.json && node --test dist-test/test/authority/github-release-runner.test.js`. Expected FAIL: `TypeError: GitHub release request is invalid [not-applied]` (the adapter forwards the raw `sha256:` id into `validateRequest`'s colon-free regex at github-release-runner.ts:439).
- [ ] **Step 3: Commit the RED tests.** `git diff --check && git add test/authority/reservation-id-seam.test.ts test/authority/github-release-runner.test.ts && git commit -m "test(authority): drive real raw reservation ids through the durable and journal seams"`.
- [ ] **Step 4: Create the shared helper.** New file `src/authority/host/reservation-identity.ts` (its own module so `receipts.ts` gains no runtime import of `dispatch.ts`):
```ts
const RAW_RESERVATION_ID = /^sha256:[0-9a-f]{64}$/;

/** Canonical durable/journal identity form for a reservation. The shipped fs-ledger mints raw
 * `sha256:<64hex>` transaction ids; the durable receipt identity and signed journal require a
 * colon-free form. This is the single bridge: raw ledger ids map to `reservation_<64hex>`,
 * every other identity passes through unchanged. The ledger API itself stays raw. */
export function normalizeReservationPublicationId(reservationId: string): string {
  return RAW_RESERVATION_ID.test(reservationId) ? `reservation_${reservationId.slice(7)}` : reservationId;
}
```
- [ ] **Step 5: Apply the helper at every seam.** (a) `dispatch.ts:332` — replace `const reservationId=/^sha256:[0-9a-f]{64}$/.test(reservation.reservationId)?\`reservation_${reservation.reservationId.slice(7)}\`:reservation.reservationId;` with `const reservationId=normalizeReservationPublicationId(reservation.reservationId);` and add `import { normalizeReservationPublicationId } from "./reservation-identity.js";`. (b) `receipts.ts` guard (line 113): `if (identity.reservationId !== normalizeReservationPublicationId(input.state.reservation.reservationId) || identity.effectDigest !== input.state.effectDigest) throw new TypeError("durable publication state identity mismatch");` plus the import. (c) `receipts.ts` `publishReservation` (line 143): `identities.set(normalizeReservationPublicationId(identity.reservationId), identity);` and `publish` (line 153): `const identity = identities.get(normalizeReservationPublicationId(input.state.reservation.reservationId));`. (d) `github-release-runner.ts` line 195: `const request = { alias, allocationId: execution.allocationId, authorizationHandle: String(body.authorizationHandle), requestId: normalizeReservationPublicationId(state.reservation.reservationId), semanticsDigest: state.effectDigest };` — and keep the coordinator reconciliation stamp RAW by changing line 196 to `if (reconcileOnly) consumeCoordinatorReconciliation(state, { reservationId: state.reservation.reservationId, allocationId: request.allocationId, effectDigest: request.semanticsDigest });` (the coordinator minted that stamp with the raw id at dispatch.ts:236). (e) `github-release-runner.ts` wrapper: line 233 `identities.set(normalizeReservationPublicationId(value.state.reservation.reservationId), ...)`; line 240 `identities.set(normalizeReservationPublicationId(query.identity.reservationId), ...)` (idempotent — query identities are already colon-free — kept explicit); line 250 `identities.get(normalizeReservationPublicationId(value.state.reservation.reservationId))`; line 255 `confirmPublication({ requestId: normalizeReservationPublicationId(value.state.reservation.reservationId), ... })`; plus the import. The `consumeCoordinatorPublicationCall` stamps at 229/246 stay raw.
- [ ] **Step 6: Run and confirm GREEN.** `npx tsc -p tsconfig.test.json && node --test dist-test/test/authority/reservation-id-seam.test.js dist-test/test/authority/github-release-runner.test.js dist-test/test/authority/receipts.test.js dist-test/test/authority/dispatch-coordinator.test.js dist-test/test/authority/ledger.test.js` — all pass (existing suites use colon-free ids, for which the helper is the identity function).
- [ ] **Step 7: Commit.** `git diff --check && git add src/authority/host/reservation-identity.ts src/authority/host/dispatch.ts src/authority/host/receipts.ts src/authority/host/github-release-runner.ts test/authority/github-release-runner.test.ts && git commit -m "fix(authority): normalize reservation ids at every durable and journal seam"`.

### Task A3: Serve injection — `--release-runner-config`, explicit runner routing, fail-closed startup

**Files:**
- Create: `src/authority/host/github-release-runner-config.ts` (closed parser + in-process construction + loopback fixture provider); `test/authority/github-release-serve-fixture.ts` (non-`.test` fixture module — the `dist-test/test/**/*.test.js` glob will not collect it).
- Modify: `src/cli.ts` (value-option list, insert `|| arg === "--release-runner-config"` after line 215's `--certification-config`); `src/authority/cli.ts` (`authorityServe` at 278–312 — parse flag mirroring `--certification-config` at 286–288, startup refusals, pass runner; `AuthorityServeHostCompositionDependencies` at 314–319 gains `createGitHubReleaseRuntime`; `authorityServeHostDependencies` at 321; `composeAuthorityServeHost` at 350–356 gains the explicit runner parameter and routing).
- Test: `test/authority/authority-serve.test.ts` (rewrite the options-record pass-through test at 29–44 — the Task-3 lesson is that it proves nothing — plus new public-dispatch tests); parser unit tests in the same file.

**Interfaces:**
- Consumes: `createGitHubReleaseRunner` (`github-release-runner.ts:66` — `{ rootDir; journalSigner: {signerId; privateKey; publicKey}; evidenceSigner: ReleaseContractSignerV1; authorizationResolver; provider: GitHubReleaseProviderV1; now }`); `createGitHubReleaseAuthorityRuntime` (`local.ts:101` — refuses non-four-alias configs (`/four reviewed/`, local.ts:106), missing deployment/trust pin (local.ts:107), unbranded runners via `assertGitHubReleaseRunnerCapability`); `githubReleaseAliases` (`src/packs/github-release/manifest.ts:7`); `verifyReleaseAuthorizationBundleV1` (`release-contracts.ts:257` — `(bundles, {signerId, publicKeySpkiBase64}, now, evidence)`); `GitHubReleaseProviderV1` 14-method surface (`github-release-runner.ts:35–50`); `__testSetAuthorityServeRuntime` (`cli.ts:343`); `runAuthorityCommand` (`cli.ts:51`); `composeAuthorityServeStdioRuntime` (`./host/stdio-context.js`), `createStdioBoundLocalAuthorityRuntime`, `createLocalAuthorityRuntime`, `createAuthorityHostServer` for real-dependency test composition; from A2: `normalizeReservationPublicationId` is not needed here.
- Produces: `export interface GitHubReleaseRunnerOperatorConfigV1` (closed v1: `{ v: "reelier.github-release-runner-config/v1"; rootDir; journalSignerId; journalKeyFile; evidenceSignerId; evidenceKeyFile; releaseAuthority: { signerId; publicKeySpkiBase64 }; authorizationDir; provider: { kind: "loopback-fixture"; fixtureDir } }` — all paths absolute; only PUBLIC key material and file paths live in the config; private keys are read from the named PEM files, never inlined — the local.ts:64 rule); `export function parseGitHubReleaseRunnerOperatorConfig(value: unknown): GitHubReleaseRunnerOperatorConfigV1` (closed: exact keys, `path.isAbsolute` on all four paths, journal signer id `/^[a-z0-9][a-z0-9._:-]{7,127}$/` matching `createSignedJournal`'s rule, provider kind literal `"loopback-fixture"` only — any other kind is a `TypeError`, Lane 2 widens the enum when the live HTTPS provider lands); `export async function createGitHubReleaseRunnerFromOperatorConfig(config, now?: () => Date): Promise<GitHubReleaseRunnerV1>` (loads private keys via `createPrivateKey(await readFile(...))`, derives the journal public key via `createPublicKey(privateKey)`, resolver reads `<authorizationDir>/<handle>.json` `{authorization, candidateManifest, operationPlan, policy, evidence, fileContents}` and returns `{ authorization: verifyReleaseAuthorizationBundleV1({authorization, candidateManifest, operationPlan, policy}, config.releaseAuthority, now(), bundle.evidence as Parameters<typeof verifyReleaseAuthorizationBundleV1>[3]), fileContents: bundle.fileContents ?? [] }` after validating the handle against `/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/`); an internal loopback fixture provider whose 14 methods each return `JSON.parse(await readFile(path.join(fixtureDir, `${method}.json`)))` when the file exists and otherwise throw the closed fault `{ v: "reelier.github-release-provider-fault/v1", kind: "transport-uncertain", reason: "loopback fixture absent" }` — deterministic, credential-free, sufficient for startup and refusal-path tests (full release dispatch is exercised only in Lane D with Lane 2's provider); new `composeAuthorityServeHost` signature `composeAuthorityServeHost(config, transport, principalRegistry, localRuntimeOptions, githubReleaseRunner: GitHubReleaseRunnerV1 | undefined, artifactStage?, dependencies?)` routing `githubReleaseRunner` present → `dependencies.createGitHubReleaseRuntime(config, githubReleaseRunner, localRuntimeOptions)` (never an options key — local.ts:104 rejects one) with `transport === "stdio"` + runner → `TypeError("the release runner requires the authenticated HTTP transport")`; `AuthorityServeHostCompositionDependencies.createGitHubReleaseRuntime: typeof createGitHubReleaseAuthorityRuntime`; startup refusal in `authorityServe`: config definitions digest-equal to the four release aliases without a constructible runner → stderr JSON `{"status":"refused","reasonCode":"release-runner-config-required",...}`, exit 1.

- [ ] **Step 1: RED parser tests.** Add to `test/authority/authority-serve.test.ts`:
```ts
import { createGitHubReleaseRunnerFromOperatorConfig, parseGitHubReleaseRunnerOperatorConfig } from "../../src/authority/host/github-release-runner-config.js";

test("the release runner operator config parser is closed and absolute", () => {
  const valid = { v: "reelier.github-release-runner-config/v1", rootDir: path.resolve("/data/runner"), journalSignerId: "release-journal-2026", journalKeyFile: path.resolve("/data/keys/journal.pem"), evidenceSignerId: "release-provider-verifier", evidenceKeyFile: path.resolve("/data/keys/evidence.pem"), releaseAuthority: { signerId: "release-authority-2026", publicKeySpkiBase64: "AA==" }, authorizationDir: path.resolve("/data/authorizations"), provider: { kind: "loopback-fixture", fixtureDir: path.resolve("/data/fixtures") } };
  assert.deepEqual(parseGitHubReleaseRunnerOperatorConfig(valid), valid);
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, extra: true }), /closed/i);
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, rootDir: "relative/runner" }), /absolute/i);
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, provider: { kind: "github-https", fixtureDir: valid.provider.fixtureDir } }), /provider/i);
  assert.throws(() => parseGitHubReleaseRunnerOperatorConfig({ ...valid, journalSignerId: "X" }), /signer/i);
});
```
Run `npx tsc -p tsconfig.test.json` — expected RED: `error TS2307: Cannot find module '../../src/authority/host/github-release-runner-config.js'`.
- [ ] **Step 2: Implement `github-release-runner-config.ts`** per the Produces contract above (closed `exactRecord`-style key check; `TypeError` messages containing "closed", "absolute", "provider", "signer" respectively). Run `npx tsc -p tsconfig.test.json && node --test dist-test/test/authority/authority-serve.test.js` — parser test passes. Commit: `git diff --check && git add src/authority/host/github-release-runner-config.ts test/authority/authority-serve.test.ts && git commit -m "feat(authority): closed release-runner operator config with loopback fixture provider"`.
- [ ] **Step 3: RED composition-routing test.** Replace the pass-through test at `test/authority/authority-serve.test.ts:29–44` with one that pins the explicit-parameter routing:
```ts
test("authority serve routes the explicit host-owned release runner to the production release factory", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  const runner = Object.freeze({ run: async () => { throw new Error("not public"); }, recover: async () => [] });
  const config = { version: 1 as const, tenant: "tenant_1", requester: "agent_1", definitions: ["github_release_candidate_publish_v1", "github_release_pr_ensure_v1", "github_release_pr_merge_v1", "github_release_tag_create_v1"], ledgerDir: "ledger", decisionDir: "decisions", receiptDir: "receipts", endpoints: [] };
  const runtime = { directOutcomeAliases: [], requiresAuthenticatedExecutionContext: false, async outcome() { return { verdict: "refused", reasonCode: "unused" }; }, async status() { return {}; } } as any;
  let received: unknown, localCalls = 0;
  try {
    await composeAuthorityServeHost(config, "http", undefined, {}, runner as never, undefined, {
      async composeStdio() { throw new Error("stdio must not be selected"); },
      async createStdioBoundRuntime() { throw new Error("stdio must not be selected"); },
      async createLocalRuntime() { localCalls += 1; return runtime; },
      async createGitHubReleaseRuntime(_config, explicitRunner) { received = explicitRunner; return runtime; },
      createHostServer(_config, host) { assert.equal(host.outcome, runtime.outcome); return { mcp: {} } as never; },
    });
    assert.equal(received, runner, "the runner is the explicit composition parameter, never an options key");
    assert.equal(localCalls, 0);
    await assert.rejects(() => composeAuthorityServeHost(config, "stdio", undefined, {}, runner as never, undefined, { async composeStdio() { throw new Error("unreachable"); }, async createStdioBoundRuntime() { throw new Error("unreachable"); }, async createLocalRuntime() { return runtime; }, async createGitHubReleaseRuntime() { return runtime; }, createHostServer() { return { mcp: {} } as never; } }), /HTTP transport/);
  } finally { restore(); }
});
```
Run — expected RED: `error TS2554`/`TS2353` (current `composeAuthorityServeHost` has no runner parameter and the dependencies type has no `createGitHubReleaseRuntime`).
- [ ] **Step 4: Implement the cli.ts changes.** (a) `src/cli.ts` line 215 area: add `|| arg === "--release-runner-config"` to the value-option chain. (b) `src/authority/cli.ts`: import `createGitHubReleaseAuthorityRuntime` (extend the line-14 import from `./host/local.js`), `githubReleaseAliases` from `../packs/github-release/manifest.js`, and `createGitHubReleaseRunnerFromOperatorConfig, parseGitHubReleaseRunnerOperatorConfig` from `./host/github-release-runner-config.js`. In `authorityServe` after the `certificationConfig` block (lines 286–288), mirror it:
```ts
  const releaseRunnerConfig = args.opts["release-runner-config"]
    ? parseGitHubReleaseRunnerOperatorConfig(JSON.parse(await readFile(path.resolve(args.opts["release-runner-config"]), "utf8")))
    : undefined;
  const releaseRunner = releaseRunnerConfig ? await createGitHubReleaseRunnerFromOperatorConfig(releaseRunnerConfig) : undefined;
  if (authorityDigest([...loaded.config.definitions].sort()) === authorityDigest([...githubReleaseAliases].sort()) && !releaseRunner) {
    console.error(JSON.stringify({ status: "refused", reasonCode: "release-runner-config-required", message: "the four GitHub release definitions refuse permanently (dedicated-release-runner-absent) without --release-runner-config" }));
    return 1;
  }
```
Pass `releaseRunner` as the new fifth argument of `composeAuthorityServeHost` (existing call at line 303). (c) Extend `AuthorityServeHostCompositionDependencies` with `readonly createGitHubReleaseRuntime: typeof createGitHubReleaseAuthorityRuntime;`, add it to `authorityServeHostDependencies` (line 321), and change `composeAuthorityServeHost` to accept `githubReleaseRunner: GitHubReleaseRunnerV1 | undefined` between `localRuntimeOptions` and `artifactStage`, routing:
```ts
  if (githubReleaseRunner) {
    if (transport === "stdio") throw new TypeError("the release runner requires the authenticated HTTP transport");
    const releaseRuntime = await dependencies.createGitHubReleaseRuntime(config, githubReleaseRunner, localRuntimeOptions);
    const runtime: AuthorityHostRuntime = { directOutcomeAliases: releaseRuntime.directOutcomeAliases, requiresAuthenticatedExecutionContext: releaseRuntime.requiresAuthenticatedExecutionContext, outcome: releaseRuntime.outcome, status: releaseRuntime.status, jobsSearch: releaseRuntime.jobsSearch, jobLoad: releaseRuntime.jobLoad, invoke: releaseRuntime.invoke, delegationRequest: releaseRuntime.delegationRequest, delegationStatus: releaseRuntime.delegationStatus, taskCreate: releaseRuntime.taskCreate, taskStatus: releaseRuntime.taskStatus, ...(artifactStage ? { artifactStage } : {}) };
    return dependencies.createHostServer(config, runtime, { ...(principalRegistry ? { principalRegistry } : {}) });
  }
```
(`GitHubReleaseRunnerV1` type import from `./host/github-release-runner.js`.) Run `npx tsc -p tsconfig.test.json && node --test dist-test/test/authority/authority-serve.test.js` — Step 3's test passes.
- [ ] **Step 5: RED fail-closed public-dispatch tests.** Add to `test/authority/authority-serve.test.ts` (in-process, win32-capable — spawn variants stay `{ skip: process.platform === "win32" }`):
```ts
import { __testSetAuthorityServeRuntime, runAuthorityCommand, composeAuthorityServeHost } from "../../src/authority/cli.js";
import { composeAuthorityServeStdioRuntime } from "../../src/authority/host/stdio-context.js";
import { createLocalAuthorityRuntime, createStdioBoundLocalAuthorityRuntime, createGitHubReleaseAuthorityRuntime } from "../../src/authority/host/local.js";
import { createAuthorityHostServer } from "../../src/authority/host/server.js";

const realDependencies = { composeStdio: composeAuthorityServeStdioRuntime, createStdioBoundRuntime: createStdioBoundLocalAuthorityRuntime, createLocalRuntime: createLocalAuthorityRuntime, createGitHubReleaseRuntime: createGitHubReleaseAuthorityRuntime, createHostServer: createAuthorityHostServer };

async function serveThroughDispatch(argv: string[], onStart?: () => void): Promise<number> {
  const restorePlatform = __testSetAuthorityCellHostPlatform("linux");
  const restoreRuntime = __testSetAuthorityServeRuntime({ hostCompositionDependencies: realDependencies, async startHost() { onStart?.(); } });
  try { const parsed = parseArgv(argv); return await runAuthorityCommand({ positional: parsed.positional.slice(1), flags: parsed.flags, opts: parsed.opts }); }
  finally { restoreRuntime(); restorePlatform(); }
}
```
(Match the argument slicing to how `src/cli.ts` dispatches `authority` — verify with `grep -n "runAuthorityCommand" src/cli.ts` and mirror it exactly.) Tests: (i) write a four-alias `authority.yml` (JSON body, like `authorityInit` writes) into a tmp dir WITHOUT `--release-runner-config` → expect return `1` and captured stderr JSON `reasonCode === "release-runner-config-required"`; (ii) valid runner config + `authority.yml` whose `definitions` are NOT the exact four → `await assert.rejects(..., /four reviewed/)`; (iii) valid runner config + four aliases but no `deploymentPath`/`jobCardTrustPinPath` in the config file → `await assert.rejects(..., /signed deployment|trust pin/i)`; (iv) `--transport stdio` (omit `--transport`) + runner config → `/HTTP transport/`; (v) construct a runner via `createGitHubReleaseRunnerFromOperatorConfig` directly and assert its PUBLIC surface still refuses: `await assert.rejects(() => runner.run({ alias: "github_release_candidate_publish_v1", allocationId: "release-candidate-branch-01", authorizationHandle: "h", requestId: "r", semanticsDigest: "sha256:" + "1".repeat(64) }), /prepared-dispatch capability/)` and `await assert.rejects(() => runner.recover(), /reconciliation capability/)`. Each runner-config fixture writes real PEM keys: `generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" })`. Run — cases (ii)–(v) may already pass from Step 4's factories (they are pinned regressions of local.ts guards through the PUBLIC dispatch); case (i) and (iv) must be observed RED before Step 4 lands if written first — write them before Step 4 where practical, otherwise record in the commit message that Step 4 and 5 land as one RED→GREEN slice with the RED evidence in the run log.
- [ ] **Step 6: Positive case with a signed four-alias deployment.** Create `test/authority/github-release-serve-fixture.ts` exporting `releaseServeFixture()`, modeled line-for-line on `multiDefinitionFixture` (`test/authority/local-multi-definition-jobs.test.ts:31–107`) with these substitutions: aliases = the four from `githubReleaseAliases`; per-alias contracts built in a loop over `githubReleasePacks` (`src/packs/github-release/index.ts:7` — each entry's `definition` provides `packDigest`, `definitionDigest` via `githubReleaseDefinitionDigests`, `resolverId`, `projectionSchemaId: "github_release_authorization_handle_projection_v1"`, `readEndpointIds: ["github.release.authorization.read"]`, `riskClasses: ["github_release"]`, `policySchemaId: "github_release_allocation_policy_v1"`); Job Card `definitionAliases` = the four aliases, `packDigests: [githubReleaseManifest.packDigest]`, `connectorIds: ["github"]`, one `adopted-mcp-stdio` connection descriptor mirroring the gmail one with `endpointIds` = the read endpoint plus the four write endpoints; deployment built with `buildAuthorityDeployment` and the extra three state entries appended to the manifest exactly as lines 94–96 do; trust pin via `jobCardTrustPinFixture`; finally write `authority.yml` (JSON) with `definitions` = four aliases, relative dirs, `deploymentPath`, `jobCardTrustPinPath`, plus a runner config JSON (loopback provider, empty `authorizationDir`/`fixtureDir` dirs, generated PEM keys) and return both file paths. Then the positive test: `assert.equal(await serveThroughDispatch(["authority", "serve", "--path", fixture.configFile, "--transport", "http", "--host", "127.0.0.1", "--port", "8080", "--release-runner-config", fixture.runnerConfigFile], () => { started += 1; }), 0)` and `assert.equal(started, 1)`. If `buildAuthorityDeployment` refuses a candidate field, read the thrown validation message and correct the candidate within `deploy.ts`'s closed schema — the assertion target (exit 0, `startHost` invoked once, real factories un-stubbed) does not move. Also add the spawn smoke `{ skip: process.platform === "win32" }`: `spawn(process.execPath, [path.resolve("dist-test/src/cli.js"), "authority", "serve", ...same args])` following the bootstrap test at `authority-serve.test.ts:60–85`, asserting the `{"status":"ready","transport":"http",...}` stderr line, then kill.
- [ ] **Step 7: Full-lane verification and commit.** `npm test` (full Ubuntu-equivalent local suite; on win32 the linux-only ledger tests self-skip). Expected: 0 failures. `git diff --check && git add src/cli.ts src/authority/cli.ts test/authority/authority-serve.test.ts test/authority/github-release-serve-fixture.ts && git commit -m "feat(authority): inject the release runner into authority serve fail-closed"`.

### Task A4: Scoped Task-5 re-review dispatch (operational — no code changes)

**Files:** none modified by this task. Evidence artifacts: the A1–A3 commit range, the RED/GREEN run logs captured in Steps A1.1/A1.2/A1.6, A2.1/A2.2, A3.1/A3.3/A3.5, and one full `npm test` log at Lane-A head. Ledger: the SDD ledger that carries the Task-5 line "BLOCKED by terminal breaker review at d075f75d" (locate with `git log --all --oneline -- "docs/superpowers/plans/*eve-governed*"` and `git grep -n "BLOCKED by terminal breaker"` across the worktree and main checkout; see notes).

**Interfaces:** Consumes: the three A1–A3 fix commits and their test evidence. Produces: one independent re-review verdict (`pass` / `fail` per falsifier) that the barrier (spec §3) and all release evidence consume; until it reads `pass`, nothing may cite Task 5 as satisfied.

- [ ] **Step 1: Confirm the tree is review-ready.** Run `npm test` at Lane-A head and `git log --oneline d075f75d..HEAD -- src/authority test` to enumerate the exact commits under review. Expected: full suite green; the commit list contains only Lane-A commits (Lane file-disjointness check — no `.github/workflows` or `infra/fly` paths).
- [ ] **Step 2: Dispatch ONE fresh independent re-review** (per the Task-1→Task-2 carry precedent: the fixer does not self-review). Exact dispatch prompt to hand the reviewer, verbatim:
> Scoped re-review of the three Task-5 terminal breaker falsifiers on branch `codex/eve-governed-production-release`, commit range `d075f75d..<lane-A-head>`. Scope is EXACTLY: (1) receipt integrity — verify `src/authority/host/receipts.ts` now recomputes `evidenceDigest` from the digest-bound preimage, cross-checks `head.phase`/`terminalKind`/`priorReceiptRef`/`reservationReceiptRef`/`v` against the preimage, refuses reservation-phase heads for `dispatched`/`ambiguous` queries loader-side, and fsyncs parent directories after node create, durable-dir mkdir, and legacy rename (temp-file+fsync+rename in `writeImmutable`); attempt to re-forge a well-formed `evidenceDigest`, a tampered `terminalKind`, and a lost terminal dirent after restart. (2) ID seam — verify `normalizeReservationPublicationId` is the single bridge applied at `receipts.ts` guard/map keys, `dispatch.ts` `durableIdentity`, and the runner's journal requestId, wrapper map keys, and confirm requestId; verify `fs-ledger.ts` is untouched, `PreparedDispatchDescriptionV1.reservationId` and the coordinator capability stamps stay raw; re-run the real-`FsAuthorityLedger` dispatch and crash-recovery tests and attempt to strand a send-started reservation. (3) serve injection — verify `authority serve` constructs the branded runner from `--release-runner-config` in-process, routes it as an explicit `composeAuthorityServeHost` parameter (never an options key), refuses four-alias configs without a constructible runner and stdio+runner at startup, and that the tests enter public command dispatch (spawn or `runAuthorityCommand` with only `startHost` stubbed) — a pass-through-options test proves nothing. Adjacent surface only: the files those fixes touch and their direct callers. You may report findings anywhere in scope, including new falsifiers. You may NOT fix anything — there is no sixth in-task fix round; any finding returns to the operator for a fresh dispatch decision. Deliver: per-falsifier verdict (pass/fail), findings list with file:line, and the commands you ran.
- [ ] **Step 3: Record the verdict in the SDD ledger.** On `pass`, append (adjusting only the head SHA and date): `2026-08-XX Task 5 re-review (scoped, independent): three terminal falsifiers re-tested at <lane-A-head> — receipt forgery refused, lost-dirent rollback refused, ID seam walks real raw reservations to terminal, serve constructs and routes the release runner; PASS. Task-5 BLOCKED status lifted; release evidence may consume Task 5 from this line onward.` On `fail`, append the finding list instead, keep the BLOCKED line in force, and stop the lane — the barrier (spec §3) cannot be claimed. Expected observable outcome: the ledger line exists in the same file that carries the `d075f75d` BLOCKED line, committed as `git diff --check && git add <ledger-file> && git commit -m "docs: record scoped Task-5 re-review verdict"`.
- [ ] **Step 4: Hand the barrier evidence forward.** Attach to the lane-completion note for the plan assembler: the re-review verdict text, the commit range, and the full-suite log. No release evidence, rehearsal, or mission step may cite Task 5 until Step 3 recorded `pass` — pending/absent/unchecked/ambiguous never pass.

# Lane B — Release surface (spec §5)

All paths are relative to the worktree root `C:/Users/maxim/CascadeProjects/reelier/.worktrees/eve-governed-production-release` (branch `codex/eve-governed-production-release`, read at `6ad09b4d`). Test cycle for every code task: `npx tsc -p tsconfig.test.json` then `node --test --test-concurrency=1 "dist-test/test/<file>.test.js"` from the worktree root (tests resolve fixtures via `process.cwd()` — the `action-version-pin.test.ts` precedent). B1 must complete before B2–B4 execute their carrier-dependent steps; B5 is independent of B1's outcome and may run in parallel after B1's read-through (it reads the same frozen files).

### Task B1: Authorization-transport contract check (FIRST work item — operational)

**Files:** Create: `docs/superpowers/plans/2026-08-19-release-authorization-transport-decision.md` (decision record). Modify: none — this task reads frozen contracts and records a decision; it changes no contract file.
**Interfaces:** Consumes: `src/authority/release-contracts.ts` (`RELEASE_EFFECTS` line 13, `parseReleaseOperationPlanV1` lines 328–363, `parseReleaseAuthorizationBundleV1` lines 382–411), `src/authority/host/github-release-runner.ts` (`GitHubReleaseProviderV1` lines 35–50, `TRANSITIONS` lines 20–24, `candidate()` line 298, `tag()` line 400), `src/packs/github-release/manifest.ts` (`githubReleaseDefinitionDigests` line 24), `docs/specs/github-release-outcomes-v1.md`. Produces: a recorded carrier decision, one of `tag-message` | `authorization-ref` | `escalated`, that B2's invocation flags and B3/B4's workflow steps bind to.

- [ ] **Step 1: Pin the frozen surface being checked.** Run `git rev-parse HEAD` and `git log -1 --format="%H %s" -- src/authority/release-contracts.ts src/authority/host/github-release-runner.ts src/packs/github-release/manifest.ts docs/specs/github-release-outcomes-v1.md`. Expected observable outcome: a commit hash (currently `6ad09b4d...` lineage); record both lines verbatim as the header of the decision record.
- [ ] **Step 2: Evaluate carrier A (annotated-tag message) against the frozen tag write.** Run `grep -n "createTag\|tags/" src/authority/host/github-release-runner.ts` and read `tag()` at lines 377–405. Expected observation: the only tag write is `provider.createRef({ repository: plan.repository, ref, sha: mergeSha, force: false })` at line 400 with `ref = "tags/" + plan.tag` (line 382) — a lightweight ref, no git tag *object* and no message field; `GitHubReleaseProviderV1` (lines 35–50) has no `createTag` method; `TRANSITIONS` (lines 20–24) has no phase for a tag-object write; `parseReleaseOperationPlanV1`'s exact key list (line 329) has no field that could carry an artifact set. Record verdict A with each file:line citation: **fits** only if a message-bearing tag can be produced without adding a provider method, a saga phase, or an operation-plan key; otherwise **does not fit**.
- [ ] **Step 3: Evaluate carrier B (`refs/reelier/release-authorizations/v0.32.1`).** Read `candidate()` lines 282–304 (exactly one governed ref write: the candidate branch, line 298) and `parseReleaseAuthorizationBundleV1` line 389–398 (exactly four allocations, `maxEffects: 1` each). Expected observation: an *additional* ref written by `github_release_candidate_publish_v1` would be a second provider write under a one-effect allocation and a new saga phase — an amendment. Then evaluate the variant where the ref is written **out-of-band by the human authorizer/Authority Cell** (the signer of the bundle, not a governed effect): confirm nothing in `release-contracts.ts`, the runner, or `docs/specs/github-release-outcomes-v1.md` binds or forbids refs outside `heads/reelier/release/0.32.1` and `tags/v0.32.1` (receipt-graph completeness is `unchecked` by charter). Record verdict B for both variants with citations.
- [ ] **Step 4: Apply the decision rule and record.** Write `docs/superpowers/plans/2026-08-19-release-authorization-transport-decision.md` containing: the Step-1 pin, verdicts A and B with citations, and the decision per the rule — prefer `tag-message` if A fits; else `authorization-ref` if B fits without amending any frozen contract; if the only fitting variant deviates from the spec's stated fallback wording (operator-written ref instead of candidate-publish-written ref) or neither fits, mark the decision `escalated`, STOP Lane-B carrier-dependent work, and put the exception to the operator verbatim — never widen a frozen contract silently. Expected observable outcome: the file exists and names exactly one of the three outcomes.
- [ ] **Step 5: Commit.** `git add docs/superpowers/plans/2026-08-19-release-authorization-transport-decision.md && git diff --cached --check && git commit -m "docs: record release authorization transport contract check"`.

### Task B2: Shared offline verifier `scripts/verify-release-authorization.mjs`

**Files:** Create: `scripts/verify-release-authorization.mjs`. Test: `test/authority/verify-release-authorization.test.ts`.
**Interfaces:** Consumes (built barrel `dist/authority/index.js`, all confirmed exported in `src/authority/index.ts` lines 6–46): `parseCanonicalSignedReleaseAuthorizationBundleV1(json: string)`, `parseCanonicalSignedStagedCandidateManifestV1(json: string)`, `parseCanonicalSignedReleasePolicyV1(json: string)`, `parseSignedReleaseOperationPlanV1(value: unknown)`, `verifyReleaseAuthorizationBundleV1(input, verifier: {publicKeySpkiBase64: string; signerId: string}, now: Date, qualityEvidence: readonly {evidence: unknown; verifier}[]) : VerifiedReleaseAuthorizationV1`. Test helpers: the `createSigned*` + `generateKeyPairSync` fixture pattern from `test/authority/release-contracts.test.ts` lines 29–163 and the single-evidence-key shortcut from `test/authority/github-release-runner.test.ts` lines 30–46; `authorityCanonicalBytes` from `src/authority/wire.js`. Produces: CLI contract `node scripts/verify-release-authorization.mjs (--artifact-set <file> | --from-tag <tag> | --from-ref <refname>) [--signer-id --signer-spki-base64 | env REELIER_RELEASE_SIGNER_ID/REELIER_RELEASE_SIGNER_SPKI] [--tag <name>] [--check-head] [--tarball <path>] [--emit <file>]`, exit 0 only on full verification; summary JSON `{v:"reelier.release-verification-summary/v1", authorizationBundleDigest, candidateCommit, expiresAt, packageVersion, packedTarballDigest, tag}`; transport envelope `reelier.release-authorization-transport/v1` (closed: `{v, artifacts:{authorization,candidateManifest,operationPlan,policy: <canonical JSON strings>}, qualityEvidence:[{evidence:<canonical JSON string>, verifier:{signerId, publicKeySpkiBase64}} x3]}`) — B3/B4 workflows and the Cell's artifact producer bind to these. Test seam: `REELIER_RELEASE_BARREL` (module URL of the barrel; precedent `REELIER_JOURNAL_MODULE` in `github-release-runner.test.ts` lines 176–183). Build prerequisite: like `scripts/build-packs.mjs`, the script imports from `dist/` — workflows must run `npm ci && npm run build` before invoking it.

- [ ] **Step 1: Write the failing test file** `test/authority/verify-release-authorization.test.ts`:

```ts
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createSignedReleaseAuthorizationBundleV1, createSignedReleaseOperationPlanV1, createSignedReleasePolicyV1, createSignedReleaseVerifierEvidenceV1, createSignedStagedCandidateManifestV1, type ReleaseEvidenceLaneV1 } from "../../src/authority/release-contracts.js";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";

const scriptPath = path.resolve("scripts/verify-release-authorization.mjs");
const digest = (c: string) => `sha256:${c.repeat(64)}`;
const sha = (c: string) => c.repeat(40);
const authorityKeys = generateKeyPairSync("ed25519"), evidenceKeys = generateKeyPairSync("ed25519"), graphKeys = generateKeyPairSync("ed25519");
const signer = { signerId: "release-authority-2026", privateKey: authorityKeys.privateKey };
const evidenceSigner = { signerId: "release-provider-verifier", privateKey: evidenceKeys.privateKey };
const spki = (key: typeof authorityKeys.publicKey) => key.export({ format: "der", type: "spki" }).toString("base64");
const spkiDigest = (key: typeof authorityKeys.publicKey) => `sha256:${createHash("sha256").update(key.export({ format: "der", type: "spki" })).digest("hex")}`;
const allLanes: ReleaseEvidenceLaneV1[] = ["ci-coverage", "ci-full-tests", "ci-mutation", "candidate-branch", "candidate-pull-request", "ghcr-immutable-manifest", "ghcr-tags", "human-authorization", "human-exceptions", "human-interruptions", "human-post-release-review", "installed-linux", "installed-windows", "mcp-registry-version", "merge-exact-sha", "npm-integrity", "npm-provenance", "tag-immutable-ref"];
const canonical = (value: unknown) => authorityCanonicalBytes(value).toString("utf8");

function buildEnvelope(issuedAtMs: number, packedTarballDigest: string): string {
  const issuedAt = new Date(issuedAtMs).toISOString(), expiresAt = new Date(issuedAtMs + 43_200_000).toISOString(), observedAt = new Date(issuedAtMs + 60_000).toISOString();
  const files = [{ blobSha: sha("b"), contentDigest: digest("b"), mode: "100644" as const, path: "CHANGELOG.md" }, { blobSha: sha("c"), contentDigest: digest("c"), mode: "100644" as const, path: "src/cli.ts" }, { blobSha: sha("d"), contentDigest: digest("d"), mode: "100644" as const, path: "test/cli-subcommand-help.test.ts" }];
  const candidateTreeDigest = authorityDigest({ v: "reelier.release-candidate-tree/v1", files });
  const workflows = [{ digest: digest("3"), path: ".github/workflows/ci.yml" }, { digest: digest("4"), path: ".github/workflows/docker-publish.yml" }, { digest: digest("5"), path: ".github/workflows/mcp-publish.yml" }, { digest: digest("6"), path: ".github/workflows/npm-publish.yml" }];
  const operationPlan = createSignedReleaseOperationPlanV1({ v: "reelier.release-operation-plan/v1", repository: "seldonframe/reelier", baseCommit: "e600ad5c2dc5e1bde0714915e7a84980c8d5602b", baseTreeSha: sha("b"), candidateBranch: "reelier/release/0.32.1", destinationBranch: "main", tag: "v0.32.1", candidateTreeDigest, expectedTreeSha: sha("e"), expectedCommitSha: sha("a"), files, commit: { author: { name: "SeldonFrame Release", email: "release@seldonframe.com", date: issuedAt }, committer: { name: "SeldonFrame Release", email: "release@seldonframe.com", date: issuedAt }, message: "release: v0.32.1", parentSha: "e600ad5c2dc5e1bde0714915e7a84980c8d5602b" }, pullRequest: { base: "main", head: "reelier/release/0.32.1", draft: true, readyForReview: true, title: "Release v0.32.1", body: "Governed release v0.32.1" }, squash: { commitTitle: "Release v0.32.1", commitMessage: "release: v0.32.1" }, requiredChecks: ["coverage", "full-tests", "mutation"], workflowCommitments: workflows, npmPreflight: { packageName: "reelier", version: "0.32.1", versionMustBeAbsent: true } } as never, signer);
  const candidateManifest = createSignedStagedCandidateManifestV1({ v: "reelier.staged-candidate-manifest/v1", repository: "seldonframe/reelier", baseCommit: "e600ad5c2dc5e1bde0714915e7a84980c8d5602b", destinationBranch: "main", branch: "reelier/release/0.32.1", tag: "v0.32.1", packageName: "reelier", packageVersion: "0.32.1", candidateCommit: sha("a"), candidateTreeDigest, changedBytes: 4096, changedPaths: files.map(file => file.path), packedTarballDigest, workflowCommitments: workflows, qualityEvidence: { coverageEvidenceDigest: digest("7"), coverageStatus: "non-regressed", fullTestEvidenceDigest: digest("8"), fullTestsStatus: "verified", headCommit: sha("a"), mutationEvidenceDigest: digest("9"), mutationScoreBasisPoints: 9_500 } }, signer);
  const policy = createSignedReleasePolicyV1({ v: "reelier.release-policy/v1", allowedPaths: files.map(file => file.path), destinations: ["ghcr", "mcp-registry", "npm"], effectAllocations: ["candidate-branch", "draft-pr", "exact-sha-merge", "non-force-tag"], expirySeconds: 43_200, forbiddenChangeClasses: ["authority-contract", "credential", "dependency", "generated-contract", "lockfile", "policy", "release-script", "workflow"], maxChangedBytes: 65_536, maxChangedFiles: 3 }, signer);
  const effects = ["candidate-branch", "draft-pr", "exact-sha-merge", "non-force-tag"] as const;
  const authorization = createSignedReleaseAuthorizationBundleV1({ v: "reelier.release-authorization-bundle/v1", authorityCellDigest: digest("a"), effectAllocations: effects.map((effect, index) => ({ allocationDigest: digest(String(index + 1)), allocationId: `release-${effect}-01`, effect, maxEffects: 1 as const })), evidenceVerifierBindings: allLanes.map(lane => ({ lane, signerId: evidenceSigner.signerId, publicKeySpkiDigest: spkiDigest(evidenceKeys.publicKey) })), expiresAt, issuedAt, jobCardDigest: digest("b"), missionDigest: digest("c"), operationPlanDigest: operationPlan.digest, packDigest: digest("d"), policyDigest: policy.digest, receiptGraphMakerBinding: { signerId: "release-graph-maker-2026", publicKeySpkiDigest: spkiDigest(graphKeys.publicKey) }, rootGrantDigest: digest("e"), stagedCandidateManifestDigest: candidateManifest.digest, taskDigest: digest("f") }, signer);
  const qualityEvidence = ([["ci-coverage", digest("7"), 1], ["ci-full-tests", digest("8"), 1], ["ci-mutation", digest("9"), 9_500]] as const).map(([lane, subjectDigest, resultValue]) => ({ evidence: canonical(createSignedReleaseVerifierEvidenceV1({ v: "reelier.release-verifier-evidence/v1", authorizationBundleDigest: null, candidateCommit: sha("a"), count: null, freshUntil: null, lane, observation: "workflow-run", observedAt, resultValue, status: "verified", subjectDigest, workflowDigest: digest("3"), workflowPath: ".github/workflows/ci.yml" }, evidenceSigner)), verifier: { signerId: evidenceSigner.signerId, publicKeySpkiBase64: spki(evidenceKeys.publicKey) } }));
  return JSON.stringify({ v: "reelier.release-authorization-transport/v1", artifacts: { authorization: canonical(authorization), candidateManifest: canonical(candidateManifest), operationPlan: canonical(operationPlan), policy: canonical(policy) }, qualityEvidence });
}

function runVerifier(argsList: string[], envelope: string, extraEnv: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "reelier-verify-release-"));
  const envelopePath = path.join(dir, "artifact-set.json");
  writeFileSync(envelopePath, envelope, "utf8");
  const result = spawnSync(process.execPath, [scriptPath, "--artifact-set", envelopePath, ...argsList], { encoding: "utf8", env: { ...process.env, GITHUB_REF_NAME: "", REELIER_RELEASE_BARREL: pathToFileURL(path.resolve("dist-test/src/authority/index.js")).href, REELIER_RELEASE_SIGNER_ID: signer.signerId, REELIER_RELEASE_SIGNER_SPKI: spki(authorityKeys.publicKey), ...extraEnv } });
  return { result, dir };
}

test("verifier accepts a live artifact set, checks the tarball, and emits the verified summary", () => {
  const tarballBytes = Buffer.from("packed-tarball-fixture-bytes");
  const tarballDigest = `sha256:${createHash("sha256").update(tarballBytes).digest("hex")}`;
  const { result, dir } = runVerifier([], buildEnvelope(Date.now() - 60_000, tarballDigest));
  try {
    const tarballPath = path.join(dir, "reelier-0.32.1.tgz");
    writeFileSync(tarballPath, tarballBytes);
    const emitPath = path.join(dir, "summary.json");
    const full = spawnSync(process.execPath, [scriptPath, "--artifact-set", path.join(dir, "artifact-set.json"), "--tag", "v0.32.1", "--tarball", tarballPath, "--emit", emitPath], { encoding: "utf8", env: { ...process.env, GITHUB_REF_NAME: "", REELIER_RELEASE_BARREL: pathToFileURL(path.resolve("dist-test/src/authority/index.js")).href, REELIER_RELEASE_SIGNER_ID: signer.signerId, REELIER_RELEASE_SIGNER_SPKI: spki(authorityKeys.publicKey) } });
    assert.equal(full.status, 0, full.stderr);
    assert.match(full.stdout, /release authorization verified: sha256:/);
    const summary = JSON.parse(readFileSync(emitPath, "utf8"));
    assert.equal(summary.v, "reelier.release-verification-summary/v1");
    assert.equal(summary.tag, "v0.32.1");
    assert.equal(summary.packageVersion, "0.32.1");
    assert.equal(summary.packedTarballDigest, tarballDigest);
    void result;
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("verifier refuses a tampered canonical artifact string", () => {
  const envelope = JSON.parse(buildEnvelope(Date.now() - 60_000, digest("2")));
  envelope.artifacts.candidateManifest = String(envelope.artifacts.candidateManifest).replace("staged-candidate-manifest/v1", "staged-candidate-manifest/v2");
  const { result, dir } = runVerifier(["--tag", "v0.32.1"], JSON.stringify(envelope));
  try { assert.equal(result.status, 1); assert.match(result.stderr, /refused|invalid|canonical/i); } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("verifier refuses an expired authorization with new Date() as the clock", () => {
  const { result, dir } = runVerifier(["--tag", "v0.32.1"], buildEnvelope(Date.now() - 13 * 3_600_000, digest("2")));
  try { assert.equal(result.status, 1); assert.match(result.stderr, /expired/i); } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("verifier refuses a wrong tag and a wrong tarball digest", () => {
  const { result, dir } = runVerifier(["--tag", "v9.9.9"], buildEnvelope(Date.now() - 60_000, digest("2")));
  try { assert.equal(result.status, 1); assert.match(result.stderr, /does not equal the signed release tag/); } finally { rmSync(dir, { recursive: true, force: true }); }
  const wrong = runVerifier([], buildEnvelope(Date.now() - 60_000, digest("2")));
  try {
    const tarballPath = path.join(wrong.dir, "other.tgz");
    writeFileSync(tarballPath, Buffer.from("different-bytes"));
    const run = spawnSync(process.execPath, [scriptPath, "--artifact-set", path.join(wrong.dir, "artifact-set.json"), "--tag", "v0.32.1", "--tarball", tarballPath], { encoding: "utf8", env: { ...process.env, GITHUB_REF_NAME: "", REELIER_RELEASE_BARREL: pathToFileURL(path.resolve("dist-test/src/authority/index.js")).href, REELIER_RELEASE_SIGNER_ID: signer.signerId, REELIER_RELEASE_SIGNER_SPKI: spki(authorityKeys.publicKey) } });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /packedTarballDigest/);
  } finally { rmSync(wrong.dir, { recursive: true, force: true }); }
});

test("--check-head executes real git readback and refuses a non-matching head", () => {
  const { dir } = runVerifier(["--tag", "v0.32.1"], buildEnvelope(Date.now() - 60_000, digest("2")));
  try {
    const repo = path.join(dir, "scratch-repo");
    const git = (...argsList: string[]) => { const run = spawnSync("git", argsList, { cwd: repo, encoding: "utf8" }); assert.equal(run.status, 0, run.stderr); };
    spawnSync("git", ["init", repo], { encoding: "utf8" });
    git("config", "user.email", "test@example.com"); git("config", "user.name", "test");
    writeFileSync(path.join(repo, "a.txt"), "one"); git("add", "."); git("commit", "-m", "one");
    writeFileSync(path.join(repo, "a.txt"), "two"); git("add", "."); git("commit", "-m", "two");
    const run = spawnSync(process.execPath, [scriptPath, "--artifact-set", path.join(dir, "artifact-set.json"), "--tag", "v0.32.1", "--check-head"], { cwd: repo, encoding: "utf8", env: { ...process.env, GITHUB_REF_NAME: "", REELIER_RELEASE_BARREL: pathToFileURL(path.resolve("dist-test/src/authority/index.js")).href, REELIER_RELEASE_SIGNER_ID: signer.signerId, REELIER_RELEASE_SIGNER_SPKI: spki(authorityKeys.publicKey) } });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /HEAD tree .* does not equal the signed expected tree/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
```

  Note the barrel seam points at `dist-test/src/authority/index.js`, which exists after the test compile — no `npm run build` needed for the hermetic tests.
- [ ] **Step 2: Run and confirm RED.** `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 "dist-test/test/authority/verify-release-authorization.test.js"`. Expected FAIL: every test fails with `AssertionError` on `result.status` / `full.status` (spawn of the missing `scripts/verify-release-authorization.mjs` exits non-zero with `Cannot find module`).
- [ ] **Step 3: Write the script** `scripts/verify-release-authorization.mjs` (complete):

```js
#!/usr/bin/env node
// Shared offline release-authorization verifier — called by all three tag publish
// workflows (npm-publish.yml, mcp-publish.yml, docker-publish.yml). Shared script
// over inline run for the same reason as check-release-ancestor.mjs: a guard
// duplicated in three places drifts in one of them.
//
// Verifies offline: signed bundle/manifest/plan/policy digest links and signatures,
// the 12-hour expiry window against new Date(), the three signed CI quality lanes,
// the release tag name, (--check-head) the checked-out squash commit's tree, parent,
// and package version, and (--tarball) the packed tarball digest against the signed
// StagedCandidateManifestV1.packedTarballDigest. Any failure exits non-zero.
//
// BUILD PREREQUISITE: imports the built authority barrel (dist/authority/index.js);
// run `npm ci && npm run build` first (same dist dependency as build-packs.mjs).
// Env: REELIER_RELEASE_SIGNER_ID / REELIER_RELEASE_SIGNER_SPKI (trust pin),
//      REELIER_RELEASE_BARREL (test seam: module URL of the built barrel).

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const barrel = await import(process.env.REELIER_RELEASE_BARREL ?? new URL("../dist/authority/index.js", import.meta.url).href);
const { parseCanonicalSignedReleaseAuthorizationBundleV1, parseCanonicalSignedStagedCandidateManifestV1, parseCanonicalSignedReleasePolicyV1, parseSignedReleaseOperationPlanV1, verifyReleaseAuthorizationBundleV1 } = barrel;

function fail(message) { console.error(`release authorization verifier: ${message}`); process.exit(1); }

function parseArgs(argv) {
  const args = { source: null, sourceValue: null, signerId: process.env.REELIER_RELEASE_SIGNER_ID || null, signerSpki: process.env.REELIER_RELEASE_SIGNER_SPKI || null, tag: null, checkHead: false, tarball: null, emit: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const take = () => { const value = argv[++index]; if (typeof value !== "string" || value.startsWith("--")) fail(`${flag} requires a value`); return value; };
    if (flag === "--artifact-set" || flag === "--from-tag" || flag === "--from-ref") { if (args.source) fail("exactly one of --artifact-set, --from-tag, --from-ref is allowed"); args.source = flag; args.sourceValue = take(); }
    else if (flag === "--signer-id") args.signerId = take();
    else if (flag === "--signer-spki-base64") args.signerSpki = take();
    else if (flag === "--tag") args.tag = take();
    else if (flag === "--check-head") args.checkHead = true;
    else if (flag === "--tarball") args.tarball = take();
    else if (flag === "--emit") args.emit = take();
    else fail(`unknown argument: ${flag}`);
  }
  if (!args.source) fail("an artifact source is required: --artifact-set <file>, --from-tag <tag>, or --from-ref <refname>");
  if (!args.signerId || !args.signerSpki) fail("the trusted authorization signer is required: --signer-id/--signer-spki-base64 or REELIER_RELEASE_SIGNER_ID/REELIER_RELEASE_SIGNER_SPKI");
  return args;
}

function git(argsList) {
  try { return execFileSync("git", argsList, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch (error) { fail(`git ${argsList.join(" ")} failed: ${error instanceof Error ? error.message : String(error)}`); }
}

function loadEnvelopeText(args) {
  if (args.source === "--artifact-set") { try { return readFileSync(args.sourceValue, "utf8"); } catch { fail(`cannot read artifact set file ${args.sourceValue}`); } }
  if (args.source === "--from-tag") {
    if (git(["cat-file", "-t", args.sourceValue]) !== "tag") fail(`tag ${args.sourceValue} is not an annotated tag; the authorization carrier is absent`);
    return git(["for-each-ref", `refs/tags/${args.sourceValue}`, "--format=%(contents)"]);
  }
  if (git(["cat-file", "-t", args.sourceValue]) !== "blob") fail(`ref ${args.sourceValue} does not point at an authorization blob`);
  return git(["cat-file", "blob", args.sourceValue]);
}

function parseEnvelope(text) {
  let value; try { value = JSON.parse(text.trim()); } catch { fail("authorization transport envelope is not valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("authorization transport envelope is not an object");
  if (Object.keys(value).sort().join(",") !== "artifacts,qualityEvidence,v" || value.v !== "reelier.release-authorization-transport/v1") fail("authorization transport envelope has the wrong version or key set");
  const artifacts = value.artifacts;
  if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts) || Object.keys(artifacts).sort().join(",") !== "authorization,candidateManifest,operationPlan,policy") fail("envelope artifacts must be exactly authorization, candidateManifest, operationPlan, policy");
  for (const key of ["authorization", "candidateManifest", "operationPlan", "policy"]) if (typeof artifacts[key] !== "string") fail(`envelope artifact ${key} must be a canonical JSON string`);
  if (!Array.isArray(value.qualityEvidence) || value.qualityEvidence.length !== 3) fail("envelope must carry exactly three quality evidence entries (ci-coverage, ci-full-tests, ci-mutation)");
  const qualityEvidence = value.qualityEvidence.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).sort().join(",") !== "evidence,verifier") fail(`quality evidence entry ${index} must be exactly { evidence, verifier }`);
    if (typeof raw.evidence !== "string") fail(`quality evidence entry ${index} evidence must be a canonical JSON string`);
    const verifier = raw.verifier;
    if (!verifier || typeof verifier !== "object" || Array.isArray(verifier) || Object.keys(verifier).sort().join(",") !== "publicKeySpkiBase64,signerId" || typeof verifier.signerId !== "string" || typeof verifier.publicKeySpkiBase64 !== "string") fail(`quality evidence entry ${index} verifier descriptor is invalid`);
    let evidence; try { evidence = JSON.parse(raw.evidence); } catch { fail(`quality evidence entry ${index} is not valid JSON`); }
    return { evidence, verifier: { publicKeySpkiBase64: verifier.publicKeySpkiBase64, signerId: verifier.signerId } };
  });
  return { artifacts, qualityEvidence };
}

const args = parseArgs(process.argv.slice(2));
const { artifacts, qualityEvidence } = parseEnvelope(loadEnvelopeText(args));

let verified;
try {
  const authorization = parseCanonicalSignedReleaseAuthorizationBundleV1(artifacts.authorization);
  const candidateManifest = parseCanonicalSignedStagedCandidateManifestV1(artifacts.candidateManifest);
  const policy = parseCanonicalSignedReleasePolicyV1(artifacts.policy);
  // No canonical-string parser is exported for the operation plan; its digest and
  // signature still bind the exact value inside verifyReleaseAuthorizationBundleV1.
  const operationPlan = parseSignedReleaseOperationPlanV1(JSON.parse(artifacts.operationPlan));
  verified = verifyReleaseAuthorizationBundleV1({ authorization, candidateManifest, operationPlan, policy }, { publicKeySpkiBase64: args.signerSpki, signerId: args.signerId }, new Date(), qualityEvidence);
} catch (error) {
  fail(`signed release authorization refused: ${error instanceof Error ? error.message : String(error)}`);
}

const manifest = verified.candidateManifest.value;
const plan = verified.operationPlan.value;

const tagName = args.tag ?? (typeof process.env.GITHUB_REF_NAME === "string" && /^v/.test(process.env.GITHUB_REF_NAME) ? process.env.GITHUB_REF_NAME : null);
if (!tagName) fail("release tag name is unavailable; pass --tag <name> (fail closed)");
if (tagName !== manifest.tag) fail(`tag ${tagName} does not equal the signed release tag ${manifest.tag}`);

if (args.checkHead) {
  const headTree = git(["rev-parse", "HEAD^{tree}"]);
  if (headTree !== plan.expectedTreeSha) fail(`HEAD tree ${headTree} does not equal the signed expected tree ${plan.expectedTreeSha}`);
  const headParent = git(["rev-parse", "HEAD^"]);
  if (headParent !== plan.baseCommit) fail(`HEAD parent ${headParent} does not equal the authorized base commit ${plan.baseCommit}`);
  let pkg; try { pkg = JSON.parse(git(["show", "HEAD:package.json"])); } catch { fail("HEAD:package.json is unreadable"); }
  if (pkg.name !== manifest.packageName || pkg.version !== manifest.packageVersion) fail(`HEAD package ${pkg.name}@${pkg.version} does not equal signed ${manifest.packageName}@${manifest.packageVersion}`);
}

if (args.tarball) {
  let tarballDigest; try { tarballDigest = `sha256:${createHash("sha256").update(readFileSync(args.tarball)).digest("hex")}`; } catch { fail(`cannot read tarball ${args.tarball}`); }
  if (tarballDigest !== manifest.packedTarballDigest) fail(`tarball digest ${tarballDigest} does not equal the signed packedTarballDigest ${manifest.packedTarballDigest}; refusing to publish`);
}

if (args.emit) writeFileSync(args.emit, `${JSON.stringify({ v: "reelier.release-verification-summary/v1", authorizationBundleDigest: verified.authorization.digest, candidateCommit: manifest.candidateCommit, expiresAt: verified.authorization.value.expiresAt, packageVersion: manifest.packageVersion, packedTarballDigest: manifest.packedTarballDigest, tag: manifest.tag }, null, 2)}\n`, "utf8");

console.log(`release authorization verified: ${verified.authorization.digest} (${manifest.packageName}@${manifest.packageVersion}, tag ${manifest.tag}, expires ${verified.authorization.value.expiresAt})`);
```

- [ ] **Step 4: Run and confirm GREEN.** Same command as Step 2. Expected PASS: `tests 5, pass 5, fail 0`.
- [ ] **Step 5: Bind the B1 carrier.** Per B1's recorded outcome, no code change is needed — the source flags already cover both carriers (`--from-tag` for `tag-message`; `--from-ref refs/reelier/release-authorizations/<tag>` for `authorization-ref`; `--artifact-set` for rehearsal fixtures). Append one line to B1's decision record naming the exact production invocation. If B1 recorded `escalated`, stop here and leave B3/B4 verifier steps in their written default.
- [ ] **Step 6: Commit.** `git add scripts/verify-release-authorization.mjs test/authority/verify-release-authorization.test.ts docs/superpowers/plans/2026-08-19-release-authorization-transport-decision.md && git diff --cached --check && git commit -m "ci: add shared offline release-authorization verifier"`.

### Task B3: `.github/workflows/npm-publish.yml` + npm destination reconciliation

**Files:** Create: `.github/workflows/npm-publish.yml` (path already bound in `RELEASE_WORKFLOWS`, `src/authority/release-contracts.ts:14`), `scripts/reconcile-npm-destination.mjs`. Test: `test/release-workflows.test.ts` (new; workflow-shape pinning in the `scripts/verify-bootstrap-native-workflow.mjs` required-lines style, as a node:test file per the `test/action-version-pin.test.ts` cwd-anchored precedent), `test/reconcile-npm-destination.test.ts`.
**Interfaces:** Consumes: B2's CLI contract and summary JSON; `scripts/check-release-ancestor.mjs` (invoked exactly as in `mcp-publish.yml:29`). Produces: `scripts/reconcile-npm-destination.mjs` contract — `--package <name> --version <v> --tarball <path> [--registry <origin>] [--expect reconciled|absent]`; exit 0 with `state=absent|reconciled` written to stdout and `$GITHUB_OUTPUT`; exit 1 = terminal conflict (never republish); exit 2 = uncertain (pending, never resent). This workflow assumes B1's **tag-message** outcome; under the **authorization-ref** fallback exactly one step changes (marked below).

- [ ] **Step 1: Write the failing workflow-shape test** `test/release-workflows.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (relative: string) => readFileSync(path.resolve(relative), "utf8");

test("npm-publish.yml pins the governed publish shape", () => {
  const workflow = read(".github/workflows/npm-publish.yml");
  for (const required of [
    'tags: ["v*"]', "workflow_dispatch:", "id-token: write", "contents: read",
    "environment: production-release", "node-version: 24", "fetch-depth: 0",
    "node scripts/check-release-ancestor.mjs", "node scripts/verify-release-authorization.mjs",
    "node scripts/reconcile-npm-destination.mjs", "npm ci", "npm run build", "npm pack",
    "--provenance", "concurrency:", "group: npm-publish-${{ github.ref_name }}", "cancel-in-progress: false",
  ]) assert.ok(workflow.includes(required), `npm-publish.yml is missing: ${required}`);
});
```

- [ ] **Step 2: Run and confirm RED.** `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 "dist-test/test/release-workflows.test.js"`. Expected FAIL: `ENOENT ... .github/workflows/npm-publish.yml`.
- [ ] **Step 3: Write `.github/workflows/npm-publish.yml`** (complete):

```yaml
# Publishes reelier to npm on release tags — the governed fourth workflow.
# This path is digest-bound in RELEASE_WORKFLOWS (src/authority/release-contracts.ts):
# any edit here changes the workflow digest every signed StagedCandidateManifestV1 pins.
# Auth: npm Trusted Publisher via GitHub OIDC (admin checklist, spec section 6) — no token secret.
name: Publish to npm

on:
  workflow_dispatch:
  push:
    tags: ["v*"]

permissions:
  id-token: write
  contents: read

# Per-version concurrency: one publish attempt per tag, never cancelled mid-publish.
concurrency:
  group: npm-publish-${{ github.ref_name }}
  cancel-in-progress: false

jobs:
  publish:
    runs-on: ubuntu-latest
    environment: production-release
    steps:
      - uses: actions/checkout@v4
        with:
          # Full history: the ancestor guard computes a merge-base.
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: "https://registry.npmjs.org"

      - name: Release guard — tag must be an ancestor of main
        run: node scripts/check-release-ancestor.mjs

      - name: Install and build (release verifier prerequisite)
        run: |
          npm ci
          npm run build

      # B1 tag-message carrier. Under the authorization-ref fallback this step's run
      # block becomes:
      #   git fetch origin "+refs/reelier/release-authorizations/*:refs/reelier/release-authorizations/*"
      #   node scripts/verify-release-authorization.mjs --from-ref "refs/reelier/release-authorizations/${GITHUB_REF_NAME}" --check-head --emit /tmp/verified-release.json
      - name: Verify release authorization (offline, fail closed)
        env:
          REELIER_RELEASE_SIGNER_ID: ${{ vars.RELEASE_AUTHORIZATION_SIGNER_ID }}
          REELIER_RELEASE_SIGNER_SPKI: ${{ vars.RELEASE_AUTHORIZATION_SIGNER_SPKI }}
        run: node scripts/verify-release-authorization.mjs --from-tag "$GITHUB_REF_NAME" --check-head --emit /tmp/verified-release.json

      - name: Pack
        run: npm pack

      - name: Tarball digest must equal the signed manifest value
        env:
          REELIER_RELEASE_SIGNER_ID: ${{ vars.RELEASE_AUTHORIZATION_SIGNER_ID }}
          REELIER_RELEASE_SIGNER_SPKI: ${{ vars.RELEASE_AUTHORIZATION_SIGNER_SPKI }}
        run: node scripts/verify-release-authorization.mjs --from-tag "$GITHUB_REF_NAME" --tarball "reelier-$(node -p "require('./package.json').version").tgz"

      # Runs BEFORE publish and before any retry: matching published integrity ->
      # reconciled success (publish skipped); conflicting -> terminal failure;
      # uncertain -> pending (exit 2), never resent.
      - name: Destination reconciliation — refuse duplicate or conflicting publish
        id: reconcile
        run: node scripts/reconcile-npm-destination.mjs --package reelier --version "$(node -p "require('./package.json').version")" --tarball "reelier-$(node -p "require('./package.json').version").tgz"

      # Publishes the exact digest-checked tarball file: npm does not re-pack or run
      # pack scripts for a tarball path, so the published bytes are the verified bytes.
      - name: Publish to npm with provenance
        if: steps.reconcile.outputs.state == 'absent'
        run: npm publish "reelier-$(node -p "require('./package.json').version").tgz" --provenance --access public

      - name: Post-publish destination reconciliation
        if: steps.reconcile.outputs.state == 'absent'
        run: node scripts/reconcile-npm-destination.mjs --package reelier --version "$(node -p "require('./package.json').version")" --tarball "reelier-$(node -p "require('./package.json').version").tgz" --expect reconciled
```

- [ ] **Step 4: Run and confirm GREEN** (same command as Step 2). Expected PASS: `pass 1, fail 0`.
- [ ] **Step 5: Write the failing reconciliation test** `test/reconcile-npm-destination.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

const scriptPath = path.resolve("scripts/reconcile-npm-destination.mjs");
const tarballBytes = Buffer.from("reconcile-fixture-tarball");
const integrity = `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`;

async function withRegistry(handler: (status: number, body: unknown) => { status: number; body: unknown }, respond: { status: number; body: unknown }, run: (origin: string, tarballPath: string, outputPath: string) => void): Promise<void> {
  void handler;
  const dir = mkdtempSync(path.join(os.tmpdir(), "reelier-reconcile-"));
  const tarballPath = path.join(dir, "reelier-0.32.1.tgz");
  const outputPath = path.join(dir, "github-output.txt");
  writeFileSync(tarballPath, tarballBytes);
  writeFileSync(outputPath, "");
  const server = createServer((_request, response) => { response.statusCode = respond.status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(respond.body ?? {})); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  try { run(`http://127.0.0.1:${port}`, tarballPath, outputPath); }
  finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
}

function invoke(origin: string, tarballPath: string, outputPath: string, extra: string[] = []) {
  return spawnSync(process.execPath, [scriptPath, "--package", "reelier", "--version", "0.32.1", "--tarball", tarballPath, "--registry", origin, ...extra], { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: outputPath } });
}

test("absent version reconciles to state=absent (exit 0)", async () => {
  await withRegistry(() => ({ status: 404, body: {} }), { status: 404, body: {} }, (origin, tarball, output) => {
    const result = invoke(origin, tarball, output);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(output, "utf8"), /state=absent/);
  });
});

test("matching published integrity reconciles to state=reconciled (exit 0)", async () => {
  await withRegistry(() => ({ status: 200, body: {} }), { status: 200, body: { versions: { "0.32.1": { dist: { integrity } } } } }, (origin, tarball, output) => {
    const result = invoke(origin, tarball, output);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(output, "utf8"), /state=reconciled/);
  });
});

test("conflicting integrity is terminal (exit 1) and never resent", async () => {
  await withRegistry(() => ({ status: 200, body: {} }), { status: 200, body: { versions: { "0.32.1": { dist: { integrity: "sha512-QUFB" } } } } }, (origin, tarball, output) => {
    const result = invoke(origin, tarball, output);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /conflicts with the local tarball/);
  });
});

test("uncertain registry state is pending (exit 2), never resent", async () => {
  await withRegistry(() => ({ status: 500, body: {} }), { status: 500, body: {} }, (origin, tarball, output) => {
    const result = invoke(origin, tarball, output);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /uncertain — pending, never resent/);
  });
});

test("--expect reconciled fails when the destination stayed absent", async () => {
  await withRegistry(() => ({ status: 404, body: {} }), { status: 404, body: {} }, (origin, tarball, output) => {
    const result = invoke(origin, tarball, output, ["--expect", "reconciled"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /destination state is absent, expected reconciled/);
  });
});
```

- [ ] **Step 6: Run and confirm RED.** `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 "dist-test/test/reconcile-npm-destination.test.js"`. Expected FAIL: all 5 tests fail (missing script → spawn exits non-zero / `Cannot find module`).
- [ ] **Step 7: Write `scripts/reconcile-npm-destination.mjs`** (complete):

```js
#!/usr/bin/env node
// npm destination reconciliation — runs BEFORE any publish and before any retry.
//   version absent               -> "absent"     (exit 0; publish may proceed)
//   matching published integrity -> "reconciled" (exit 0; publish is skipped)
//   conflicting integrity        -> terminal (exit 1; never republish over a conflict)
//   registry state uncertain     -> pending  (exit 2; never resent; rerun re-checks first)
// Usage: node scripts/reconcile-npm-destination.mjs --package <name> --version <v>
//        --tarball <path> [--registry <origin>] [--expect reconciled|absent]
import { createHash } from "node:crypto";
import { readFileSync, appendFileSync } from "node:fs";
import process from "node:process";

function fail(code, message) { console.error(`npm destination reconciliation: ${message}`); process.exit(code); }

const args = {};
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index += 1) {
  const flag = argv[index], value = argv[++index];
  if (!["--package", "--version", "--tarball", "--registry", "--expect"].includes(flag) || typeof value !== "string") fail(1, `invalid argument ${flag}`);
  args[flag.slice(2)] = value;
}
if (!args.package || !args.version || !args.tarball) fail(1, "--package, --version, and --tarball are required");
if (args.expect && !["reconciled", "absent"].includes(args.expect)) fail(1, "--expect must be reconciled or absent");
const registry = args.registry ?? "https://registry.npmjs.org";

let bytes;
try { bytes = readFileSync(args.tarball); } catch { fail(1, `cannot read local tarball ${args.tarball}`); }
const localIntegrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
const localShasum = createHash("sha1").update(bytes).digest("hex");

let response;
try { response = await fetch(`${registry}/${args.package}`, { headers: { accept: "application/json" } }); }
catch { fail(2, "registry is unreachable; destination state is uncertain — pending, never resent"); }

let state;
if (response.status === 404) state = "absent";
else if (!response.ok) fail(2, `registry answered ${response.status}; destination state is uncertain — pending, never resent`);
else {
  let packument;
  try { packument = await response.json(); } catch { fail(2, "registry payload is unreadable; destination state is uncertain — pending, never resent"); }
  const version = packument && typeof packument === "object" && packument.versions && typeof packument.versions === "object" ? packument.versions[args.version] : undefined;
  if (!version) state = "absent";
  else {
    const integrity = typeof version.dist?.integrity === "string" ? version.dist.integrity : null;
    const shasum = typeof version.dist?.shasum === "string" ? version.dist.shasum : null;
    if (integrity === localIntegrity || (integrity === null && shasum === localShasum)) state = "reconciled";
    else if (integrity === null && shasum === null) fail(2, `published ${args.package}@${args.version} carries no integrity metadata; destination state is uncertain — pending, never resent`);
    else fail(1, `published ${args.package}@${args.version} integrity ${integrity ?? shasum} conflicts with the local tarball ${localIntegrity}; terminal — never republish over a conflicting destination`);
  }
}
if (args.expect && state !== args.expect) fail(args.expect === "reconciled" ? 2 : 1, `destination state is ${state}, expected ${args.expect}`);
console.log(`state=${state}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `state=${state}\n`);
console.log(`npm destination reconciliation: ${args.package}@${args.version} is ${state}`);
```

- [ ] **Step 8: Run and confirm GREEN** (same command as Step 6). Expected PASS: `pass 5, fail 0`.
- [ ] **Step 9: Commit.** `git add .github/workflows/npm-publish.yml scripts/reconcile-npm-destination.mjs test/release-workflows.test.ts test/reconcile-npm-destination.test.ts && git diff --cached --check && git commit -m "ci: add governed npm publish workflow with destination reconciliation"`.

### Task B4: Verifier + environment insertion into `mcp-publish.yml` and `docker-publish.yml`

**Files:** Modify: `.github/workflows/mcp-publish.yml` (job header at line 17; between the guard step ending line 29 and "Install mcp-publisher" at line 31), `.github/workflows/docker-publish.yml` (job header at line 26; after the guard step ending line 39). Test: `test/release-workflows.test.ts` (extend, created in B3).
**Interfaces:** Consumes: B2's verifier CLI; B3's test file. Produces: both tag publish jobs gated by `environment: production-release` and the offline verifier. These edits change the two files' byte digests — every `workflowCommitments` pin must be computed after the post-merge re-pin (spec §3 post-barrier), never from pre-B4 bytes. Verifier steps assume B1's **tag-message** outcome; the fallback substitution is the same one documented in B3's workflow comment.

- [ ] **Step 1: Write the failing shape tests** — append to `test/release-workflows.test.ts`:

```ts
test("mcp-publish.yml gates tag publishes behind the environment and verifier", () => {
  const workflow = read(".github/workflows/mcp-publish.yml");
  for (const required of ["environment: production-release", "node scripts/verify-release-authorization.mjs", "node-version: 24", "npm run build"]) assert.ok(workflow.includes(required), `mcp-publish.yml is missing: ${required}`);
  assert.ok(workflow.indexOf("check-release-ancestor.mjs") < workflow.indexOf("verify-release-authorization.mjs"), "verifier must run after the ancestor guard");
  assert.ok(workflow.indexOf("verify-release-authorization.mjs") < workflow.indexOf("Install mcp-publisher"), "verifier must run before mcp-publisher install");
});

test("docker-publish.yml gates only tag-triggered publishes", () => {
  const workflow = read(".github/workflows/docker-publish.yml");
  for (const required of ["environment: ${{ github.event_name != 'pull_request' && 'production-release' || '' }}", "node scripts/verify-release-authorization.mjs", "if: startsWith(github.ref, 'refs/tags/')"]) assert.ok(workflow.includes(required), `docker-publish.yml is missing: ${required}`);
  assert.ok(workflow.indexOf("check-release-ancestor.mjs") < workflow.indexOf("verify-release-authorization.mjs"), "verifier must run after the ancestor guard");
});
```

- [ ] **Step 2: Run and confirm RED.** `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 "dist-test/test/release-workflows.test.js"`. Expected FAIL: the two new tests fail on the first missing string.
- [ ] **Step 3: Edit `mcp-publish.yml`** — exact insertions (unified-diff form against the current file):

```diff
 jobs:
   publish:
     runs-on: ubuntu-latest
+    # Mission-#1 pre-publish human review gate (spec 2.1). The environment reference
+    # stays after the required reviewer is removed; it then gates nothing.
+    environment: production-release
     steps:
```

```diff
       - name: Release guard — tag must be an ancestor of main
         run: node scripts/check-release-ancestor.mjs
 
+      - uses: actions/setup-node@v4
+        with:
+          node-version: 24
+
+      - name: Install and build (release verifier prerequisite)
+        run: |
+          npm ci
+          npm run build
+
+      # Fails closed on workflow_dispatch from a branch: with no release tag there is
+      # no authorization carrier, and an unauthorized publish must refuse.
+      - name: Verify release authorization (offline, fail closed)
+        env:
+          REELIER_RELEASE_SIGNER_ID: ${{ vars.RELEASE_AUTHORIZATION_SIGNER_ID }}
+          REELIER_RELEASE_SIGNER_SPKI: ${{ vars.RELEASE_AUTHORIZATION_SIGNER_SPKI }}
+        run: node scripts/verify-release-authorization.mjs --from-tag "$GITHUB_REF_NAME" --check-head
+
       - name: Install mcp-publisher
```

- [ ] **Step 4: Edit `docker-publish.yml`** — exact insertions:

```diff
 jobs:
   docker:
     runs-on: ubuntu-latest
+    # Tag/release publishes queue on the mission-#1 environment reviewer; the PR
+    # validation path evaluates to '' and runs ungated.
+    environment: ${{ github.event_name != 'pull_request' && 'production-release' || '' }}
     steps:
```

```diff
       - name: Release guard — tag must be an ancestor of main
         if: startsWith(github.ref, 'refs/tags/')
         run: node scripts/check-release-ancestor.mjs
 
+      - uses: actions/setup-node@v4
+        if: startsWith(github.ref, 'refs/tags/')
+        with:
+          node-version: 24
+
+      - name: Install and build (release verifier prerequisite)
+        if: startsWith(github.ref, 'refs/tags/')
+        run: |
+          npm ci
+          npm run build
+
+      - name: Verify release authorization (offline, fail closed)
+        if: startsWith(github.ref, 'refs/tags/')
+        env:
+          REELIER_RELEASE_SIGNER_ID: ${{ vars.RELEASE_AUTHORIZATION_SIGNER_ID }}
+          REELIER_RELEASE_SIGNER_SPKI: ${{ vars.RELEASE_AUTHORIZATION_SIGNER_SPKI }}
+        run: node scripts/verify-release-authorization.mjs --from-tag "$GITHUB_REF_NAME" --check-head
+
       - uses: docker/setup-buildx-action@v3
```

- [ ] **Step 5: Run and confirm GREEN** (same command as Step 2). Expected PASS: `pass 3, fail 0` in `release-workflows.test.js`.
- [ ] **Step 6: Commit.** `git add .github/workflows/mcp-publish.yml .github/workflows/docker-publish.yml test/release-workflows.test.ts && git diff --cached --check && git commit -m "ci: gate MCP and Docker tag publishes behind the release verifier"`.

### Task B5: Live GitHub HTTPS provider `src/authority/host/github-release-https-provider.ts`

**Files:** Create: `src/authority/host/github-release-https-provider.ts`, `scripts/github-release-provider-live-smoke.mjs`. Modify: `src/authority/host/index.ts` (append one export line after line 74, the `./github-release-runner.js` export). Test: `test/authority/github-release-https-provider.test.ts`.
**Interfaces:** Consumes: `GitHubReleaseProviderV1` (all 14 method signatures, `src/authority/host/github-release-runner.ts:35-50`); the existing json-https driver `executeJsonHttpsRead(read: JsonHttpsRead, endpoint, secrets, options)` / `executeJsonHttpsEffect(effect: TransportEffect, endpoint, secrets, options)` / `JsonHttpsSecurityError` / types `JsonHttpsEndpoint`, `JsonHttpsRead`, `JsonHttpsSecretResolver` from `src/authority/drivers/json-https.js` (the driver itself injects `authorization: Bearer <secret>` from `endpoint.secretRef` — json-https.ts:187 — so the provider never touches the token; `SecretResolver` from `src/authority/host/secret-resolver.ts:30` satisfies `JsonHttpsSecretResolver` structurally); `TransportEffect` from `src/authority/types.ts:53`; fault DTO shape `GitHubReleaseProviderFaultV1` consumed by `normalizeProviderFault` (github-release-runner.ts:478 — thrown values must be PLAIN objects with exactly `{v, kind, reason}`). Produces: `parseGitHubReleaseHttpsProviderConfigV1(value: unknown): GitHubReleaseHttpsProviderConfigV1` (closed parser; Lane 1's `--release-runner-config` consumes it), `createGitHubReleaseHttpsProvider(config: GitHubReleaseHttpsProviderConfigV1, secrets: JsonHttpsSecretResolver): GitHubReleaseProviderV1`, test seam `__testSetGitHubReleaseHttpsTransport(transport: GitHubReleaseHttpsTransport | null): () => void` (the `__testSetAuthorityCellHostPlatform` restore-function precedent — required because the driver's `assertAllPublicAddresses` SSRF guard refuses loopback, so hermetic tests cannot use real sockets).

- [ ] **Step 1: Write the first failing test file** `test/authority/github-release-https-provider.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createGitHubReleaseHttpsProvider, parseGitHubReleaseHttpsProviderConfigV1, __testSetGitHubReleaseHttpsTransport, type GitHubReleaseHttpsTransport } from "../../src/authority/host/github-release-https-provider.js";

const config = { v: "reelier.github-release-https-provider-config/v1" as const, githubAccountIdentity: "seldonframe-release-cell", githubBaseUrl: "https://api.github.com", githubTokenRef: "env:REELIER_TEST_GITHUB_TOKEN", npmRegistryBaseUrl: "https://registry.npmjs.org", timeoutMs: 15_000 };
const secrets = { async resolve() { return "never-used-in-hermetic-tests"; } };
const json = (status: number, body: unknown) => ({ status, body: Buffer.from(JSON.stringify(body)) });

function fakeTransport(responses: { status: number; body: Buffer }[], calls: { kind: string; method: string; path: string; query: string; bodyBase64?: string; endpointId: string }[]): GitHubReleaseHttpsTransport {
  return {
    async read(read, endpoint) { calls.push({ kind: "read", method: "GET", path: read.path, query: read.query ?? "", endpointId: endpoint.endpointId }); return responses.shift()!; },
    async write(effect, endpoint) { calls.push({ kind: "write", method: effect.method, path: effect.path, query: effect.query, bodyBase64: effect.bodyBase64, endpointId: endpoint.endpointId }); return responses.shift()!; },
  };
}

test("config parser refuses non-https origins, inline credentials, and extra keys", () => {
  assert.throws(() => parseGitHubReleaseHttpsProviderConfigV1({ ...config, githubBaseUrl: "http://api.github.com" }), /https origin/);
  assert.throws(() => parseGitHubReleaseHttpsProviderConfigV1({ ...config, githubTokenRef: "ghp_rawtokenvalue" }), /secret reference/);
  assert.throws(() => parseGitHubReleaseHttpsProviderConfigV1({ ...config, extra: 1 }), /exact closed key set/);
  assert.equal(parseGitHubReleaseHttpsProviderConfigV1(config).githubBaseUrl, "https://api.github.com");
});

test("getRef maps 200 to the closed sha record and 404 to null", async () => {
  const calls: never[] = [] as never[];
  const restore = __testSetGitHubReleaseHttpsTransport(fakeTransport([json(200, { ref: "refs/heads/main", object: { sha: "a".repeat(40), type: "commit" } }), json(404, { message: "Not Found" })], calls as never));
  try {
    const provider = createGitHubReleaseHttpsProvider(config, secrets);
    assert.deepEqual(await provider.getRef({ repository: "seldonframe/reelier", ref: "heads/main" }), { sha: "a".repeat(40) });
    assert.equal(await provider.getRef({ repository: "seldonframe/reelier", ref: "tags/v0.32.1" }), null);
    assert.deepEqual((calls as { path: string; endpointId: string }[]).map(call => call.path), ["/repos/seldonframe/reelier/git/ref/heads/main", "/repos/seldonframe/reelier/git/ref/tags/v0.32.1"]);
    assert.ok((calls as { endpointId: string }[]).every(call => call.endpointId === "github.release.provider"));
  } finally { restore(); }
});

test("createBlob sends the closed transport effect and returns the created sha", async () => {
  const calls: { bodyBase64?: string; method: string; path: string }[] = [];
  const restore = __testSetGitHubReleaseHttpsTransport(fakeTransport([json(201, { sha: "b".repeat(40), url: "ignored" })], calls as never));
  try {
    const provider = createGitHubReleaseHttpsProvider(config, secrets);
    const contentBase64 = Buffer.from("hello").toString("base64");
    assert.deepEqual(await provider.createBlob({ repository: "seldonframe/reelier", contentBase64 }), { sha: "b".repeat(40) });
    assert.equal(calls[0]!.method, "POST");
    assert.equal(calls[0]!.path, "/repos/seldonframe/reelier/git/blobs");
    assert.deepEqual(JSON.parse(Buffer.from(calls[0]!.bodyBase64!, "base64").toString("utf8")), { content: contentBase64, encoding: "base64" });
  } finally { restore(); }
});

test("getPullRequest never reports a test-merge SHA on an unmerged pull request", async () => {
  const detail = { number: 7, node_id: "PR_x", head: { ref: "reelier/release/0.32.1", sha: "a".repeat(40) }, base: { ref: "main" }, draft: false, title: "Release v0.32.1", body: "Governed release v0.32.1", merged: false, merged_at: null, merge_commit_sha: "c".repeat(40) };
  const restore = __testSetGitHubReleaseHttpsTransport(fakeTransport([json(200, detail)], [] as never));
  try {
    const pr = await createGitHubReleaseHttpsProvider(config, secrets).getPullRequest({ repository: "seldonframe/reelier", number: 7 });
    assert.deepEqual(pr, { number: 7, head: "reelier/release/0.32.1", base: "main", draft: false, title: "Release v0.32.1", body: "Governed release v0.32.1", headSha: "a".repeat(40), merged: false, mergeCommitSha: null });
  } finally { restore(); }
});

test("getChecks joins check suites to workflow paths and digests the workflow bytes", async () => {
  const workflowBytes = Buffer.from("name: CI\n");
  const workflowDigest = `sha256:${createHash("sha256").update(workflowBytes).digest("hex")}`;
  const restore = __testSetGitHubReleaseHttpsTransport(fakeTransport([
    json(200, { check_runs: [{ id: 2, name: "full-tests", status: "completed", conclusion: "success", check_suite: { id: 11 } }, { id: 3, name: "external-scan", status: "completed", conclusion: "success", check_suite: { id: 99 } }] }),
    json(200, { workflow_runs: [{ check_suite_id: 11, path: ".github/workflows/ci.yml", head_sha: "a".repeat(40) }] }),
    json(200, { content: workflowBytes.toString("base64"), encoding: "base64" }),
  ], [] as never));
  try {
    const checks = await createGitHubReleaseHttpsProvider(config, secrets).getChecks({ repository: "seldonframe/reelier", sha: "a".repeat(40) });
    assert.deepEqual(checks, [
      { name: "external-scan", status: "success", workflowDigest: `sha256:${"0".repeat(64)}`, workflowPath: "(unjoined-check-suite)" },
      { name: "full-tests", status: "success", workflowDigest, workflowPath: ".github/workflows/ci.yml" },
    ]);
  } finally { restore(); }
});

test("faults are plain closed DTOs: 422 is definitive-refusal, transport throw is transport-uncertain", async () => {
  const restore = __testSetGitHubReleaseHttpsTransport({
    async read() { throw new Error("socket hang up"); },
    async write() { return json(422, { message: "Validation Failed" }); },
  });
  try {
    const provider = createGitHubReleaseHttpsProvider(config, secrets);
    await provider.createRef({ repository: "seldonframe/reelier", ref: "tags/v0.32.1", sha: "a".repeat(40), force: false }).then(() => assert.fail("expected refusal"), fault => assert.deepEqual(fault, { v: "reelier.github-release-provider-fault/v1", kind: "definitive-refusal", reason: "ref creation refused with HTTP 422" }));
    await provider.getRef({ repository: "seldonframe/reelier", ref: "heads/main" }).then(() => assert.fail("expected fault"), fault => assert.deepEqual(fault, { v: "reelier.github-release-provider-fault/v1", kind: "transport-uncertain", reason: "socket hang up" }));
  } finally { restore(); }
});

test("npmVersionExists reads the registry endpoint and maps absence, presence, and uncertainty", async () => {
  const calls: { endpointId: string; path: string }[] = [];
  const restore = __testSetGitHubReleaseHttpsTransport(fakeTransport([json(404, {}), json(200, { versions: { "0.32.1": { dist: {} } } }), json(500, {})], calls as never));
  try {
    const provider = createGitHubReleaseHttpsProvider(config, secrets);
    assert.equal(await provider.npmVersionExists({ packageName: "reelier", version: "0.32.1" }), false);
    assert.equal(await provider.npmVersionExists({ packageName: "reelier", version: "0.32.1" }), true);
    await provider.npmVersionExists({ packageName: "reelier", version: "0.32.1" }).then(() => assert.fail("expected fault"), fault => assert.equal((fault as { kind: string }).kind, "transport-uncertain"));
    assert.ok(calls.every(call => call.endpointId === "npm.registry.read" && call.path === "/reelier"));
  } finally { restore(); }
});

test("live smoke script default-skips without the env flag", () => {
  const result = spawnSync(process.execPath, [path.resolve("scripts/github-release-provider-live-smoke.mjs")], { encoding: "utf8", env: { ...process.env, REELIER_RELEASE_PROVIDER_LIVE_SMOKE: "" } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /skipped/);
});
```

- [ ] **Step 2: Run and confirm RED.** `npx tsc -p tsconfig.test.json` — Expected FAIL: `error TS2307: Cannot find module '../../src/authority/host/github-release-https-provider.js'`.
- [ ] **Step 3: Read the driver call surface once more before implementing** — `src/authority/drivers/json-https.ts` lines 51–66 (`executeJsonHttpsEffect`), 114–128 (`executeJsonHttpsRead`), 180–190 (`requestPinned` header injection, `FORBIDDEN` header set at line 17: caller headers must never include `authorization`/`cookie`/`host`). Expected observation: the read/write signatures and the Bearer injection match the Interfaces block above; if not, stop and re-derive before coding.
- [ ] **Step 4: Implement `src/authority/host/github-release-https-provider.ts`** (complete):

```ts
import { createHash } from "node:crypto";
import { executeJsonHttpsEffect, executeJsonHttpsRead, JsonHttpsSecurityError, type JsonHttpsEndpoint, type JsonHttpsRead, type JsonHttpsSecretResolver } from "../drivers/json-https.js";
import type { TransportEffect } from "../types.js";
import type { GitHubReleaseProviderV1 } from "./github-release-runner.js";

const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const REF = /^(heads|tags)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const PACKAGE_NAME = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const SECRET_REF = /^(env:|file:).+/;
const ZERO_DIGEST = `sha256:${"0".repeat(64)}`;
const DEFINITIVE_STATUSES = new Set([400, 401, 403, 404, 405, 409, 422]);

export interface GitHubReleaseHttpsProviderConfigV1 { readonly v: "reelier.github-release-https-provider-config/v1"; readonly githubAccountIdentity: string; readonly githubBaseUrl: string; readonly githubTokenRef: string; readonly npmRegistryBaseUrl: string; readonly timeoutMs: number }
export interface GitHubReleaseHttpsResponse { readonly status: number; readonly body: Buffer }
export interface GitHubReleaseHttpsTransport { read(read: JsonHttpsRead, endpoint: JsonHttpsEndpoint): Promise<GitHubReleaseHttpsResponse>; write(effect: TransportEffect, endpoint: JsonHttpsEndpoint): Promise<GitHubReleaseHttpsResponse> }

let transportOverride: GitHubReleaseHttpsTransport | null = null;
/** @internal Test seam (the __testSetAuthorityCellHostPlatform precedent): the driver's
 * public-address guard refuses loopback, so hermetic suites swap the transport whole. */
export function __testSetGitHubReleaseHttpsTransport(transport: GitHubReleaseHttpsTransport | null): () => void { const prior = transportOverride; transportOverride = transport; return () => { transportOverride = prior; }; }

export function parseGitHubReleaseHttpsProviderConfigV1(value: unknown): GitHubReleaseHttpsProviderConfigV1 {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("GitHub release HTTPS provider config is not a plain object");
  if (Object.keys(value).sort().join(",") !== "githubAccountIdentity,githubBaseUrl,githubTokenRef,npmRegistryBaseUrl,timeoutMs,v") throw new TypeError("GitHub release HTTPS provider config is not the exact closed key set");
  const item = value as Record<string, unknown>;
  if (item.v !== "reelier.github-release-https-provider-config/v1") throw new TypeError("GitHub release HTTPS provider config version is invalid");
  requireHttpsOrigin(item.githubBaseUrl, "githubBaseUrl");
  requireHttpsOrigin(item.npmRegistryBaseUrl, "npmRegistryBaseUrl");
  if (typeof item.githubTokenRef !== "string" || !SECRET_REF.test(item.githubTokenRef)) throw new TypeError("githubTokenRef must be an env: or file: secret reference — never a credential value");
  if (typeof item.githubAccountIdentity !== "string" || item.githubAccountIdentity.length === 0 || item.githubAccountIdentity.length > 128) throw new TypeError("githubAccountIdentity is invalid");
  if (typeof item.timeoutMs !== "number" || !Number.isSafeInteger(item.timeoutMs) || item.timeoutMs < 1_000 || item.timeoutMs > 120_000) throw new TypeError("timeoutMs must be an integer between 1000 and 120000");
  return Object.freeze({ v: item.v, githubAccountIdentity: item.githubAccountIdentity, githubBaseUrl: item.githubBaseUrl as string, githubTokenRef: item.githubTokenRef, npmRegistryBaseUrl: item.npmRegistryBaseUrl as string, timeoutMs: item.timeoutMs });
}

function requireHttpsOrigin(value: unknown, label: string): void {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  let url: URL; try { url = new URL(value); } catch { throw new TypeError(`${label} is not a valid URL`); }
  if (url.protocol !== "https:" || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash || url.username || url.password) throw new TypeError(`${label} must be an https origin with no path, query, or credentials`);
}

function fault(kind: "transport-uncertain" | "definitive-refusal", reason: string): never { throw { v: "reelier.github-release-provider-fault/v1", kind, reason: reason.slice(0, 512) }; }
function requireRepository(value: unknown): string { if (typeof value !== "string" || !REPOSITORY.test(value) || value.length > 200) fault("definitive-refusal", "repository identity is invalid"); return value; }
function requireGitSha(value: unknown, label: string): string { if (typeof value !== "string" || !GIT_SHA.test(value)) fault("definitive-refusal", `${label} is not a 40-hex Git SHA`); return value; }
function requireRef(value: unknown): string { if (typeof value !== "string" || !REF.test(value) || value.length > 200) fault("definitive-refusal", "ref name is invalid"); return value; }
function requireNumber(value: unknown, label: string): number { if (!Number.isSafeInteger(value) || (value as number) <= 0) fault("definitive-refusal", `${label} is invalid`); return value as number; }
function asRecord(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) fault("transport-uncertain", `${label} payload is not an object`); return value as Record<string, unknown>; }
function readGitSha(value: unknown, label: string): string { if (typeof value !== "string" || !GIT_SHA.test(value)) fault("transport-uncertain", `${label} is not a 40-hex Git SHA`); return value; }

export function createGitHubReleaseHttpsProvider(config: GitHubReleaseHttpsProviderConfigV1, secrets: JsonHttpsSecretResolver): GitHubReleaseProviderV1 {
  const parsed = parseGitHubReleaseHttpsProviderConfigV1(config);
  if (!secrets || typeof secrets.resolve !== "function") throw new TypeError("GitHub release HTTPS provider requires a secret resolver");
  const github: JsonHttpsEndpoint = Object.freeze({ endpointId: "github.release.provider", baseUrl: parsed.githubBaseUrl, allowedMethods: ["GET", "POST", "PUT", "PATCH"] as const, allowedPathPrefixes: ["/repos/", "/graphql"], secretRef: parsed.githubTokenRef, accountIdentity: parsed.githubAccountIdentity });
  const npmRegistry: JsonHttpsEndpoint = Object.freeze({ endpointId: "npm.registry.read", baseUrl: parsed.npmRegistryBaseUrl, allowedMethods: ["GET"] as const, allowedPathPrefixes: ["/"], accountIdentity: "npm-registry-anonymous" });
  const githubHeaders = Object.freeze({ accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" });
  const realTransport: GitHubReleaseHttpsTransport = {
    async read(read, endpoint) { const response = await executeJsonHttpsRead(read, endpoint, secrets, { timeoutMs: parsed.timeoutMs }); return { status: response.status, body: response.body }; },
    async write(effect, endpoint) { const response = await executeJsonHttpsEffect(effect, endpoint, secrets, { timeoutMs: parsed.timeoutMs }); return { status: response.status, body: response.body }; },
  };
  const transport = () => transportOverride ?? realTransport;

  const decode = (response: GitHubReleaseHttpsResponse, label: string): { status: number; body: unknown } => {
    if (response.body.length === 0) return { status: response.status, body: null };
    try { return { status: response.status, body: JSON.parse(response.body.toString("utf8")) }; }
    catch { fault("transport-uncertain", `${label} answered with unreadable JSON (HTTP ${response.status})`); }
  };
  const get = async (endpoint: JsonHttpsEndpoint, pathName: string, query = ""): Promise<{ status: number; body: unknown }> => {
    let response: GitHubReleaseHttpsResponse;
    try { response = await transport().read({ endpointId: endpoint.endpointId, method: "GET", path: pathName, query, headers: endpoint.endpointId === github.endpointId ? githubHeaders : { accept: "application/json" } }, endpoint); }
    catch (error) { if (error instanceof JsonHttpsSecurityError) fault("definitive-refusal", `HTTPS read refused: ${error.message}`); fault("transport-uncertain", error instanceof Error ? error.message : "HTTPS read transport failure"); }
    return decode(response, `GET ${pathName}`);
  };
  const send = async (method: "POST" | "PUT" | "PATCH", pathName: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> => {
    const effect: TransportEffect = { v: "reelier.transport-effect/v1", endpointId: github.endpointId, method, path: pathName, query: "", headers: { ...githubHeaders }, bodyBase64: Buffer.from(JSON.stringify(body)).toString("base64"), riskClass: "github_release", idempotency: "reconcile-only", preconditions: [], reconciliation: { recipeId: "github_release_authoritative_readback_v1" } };
    let response: GitHubReleaseHttpsResponse;
    try { response = await transport().write(effect, github); }
    catch (error) { if (error instanceof JsonHttpsSecurityError) fault("definitive-refusal", `HTTPS write refused: ${error.message}`); fault("transport-uncertain", error instanceof Error ? error.message : "HTTPS write transport failure"); }
    return decode(response, `${method} ${pathName}`);
  };
  const requireStatus = (result: { status: number; body: unknown }, expected: readonly number[], label: string): unknown => {
    if (expected.includes(result.status)) return result.body;
    if (DEFINITIVE_STATUSES.has(result.status)) fault("definitive-refusal", `${label} refused with HTTP ${result.status}`);
    fault("transport-uncertain", `${label} answered HTTP ${result.status}`);
  };
  const mapPullRequest = (raw: unknown): Readonly<{ number: number; head: string; base: string; draft: boolean; title: string; body: string; headSha: string; merged: boolean; mergeCommitSha: string | null }> => {
    const item = asRecord(raw, "pull request");
    const head = asRecord(item.head, "pull request head"), base = asRecord(item.base, "pull request base");
    const merged = item.merged === true || (typeof item.merged_at === "string" && item.merged_at.length > 0);
    const mergeCommitSha = merged && typeof item.merge_commit_sha === "string" && GIT_SHA.test(item.merge_commit_sha) ? item.merge_commit_sha : null;
    if (!Number.isSafeInteger(item.number) || Number(item.number) <= 0 || typeof head.ref !== "string" || typeof base.ref !== "string") fault("transport-uncertain", "pull request payload is malformed");
    return Object.freeze({ number: Number(item.number), head: head.ref, base: base.ref, draft: item.draft === true, title: typeof item.title === "string" ? item.title : "", body: typeof item.body === "string" ? item.body : "", headSha: readGitSha(head.sha, "pull request head SHA"), merged, mergeCommitSha });
  };
  const readWorkflowFileDigest = async (repository: string, workflowPath: string, sha: string): Promise<string> => {
    const contents = asRecord(requireStatus(await get(github, `/repos/${repository}/contents/${workflowPath}`, `ref=${sha}`), [200], "workflow file read"), "workflow file");
    if (typeof contents.content !== "string") fault("transport-uncertain", "workflow file content is absent");
    return `sha256:${createHash("sha256").update(Buffer.from(contents.content, "base64")).digest("hex")}`;
  };

  return Object.freeze({
    async createBlob({ repository, contentBase64 }) {
      requireRepository(repository);
      if (typeof contentBase64 !== "string" || Buffer.from(contentBase64, "base64").toString("base64") !== contentBase64) fault("definitive-refusal", "blob content is not canonical base64");
      const body = asRecord(requireStatus(await send("POST", `/repos/${repository}/git/blobs`, { content: contentBase64, encoding: "base64" }), [200, 201], "blob creation"), "blob");
      return Object.freeze({ sha: readGitSha(body.sha, "created blob SHA") });
    },
    async createTree({ repository, baseTreeSha, files }) {
      requireRepository(repository); requireGitSha(baseTreeSha, "base tree SHA");
      if (!Array.isArray(files) || files.length === 0 || files.length > 64) fault("definitive-refusal", "tree file list is invalid");
      const tree = files.map(file => ({ path: String(file.path), mode: String(file.mode), type: "blob", sha: requireGitSha(file.blobSha, "tree blob SHA") }));
      const body = asRecord(requireStatus(await send("POST", `/repos/${repository}/git/trees`, { base_tree: baseTreeSha, tree }), [200, 201], "tree creation"), "tree");
      return Object.freeze({ sha: readGitSha(body.sha, "created tree SHA") });
    },
    async createCommit(input) {
      const item = asRecord(input, "commit input");
      const repository = requireRepository(item.repository);
      const treeSha = requireGitSha(item.treeSha, "commit tree SHA"), parentSha = requireGitSha(item.parentSha, "commit parent SHA");
      if (typeof item.message !== "string" || item.message.length === 0) fault("definitive-refusal", "commit message is invalid");
      const identity = (value: unknown, label: string) => { const id = asRecord(value, label); if (typeof id.name !== "string" || typeof id.email !== "string" || typeof id.date !== "string") fault("definitive-refusal", `${label} is invalid`); return { name: id.name, email: id.email, date: id.date }; };
      const body = asRecord(requireStatus(await send("POST", `/repos/${repository}/git/commits`, { message: item.message, tree: treeSha, parents: [parentSha], author: identity(item.author, "commit author"), committer: identity(item.committer, "commit committer") }), [200, 201], "commit creation"), "commit");
      return Object.freeze({ sha: readGitSha(body.sha, "created commit SHA") });
    },
    async getRef({ repository, ref }) {
      requireRepository(repository); requireRef(ref);
      const result = await get(github, `/repos/${repository}/git/ref/${ref}`);
      if (result.status === 404) return null;
      const body = asRecord(requireStatus(result, [200], "ref read"), "ref");
      return Object.freeze({ sha: readGitSha(asRecord(body.object, "ref object").sha, "ref SHA") });
    },
    async createRef({ repository, ref, sha, force }) {
      requireRepository(repository); requireRef(ref); requireGitSha(sha, "ref target SHA");
      if (force !== false) fault("definitive-refusal", "force ref creation is never authorized");
      const body = asRecord(requireStatus(await send("POST", `/repos/${repository}/git/refs`, { ref: `refs/${ref}`, sha }), [200, 201], "ref creation"), "created ref");
      return Object.freeze({ sha: readGitSha(asRecord(body.object, "created ref object").sha, "created ref SHA") });
    },
    async getCommit({ repository, sha }) {
      requireRepository(repository); requireGitSha(sha, "commit SHA");
      const result = await get(github, `/repos/${repository}/git/commits/${sha}`);
      if (result.status === 404) return null;
      const commit = asRecord(requireStatus(result, [200], "commit read"), "commit");
      const parents = Array.isArray(commit.parents) ? commit.parents : [];
      if (parents.length !== 1) fault("definitive-refusal", `commit ${sha} has ${parents.length} parents; the release saga binds single-parent commits only`);
      return Object.freeze({ sha: readGitSha(commit.sha, "commit SHA"), parentSha: readGitSha(asRecord(parents[0], "commit parent").sha, "commit parent SHA"), treeSha: readGitSha(asRecord(commit.tree, "commit tree").sha, "commit tree SHA") });
    },
    async findPullRequests(input) {
      const item = asRecord(input, "pull request query");
      const repository = requireRepository(item.repository);
      if (typeof item.head !== "string" || typeof item.base !== "string") fault("definitive-refusal", "pull request query head/base is invalid");
      const owner = repository.split("/")[0]!;
      const body = requireStatus(await get(github, `/repos/${repository}/pulls`, `head=${owner}:${item.head}&base=${item.base}&state=all&per_page=10`), [200], "pull request listing");
      if (!Array.isArray(body)) fault("transport-uncertain", "pull request listing is not an array");
      return Object.freeze(body.map(mapPullRequest));
    },
    async createPullRequest(input) {
      const item = asRecord(input, "pull request creation");
      const repository = requireRepository(item.repository);
      if (typeof item.title !== "string" || typeof item.body !== "string" || typeof item.head !== "string" || typeof item.base !== "string" || item.draft !== true) fault("definitive-refusal", "pull request creation input is invalid");
      return mapPullRequest(requireStatus(await send("POST", `/repos/${repository}/pulls`, { title: item.title, body: item.body, head: item.head, base: item.base, draft: true }), [200, 201], "pull request creation"));
    },
    async markPullRequestReady({ repository, number }) {
      requireRepository(repository); requireNumber(number, "pull request number");
      const detail = asRecord(requireStatus(await get(github, `/repos/${repository}/pulls/${number}`), [200], "pull request read"), "pull request");
      if (typeof detail.node_id !== "string" || detail.node_id.length === 0) fault("transport-uncertain", "pull request node id is absent");
      // Ready-for-review has no REST mutation; the GraphQL mutation is the provider-documented path.
      const result = asRecord(requireStatus(await send("POST", "/graphql", { query: "mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{number}}}", variables: { id: detail.node_id } }), [200], "ready-for-review mutation"), "GraphQL response");
      if (Array.isArray(result.errors) && result.errors.length > 0) fault("definitive-refusal", `ready-for-review mutation refused: ${String(asRecord(result.errors[0], "GraphQL error").message ?? "unknown")}`);
      return mapPullRequest(requireStatus(await get(github, `/repos/${repository}/pulls/${number}`), [200], "pull request readback"));
    },
    async getPullRequest({ repository, number }) {
      requireRepository(repository); requireNumber(number, "pull request number");
      return mapPullRequest(requireStatus(await get(github, `/repos/${repository}/pulls/${number}`), [200], "pull request read"));
    },
    async getChecks({ repository, sha }) {
      requireRepository(repository); requireGitSha(sha, "checks commit SHA");
      const checkPayload = asRecord(requireStatus(await get(github, `/repos/${repository}/commits/${sha}/check-runs`, "per_page=100"), [200], "check-run listing"), "check-run listing");
      const runsPayload = asRecord(requireStatus(await get(github, `/repos/${repository}/actions/runs`, `head_sha=${sha}&per_page=100`), [200], "workflow-run listing"), "workflow-run listing");
      const pathBySuite = new Map<number, string>();
      for (const raw of Array.isArray(runsPayload.workflow_runs) ? runsPayload.workflow_runs : []) { const run = asRecord(raw, "workflow run"); if (Number.isSafeInteger(run.check_suite_id) && typeof run.path === "string" && run.path.startsWith(".github/")) pathBySuite.set(Number(run.check_suite_id), run.path); }
      const digestByPath = new Map<string, string>();
      const entries: { id: number; name: string; status: string; workflowDigest: string; workflowPath: string }[] = [];
      for (const raw of Array.isArray(checkPayload.check_runs) ? checkPayload.check_runs : []) {
        const run = asRecord(raw, "check run");
        const suiteId = Number(asRecord(run.check_suite ?? {}, "check suite").id);
        const workflowPath = pathBySuite.get(suiteId) ?? "(unjoined-check-suite)";
        let workflowDigest = ZERO_DIGEST;
        if (workflowPath.startsWith(".github/")) {
          if (!digestByPath.has(workflowPath)) digestByPath.set(workflowPath, await readWorkflowFileDigest(repository, workflowPath, sha));
          workflowDigest = digestByPath.get(workflowPath)!;
        }
        entries.push({ id: Number(run.id ?? 0), name: String(run.name ?? ""), status: run.status === "completed" && run.conclusion === "success" ? "success" : String(run.conclusion ?? run.status ?? "unknown"), workflowDigest, workflowPath });
      }
      const latestByName = new Map<string, (typeof entries)[number]>();
      for (const entry of entries) { const prior = latestByName.get(entry.name); if (!prior || entry.id > prior.id) latestByName.set(entry.name, entry); }
      return Object.freeze([...latestByName.values()].sort((left, right) => left.name < right.name ? -1 : 1).map(({ name, status, workflowDigest, workflowPath }) => Object.freeze({ name, status, workflowDigest, workflowPath })));
    },
    async mergePullRequest(input) {
      const item = asRecord(input, "merge input");
      const repository = requireRepository(item.repository);
      requireNumber(item.number, "pull request number"); requireGitSha(item.expectedHeadSha, "expected head SHA");
      if (item.method !== "squash" || typeof item.commitTitle !== "string" || typeof item.commitMessage !== "string") fault("definitive-refusal", "merge input is invalid");
      const body = asRecord(requireStatus(await send("PUT", `/repos/${repository}/pulls/${item.number}/merge`, { sha: item.expectedHeadSha, merge_method: "squash", commit_title: item.commitTitle, commit_message: item.commitMessage }), [200], "squash merge"), "merge result");
      return Object.freeze({ merged: body.merged === true, sha: readGitSha(body.sha, "merge commit SHA") });
    },
    async npmVersionExists({ packageName, version }) {
      if (typeof packageName !== "string" || !PACKAGE_NAME.test(packageName)) fault("definitive-refusal", "npm package name is invalid");
      if (typeof version !== "string" || version.length === 0 || version.length > 64) fault("definitive-refusal", "npm version is invalid");
      const result = await get(npmRegistry, `/${packageName}`);
      if (result.status === 404) return false;
      const body = asRecord(requireStatus(result, [200], "npm packument read"), "npm packument");
      return !!body.versions && typeof body.versions === "object" && Object.prototype.hasOwnProperty.call(body.versions, version);
    },
    async readPackageManifest({ repository, sha }) {
      requireRepository(repository); requireGitSha(sha, "manifest commit SHA");
      const contents = asRecord(requireStatus(await get(github, `/repos/${repository}/contents/package.json`, `ref=${sha}`), [200], "package manifest read"), "package manifest file");
      if (typeof contents.content !== "string") fault("transport-uncertain", "package manifest content is absent");
      let manifest: unknown; try { manifest = JSON.parse(Buffer.from(contents.content, "base64").toString("utf8")); } catch { fault("transport-uncertain", "package manifest is not valid JSON"); }
      const item = asRecord(manifest, "package manifest");
      if (typeof item.name !== "string" || typeof item.version !== "string") fault("transport-uncertain", "package manifest name or version is absent");
      return Object.freeze({ name: item.name, version: item.version });
    },
  } satisfies GitHubReleaseProviderV1);
}
```

- [ ] **Step 5: Export from the host barrel.** In `src/authority/host/index.ts`, insert directly after the line-74 `./github-release-runner.js` export: `export { createGitHubReleaseHttpsProvider, parseGitHubReleaseHttpsProviderConfigV1, __testSetGitHubReleaseHttpsTransport, type GitHubReleaseHttpsProviderConfigV1, type GitHubReleaseHttpsTransport } from "./github-release-https-provider.js";` (host barrel only — the public `src/authority/index.ts` barrel deliberately excludes host runner symbols and stays untouched).
- [ ] **Step 6: Write the live-smoke script** `scripts/github-release-provider-live-smoke.mjs` (complete; READ-ONLY by construction — only read methods are referenced, satisfying the no-external-writes lane constraint; DEFAULT SKIP):

```js
#!/usr/bin/env node
// Live READ-ONLY smoke for the GitHub release HTTPS provider against the rehearsal
// repository. DEFAULT SKIP. Invokes only getRef/getCommit/readPackageManifest/
// npmVersionExists/getChecks — never a provider write.
// Gate:   REELIER_RELEASE_PROVIDER_LIVE_SMOKE=1
// Inputs: REELIER_SMOKE_REPOSITORY (owner/name of the disposable rehearsal repo)
//         REELIER_SMOKE_TOKEN_REF  (env:NAME or file:PATH secret reference)
// Build prerequisite: npm run build (imports dist/authority/host/index.js).
import { readFileSync } from "node:fs";
import process from "node:process";

if (process.env.REELIER_RELEASE_PROVIDER_LIVE_SMOKE !== "1") { console.log("github-release-provider live smoke: skipped (set REELIER_RELEASE_PROVIDER_LIVE_SMOKE=1 to run)"); process.exit(0); }

const repository = process.env.REELIER_SMOKE_REPOSITORY;
const tokenRef = process.env.REELIER_SMOKE_TOKEN_REF;
if (!repository || !tokenRef) { console.error("live smoke: REELIER_SMOKE_REPOSITORY and REELIER_SMOKE_TOKEN_REF are required"); process.exit(1); }

const { createGitHubReleaseHttpsProvider } = await import(new URL("../dist/authority/host/index.js", import.meta.url).href);
const secrets = { async resolve(reference) {
  if (reference.startsWith("env:")) { const value = process.env[reference.slice(4)]; if (!value) throw new Error("secret is unavailable"); return value; }
  if (reference.startsWith("file:")) { const value = readFileSync(reference.slice(5), "utf8").trim(); if (!value) throw new Error("secret is empty"); return value; }
  throw new TypeError("secret references must use env: or file:");
} };

const provider = createGitHubReleaseHttpsProvider({ v: "reelier.github-release-https-provider-config/v1", githubAccountIdentity: "rehearsal-smoke", githubBaseUrl: "https://api.github.com", githubTokenRef: tokenRef, npmRegistryBaseUrl: "https://registry.npmjs.org", timeoutMs: 30_000 }, secrets);

try {
  const main = await provider.getRef({ repository, ref: "heads/main" });
  if (!main) { console.error("live smoke: heads/main is absent on the rehearsal repository"); process.exit(1); }
  console.log(`getRef heads/main -> ${main.sha}`);
  const commit = await provider.getCommit({ repository, sha: main.sha });
  console.log(`getCommit -> tree ${commit?.treeSha ?? "(null)"}`);
  const manifest = await provider.readPackageManifest({ repository, sha: main.sha });
  console.log(`readPackageManifest -> ${manifest.name}@${manifest.version}`);
  console.log(`npmVersionExists reelier@0.0.0-never -> ${await provider.npmVersionExists({ packageName: "reelier", version: "0.0.0-never" })}`);
  const checks = await provider.getChecks({ repository, sha: main.sha });
  console.log(`getChecks -> ${checks.length} check(s): ${checks.map(check => `${check.name}=${check.status}`).join(", ") || "(none)"}`);
  console.log("github-release-provider live smoke: PASS (reads only; no write was dispatched)");
} catch (error) {
  console.error(`github-release-provider live smoke: FAIL — ${typeof error === "object" && error && "reason" in error ? `${error.kind}: ${error.reason}` : error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
```

- [ ] **Step 7: Run and confirm GREEN.** `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 "dist-test/test/authority/github-release-https-provider.test.js"`. Expected PASS: `tests 8, pass 8, fail 0` (including the smoke default-skip test).
- [ ] **Step 8: Focused regression** — the runner suite must be untouched by the new module: `node --test --test-concurrency=1 "dist-test/test/authority/github-release-runner.test.js"`. Expected PASS with the same test count as before this task.
- [ ] **Step 9: Commit.** `git add src/authority/host/github-release-https-provider.ts src/authority/host/index.ts scripts/github-release-provider-live-smoke.mjs test/authority/github-release-https-provider.test.ts && git diff --cached --check && git commit -m "feat(authority): add live GitHub release HTTPS provider"`.
- [ ] **Step 10 (barrier prerequisite, operational): live smoke against the rehearsal repo.** After the operator's admin checklist creates the disposable rehearsal repo and PAT (Lane 3), run `npm run build` then `REELIER_RELEASE_PROVIDER_LIVE_SMOKE=1 REELIER_SMOKE_REPOSITORY=<owner/rehearsal-repo> REELIER_SMOKE_TOKEN_REF=env:REHEARSAL_PAT REHEARSAL_PAT=<value-set-by-operator-in-their-shell> node scripts/github-release-provider-live-smoke.mjs`. Expected observable outcome: five read lines and `live smoke: PASS (reads only; no write was dispatched)`, exit 0. This is Lane 2's barrier criterion; a FAIL blocks the barrier, is recorded, and is never papered over.

# LANE C — Fly substrate + admin (spec §6)

Lane C owns `infra/fly/**`, the substrate-certification evidence procedure, and the human admin
checklist. It touches no `src/authority/host` file (Lane 1's territory) and no workflow file
(Lane 2's territory). Every step that mutates the operator's Fly account is marked
**OPERATOR-CONFIRM-FIRST**: the executor states the exact command and waits for the operator's
explicit go-ahead in chat before running it. Evidence produced on the operator machine lands in
`C:\Users\maxim\reelier-release-evidence\` (outside the repo); evidence produced in the Cell lands
on the volume under `/data/authority/evidence/`.

### Task C1: Fly Cell deployment serving the four release definitions

**Files:**
- Modify: `infra/fly/authority-cell/authority-cell.toml` (the `[processes]` line, currently line 7)
- Test: `test/authority/fly-authority-cell-manifest.test.ts` (new)
- Operator-held (never committed): `/data/authority/authority.yml`, `/data/authority/release-runner.config.json`, principal registry, Job Card trust pin — installed on the Fly volume only.

**Interfaces:**
- Consumes: Lane A (kernel) Task 4.3's closed serve flag `--release-runner-config <file>` on `authority serve` (`src/authority/cli.ts`, `authorityServe`, currently lines 278–312); `createGitHubReleaseRunner(input: Readonly<{ rootDir: string; journalSigner: Readonly<{ signerId: string; privateKey: KeyObject; publicKey: KeyObject }>; evidenceSigner: ReleaseContractSignerV1; authorizationResolver: (handle: string) => Promise<GitHubReleaseAuthorizationContextV1 | VerifiedReleaseAuthorizationV1>; provider: GitHubReleaseProviderV1; now: () => Date }>)` (`src/authority/host/github-release-runner.ts:66`); Lane B's live provider `src/authority/host/github-release-https-provider.ts`; `createGitHubReleaseAuthorityRuntime(config, runner, options)` (`src/authority/host/local.ts:101`), which requires `config.definitions` to equal exactly `githubReleaseAliases` = `["github_release_candidate_publish_v1","github_release_pr_ensure_v1","github_release_pr_merge_v1","github_release_tag_create_v1"]` (`src/packs/github-release/manifest.ts:3–7`) plus `deploymentPath` and `jobCardTrustPinPath` (`local.ts:107`).
- Produces: a running Cell app (name `reelier-authority-cell`, operator's Fly org, region `yyz`) with HTTPS ingress `https://reelier-authority-cell.fly.dev`; the manifest process line consumed by C2/C4/C5/D3/D4; the Fly secret names `REELIER_RELEASE_GITHUB_PAT`, `REELIER_AUTHORITY_BEARER` (names are the interface; values are operator-supplied and never enter any repo file, receipt, or agent context); the journal and evidence signer private keys installed as PEM files under `/data/authority/keys/` on the volume (Step 6), referenced by `release-runner.config.json`'s `journalKeyFile`/`evidenceKeyFile` absolute paths — **not** Fly secrets, because Lane A's closed parser (`src/authority/host/github-release-runner-config.ts`) reads those two fields with a direct `readFile` on an `absolutePath`-checked string, never through `SecretResolver`'s `env:`/`file:` reference syntax.

- [ ] **Step 1: RED — manifest test.** Write `test/authority/fly-authority-cell-manifest.test.ts`:
  ```ts
  import test from "node:test";
  import assert from "node:assert/strict";
  import { readFile } from "node:fs/promises";
  import path from "node:path";

  test("authority-cell manifest serves HTTP with the host-owned release runner config", async () => {
    const manifest = await readFile(path.resolve("infra/fly/authority-cell/authority-cell.toml"), "utf8");
    const processLine = manifest.split("\n").map(line => line.trim()).find(line => line.startsWith("app = "));
    assert.equal(
      processLine,
      'app = "authority serve --transport http --host 0.0.0.0 --port 8080 --path /data/authority/authority.yml --release-runner-config /data/authority/release-runner.config.json"',
    );
  });
  ```
  Run: `npx tsc -p tsconfig.test.json && node --test dist-test/test/authority/fly-authority-cell-manifest.test.js`
  Expected: **FAIL** — `AssertionError` because the current line 7 carries `--certification-config /data/authority/certification.local.json` and no `--release-runner-config`.
- [ ] **Step 2: GREEN — edit the manifest.** In `infra/fly/authority-cell/authority-cell.toml` replace line 7 with:
  ```toml
  app = "authority serve --transport http --host 0.0.0.0 --port 8080 --path /data/authority/authority.yml --release-runner-config /data/authority/release-runner.config.json"
  ```
  Re-run the Step-1 command. Expected: **PASS** (`1 passing`).
- [ ] **Step 3: Commit.** `git add infra/fly/authority-cell/authority-cell.toml test/authority/fly-authority-cell-manifest.test.ts && git commit -m "infra: point the Fly Cell entrypoint at the host-owned release runner config"`
- [ ] **Step 4 (OPERATOR-CONFIRM-FIRST): create app + volume.** From the worktree root:
  `flyctl apps create reelier-authority-cell --org personal`
  `flyctl volumes create reelier_authority_data --app reelier-authority-cell --region yyz --size 1 --yes`
  Expected: app listed by `flyctl apps list`; volume listed by `flyctl volumes list --app reelier-authority-cell` with `region yyz`.
- [ ] **Step 5 (OPERATOR-CONFIRM-FIRST): bootstrap deploy.** Per `infra/fly/authority-cell/README.md` (root build context so `../../../Dockerfile` resolves):
  `flyctl deploy . --config infra/fly/authority-cell/authority-cell-bootstrap.toml --app reelier-authority-cell --regions yyz`
  Expected: deploy succeeds; `flyctl logs --app reelier-authority-cell` shows `{"status":"ready","service":"authority-bootstrap","path":"/data/authority"}` (from `authorityBootstrap`, `src/authority/cli.ts`). Bootstrap exposes no HTTP and cannot dispatch.
- [ ] **Step 6 (OPERATOR-CONFIRM-FIRST): install reviewed configuration on the volume.** Operator prepares locally (values reviewed by hand, never committed): `authority.yml` with `tenant`, `topology`, `definitions` set to exactly the four `githubReleaseAliases` strings above, `ledgerDir`/`decisionDir`/`receiptDir`, `ingress.principalRegistryFile`, `deploymentPath`, and `jobCardTrustPinPath` resolving OUTSIDE the deployment directory (`local.ts:129–137` refuses otherwise); the signed jobs/trust/principal-registry files; the journal and evidence signer private keys as two PEM files (e.g. `journal-signer.pem`, `evidence-signer.pem`); and `release-runner.config.json` in the closed shape Lane A's parser defines (`src/authority/host/github-release-runner-config.ts`) — `journalKeyFile`/`evidenceKeyFile` are absolute paths pointing at the two PEM files just installed (the parser opens them directly with `readFile`; they are never `SecretResolver` references), while `provider.githubTokenRef` is the one genuine `SecretResolver` reference, `env:REELIER_RELEASE_GITHUB_PAT`, resolved at dispatch from the Step-7 secret (`local.ts:64` rule). Install with:
  `flyctl ssh sftp shell --app reelier-authority-cell` then `put` each file under `/data/authority/` (the two PEM files under `/data/authority/keys/`), trust pin under `/data/trust-pin/` (outside `/data/authority/deployment/`).
  Verify: `flyctl ssh console --app reelier-authority-cell -C "ls /data/authority"` lists `authority.yml release-runner.config.json ledger decisions receipts keys`; `ls /data/authority/keys` lists the two PEM filenames referenced by `release-runner.config.json`.
- [ ] **Step 7 (OPERATOR-CONFIRM-FIRST): set secrets (names only here; operator types values directly).**
  `flyctl secrets set --app reelier-authority-cell --stage REELIER_RELEASE_GITHUB_PAT=<operator-supplied> REELIER_AUTHORITY_BEARER=<operator-supplied>`
  The PAT is the fine-grained token scoped to `seldonframe/reelier`, contents + pull-requests write, ~14-day expiry (spec §6); it is resolved at dispatch through `provider.githubTokenRef: "env:REELIER_RELEASE_GITHUB_PAT"` (`src/authority/host/secret-resolver.ts`'s `env:` arm). `--stage` defers the restart to Step 8. **The journal and evidence signer keys are deliberately NOT Fly secrets here** — they were installed as files in Step 6, because Lane A's closed `release-runner.config.json` parser requires `journalKeyFile`/`evidenceKeyFile` to be absolute filesystem paths and reads them with a direct `readFile`, never through `SecretResolver`'s `env:`/`file:` syntax; a `REELIER_RELEASE_JOURNAL_SIGNER_PEM`/`REELIER_RELEASE_EVIDENCE_SIGNER_PEM` env var would be a dead trust knob nothing consumes, and the parser's `absolutePath()` guard refuses a non-path string outright rather than silently accepting one. Expected: `flyctl secrets list --app reelier-authority-cell` shows exactly these two names with digests, no values.
- [ ] **Step 8 (OPERATOR-CONFIRM-FIRST): production deploy.**
  `flyctl deploy . --config infra/fly/authority-cell/authority-cell.toml --app reelier-authority-cell --regions yyz`
  Expected: `flyctl logs --app reelier-authority-cell` shows `{"status":"ready","transport":"http","host":"0.0.0.0","port":8080}` (emitted by `authorityServeRuntimeDefaults.startHost`, `src/authority/cli.ts:333`). If Lane A's fail-closed startup refuses (four aliases without a constructible runner), the log shows the actionable refusal instead — that is a C1 failure to fix before proceeding.
- [ ] **Step 9: verification probe (read-only).** From the operator machine:
  1. Unauthenticated ingress check: `curl -sS -o /dev/null -w "%{http_code}\n" https://reelier-authority-cell.fly.dev/` — expected `401` (or the host's refusal status), proving auth is enforced; anything `200` without a bearer is a stop-the-line finding.
  2. In-Cell config doctor: `flyctl ssh console --app reelier-authority-cell -C "node /app/dist/cli.js doctor --path /data/authority/authority.yml"` — expected JSON `{"ok":true, ..., "checks":{"config":"verified","topology":"unchecked",...,"ingress":"verified","ledger":"configured","decisions":"configured","receipts":"configured",...,"live":"not-run"}}` (`authorityDoctor`, `src/authority/cli.ts:198–236`). `topology` MUST read `unchecked` here — a config value is an operator claim, not topology proof.
  3. Live probe: `node dist/cli.js authority connect --endpoint https://reelier-authority-cell.fly.dev --token-ref env:REELIER_AUTHORITY_BEARER --cell-id <cellId from the installed config> --adapter-contract-digest <digest recorded at config review>` then `node dist/cli.js authority doctor --live` — expected `{"ok":true,...,"checks":{"live":"verified"},...}` and exit 0 (`checkAuthorityCellLive`, `src/authority/client/http.ts:15`). Exit 1 or `live:"failed"` blocks C5/D3.
- [ ] **Step 10: record.** Append to `.superpowers/sdd/2026-08-18-eve-governed-production-release/progress.md`: `Lane C / C1: Cell deployed (app reelier-authority-cell, region yyz, image digest <from flyctl releases>, doctor live verified <timestamp>); secrets present by name only.` Then `git add .superpowers/sdd/2026-08-18-eve-governed-production-release/progress.md && git commit -m "sdd: record C1 Fly Cell deployment evidence"`

### Task C2: substrate certification — honest scope, explicit gaps

**Files:**
- Operator-held: `certification.local.json` (closed shape `parseCertificationOperatorConfig`, `src/authority/host/certification-config.ts:70` — root keys exactly `v, authorityConfigPath, evidenceDirectory, providers, fly, codex`; the `fly` object requires exactly `appName, authorityMachineId, agentAppName, agentMachineId, egressAppName, egressMachineId, orgSlug, region, apiCredentialRef, flyctlPath, flyctlVersion, egressProxyBaseUrl, egressProxyBearerRef, authorityImageDigest, agentImageDigest, gatewayImageDigest, networkPolicyDigest, schemaDigest` per `certification-config.ts:176`).
- Test: no new repo tests — this task runs existing checks and records evidence; the machine-restart case's assertions live in Lane 1's `test/authority/receipts.test.ts` RED cases and C4's corpus.

**Interfaces:**
- Consumes: C1's running Cell; `reelier authority certify preflight --config <file>` (`src/authority/cli.ts:455–495`); `reelier authority certify run --adapter fly-topology --config <file>` (`src/authority/cli.ts:529–565`, gated by `REELIER_LIVE_CERTIFY=1` and `assertLinuxAuthorityCellHost`); `createFlyRemoteTopologyOperations` (`src/authority/host/fly-remote-probe.ts`) and `runFlyCertification` (`src/authority/host/fly-certification.ts`) — the certification-branch Fly probe runner is already ported into this worktree, so "port" here means configure-and-execute, not re-implement; account binding via `probeGitHubAccountIdentity` (`src/authority/host/github-account-identity.ts:22` → `AuthenticatedProviderIdentityV1`); freshness via `assertFreshManagedTopologyEvidence` (`src/authority/host/topology.ts:142`, 5-minute `maxAgeMs` at the `local.ts:124` call site), `assertManagedTopologyEvidence` (`topology.ts:84`), `verifyAuthorityLease` (`src/authority/host/lease.ts:15`).
- Produces: four certification evidence records for D1's barrier checklist: (a) secret-canary scan transcript, (b) durable-ledger restart evidence, (c) account-binding/freshness evidence, (d) topology evidence — signed, or the explicit fallback record `egress: unchecked` with a named follow-up. Non-verified statuses are recorded as what they are; they never pass.

- [ ] **Step 1: secret-canary scan — structural markers (agent-runnable).** Pull Cell state and logs to the operator machine, then scan:
  ```bash
  mkdir -p ~/reelier-release-evidence/c2-canary && cd ~/reelier-release-evidence/c2-canary
  flyctl logs --app reelier-authority-cell --no-tail > fly-logs.txt
  flyctl ssh console --app reelier-authority-cell -C "sh -c 'grep -rIl -e github_pat_ -e ghp_ -e \"BEGIN PRIVATE KEY\" -e \"BEGIN OPENSSH\" /data/authority/receipts /data/authority/ledger /data/authority/evidence /data/authority/decisions 2>/dev/null; echo SCAN-DONE'" > cell-scan.txt
  grep -c -e github_pat_ -e ghp_ -e "BEGIN PRIVATE KEY" fly-logs.txt
  ```
  Expected: `cell-scan.txt` contains only `SCAN-DONE` (no file paths); the final `grep -c` prints `0`. Any hit is a Critical finding: stop, rotate the credential, record.
- [ ] **Step 2: secret-canary scan — value-level (OPERATOR-ONLY).** The operator (who alone holds the values) runs on their machine, without echoing values into shell history: `grep -rF "<last 12 chars of the PAT>" ~/reelier-release-evidence/ fly-logs.txt cell-scan.txt` and the same for each signer key's base64 tail. Expected: zero matches. Operator reports pass/fail in chat; the executor records only the verdict, never the substring.
- [ ] **Step 3: record canary evidence.** Write `~/reelier-release-evidence/c2-canary/verdict.json` `{"v":"c2-secret-canary/v1","structuralHits":0,"valueLevel":"operator-attested-clean","observedAt":"<ISO>"}` and append its sha256 to progress.md: `Lane C / C2: secret-canary scan clean (digest sha256:<hex>).` Commit: `git add .superpowers/sdd/2026-08-18-eve-governed-production-release/progress.md && git commit -m "sdd: record C2 secret-canary scan verdict"`
- [ ] **Step 4 (OPERATOR-CONFIRM-FIRST): durable-ledger restart case.** During a C4 rehearsal dispatch against the disposable repo (never production), immediately after the runner journals send-started (observed via `flyctl logs`), run:
  `flyctl machine restart <authorityMachineId> --app reelier-authority-cell`
  Expected reconciliation on restart: the serve process restarts; `GitHubReleaseRunnerV1.recover()` (`src/authority/host/github-release-runner.ts:55`) walks the journal and either reconciles the in-flight operation to its terminal state via provider readback or records explicit ambiguity — never a resend; a `dispatched` query whose reconstructed durable head is `reservation`-phase refuses (Lane 1 fix 4.1's loader-side check), it does not silently roll back. Capture `flyctl logs` around the restart into `~/reelier-release-evidence/c2-restart/` and record the classification (reconciled / ambiguity / refusal — all are acceptable outcomes; a duplicate provider effect or silent rollback is a Critical failure).
- [ ] **Step 5: account-binding + freshness evidence.** From the Cell: run the identity probe path (Lane B's live provider composes `probeGitHubAccountIdentity` over the PAT lease) and record the returned `AuthenticatedProviderIdentityV1` (account login/id — names, never tokens). Freshness: confirm by code-reference that managed topology evidence is enforced fresh at ≤5 minutes (`local.ts:124`) and leases verify against the topology digest (`lease.ts:15`); these run implicitly wherever `config.cloud` topology is claimed — for this Cell (`cloud` unset) record them as the named contract checks that WOULD gate a managed claim, and record this Cell's topology claim as `unchecked` until Step 6 lands. No self-signed upgrade of the claim.
- [ ] **Step 6 (OPERATOR-CONFIRM-FIRST, 3-day timebox from its first run): topology evidence via the Fly probe runner.** Prereqs: pinned `flyctl` version in config; the three reference network policies applied through Fly's Machines API per `infra/fly/authority-cell/README.md`. Fill `certification.local.json` completely (machine IDs from `flyctl machines list`, image digests from `flyctl releases --app ... --json`), then from a Linux host (the Cell itself, or WSL — `assertLinuxAuthorityCellHost` gates this path):
  `REELIER_LIVE_CERTIFY=1 node dist/cli.js authority certify run --adapter fly-topology --config certification.local.json`
  Expected on success: `{"status":"verified","adapter":"fly-topology","evidenceDigest":"sha256:...","output":".../topology-<hex>.json"}` and a signed evidence file (mode 0600) in `evidenceDirectory`.
  **Timebox fallback (explicit, spec §6/§10):** if this has not produced signed evidence within 3 days of first attempt, STOP the port. Record in progress.md: `Lane C / C2: topology probe not landed inside 3-day timebox; mission proceeds with egress recorded UNCHECKED in the receipt; follow-up: fly-topology certification of reelier-authority-cell.` The mission's receipt narrative carries `egress: unchecked` — stated, never silently claimed, and never rendered as a pass.
- [ ] **Step 7: commit certification record.** Append the four evidence verdicts (with digests and explicit statuses, including any `unchecked`) to progress.md and commit: `git add .superpowers/sdd/2026-08-18-eve-governed-production-release/progress.md && git commit -m "sdd: record C2 substrate certification evidence and explicit gaps"`

### Task C3: admin checklist (operator, ~hours, start immediately — no code)

**Files:** Operator console work only; the completed checklist is recorded in progress.md.
**Interfaces:**
- Consumes: Lane B's committed `.github/workflows/npm-publish.yml` path (already bound in `RELEASE_WORKFLOWS`, `src/authority/release-contracts.ts:14`); C1's PAT identity.
- Produces: the external prerequisites D3/D4 depend on: npm Trusted Publisher binding, `production-release` environment with required reviewer, branch/tag protection, rehearsal repo `seldonframe/reelier-release-rehearsal`, local Verdaccio registry `http://127.0.0.1:4873`, scratch GHCR package `ghcr.io/seldonframe/reelier-rehearsal`, and the MCP dry-run recording rule.

Every step is operator-executed in a browser/console; the executor's job is to present each item, wait for the operator's confirmation, and record the outcome. None of these are governed writes.

- [ ] **Step 1: npm Trusted Publisher.** On npmjs.com → package `reelier` → Settings → Trusted Publisher → GitHub Actions: organization `seldonframe`, repository `reelier`, workflow filename `npm-publish.yml`, environment `production-release`. Save. Verify the package settings page shows the publisher binding. (This makes `npm publish --provenance` work via OIDC with `permissions: id-token: write` — no npm token secret anywhere.)
- [ ] **Step 2: GitHub App install check.** GitHub → `seldonframe/reelier` → Settings → GitHub Apps: confirm the Reelier GitHub App is installed on the repository and note its installation id. Record installed/not-installed verbatim.
- [ ] **Step 3: branch protection contexts.** GitHub → `seldonframe/reelier` → Settings → Branches → rule for `main`: required status checks include exactly the two required CI contexts `test (ubuntu-latest)` and `test (windows-latest)` (these are the REQUIRED contexts per the comment block at the top of `.github/workflows/ci.yml`); require a pull request before merging; no force pushes.
- [ ] **Step 4: `v*` tag protection permitting the Cell PAT identity.** Settings → Rules → Rulesets → New tag ruleset: target `v*`; restrict creations/updates/deletions; bypass list = the operator account that owns the fine-grained PAT the Cell holds (a fine-grained PAT acts as its owning user). Verify by attempting `git push origin refs/tags/v0.0.0-protection-probe` from an identity NOT on the bypass list → expected rejection; delete nothing (the probe push must be refused, so there is nothing to clean up).
- [ ] **Step 5: `production-release` environment.** Settings → Environments → New environment `production-release` → Required reviewers: the operator (mission #1 gate, spec §2.1). All three publish workflows reference this environment (Lane B's edits), so each tag-triggered publish job queues for this single reviewer. Note for missions #2–3: the reviewer is removed after two clean missions; the environment reference stays and then gates nothing.
- [ ] **Step 6: disposable rehearsal repo.** `gh repo create seldonframe/reelier-release-rehearsal --private --description "Disposable governed-release rehearsal target; delete after mission #1"` — expected: repo exists, empty. Push the real `main` history up to the pinned base so the runner's base-drift equality check can hold in rehearsal: `git push https://github.com/seldonframe/reelier-release-rehearsal.git <RELEASE_BASE-current-value>:refs/heads/main`.
- [ ] **Step 7: Verdaccio dummy npm registry.** `docker run --rm -d --name reelier-verdaccio -p 4873:4873 verdaccio/verdaccio:6` then `curl -sS http://127.0.0.1:4873/-/ping` — expected `{}`. Rehearsal publishes point `--registry http://127.0.0.1:4873`; live-shaped, no public effect.
- [ ] **Step 8: scratch GHCR package.** Confirm push access for a scratch image name: `docker pull alpine:3 && docker tag alpine:3 ghcr.io/seldonframe/reelier-rehearsal:probe && docker push ghcr.io/seldonframe/reelier-rehearsal:probe` (authenticated as the operator) — expected: package `reelier-rehearsal` appears under the org's Packages, visibility private. This scratch package receives rehearsal images; the real `ghcr.io/seldonframe/reelier` is untouched until the mission.
- [ ] **Step 9: MCP dry-run recording rule (write it down verbatim).** The MCP Registry lane has no dummy registry; rehearsals run the `mcp-publish.yml` steps only up to (not including) `mcp-publisher login github-oidc`/`publish`, and every rehearsal record MUST state `mcp-registry: dry-run — not covered`. A rehearsal record that renders the MCP lane as covered/verified is invalid (never-list #1: `unchecked` never renders as a pass).
- [ ] **Step 10: record + commit.** Append to progress.md: `Lane C / C3: admin checklist complete — trusted publisher bound (reelier↔seldonframe/reelier/npm-publish.yml/production-release), GitHub App <installed|absent>, branch contexts [test (ubuntu-latest), test (windows-latest)], v* tag ruleset with PAT-identity bypass, production-release reviewer=<operator>, rehearsal repo created, Verdaccio up, GHCR scratch verified, MCP dry-run rule recorded.` Commit: `git add .superpowers/sdd/2026-08-18-eve-governed-production-release/progress.md && git commit -m "sdd: record C3 admin checklist completion"`

### Task C4: rehearsal fault-injection harness (executable corpus)

**Files:**
- Operator-held: `~/reelier-release-evidence/c4-faults/<case-id>/` per case (logs, journal snapshots, classification verdicts).
- Test: the three permanent breaker-class cases are already code — Lane 1's `test/authority/receipts.test.ts` additions (tampered evidence digest; lost terminal dirent) and Lane A 4.3's serve fail-closed tests (absent/lookalike runner). C4 re-executes them live against the Cell; it adds no new repo test files.

**Interfaces:**
- Consumes: C1 Cell, C3 rehearsal repo + dummy registries, Lane 1's `recover()` and loader-side refusal semantics, spec §9's classification rule.
- Produces: the fault corpus D3 must run inside each rehearsal; a per-case classification table where every case maps to exactly one expected classification — refusal, ambiguity, reconciliation, or explicit non-pass. Any case producing a duplicate provider effect, a silent rollback, or a rendered pass from `pending`/`absent`/`unchecked`/`ambiguous` fails the corpus.

Each case below is one checkbox: execute, capture evidence to its directory, record `{case, injected, observed, classification, evidenceDigest}`.

- [ ] **Case 1 — injected provider timeout.** During a rehearsal-repo dispatch, drop the Cell's egress mid-call (`flyctl machine stop <egress-or-network path>` is too blunt; instead configure Lane B's provider test seam or a firewalled proxy port for one call). Expected classification: **ambiguity** at the send boundary → durable ambiguous record, **no resend** (spec §5 destination-reconciliation rule); a later `recover()` resolves by readback to reconciled-success or terminal-failure. Evidence: journal entries showing exactly one send attempt.
- [ ] **Case 2 — duplicate invocation.** Invoke the same signed job twice with the same `requestId` through the ingress. Expected: **refusal** of the second invocation (request-ID conflict; the runner's identity map returns the original result or refuses the conflicting duplicate — one provider effect total). Evidence: two ingress records, one provider effect, `maxEffects: 1` intact.
- [ ] **Case 3 — machine restart mid-dispatch.** C2 Step 4 executed as part of a rehearsal run (shared evidence). Expected: **reconciliation** (or explicit ambiguity), never duplicate effect, never silent `reservation` rollback on a `dispatched` query.
- [ ] **Case 4 — tampered evidence digest (permanent breaker case).** On the volume: `flyctl ssh console -C "sh -c 'cp <terminal-node>.json /tmp/x && sed -i s/<first-8-of-evidenceDigest>/deadbeef/ <terminal-node>.json'"` then query the head. Expected: **refusal** — `loadDurableHead`/`loadDurableChain` throws the invalid/conflicting `TypeError` because the recomputed digest over `{v, receiptRef, identity, phase, terminalKind, providerResultDigest}` mismatches (Lane 1 fix 4.1). Restore the node from `/tmp/x` afterwards.
- [ ] **Case 5 — lost terminal dirent (permanent breaker case).** `flyctl ssh console -C "rm /data/authority/receipts/<durable-dir>/<terminal-node>.json"` mid-rehearsal, then issue a `dispatched`-state query. Expected: **refusal** (`dispatched`/`ambiguous` query with a `reservation`-phase reconstructed head refuses; the silent-rollback readback is closed). Recovery: the ambiguity is resolved by provider readback in `recover()`, recorded as reconciliation — never a pass.
- [ ] **Case 6 — absent/lookalike runner (permanent breaker case).** Deploy once with `release-runner.config.json` renamed away (`flyctl ssh console -C "mv /data/authority/release-runner.config.json /data/authority/release-runner.config.json.off"` + `flyctl machine restart <id>`). Expected: **startup refusal** with the actionable message (Lane A 4.3 fail-closed: four release aliases without a constructible runner refuse to start; all four endpoints must NOT come up refusing per-call). Restore the file, restart, confirm `status: ready`.
- [ ] **Record + commit.** Append the six-row classification table to progress.md (`Lane C / C4: fault corpus executed — 6/6 classified as expected (refusal x3, ambiguity x1, reconciliation x2), evidence digests listed`) and commit: `git add .superpowers/sdd/2026-08-18-eve-governed-production-release/progress.md && git commit -m "sdd: record C4 fault-injection corpus results"`

### Task C5: Eve 0.39 smoke against the Cell ingress (2-working-day timebox)

**Files:**
- Operator-held: smoke transcript + verdict in `~/reelier-release-evidence/c5-eve-smoke/`.
- Existing fixture consulted, not modified: `conformance/continuity-adapter/v1/eve-fixture/` (real Eve `0.39.0` pinned in its `package.json`; note its current tools drive a loopback Path C port via `agent/lib/runtime.ts` env wiring, not a remote ingress).

**Interfaces:**
- Consumes: C1 ingress URL + `REELIER_AUTHORITY_BEARER`; the host's `jobsSearch`/`jobLoad` runtime surface (`AuthorityHostRuntime`, exposed through `buildAuthorityMcpServer`, `src/authority/host/server.ts`); the four-definition Job Card installed in C1 Step 6.
- Produces: either (a) smoke-verified evidence that a real Eve 0.39 agent can `jobs.search` → `load` the four-definition Job Card through the Fly ingress — the precondition for the mission's Eve organization — or (b) the explicit fallback record consumed by D5: harness swap to Codex/Claude Code, Eve gap ships as a finding.

- [ ] **Step 1: start the timebox.** Record start timestamp in progress.md: `Lane C / C5: Eve smoke timebox opened <ISO>` (2 working days, spec §2.5/§10). Commit with message `"sdd: open C5 Eve smoke timebox"`.
- [ ] **Step 2: point a real Eve 0.39 session at the ingress.** In a scratch copy of the eve-fixture agent (outside the repo, `~/reelier-release-evidence/c5-eve-smoke/agent/`): configure Eve 0.39's MCP/tool transport to `https://reelier-authority-cell.fly.dev` with `Authorization: Bearer` from `REELIER_AUTHORITY_BEARER` and the principal attributes (`taskId`, `workloadId`, `principalId`) an installed principal-registry entry accepts (`agent/lib/binding.ts` shows the required authenticated-caller attributes). This wiring is the timeboxed unknown — the shipped fixture binds a loopback port, not remote HTTP.
- [ ] **Step 3: drive `jobs.search`.** Have the Eve agent issue a jobs search through the ingress. Expected: a result set of exactly four opaque `jobRef`s — one per signed definition (`github_release_candidate_publish_v1`, `github_release_pr_ensure_v1`, `github_release_pr_merge_v1`, `github_release_tag_create_v1`); refs are opaque, no provider identity or credential material in the payload.
- [ ] **Step 4: drive `load` on each ref.** Expected: each `jobLoad` resolves inside the authenticated task/principal/allocation and returns the signed Job Card projection; a ref replayed under a different principal or task refuses (spot-check one cross-principal refusal). No `invoke` is issued — smoke is read-only against production definitions.
- [ ] **Step 5: verdict.** Success: record `Lane C / C5: Eve 0.39 smoke verified — search returned 4 refs, 4 loads resolved, 1 cross-principal refusal observed (evidence digest sha256:<hex>)`, commit `"sdd: record C5 Eve smoke pass"`. **Timebox expiry without success:** record `Lane C / C5: Eve binding not achieved inside 2 working days — invoking spec §2.5 fallback: mission runs on Codex/Claude Code through the same harness-neutral contract; Eve gap ships as a finding.` Commit `"sdd: record C5 Eve fallback"` and hand D5 Step-2 the trigger. Either outcome satisfies C5; an unrecorded stall does not.

# LANE D — barrier + endgame (spec §3 post-barrier order, §7, §8, §10)

Lane D starts only when Lanes 1/2/3 report done. D1 is the sync barrier. External provider effects occur only in D3 (rehearsal targets: disposable repo + dummy registries) and D4 (the mission), each under its own gates.

### Task D1: barrier verification + infra PR to main

**Files:**
- Modify: `.worktrees/eve-governed-production-release/CLAUDE.md` (re-pin snapshot line to `0.32.1`-candidate state — "rides along" per spec §3)
- Operator-held: barrier checklist verdict in progress.md.

**Interfaces:**
- Consumes: spec §3 barrier criteria; `.github/workflows/ci.yml`'s `workflow_dispatch` trigger (present; note in the ci.yml comment block: a dispatched run gives a real pass/fail signal but does NOT satisfy branch protection — the PR merge still needs event-driven checks); Lane summaries C1–C5, Lane-1 scoped re-review verdict, Lane-2 live smoke verdict.
- Produces: `MERGE_HEAD` — the post-merge `origin/main` SHA every D2/D4 step keys off; the merged infra tree containing all three lanes' work.

- [ ] **Step 1: barrier criteria checklist (all four required, spec §3).** Verify and record each with its evidence pointer:
  1. Lane-1 scoped re-review passed (ledger entry per §4.4 — one fresh dispatch, one scoped re-review, no sixth in-task fix round).
  2. Lane-2 live-provider smoke against `seldonframe/reelier-release-rehearsal` passed.
  3. Lane-3: Cell deployed (C1), certification gaps explicitly recorded (C2 — including `egress: unchecked` if the timebox lapsed), admin checklist complete (C3).
  4. Integrated branch passes the full Ubuntu suite (Step 2).
  A missing item blocks the barrier; there is no partial pass.
- [ ] **Step 2: integrated full Ubuntu suite.** Push the branch, then dispatch the repo's own CI on it:
  `git push origin codex/eve-governed-production-release && gh workflow run ci.yml --ref codex/eve-governed-production-release && gh run watch $(gh run list --workflow ci.yml --branch codex/eve-governed-production-release --limit 1 --json databaseId -q '.[0].databaseId')`
  Expected: run concludes `success`, including `test (ubuntu-latest)` (Node 24, full `npm test`: `tsc -p tsconfig.test.json && node --test --test-concurrency=1 "dist-test/test/**/*.test.js"`) and `test (windows-latest)`. Fallback if Actions is unavailable: local containerized run modeled on the repo's prior Linux evidence pattern (`linux-verify-*/run.sh`): copy the tree without `node_modules/.git/dist/dist-test` into a Linux container, `npm ci --ignore-scripts`, `npm run build`, `timeout 25m npm test`, statuses captured to an out dir — see notes; the exact docker invocation is not committed anywhere and must be recorded verbatim when used.
- [ ] **Step 3: CLAUDE.md re-pin.** Update the worktree `CLAUDE.md` header block: release snapshot line to name the barrier-verified branch head and the `0.32.1` target state, and correct any §-claims the lanes changed (at minimum: the serve path now constructs the release runner; durable-head validation recomputes digests). `git add CLAUDE.md && git commit -m "docs: re-pin worktree CLAUDE.md at the barrier head"`
- [ ] **Step 4: open the infra PR (normal human-reviewed PR — NOT governed, never the candidate).**
  `gh pr create --base main --head codex/eve-governed-production-release --title "Release-authority infrastructure for governed 0.32.1 (prerequisite construction)" --body-file pr-body.md`
  `pr-body.md` must contain, in order: (1) the explicit scope sentence — "Prerequisite construction per the recorded SDD ruling; this PR is NOT the governed release candidate and its merge is authorized by ordinary human review, not by the mission bundle"; (2) the three breaker fixes with their falsifiers and RED-first evidence (receipts integrity, ID seam, serve injection); (3) Lane-2 surface list (`npm-publish.yml`, shared verifier, two workflow edits, live provider); (4) Lane-3 surface list (Cell manifest change, admin checklist outcome, certification evidence with explicit `unchecked` gaps named); (5) barrier evidence: CI run URL(s), focused-gate counts, fault-corpus table digest; (6) the statement "No external provider write occurred in any lane task; Fly deployment was operator-confirmed infrastructure"; (7) the CLAUDE.md re-pin note; (8) the post-merge plan pointer (D2 re-pin PR next).
- [ ] **Step 5: human review + merge (operator merges via the GitHub UI after checks).** Then capture:
  `git fetch origin && MERGE_HEAD=$(git rev-parse origin/main) && echo $MERGE_HEAD`
  Record in progress.md: `Lane D / D1: barrier passed; infra PR #<n> merged; MERGE_HEAD=<sha>.` Commit: `git add .superpowers/sdd/2026-08-18-eve-governed-production-release/progress.md && git commit -m "sdd: record D1 barrier pass and infra merge head"`

### Task D2: RELEASE_BASE re-pin follow-up PR

**Files:**
- Modify: `src/authority/release-contracts.ts` (line 9: `const RELEASE_BASE = "e600ad5c2dc5e1bde0714915e7a84980c8d5602b";`)
- Test: `test/authority/release-contracts.test.ts` (4 occurrences of the old literal), `test/authority/github-release-runner.test.ts` (17 occurrences)

**Interfaces:**
- Consumes: D1's `MERGE_HEAD`; the parsers that enforce the pin — `parseStagedCandidateManifestV1` (`release-contracts.ts:307`, `baseCommit !== RELEASE_BASE` refusal) and `parseReleaseOperationPlanV1` (`release-contracts.ts:330` and the `commit.parentSha !== RELEASE_BASE` check at `:346`).
- Produces: a main tree whose compiled contracts accept only `baseCommit === MERGE_HEAD` (subject to the self-reference caveat in notes); the recomputed digests of the four `RELEASE_WORKFLOWS` at the post-merge head, recorded for mission-input composition.

- [ ] **Step 1: branch off post-merge main.** `git fetch origin && git checkout -b codex/release-base-repin-0.32.1 origin/main && MERGE_HEAD=$(git rev-parse origin/main)`
- [ ] **Step 2: RED — re-point the test fixtures first.**
  `sed -i "s/e600ad5c2dc5e1bde0714915e7a84980c8d5602b/$MERGE_HEAD/g" test/authority/release-contracts.test.ts test/authority/github-release-runner.test.ts`
  `grep -rc "e600ad5c2dc5e1bde0714915e7a84980c8d5602b" test/ src/` — expected: only `src/authority/release-contracts.ts:1` remains.
  Run: `npx tsc -p tsconfig.test.json && node --test --test-concurrency=1 dist-test/test/authority/release-contracts.test.js dist-test/test/authority/github-release-runner.test.js`
  Expected: **FAIL** — fixtures now carry `$MERGE_HEAD` while the constant still says `e600ad5c…`, so every construction throws `TypeError: staged candidate manifest release identity or ref is invalid` (and the operation-plan equivalent).
- [ ] **Step 3: GREEN — re-pin the constant.** Edit `src/authority/release-contracts.ts:9` to `const RELEASE_BASE = "<value of $MERGE_HEAD>";` (write the literal, not the variable). Re-run the Step-2 test command. Expected: **PASS**, 0 failures.
- [ ] **Step 4: workflow digest recomputation.** Compute and record the four committed-workflow digests at the post-merge head:
  ```bash
  for f in .github/workflows/ci.yml .github/workflows/docker-publish.yml .github/workflows/mcp-publish.yml .github/workflows/npm-publish.yml; do
    printf "%s " "$f"; git show "$MERGE_HEAD:$f" | node -e "const c=require('crypto');const b=[];process.stdin.on('data',d=>b.push(d)).on('end',()=>console.log('sha256:'+c.createHash('sha256').update(Buffer.concat(b)).digest('hex')))"
  done
  ```
  These are the exact `workflowCommitments` values (path order fixed by `RELEASE_WORKFLOWS`, `release-contracts.ts:14`) the mission-input composition in D4 must bind. Verify npm-publish.yml specifically: `git diff $MERGE_HEAD origin/codex/eve-governed-production-release -- .github/workflows/npm-publish.yml` — expected empty output (the merge did not alter Lane B's file), so the digest recomputed here equals the digest Lane B's live smoke exercised.
- [ ] **Step 5: record digests in the ledger.** Append to progress.md: `Lane D / D2: RELEASE_BASE re-pinned to <MERGE_HEAD>; workflow digests at pin: ci.yml sha256:<...>, docker-publish.yml sha256:<...>, mcp-publish.yml sha256:<...>, npm-publish.yml sha256:<...>.`
- [ ] **Step 6: commit + PR.** `git add src/authority/release-contracts.ts test/authority/release-contracts.test.ts test/authority/github-release-runner.test.ts .superpowers/sdd/2026-08-18-eve-governed-production-release/progress.md && git commit -m "release: re-pin RELEASE_BASE and workflow digests to the post-infra-merge head"` then `gh pr create --base main --head codex/release-base-repin-0.32.1 --title "Re-pin RELEASE_BASE to post-infra-merge head" --body "Follow-up per the release design §3 post-barrier order. Changes only the base pin constant and its test fixtures. Human-reviewed, not governed."` Operator merges after checks. **Then redeploy the Cell from the re-pinned tree (OPERATOR-CONFIRM-FIRST):** `git checkout <re-pinned source> && flyctl deploy . --config infra/fly/authority-cell/authority-cell.toml --app reelier-authority-cell` — the runner enforces the compiled-in constant, so the deployed image must carry the new pin. See notes for the base-advance caveat this merge itself creates.

### Task D3: rehearsal ×2 — operational runbook

**Files:** Operator-held run records `~/reelier-release-evidence/d3-rehearsal-<n>/`; ledger lines in progress.md.
**Interfaces:**
- Consumes: C3 resources (rehearsal repo, Verdaccio, GHCR scratch, MCP dry-run rule), C4 corpus, D2's deployed Cell, Lane B's workflows.
- Produces: two consecutive clean full-path run records — prerequisite evidence only, never production-pass evidence (spec §7).

- [ ] **Step 1: counter rule (record before the first run).** Append to progress.md: `Lane D / D3: consecutive-clean counter initialized at 0; ANY failure in any rehearsal run resets it to 0 (spec §10); two consecutive clean runs required.` Commit `"sdd: initialize rehearsal counter"`.
- [ ] **Step 2: rehearsal run — full path (repeat until counter reaches 2).** One run = the complete mission shape against rehearsal targets: compose + sign rehearsal-scoped artifacts (rehearsal repo identity; rehearsal signer keys — never the mission keys); dispatch the four governed Outcomes through the Cell ingress (candidate branch → draft PR → ready → exact-SHA squash merge → non-force tag on `seldonframe/reelier-release-rehearsal`); tag workflows run with npm pointed at `--registry http://127.0.0.1:4873`, docker pushed to `ghcr.io/seldonframe/reelier-rehearsal`, MCP lane executed dry-run and **recorded as dry-run, not covered**; run the C4 fault corpus cases 1–6 across the two runs (each case at least once per the pair); offline receipt verification of the rehearsal receipts.
- [ ] **Step 3: what gets recorded per run (all seven, every run).** (1) run id + start/end timestamps; (2) the signed rehearsal artifact digests; (3) per-Outcome terminal states with journal head digests; (4) fault cases injected and their classifications; (5) destination reconciliation results (Verdaccio tarball digest, GHCR manifest digest, rehearsal-repo refs) — matching → reconciled, conflicting → terminal failure, uncertain → pending and **never resent**; (6) the MCP dry-run line verbatim; (7) verdict `clean` or `failed:<first-failure>`. A run with any `pending`/`absent`/`unchecked`/`ambiguous` item outside the fault corpus's expected classifications is `failed`.
- [ ] **Step 4: counter bookkeeping.** After each run append `Lane D / D3: rehearsal run <n> verdict <clean|failed:...>; counter=<value>.` and commit `"sdd: record rehearsal run <n>"`. On `failed`: counter := 0, fix through the normal lane owner, rerun. Proceed to D4 only at counter = 2.

### Task D4: mission #1 runbook

**Files:** Operator-held mission directory `~/reelier-release-evidence/d4-mission-1/` (parameters JSON, signed artifacts, evidence records, verification transcripts); ledger completion entries in progress.md.
**Interfaces:**
- Consumes: everything above; `verifyReleaseAuthorizationBundleV1` / `verifyReleaseReceiptGraphV1` / `createSigned*` / `parseCanonicalSigned*` from the `src/authority` barrel; the 15 receipt lanes (`RECEIPT_LANES`, `release-contracts.ts:17`) and 3 quality lanes (`QUALITY_LANES`, `:16`).
- Produces: `reelier@0.32.1` on npm, MCP Registry, and GHCR; the signed release receipt graph; SDD ledger completion for Tasks 6–8.

- [ ] **Step 1: pre-signing quality evidence, bound to the candidate head.** Freeze the three-file candidate (`src/cli.ts`, `test/cli-subcommand-help.test.ts`, `CHANGELOG.md` — `RELEASE_PATHS`, `release-contracts.ts:11`) and compute its `candidateCommit`. Then, at that head: full suite via `gh workflow run ci.yml --ref <candidate-ref>` (both OS legs green); coverage `npm run test:coverage` (status `non-regressed` vs baseline); mutation `npm run test:mutation` — Stryker, plan ~11.5 h wall-clock at the committed concurrency, result must be ≥ 9000 basis points (`release-contracts.ts:317` refuses below). Record the three evidence digests + `headCommit`. All of this completes BEFORE signing so the 12-hour window (`expirySeconds: 43200`, `:100`) covers only branch → PR → merge → review → tag → publish.
- [ ] **Step 2: signing ceremony (operator).** Generate three ed25519 keypairs with distinct SPKI digests — authorization signer, receipt-graph maker, evidence checker (`release-contracts.ts:277` refuses shared keys). Compose `StagedCandidateManifestV1` (incl. `packedTarballDigest` = sha256 over the exact clean `npm pack` bytes; D2's workflow digests as `workflowCommitments`), `ReleaseOperationPlanV1`, `ReleasePolicyV1`, `ReleaseAuthorizationBundleV1` (`issuedAt` = now, `expiresAt` = +12 h exactly) and sign via a reviewed operator script calling `createSignedStagedCandidateManifestV1` / `createSignedReleaseOperationPlanV1` / `createSignedReleasePolicyV1` / `createSignedReleaseAuthorizationBundleV1` from the built barrel. Sanity-verify locally: `verifyReleaseAuthorizationBundleV1({authorization, candidateManifest, operationPlan, policy}, verifier, new Date(), qualityEvidence)` returns without throwing. The three quality-evidence records are signed by the evidence-checker key with `observedAt` AFTER `issuedAt` (chronology check at `release-contracts.ts:507` — the CI/coverage/mutation runs happen before signing; their signed attestation records are minted after).
- [ ] **Step 3: agent-organization dispatch.** The Eve 0.39 organization (or the C5/D5 fallback harness) executes: root + eight roles; root decomposes, collects evidence, invokes signed jobs through the Cell ingress, never edits the candidate. Sequence of governed Outcomes: candidate branch → draft PR → ready → CI evidence → exact-SHA squash merge (reconciled) → tag `v0.32.1`. Every provider effect consumes exactly one of the four effect allocations.
- [ ] **Step 4: the production-release review moment.** All three publish workflows (`npm-publish.yml`, `mcp-publish.yml`, `docker-publish.yml`) trigger on the tag and queue on the `production-release` environment. The operator opens each queued run (GitHub → Actions → run → "Review deployments"), reviews once, and approves all three — this is the single pre-publish human review of mission #1. A rejection here leaves: tag on merged main, zero publications, an immutable failed-mission record — publication, not the tag, is the guarded irreversible exit.
- [ ] **Step 5: destination reconciliation (before any retry, per lane).**
  - npm: `npm pack reelier@0.32.1 && node -e "const c=require('crypto'),f=require('fs');console.log('sha256:'+c.createHash('sha256').update(f.readFileSync('reelier-0.32.1.tgz')).digest('hex'))"` — must equal the signed `packedTarballDigest`; `npm view reelier@0.32.1 version` → `0.32.1`; provenance: `npm audit signatures` in a scratch dir with `reelier@0.32.1` installed → `verified` attestations.
  - MCP Registry: `curl -sS "https://registry.modelcontextprotocol.io/v0/servers?search=io.github.seldonframe/reelier"` → version `0.32.1` present.
  - GHCR: `docker manifest inspect ghcr.io/seldonframe/reelier:v0.32.1` → digest recorded.
  - git: `git ls-remote origin refs/tags/v0.32.1` → the planned tag SHA; `git rev-parse origin/main` → `expectedCommitSha` from the operation plan.
  Matching published integrity → reconciled success; conflicting → terminal failure; uncertain → pending, never resent.
- [ ] **Step 6: fresh-install verification (Windows + Ubuntu).** On each fresh environment: `npm install -g reelier@0.32.1` then the complete help matrix —
  ```bash
  set -e; for c in run bench baseline cost prices mcp serve trace compile manifest approve push get verify diff ci policy init up discover connections connect deploy doctor bridge coverage from-session scan install uninstall login logout whoami; do reelier "$c" --help >/dev/null; reelier "$c" -h >/dev/null; done; reelier --help >/dev/null; echo HELP-MATRIX-PASS
  ```
  (PowerShell on Windows: same loop with `foreach ($c in @(...)) { reelier $c --help | Out-Null; if ($LASTEXITCODE -ne 0) { throw $c } }`.) The authoritative command list is the Task-1 test `test/cli-subcommand-help.test.ts` — if it and this list disagree, the test wins. Expected: `HELP-MATRIX-PASS`, every invocation exit 0, no network/subprocess side effects. Sign the two installed-check evidence records with `observedAt`/`freshUntil` such that graph `verifiedAt` falls inside them (`parseFreshLane`, `release-contracts.ts:480`).
- [ ] **Step 7: offline receipt-graph verification.** Compose `ReleaseReceiptGraphV1` (graph-maker key), gather the 15 signed receipt-lane evidence records (evidence-checker key), and run an operator-side offline script (kept in the mission directory, not the repo) calling `verifyReleaseReceiptGraphV1(graph, graphMakerVerifier, verifiedAuthorization, evidence, new Date())`. Expected: `evaluation.status === "verified"`, `success === true`, all 15 required lanes `verified`, `completeness === "unchecked"` (mandatory — `release-contracts.ts:415` refuses anything else). If C2's egress gap stands, the mission narrative records `egress: unchecked` alongside — stated, never a pass.
- [ ] **Step 8: post-release review + ledger completion.** Operator conducts the post-release review (signed `human-post-release-review` lane evidence). Then append to progress.md, matching the ledger's existing format:
  ```
  Task 6: complete (commits <first>..<last>, common verifier + three publish workflows live-smoked against the rehearsal repo; MCP lane dry-run only)
  Task 7: complete (commits <first>..<last>, Eve smoke <verified|fallback recorded>, rehearsal x2 clean, fault corpus 6/6 expected classifications)
  Task 8: complete (mission #1: authorization digest sha256:<...>, receipt graph verified offline 15/15 lanes, completeness unchecked, destinations reconciled npm+mcp+ghcr, fresh installs verified win32+ubuntu, one pre-publish review, one post-release review, zero routine approvals)
  ```
  Commit: `git add .superpowers/sdd/2026-08-18-eve-governed-production-release/progress.md && git commit -m "sdd: record Tasks 6-8 completion and mission #1 evidence"`. Any missing §8 criterion falsifies the mission even if artifacts shipped — record the falsification instead of the completion lines.

### Task D5: contingencies (pre-committed, each an executable conditional)

**Files:** Ledger lines in progress.md; contingency A additionally touches `src/authority/release-contracts.ts` and version files on a plain hotfix branch.
**Interfaces:** Consumes: the three spec-§10 triggers. Produces: deterministic recovery paths that never widen a contract silently.

- [ ] **Contingency A — Sep 1 auto-decouple (trigger: `0.32.1` not shipped by 2026-09-01, checked that morning).**
  1. `git fetch origin && git checkout -b hotfix/cli-help-0.32.1 origin/main`
  2. Apply the candidate by tree diff, not commit labels (Task-1 carried ruling): `git diff e600ad5c2dc5e1bde0714915e7a84980c8d5602b..codex/eve-governed-production-release -- src/cli.ts test/cli-subcommand-help.test.ts CHANGELOG.md | git apply` (if D1 already merged, diff from `$MERGE_HEAD` instead; if the files are already on main, this step is a no-op — verify with `git status`).
  3. `npm version 0.32.1 --no-git-tag-version`, commit, PR to main (ordinary review), merge, `git tag v0.32.1 <merge-sha> && git push origin v0.32.1` — plain release ships that day through the existing workflows; the `production-release` reviewer approves as a plain publish, recorded as NOT a governed mission.
  4. Mission re-point to `0.32.2` — exact constant changes in `src/authority/release-contracts.ts`: line 10 `RELEASE_BRANCH` → `"reelier/release/0.32.2"`; every `"0.32.1"` literal → `"0.32.2"` and every `"v0.32.1"` → `"v0.32.2"` (interface literal types `StagedCandidateManifestV1.packageVersion`/`tag` at `:51/:63`, `ReleaseOperationPlanV1.npmPreflight` at `:83`, `tag` at `:88`, and the parser equality checks at `:307`, `:330`, `:354`); plus the same literals in `test/authority/release-contracts.test.ts` and `test/authority/github-release-runner.test.ts`; plus a fresh RELEASE_BASE re-pin (rerun D2 against the new main head). The npm `versionMustBeAbsent: true` preflight then enforces the re-point: `0.32.1` existing on npm makes any stale `0.32.1` dispatch refuse (version-collision refusal handles the re-point, spec §2.2).
  5. Ledger: `Lane D / D5-A: Sep 1 auto-decouple executed — 0.32.1 shipped plain <date>; mission re-pointed at 0.32.2.` Commit `"sdd: record Sep 1 auto-decouple"`.
- [ ] **Contingency B — Eve fallback (trigger: C5 timebox expiry, or Eve organization failure during D3/D4).** Swap the harness: run the same mission decomposition on Codex/Claude Code against the identical Cell ingress and signed Job Cards — the contract is harness-neutral; no contract, definition, or workflow changes. Record: `Lane D / D5-B: Eve fallback invoked at <phase>; mission carried by <Codex|Claude Code>; Eve gap ships as a finding in the release notes and mission record.` The Eve gap is a finding, never silently absorbed.
- [ ] **Contingency C — rehearsal-failure counter reset (trigger: any failed rehearsal run in D3).** Set counter := 0 in the ledger; route the failure to its owning lane as a normal defect (RED-first fix); rerun the full-path rehearsal from scratch — partial re-runs never count toward the two consecutive cleans. Ledger: `Lane D / D5-C: rehearsal counter reset at run <n> (<failure>); counter=0.`

## Appendix: drafting-agent notes (context for implementers; resolutions above are binding)

### laneA notes
- [laneA.0] SPEC TENSION the assembler must resolve before executing A1 (I implemented the spec literally; both callers below then break at runtime in production composition): (1) github-release-runner.ts:231-232 — the wrapper's publishReservation immediately re-loads the durable head with ledgerState:'dispatched' and asserts head.phase === 'reservation'; after A1's loader-side refusal that readback THROWS whenever the underlying publication is createFileReceiptPublication (the production basePublication in local.ts:178), so every governed release dispatch would refuse at its root publish. Spec 4.2's change list for lines 229-255 names only map keys + confirm requestId, not this readback. Options: exempt the wrapper by replacing its loadDurableHead readback with a check that treats the loader's refusal error as the expected root-only state, or have publishReservation return enough to verify without a dispatched-query readback. (2) dispatch.ts:285-286 — recover()'s legitimate crash window (root published, terminal not yet published) reaches loadDurableHead('dispatched') on a reservation-only chain and now REFUSES instead of publishing an ambiguous node; the reservation strands behind a loud loader error until operator action. This may be the intended fail-closed semantics (rehearsal fault classes include 'refusal'), but the spec does not say so explicitly. A2's crash test therefore injects the crash AFTER the terminal durable publish (w3), which recovery adopts cleanly — consistent with both 4.1 and 4.2 as written.
- [laneA.1] A1 seam shape: the spec mandates a module-level hook following the __testSetAuthorityCellHostPlatform precedent but does not name it or its event shape. I chose __testSetReceiptsDurabilityProbe with a closed {kind: created|synced, site: node-create|durable-mkdir|legacy-rename, target} event; rename freely, but keep it module-level and out of the host barrel.
- [laneA.2] A1 refusal error text 'durable publication terminal receipt is absent for a send-started reservation' is plan-chosen (spec names no message). Lane D's rehearsal case and my A1 test match on /terminal receipt is absent/ — keep them in sync if reworded.
- [laneA.3] A3 config file format: the spec fixes the six createGitHubReleaseRunner inputs but leaves the operator-config field names/schema open. I chose a closed v1 (reelier.github-release-runner-config/v1) with absolute paths, PEM key FILES for the two host signers (precedent: gateKeyFile in authority.yml), public SPKI base64 for the release authority, an authorizationDir of verifiable bundle files, and a provider enum containing ONLY 'loopback-fixture' — Lane 2 must widen the enum with its live github-https provider kind and its SecretResolver credential ref; coordinate that seam at the barrier.
- [laneA.4] A3 positive-case fixture risk: the four-alias signed deployment fixture is modeled on multiDefinitionFixture (verified symbols: buildAuthorityDeployment, signJobCard, jobCardTrustPinFixture, githubReleasePacks/githubReleaseManifest/githubReleaseDefinitionDigests) but I could not execute deploy.ts's candidate validation; the step includes the correction rule (adjust candidate fields within deploy.ts's closed schema, assertion target fixed). Budget one extra iteration there.
- [laneA.5] A2 test environment: the real FsAuthorityLedger binds a derived fence endpoint on Windows; ledger.test.ts uses a bindableTempRoot retry helper for rare EADDRINUSE collisions. My A2 test uses plain mkdtemp roots — if flaky on win32, copy ledger.test.ts's bindableTempRoot pattern (fence-port imports at its lines 1-36).
- [laneA.6] A4 ledger location: the SDD ledger line 'BLOCKED by terminal breaker review at d075f75d' is NOT in the worktree's docs/ tree (searched; the spec cites 'SDD ledger, progress.md'). The assembler must locate the actual file (likely session-local progress notes for the 2026-08-18 plan in the main checkout) before Step A4.3; the append text is provided.
- [laneA.7] A3 dispatch plumbing: runAuthorityCommand receives positional args already stripped of the leading 'authority' by src/cli.ts's dispatcher — the serveThroughDispatch helper must mirror the exact slicing (verify with grep -n runAuthorityCommand src/cli.ts before writing it; I did not read that dispatch call site).
- [laneA.8] Fix-order dependency inside Lane A: A1's tests use identity.reservationId 'r1' so they pass both before and after A2's normalization (normalize is identity on non-raw ids); A2's real-ledger test requires A1's loader changes to be present only in that it must NOT crash on reservation-phase heads during recovery — its crash point (w3) avoids that path deliberately. Do not reorder A2 before A1.

### laneB notes
- [laneB.0] B1 outcome tension the assembler must surface to the operator: the frozen tag write is a lightweight `createRef` (`github-release-runner.ts:400`) with no tag-object/message surface and no `createTag` among the 14 provider methods, and candidate publish writes exactly one governed ref (`:298`) — the reading procedure will likely find carrier A (annotated tag message) does not fit, and carrier B fits only in an operator/Cell-written out-of-band ref variant, which deviates from the spec's literal fallback wording ('written by github_release_candidate_publish_v1'). B1's escalation path covers this, but the decision belongs to B1 execution + operator, not this plan.
- [laneB.1] Trust-pin location for the verifier's authorization key is not fixed by the spec. B3/B4 read it from repository variables (`vars.RELEASE_AUTHORIZATION_SIGNER_ID` / `vars.RELEASE_AUTHORIZATION_SPKI`, set during the Lane-3 admin checklist). Repo variables are mutable by repo admins — this touches the unbuilt segregation-of-duties atom (CLAUDE.md §8) and the assembler/operator should confirm or move the pin (production-release environment variables, or a committed trust-pin file on the re-pinned base).
- [laneB.2] Spec §5 lists the npm-publish step order as guard → verifier → clean npm ci + build, but the verifier imports the built barrel (`dist/authority/index.js`), so B3/B4 place `npm ci && npm run build` immediately before the verifier step. If the spec's literal ordering is binding, the alternative is a self-building verifier step; flag for assembler confirmation.
- [laneB.3] `environment: ${{ github.event_name != 'pull_request' && 'production-release' || '' }}` on docker-publish's mixed PR/tag job relies on empty-string-means-no-environment, a widely used but not formally documented Actions behavior. Verify on the first PR run after B4; the fallback is splitting the docker job into a PR-validation job and a gated publish job.
- [laneB.4] No `parseCanonicalSignedReleaseOperationPlanV1` is exported from release-contracts.ts (only bundle/manifest/policy/receipt-graph have canonical-string parsers). B2 parses the operation plan value-level via `parseSignedReleaseOperationPlanV1`; digest+signature still bind content, but byte-level canonicality is unenforced for that one artifact. Exporting the missing parser would be a release-contracts.ts change this lane must not make — Lane 1 decision if wanted.
- [laneB.5] B5's `getCommit` refuses multi-parent commits (definitive-refusal). If a re-pinned RELEASE_BASE is ever a true merge commit, base readback would refuse; rehearsal should confirm the base commit's parent count.
- [laneB.6] npm-publish publishes the digest-checked tarball file (`npm publish reelier-<v>.tgz`), which skips prepack/prepublishOnly so the published bytes are exactly the verified bytes; the quality gates those scripts duplicate are already bound as signed CI lanes. Also assumed: npm Trusted Publisher OIDC (admin checklist) so no NODE_AUTH_TOKEN appears anywhere.
- [laneB.7] B3 adds npm-publish.yml and B4 edits mcp/docker workflows — all three files' byte digests change, so every `workflowCommitments` pin must be computed from the post-merge files by the spec §3 re-pin PR; no artifact signed before that re-pin can verify against these workflows.
- [laneB.8] GitHub API mapping choices in B5 that rehearsal must validate live: ready-for-review is GraphQL-only (REST has no mutation); list-pulls payloads lack `merged` so `merged_at` presence is used; unmerged PRs' `merge_commit_sha` (a test-merge SHA) is deliberately mapped to null; getChecks joins check runs to workflow runs via check_suite id and digests workflow bytes fetched at the head SHA — unjoined external checks map to a zero digest + '(unjoined-check-suite)' and fail closed in the runner's assertChecks.
- [laneB.9] Spec §5 says the verifier is 'called by all three tag workflows'; on mcp-publish the inserted verifier step is unconditional, which also fail-closes the pre-existing workflow_dispatch path (no tag → no authorization carrier → refuse). If dispatch-path MCP publishes must keep working before the mission, the step needs the same tags-only condition as docker — operator call.

### laneC notes
- [laneC.0] SPEC-VS-CODE CONFLICT the assembler must surface to the operator (D2): the spec's post-barrier order (§3) re-pins RELEASE_BASE to the post-infra-merge head via a follow-up PR to main, but merging that PR itself advances origin/main past the pinned value. The runner refuses dispatch when heads/main != plan.baseCommit (github-release-runner.ts:274 'candidate publication base branch drifted') and the parsers require baseCommit === RELEASE_BASE (release-contracts.ts:307/:330/:346), so with the D2 merge as the last main mutation the mission refuses at candidate publication. A constant cannot pin its own merge commit (content would contain its own hash). Resolution options — (a) relax the pin check to ancestry/known-set (a Lane-1 contract amendment, needs operator exception per §10), (b) treat RELEASE_BASE as enforced only by the Cell's deployed build and set it on the Cell branch AFTER the D2 merge (but the tag-tree workflow verifier would then disagree with main's copy), or (c) accept that D2's merge head is the pin and require no further main merges, which contradicts the equality check. Escalate; do not silently widen. D3's first rehearsal will reproduce the refusal if unresolved.
- [laneC.1] The exact docker invocation for a local full Ubuntu suite run is not committed anywhere in this worktree; the prior evidence dirs (main repo, e.g. linux-verify-4f0a8cc-final/run.sh) show only the in-container script (npm ci --ignore-scripts, npm run build, timeout 25m npm test) and not the docker run line or image tag. D1 Step 2 therefore uses the repo's own CI via gh workflow run ci.yml (workflow_dispatch exists on ci.yml) as primary, with the containerized fallback flagged as pattern-inferred.
- [laneC.2] **RESOLVED (D1 prep pass):** reconciled against Lane A's closed parser (`src/authority/host/github-release-runner-config.ts`). Only `provider.githubTokenRef` is a genuine `SecretResolver` reference (`env:REELIER_RELEASE_GITHUB_PAT`); `journalKeyFile`/`evidenceKeyFile` are `absolutePath`-checked fields read with a direct `readFile`, never through `SecretResolver`, so `REELIER_RELEASE_JOURNAL_SIGNER_PEM`/`REELIER_RELEASE_EVIDENCE_SIGNER_PEM` were dead Fly-secret names nothing in the parser consumes. C1 Step 6/7 now install the two signer PEMs as files under `/data/authority/keys/` and set only `REELIER_RELEASE_GITHUB_PAT` and `REELIER_AUTHORITY_BEARER` as Fly secrets.
- [laneC.3] The spec assigns no lane to BUILDING the Eve root-orchestrator + eight-roles organization (plan Task 7 first bullet). C5 smokes jobs.search/load only and D4 Step 3 assumes the organization exists or falls back per §2.5/D5-B. If no other lane builds it, the fallback harness (Codex/Claude Code decomposition against the same signed Job Cards) is the de facto mission path — the assembler should either add that build task to a lane or confirm the fallback is the intended default.
- [laneC.4] conformance/continuity-adapter/v1/eve-fixture EXISTS in this worktree (real Eve 0.39.0 pinned: dependencies { eve: 0.39.0, reelier: file:../../../.. }), but its agent binds a loopback hermetic Path C port via env wiring (agent/lib/runtime.ts, binding.ts), not remote HTTP — C5 Step 2's remote-ingress wiring of a real Eve session is the genuine timeboxed unknown.
- [laneC.5] C2 'port the certification-branch Fly probe runner' is already satisfied code-wise in this worktree (src/authority/host/fly-remote-probe.ts, fly-certification.ts, cli certify run --adapter fly-topology); C2 Step 6 is configure-and-execute. However parseCertificationOperatorConfig requires the FULL three-app fly config (agent + egress apps, machine ids, image digests) — for a Cell-only deployment those fields have no live referent, which is a likely stall path feeding the 3-day timebox fallback (egress recorded unchecked). Flag to the operator when composing certification.local.json.
- [laneC.6] Fly app name reelier-authority-cell, volume size 1GB, org slug 'personal', and rehearsal repo name seldonframe/reelier-release-rehearsal are proposals consistent with the manifests (volume name reelier_authority_data and region yyz are fixed by authority-cell.toml); operator may rename at C1/C3 execution time — the names are otherwise unbound.
- [laneC.7] D4 Step 2's signing ceremony and Step 7's offline receipt-graph verification use operator-side scripts kept OUT of the repo (mission directory) because post-D2 main is frozen for the candidate and the three-file candidate cap (RELEASE_PATHS) forbids adding scripts; the spec names no committed tool for either. If the assembler prefers committed scripts, they must land in the infra PR (D1) window, not after D2.
- [laneC.8] Contingency A step 4's re-point literal list was verified against release-contracts.ts as of 6ad09b4d (grep '0.32.1' hits at the cited lines); recount at execution time since Lane B may add version literals to workflows and the shared verifier.
- [laneC.9] The mcp-publish.yml MCP Registry lane has no dummy registry; C3 Step 9's dry-run recording rule implements spec §6's 'recorded as dry-run, not covered' — mcp-publisher login/publish are never executed in rehearsal.
