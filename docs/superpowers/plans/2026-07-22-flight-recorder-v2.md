# Flight Recorder v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship reelier 0.19.0 — per-skill manifest with fail-closed replay preflight, hash-bound per-step write approval replacing blanket `--allow-writes` as the final boundary, and `--fail N` mocked-failure replay.

**Architecture:** Three sequential slices on `feat/flight-recorder-v2` (this worktree: `C:\Users\maxim\CascadeProjects\reelier-fr2`). Manifest = environment binding (tool present + schema digest, checked before step 1, fail closed). Approval = operation binding (hash of tool + args *template*, stamped per step by a human command, checked at execution, fail closed on drift). Mock failures = synthetic Observations injected before tool dispatch so the real escalation ladder is exercised. Spec: `docs/specs/flight-recorder-v2.md`.

**Tech Stack:** TypeScript 5.5, ESM, Node built-in test runner. Only runtime dep is `@modelcontextprotocol/sdk`. No new dependencies.

## Global Constraints

- Test command: `npm test` (= `tsc -p tsconfig.test.json && node --test dist-test/test/*.test.js`). Targeted run after a build: `node --test dist-test/test/<name>.test.js`.
- Tests live in `test/<name>.test.ts`, node:test style (`import { test } from "node:test"; import assert from "node:assert/strict";`) — copy the idiom from `test/skill.test.ts`.
- **Prime-directive split (spec):** record-time capture fails open (omit + visible gap, never an error to the agent); replay-side checks fail closed.
- **Never-lies:** every new record field is optional, omitted when unknown, never guessed. Old skills/records must parse and behave exactly as today (regression: full suite green after every task).
- **Honest-success rule** unchanged: zero assertions = "unchecked", never "passed".
- All hashes: `"sha256:" + createHash("sha256").update(canonicalJson(x), "utf8").digest("hex")` — canonical JSON only, never raw `JSON.stringify`.
- Commit after every task: `git add <files> && git commit -m "<type>(<scope>): <what>"`. Windows: LF/CRLF warnings from git are expected noise.
- Replay-side policy.yml enforcement is a **non-goal** (spec §Non-goals): policy guards the recorder chokepoint; manifest + approval are the replay-side controls.

---

## Slice 1 — Manifest + fail-closed preflight

### Task 1: Canonical JSON + schema digest

**Files:**
- Create: `src/canonical-json.ts`
- Test: `test/canonical-json.test.ts`

**Interfaces:**
- Produces: `canonicalJson(value: unknown): string` — deterministic JSON text: object keys sorted recursively (code-point order), array order preserved, `undefined` object values omitted (JSON semantics), throws `TypeError` on circular refs (rely on JSON.stringify's own error via the replacer approach below).
- Produces: `digestSha256(value: unknown): string` — `"sha256:" + <64 lowercase hex>` over `canonicalJson(value)`.

- [ ] **Step 1: Write the failing test**

```typescript
// test/canonical-json.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalJson, digestSha256 } from "../../src/canonical-json.js";

test("object keys are sorted recursively", () => {
  assert.equal(
    canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 4, y: 5 }] } }),
    '{"a":{"c":[3,{"y":5,"z":4}],"d":2},"b":1}'
  );
});

test("key order does not change the digest; value change does", () => {
  const d1 = digestSha256({ a: 1, b: 2 });
  const d2 = digestSha256({ b: 2, a: 1 });
  const d3 = digestSha256({ a: 1, b: 3 });
  assert.equal(d1, d2);
  assert.notEqual(d1, d3);
  assert.match(d1, /^sha256:[0-9a-f]{64}$/);
});

test("arrays preserve order", () => {
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test("primitives and null round through", () => {
  assert.equal(canonicalJson(null), "null");
  assert.equal(canonicalJson("x"), '"x"');
  assert.equal(canonicalJson(3), "3");
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test` → FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// src/canonical-json.ts
// Deterministic JSON serialization for hashing: recursive key sort,
// array order preserved. Plain JSON.stringify is insertion-ordered and
// therefore unstable across producers — never hash it directly.
import { createHash } from "node:crypto";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function digestSha256(value: unknown): string {
  return "sha256:" + createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → all green.
- [ ] **Step 5: Commit** — `feat(hash): canonical JSON + sha256 digest helpers`

### Task 2: `Skill.manifest` — parse + serialize roundtrip

**Files:**
- Modify: `src/skill.ts` (Skill interface ~:20–36; `parseFrontmatter` ~:107–130 — it currently allows only `name`/`description` shape via a flat map; manifest is a third known key)
- Modify: `src/writeback.ts` (`serializeSkill` :95–117 — emit the key after `description:`)
- Test: `test/manifest.test.ts`

**Interfaces:**
- Produces (in `src/skill.ts`):
  ```typescript
  export interface ManifestTool { name: string; server?: string; digest: string }
  export interface SkillManifest { v: 1; tools: ManifestTool[] }
  // Skill gains: manifest?: SkillManifest
  ```
- Frontmatter form (ONE line, canonical JSON value): `manifest: {"tools":[{"digest":"sha256:…","name":"crm.create_contact","server":"seldonframe"}],"v":1}`
- Consumes: `canonicalJson` from Task 1 (serialization uses it so the line is stable).

- [ ] **Step 1: Failing tests** — in `test/manifest.test.ts`: (a) skill with a valid `manifest:` line parses, `skill.manifest.tools[0].digest` matches; (b) malformed manifest JSON → `SkillParseError` naming the key (loud, per the parser's no-silent-skip rule); (c) manifest with wrong shape (`v: 2`, or `tools` not an array, or a tool missing `name`/`digest`) → `SkillParseError`; (d) serialize→parse→serialize is byte-identical for a skill WITH a manifest; (e) a skill WITHOUT a manifest serializes byte-identically to today (no `manifest:` line). Use a minimal inline skill source string (copy the fixture idiom from `test/skill.test.ts`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** In `parseFrontmatter`: keep the existing flat `key: value` scan; after fields are collected, if `fields.manifest` present → `JSON.parse` inside try/catch (catch → `SkillParseError("Malformed manifest frontmatter (not valid JSON)")`), then validate shape explicitly (`v === 1`, `Array.isArray(tools)`, every tool has string `name` and string `digest` matching `/^sha256:[0-9a-f]{64}$/`, optional string `server`) — any violation → `SkillParseError` with the offending detail. Return it alongside name/description; thread into the `Skill` object in `parseSkill`. In `serializeSkill` (writeback.ts:99) add after the description line:
  ```typescript
  if (skill.manifest) lines.push(`manifest: ${canonicalJson(skill.manifest)}`);
  ```
- [ ] **Step 4: Run** → green, including the whole existing suite (roundtrip regression).
- [ ] **Step 5: Commit** — `feat(skill): optional manifest frontmatter (tool schema digests), parse+serialize`

### Task 3: Capture at wrap time — trace meta carries the tool manifest

**Files:**
- Modify: `src/trace.ts` (meta TraceRecord type — find the meta record interface; it already carries optional `toolAnnotations`, added at recorder.ts:142–154)
- Modify: `src/recorder.ts` (`collectToolAnnotations` :231–243 area; `Recorder.start` :142–154)
- Test: extend `test/recorder.test.ts`

**Interfaces:**
- Trace meta record gains `toolManifest?: ManifestTool[]` — one entry per exposed tool route (post-collision-prefix `exposedName`, so what's recorded is what replay will look up), `server` = the downstream's advertised `name` (`DownstreamConnection.name`, mcp-client.ts:30–36), `digest` = `digestSha256(route.tool.inputSchema)`.
- **Fail-open:** if digest computation throws for a tool (exotic schema value), skip that tool and append the v1-style gap marker the meta record already uses for policy gaps (find `policyGap` in recorder.ts and mirror the pattern as `manifestGap: string[]` — tool names that could not be digested). Never throw out of the proxy path.

- [ ] **Step 1: Failing test** — recorder.test.ts already builds a fake downstream (find its fixture); assert the meta record now contains `toolManifest` with the fixture tool's name and a `/^sha256:[0-9a-f]{64}$/` digest, and that two runs produce the SAME digest (stability).
- [ ] **Step 2: Run** → FAIL. **Step 3:** implement per the interface block. **Step 4:** green. 
- [ ] **Step 5: Commit** — `feat(recorder): stamp tool schema digests into trace meta (fail-open)`

### Task 4: Thread into skills at creation + `reelier manifest` command

**Files:**
- Modify: `src/from-session.ts` (locate where the `Skill` object is constructed from a recorded trace; the meta record is already read there for annotations — attach `manifest` filtered to tools actually used: `new Set(steps.map(s => s.actionTool))`)
- Create: `src/manifest.ts`
- Modify: `src/cli.ts` (register `manifest` subcommand next to the existing subcommand dispatch; usage line)
- Test: `test/manifest-cli.test.ts` + extend `test/from-session-cli.test.ts`

**Interfaces (src/manifest.ts):**
```typescript
import type { Skill, SkillManifest, ManifestTool } from "./skill.js";
import type { DownstreamConnection } from "./mcp-client.js";

/** Manifest for the tools this skill's steps actually use, from live downstreams. Tools not found live are OMITTED here (build ≠ verify). */
export function buildManifestForSkill(skill: Skill, downstreams: DownstreamConnection[]): SkillManifest;

export interface ManifestDrift { name: string; recorded?: string; live?: string; note: string }
/** Compare a stored manifest against live downstreams. ok=false on any missing tool or digest mismatch. */
export function preflightManifest(manifest: SkillManifest, downstreams: DownstreamConnection[]): { ok: boolean; drifts: ManifestDrift[] };
```
Both use `buildToolRoutes(downstreams)` (mcp-client.ts:150) so names match replay's `exposedName` semantics. Drift notes: `"missing: tool not exposed by any wrapped server"`, `"schema drifted since recording"`, and when the digest exists under a different exposed name, name it (`"schema found under 'X' — wrap order may have changed collision renaming"`).

**`reelier manifest <skill.md> --wrap "…"`:** parse skill → connect wraps → `buildManifestForSkill` → print per-tool old→new digest lines (`unchanged` / `updated` / `added` / `removed`) → set `skill.manifest`, serialize, write atomically (reuse writeback.ts's atomic write helper — export it if private). No `--wrap` → error `"reelier manifest needs --wrap to reach live servers"`, exit 1.

- [ ] **Step 1: Failing tests** — manifest-cli: drive `cmdManifest` directly with a fake `ParsedArgs` + injected fake downstream (follow the `cmdPush`-export-for-tests pattern, cli.ts:63–66); assert the file on disk gains the `manifest:` line and re-running prints `unchanged`. from-session: the generated SKILL.md now carries `manifest:` with only step-used tools.
- [ ] **Step 2** FAIL → **Step 3** implement → **Step 4** green (full suite — from-session fixtures must still parse).
- [ ] **Step 5: Commit** — `feat(manifest): build/refresh per-skill tool manifest (from-session + reelier manifest cmd)`

### Task 5: Fail-closed preflight in `cmdRun`

**Files:**
- Modify: `src/cli.ts` (`cmdRun` — insert after the wrap-connect loop :196–201, before `runSkill` :216)
- Modify: `src/runner.ts` (`RunRecord` gains `manifestIgnored?: true`; `RunOptions` gains `manifestIgnored?: boolean` threaded verbatim)
- Test: extend `test/manifest-cli.test.ts` (unit, fake downstream) + `test/proxy-e2e.test.ts`-style e2e if a fixture server exists

**Behavior (exact):**
1. `skill.manifest` absent → `console.error("note: <skill> has no manifest — replay cannot detect tool-schema drift. Stamp one: reelier manifest <skill> --wrap …")`, proceed.
2. Manifest present, `args.wraps.length === 0` → fail: `"manifest present but no --wrap given — cannot verify tools against live servers"`, exit 1 (unless `--ignore-manifest`).
3. Manifest present + wraps → `preflightManifest`. `ok` → proceed silently. Drift → print `MANIFEST DRIFT — refusing to replay (fail closed):` then one line per drift (`  ✗ crm.create_contact — recorded sha256:ab12… live sha256:cd34… (schema drifted since recording)`), then the remediation line (`If the change is intentional: reelier manifest <skill> --wrap …  |  break-glass: --ignore-manifest`), exit 1 **before step 1 executes**.
4. `--ignore-manifest` flag → skip check, `console.error("WARNING: --ignore-manifest — replaying despite unverified tool schemas")`, pass `manifestIgnored: true` into `runSkill` → stamped on the record.

- [ ] **Step 1: Failing tests** — the four behaviors above; the drift case asserts exit code 1 AND that the fake downstream's `call` was never invoked (fail closed = before step 1).
- [ ] **Steps 2–4:** FAIL → implement → green.
- [ ] **Step 5: Commit** — `feat(run): fail-closed manifest preflight (--ignore-manifest break-glass)`

---

## Slice 2 — Writes hardening

### Task 6: `Step.approve` field + approval hash

**Files:**
- Modify: `src/skill.ts` (Step interface :7–18; step-field parser — find where `- effect:` is parsed and add `- approve:`)
- Modify: `src/writeback.ts` (`renderStepBlock` :74–84 — emit `- approve: …` after the effect line)
- Create: `src/approval.ts`
- Test: `test/approval.test.ts`

**Interfaces (src/approval.ts):**
```typescript
import { digestSha256 } from "./canonical-json.js";
import type { Step } from "./skill.js";

/**
 * Approval binds the OPERATION SHAPE: tool + args template ({{placeholders}}
 * intact). Environment binding is the manifest's job (preflight fails closed
 * on server/schema drift BEFORE approval is ever evaluated) — that split is
 * what lets `reelier approve` run offline. Spec: flight-recorder-v2 §2.
 */
export function computeApprovalHash(step: Pick<Step, "actionTool" | "actionArgs">): string {
  return digestSha256({ args: step.actionArgs, tool: step.actionTool });
}

/** Per-run identity of an executed write: tool + FILLED args + server. Recorded in the receipt; never enforced against external state (spec non-goal). */
export function computeIdempotencyKey(tool: string, server: string | null, filledArgs: unknown): string {
  return digestSha256({ args: filledArgs, server, tool });
}
```
- `Step.approve?: string` — parsed from `- approve: sha256:<64hex>` (validate format at parse, `SkillParseError` on garbage); serialized back verbatim. Absent = legacy step.

- [ ] **Step 1: Failing tests** — parse/serialize roundtrip with `approve:`; malformed value rejected; `computeApprovalHash` stable across arg-key order and DIFFERENT when tool or template changes; hash of static-args step differs from same step with a placeholder swapped in.
- [ ] **Steps 2–4:** FAIL → implement → green. **Step 5: Commit** — `feat(skill): per-step approve field + approval/idempotency hashes`

### Task 7: The replay gate — approval replaces the blanket flags

**Files:**
- Modify: `src/tools.ts` (`Tool` gains `server?: string`)
- Modify: `src/mcp-tool.ts` (`mcpTool` :51–59 — set `server: downstream.name`)
- Modify: `src/runner.ts` (`executeStep` — REPLACE the two gate blocks at :303–316 and :318–335)
- Test: extend `test/runner.test.ts`

**Replacement gate (exact logic, single block where the two blocks were):**
```typescript
const effectiveEffect = step.effect ?? tool.effect;
const isWrite = effectiveEffect === "idempotent-write" || effectiveEffect === "destructive";
if (isWrite) {
  if (step.approve !== undefined) {
    const expected = computeApprovalHash(step);
    if (step.approve !== expected) {
      // Drifted since approval. FINAL boundary: no flag overrides this.
      failures.push(
        `Approval mismatch on write step — the step's tool/args changed since it was approved. ` +
          `Re-review and re-approve: reelier approve <skill.md>. (--allow-writes/--yes do NOT override an approval mismatch.)`
      );
      return { outcome: "failed", ms: Date.now() - started, failures, binds: localBinds };
    }
    // Hash matches: the human approved exactly this operation — execute, no flag needed.
  } else if (effectiveEffect === "destructive" && !ctx.allowDestructive) {
    /* keep today's exact refusal message from :310-314 */
  } else if (effectiveEffect === "idempotent-write" && !ctx.allowWrites) {
    /* keep today's exact refusal message from :330-333 */
  }
}
```

**Test matrix (each a named test):** approved+match executes with NO flags (both effects) · approved+mismatch fails closed even WITH `--allow-writes` AND `--yes` (assert the fake tool was never called) · no-approve keeps today's behavior exactly (both refusal messages byte-compatible — existing tests must not change) · `read` steps untouched by all of it.

- [ ] **Steps 1–4:** failing tests → implement → green (whole suite: the two old gate tests still pass unmodified).
- [ ] **Step 5: Commit** — `feat(runner): hash-bound approval gate — op-scoped, final, flag-proof`

### Task 8: The write receipt — idempotency key, resource, L2 stamping

**Files:**
- Modify: `src/runner.ts` (`StepRecord` gains `write?`; `executeStep` return gains `write?`; the L2 re-execution path — find where escalation re-runs the tool around :540–550 — stamps the same shape; `runSkill` threads it and tracks duplicate keys)
- Test: extend `test/runner.test.ts`

**Interfaces:**
```typescript
export interface StepWrite {
  idempotencyKey: string;       // computeIdempotencyKey(tool, tool.server ?? null, filledArgs)
  approved: boolean;            // true = executed via approval hash; false = via legacy flag
  resource?: { id?: string; version?: string };
  duplicateOf?: number;         // step n of an earlier step in THIS run with the same key
}
// StepRecord gains: write?: StepWrite  — present iff a write-effect step actually executed its tool.
```
**Resource heuristic (honest, labeled):** `JSON.parse(obs.body)` in try/catch; on an object: `id` from `body.id ?? body._id`, `version` from `body.version ?? body.etag ?? body.revision ?? body.sha` (String() each, only when the raw value is string|number); omit `resource` when nothing found or body isn't JSON. Mocked steps (Task 10) and refused steps never get `write`.
**Duplicates:** `runSkill` keeps `Map<key, n>`; second sighting sets `duplicateOf` — recorded, not failed. `cmdRun`'s onStep output prints `    ! duplicate write (same idempotency key as step N)` when present, and after the run prints ONE deprecation line if any `write.approved === false`: `note: write steps executed via --allow-writes/--yes without per-step approval — approve them: reelier approve <skill.md>`.

- [ ] **Steps 1–4:** failing tests (key present+stable on executed write · approved flag truthful both paths · resource extracted/omitted per fixture bodies incl. non-JSON · duplicate detection · L2-healed write carries `write`) → implement → green.
- [ ] **Step 5: Commit** — `feat(receipt): write block — idempotency key, approved, resource, dup detection`

### Task 9: `reelier approve` command

**Files:**
- Modify: `src/cli.ts` (new `cmdApprove`, subcommand registration, usage; `--all` flag)
- Test: `test/approve-cli.test.ts`

**Behavior:** parse skill → write steps = `effect === "idempotent-write" || effect === "destructive"`. None → print `no write steps to approve`, exit 0. For each: print `Step N — <title>`, `  <tool> <canonicalJson(argsTemplate)>`, `  effect: <effect>`, current state (`unapproved` / `approved (current)` / `approved (STALE — args changed)`); confirm per step via readline y/N (`--all` = yes to all, non-interactive); on yes stamp `step.approve = computeApprovalHash(step)`. Serialize + atomic write (same helper as Task 4); append a changelog line via writeback's existing changelog helper (:119+): `- approved N write step(s) (reelier approve)`. Print summary `approved N, skipped M`.

- [ ] **Steps 1–4:** failing tests (drive `cmdApprove` with fake ParsedArgs + `--all`; assert file gains valid `approve:` lines that then satisfy Task 7's gate in a follow-up `runSkill` call; stale detection when args edited after approval) → implement → green.
- [ ] **Step 5: Commit** — `feat(cli): reelier approve — per-step hash-bound write approval`

---

## Slice 3 — Mocked-failure replay

### Task 10: `--fail N[=status]` injection through the real ladder

**Files:**
- Modify: `src/cli.ts` (`parseArgv` — `--fail` takes a value, repeatable, into a new `fails: string[]` on `ParsedArgs` (mirror the `--wrap` pattern :91–96); `cmdRun` parses each as `N` or `N=<int>` → `Record<number, number>` (default 500), rejects garbage with a usage error; passes as `mockFailures`; onStep prints `  ⚡ INJECTED failure (--fail N)` for mocked steps; banner line `MOCK RUN — injected failures at step(s): N, M` before step output)
- Modify: `src/runner.ts` (`RunOptions.mockFailures?: Record<number, number>`; `executeStep` gains a 6th param `mockStatus?: number`; `RunRecord.mockFailures?: number[]`; `StepRecord.mocked?: true`)
- Test: extend `test/runner.test.ts` + `test/cli-entrypoint.test.ts` for flag parsing

**Injection point (exact):** in `executeStep`, immediately AFTER the unknown-tool check (:297–301) and BEFORE the write gates — a mocked step dispatches nothing, so approval/flag gates must not block it (you can recovery-test a write skill without `--allow-writes`; no side effect exists to guard). Still fill the template (template errors should surface normally), then:
```typescript
if (mockStatus !== undefined) {
  obs = { status: mockStatus, headers: {}, body: `reelier: injected failure (--fail ${step.n})` };
} else {
  obs = await tool.run(filledArgs, ctx);  // today's :347
}
```
Asserts/binds evaluate against the synthetic observation; a failure flows into `attemptEscalation` exactly like a real one (that's the point — the REAL ladder runs). Mocked steps: `mocked: true` on the StepRecord, never a `write` block. `runSkill` sets `RunRecord.mockFailures` = sorted step numbers (only when non-empty). Pass/fail semantics unchanged: if the ladder heals, the run passes.

- [ ] **Steps 1–4:** failing tests (flag parse matrix incl. `--fail 3`, `--fail 3=429`, repeated, `--fail x` rejected · fixture tool records ZERO calls for the mocked step · assert failure on synthetic body triggers escalation (reuse `test/runner-escalate.test.ts` fixtures) · records carry `mocked`/`mockFailures` · unmocked steps unaffected) → implement → green.
- [ ] **Step 5: Commit** — `feat(run): --fail N mocked-failure replay through the real escalation ladder`

### Task 11: `reelier push` refuses mock runs

**Files:**
- Modify: `src/push.ts` (in `pushSkill`/the record-selection path — find where the latest RunRecord is loaded; refuse when `record.mockFailures?.length`)
- Test: extend `test/push-cli.test.ts`

**Behavior:** structured error, exit 1: `refusing to push a mock run (injected failures at step(s): N) — mock runs are local recovery tests; a mocked receipt must never sit beside real ones. Re-run without --fail to produce a pushable receipt.` No `--force` override (never-lies: there is no legitimate reason to publish a mocked receipt).

- [ ] **Steps 1–4:** failing test (fixture record with `mockFailures: [3]` → push exits 1 with the message, fetch never called; record without the field pushes as today) → implement → green.
- [ ] **Step 5: Commit** — `feat(push): refuse mock-run receipts`

---

### Task 12: Docs — three-test taxonomy (credited) + CHANGELOG

**Files:**
- Modify: `README.md` (new section "Three tests, one skill" after the replay/receipts section: determinism = replay against recorded expectations · recovery = `--fail N` · drift = replay against live read-only deps; credit line: "Taxonomy due to Mads Hansen's review of the launch post."; document `reelier manifest`, `reelier approve`, `--fail`, `--ignore-manifest`)
- Modify: `CHANGELOG.md` (0.19.0 entry: the three features, breaking-behavior note: NONE — all additive; approval mismatch fail-closed only applies to steps that HAVE an `approve:` field)
- Modify: `SPEC.md` (if it documents the step grammar / run flags: add `approve:`, `manifest:`, `--fail`, `--ignore-manifest` — match its existing style; skip sections it doesn't have)

- [ ] **Step 1:** write docs. **Step 2:** `npm test` (full suite green — docs task doubles as the slice-3 regression gate). 
- [ ] **Step 3: Commit** — `docs: three-test taxonomy (credited), manifest/approve/--fail documented, 0.19.0 changelog`

---

## Self-review notes (already applied)

- Spec §2 said the approval hash includes `server`; Task 6 drops it (offline `reelier approve` can't know it) — environment binding is delivered by the manifest preflight instead. The spec file gets a matching amendment (committed alongside this plan).
- Spec §2 "policy.yml stays the floor" is scoped to the recorder chokepoint; replay-side policy evaluation is added to Non-goals (same amendment).
- Version bump to 0.19.0 + `npm publish` are NOT a task: one release rides the merge (one-publish-per-session rule); Max runs publish + 2FA once.
