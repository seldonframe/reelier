# SPEC record-shape drift guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SPEC.md §4.1/§4.2 a complete, machine-checked description of the run record this
version emits, and add a regression test that fails the moment a `StepRecord`/`RunRecord` field
ships without a documented row.

**Architecture:** One new test file parses three sources with the *same* TypeScript parser and
compares them: (a) the real interfaces in `src/runner.ts` / `src/assert.ts`, (b) the `interface`
code blocks embedded in SPEC.md §4.1/§4.2 — which are themselves valid TypeScript — and (c) the
`| Field | Semantics |` tables that follow them. The real types are the source of truth; the SPEC
block must match them structurally, and every field must be documented. No network, no fixtures,
no snapshot files.

**Tech Stack:** TypeScript 5.5 compiler API (`typescript` is already a devDependency), Node's
built-in `node:test` + `node:assert/strict`, ESM (`"type": "module"`, `module: NodeNext`).

## Global Constraints

- **The verifier stays open source.** This work lands in the public `reelier` repo only.
- **Repo hygiene.** No third-party names, no user quotes, no go-to-market content in this repo.
  This plan is engineering-only by construction.
- **Never let a receipt imply more than it proves.** Documentation prose added here describes what a
  field *is*, and states what a consumer MUST NOT infer, matching the voice of the existing §4.1 rows.
- **Never render `absent`, `pending`, or `unevaluated` as a pass.** Any new prose describing an
  optional field must say what its absence means, and must not let absence read as a pass.
- **No placeholder rows.** A table row that says "internal field" is a plan failure — every row
  states when the field is present, when it is absent, and what a consumer may not infer.
- **Do not weaken existing prose.** Existing §4.2 paragraphs for `passed`, `manifestIgnored`, and
  `mockFailures` are *moved* into the new table, not rewritten or summarized.
- Baseline before starting: `npm test` → 1126 tests, 1125 pass, 0 fail, 1 skipped.

---

## File Structure

- **Create** `test/spec-record-shape.test.ts` — the drift guard. Self-contained: parser helpers +
  three tests. No production code changes; this is a docs-consistency lint.
- **Modify** `SPEC.md` §4.1 — document the nested keys the guard reports as undocumented.
- **Modify** `SPEC.md` §4.2 — add a `| Field | Semantics |` table covering every `RunRecord` field,
  folding the three existing prose paragraphs into it.

No `src/` file changes. If the guard reports a mismatch between `src/runner.ts` and the SPEC
interface block, **the SPEC block is what changes** — the types are the source of truth.

---

### Task 1: SPEC record-shape drift guard

**Files:**
- Create: `test/spec-record-shape.test.ts`
- Modify: `SPEC.md` (§4.1 table rows; §4.2 new table)

**Interfaces:**
- Consumes: nothing from earlier tasks (this is the first task of the wave).
- Produces: `test/spec-record-shape.test.ts` as the standing guard. Later waves that add a record
  field must add a SPEC row in the same PR or this test fails. No exported runtime API.

**Background you need (verified against live code on 2026-07-31):**

- `src/runner.ts` exports `StepRecord` (:168) and `RunRecord` (:222). They reference named
  interfaces declared in the same file: `StepWhy` (:56), `StepWrite` (:68), `StepStateCheck` (:123),
  `AttestState` (:150), `StepAttest` (:155). `ObservationRef` is declared in `src/assert.ts` (:4).
- SPEC §4.1's `interface StepRecord` block (SPEC.md:618-657) **inlines all of those as anonymous
  object literals**. So a structural comparison must expand named references on the `runner.ts`
  side before comparing. That expansion is the core of this task.
- SPEC §4.2's `interface RunRecord` block (SPEC.md:677-697) leaves `steps: StepRecord[]` as a named
  reference, because `StepRecord` has its own section. The comparison must therefore **stop
  expanding at `StepRecord`** — treat it as a leaf. This is the only such exception and it is
  explicit in the code below.
- §4.1 has a semantics table (header at SPEC.md:660). Its first cells look like
  `` `write` (0.19.0+, §6.1c) `` and one row names two fields: `` `n`, `title` ``. Extract *every*
  backticked identifier from the first cell.
- **§4.2 has no table at all** — only three prose paragraphs (`passed`, `manifestIgnored`,
  `mockFailures`). Adding that table is half this task's work.
- Nested keys are documented **inside the parent row's prose**, never as their own rows — e.g.
  `approvalHash`, `dispatchedAt`, `duplicateOf` all live inside the `write` row's cell. The guard
  encodes exactly that convention: a nested key is "documented" if it appears backticked anywhere
  in its top-level parent's row.
- Tests are ESM and compile to `dist-test/test/*.test.js`, two levels below the repo root, so
  `fileURLToPath(new URL("../..", import.meta.url))` resolves the repo root. This is the existing
  idiom in `test/writeback.test.ts:12`.

---

- [ ] **Step 1: Write the failing test**

Create `test/spec-record-shape.test.ts` with exactly this content:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

/**
 * SPEC.md §4.1/§4.2 must be a complete description of the record this version emits.
 *
 * This is a pure lint over two sources already in the repo -- the TypeScript types and SPEC.md.
 * No network, no fixtures. It exists because `refs` (0.20.0), `stateCheck` and `write.dispatchedAt`
 * (0.25.0) each shipped while §4.1 stayed silent about them: a third party implementing from the
 * spec emitted records whose fields the cloud was already consuming. The types are the source of
 * truth; when this test fails, SPEC.md is what changes.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** A field and its nested keys, normalized so an inline object literal and a named interface
 *  reference to the same shape compare equal. */
type FieldNode = { name: string; optional: boolean; children: FieldNode[] };

/** Types documented in their own SPEC section. Expansion stops here so that `steps: StepRecord[]`
 *  in §4.2 stays a leaf, exactly as the spec writes it. */
const DOCUMENTED_ELSEWHERE = new Set(["StepRecord"]);

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true);
}

function collectDeclarations(sources: ts.SourceFile[]): Map<string, ts.InterfaceDeclaration> {
  const decls = new Map<string, ts.InterfaceDeclaration>();
  for (const sf of sources) {
    for (const stmt of sf.statements) {
      if (ts.isInterfaceDeclaration(stmt)) decls.set(stmt.name.text, stmt);
    }
  }
  return decls;
}

/** Strip `[]` and parenthesized/array wrappers down to the node that carries the members. */
function unwrap(node: ts.TypeNode): ts.TypeNode {
  if (ts.isArrayTypeNode(node)) return unwrap(node.elementType);
  if (ts.isParenthesizedTypeNode(node)) return unwrap(node.type);
  return node;
}

function childrenOf(
  node: ts.TypeNode | undefined,
  decls: Map<string, ts.InterfaceDeclaration>,
  seen: ReadonlySet<string>
): FieldNode[] {
  if (!node) return [];
  const inner = unwrap(node);
  if (ts.isTypeLiteralNode(inner)) return membersOf(inner.members, decls, seen);
  if (ts.isTypeReferenceNode(inner) && ts.isIdentifier(inner.typeName)) {
    const name = inner.typeName.text;
    if (DOCUMENTED_ELSEWHERE.has(name) || seen.has(name)) return [];
    const decl = decls.get(name);
    if (!decl) return [];
    return membersOf(decl.members, decls, new Set([...seen, name]));
  }
  return [];
}

function membersOf(
  members: ts.NodeArray<ts.TypeElement>,
  decls: Map<string, ts.InterfaceDeclaration>,
  seen: ReadonlySet<string>
): FieldNode[] {
  const out: FieldNode[] = [];
  for (const m of members) {
    if (!ts.isPropertySignature(m) || !m.name) continue;
    const name = ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) ? m.name.text : m.name.getText();
    out.push({
      name,
      optional: m.questionToken !== undefined,
      children: childrenOf(m.type, decls, seen),
    });
  }
  return out;
}

function shapeOf(
  interfaceName: string,
  sources: ts.SourceFile[]
): FieldNode[] {
  const decls = collectDeclarations(sources);
  const decl = decls.get(interfaceName);
  assert.ok(decl, `interface ${interfaceName} not found in ${sources.map((s) => s.fileName).join(", ")}`);
  return membersOf(decl.members, decls, new Set([interfaceName]));
}

/** Stable, diff-friendly rendering: one dotted path per line, `?` marking optional. */
function paths(fields: FieldNode[], prefix = ""): string[] {
  const out: string[] = [];
  for (const f of fields) {
    const p = prefix ? `${prefix}.${f.name}` : f.name;
    out.push(`${p}${f.optional ? "?" : ""}`);
    out.push(...paths(f.children, p));
  }
  return out.sort();
}

/** Every dotted path with its top-level parent, e.g. { path: "write.resource.id", top: "write" }. */
function leafPaths(fields: FieldNode[], prefix = "", top = ""): { path: string; top: string }[] {
  const out: { path: string; top: string }[] = [];
  for (const f of fields) {
    const p = prefix ? `${prefix}.${f.name}` : f.name;
    const t = top || f.name;
    out.push({ path: p, top: t });
    out.push(...leafPaths(f.children, p, t));
  }
  return out;
}

const SPEC = readFileSync(path.join(REPO_ROOT, "SPEC.md"), "utf8");
const SPEC_LINES = SPEC.split(/\r?\n/);

/** Slice SPEC.md between two `### ` headings (exclusive of the closing one). */
function section(startsWith: string, endsWith: string): string[] {
  const start = SPEC_LINES.findIndex((l) => l.startsWith(startsWith));
  assert.ok(start !== -1, `SPEC.md heading not found: ${startsWith}`);
  const rest = SPEC_LINES.slice(start + 1);
  const endRel = rest.findIndex((l) => l.startsWith(endsWith));
  assert.ok(endRel !== -1, `SPEC.md heading not found after ${startsWith}: ${endsWith}`);
  return rest.slice(0, endRel);
}

/** The first ```ts fenced block in a section. */
function fencedTs(lines: string[], label: string): string {
  const open = lines.findIndex((l) => l.trim() === "```ts");
  assert.ok(open !== -1, `no \`\`\`ts block in ${label}`);
  const rest = lines.slice(open + 1);
  const close = rest.findIndex((l) => l.trim() === "```");
  assert.ok(close !== -1, `unterminated \`\`\`ts block in ${label}`);
  return rest.slice(0, close).join("\n");
}

/** Rows of the first `| Field | Semantics |` table in a section: backticked names in cell 1,
 *  raw text of the whole row for the nested-key prose check. */
function tableRows(lines: string[]): { names: string[]; text: string }[] {
  const rows: { names: string[]; text: string }[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    const cells = t.slice(1).split("|");
    if (cells.length < 2) continue;
    const first = cells[0];
    if (/^\s*-+\s*$/.test(first) || /^\s*Field\s*$/.test(first)) continue;
    const names = [...first.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)].map((m) => m[1]);
    if (names.length === 0) continue;
    rows.push({ names, text: t });
  }
  return rows;
}

const runnerSf = parse("runner.ts", readFileSync(path.join(REPO_ROOT, "src", "runner.ts"), "utf8"));
const assertSf = parse("assert.ts", readFileSync(path.join(REPO_ROOT, "src", "assert.ts"), "utf8"));
const REAL_SOURCES = [runnerSf, assertSf];

const S41 = section("### 4.1 ", "### 4.2 ");
const S42 = section("### 4.2 ", "### 4.3 ");

for (const { name, lines, label } of [
  { name: "StepRecord", lines: S41, label: "§4.1" },
  { name: "RunRecord", lines: S42, label: "§4.2" },
]) {
  test(`SPEC ${label}: the published interface block matches the real ${name} type`, () => {
    const real = paths(shapeOf(name, REAL_SOURCES));
    const spec = paths(shapeOf(name, [parse(`spec-${name}.ts`, fencedTs(lines, label))]));
    assert.deepEqual(
      spec,
      real,
      `SPEC.md ${label}'s interface block has drifted from src/. ` +
        `The types are the source of truth -- update SPEC.md, not the types.`
    );
  });

  test(`SPEC ${label}: every ${name} field is documented`, () => {
    const rows = tableRows(lines);
    assert.ok(rows.length > 0, `${label} has no \`| Field | Semantics |\` table -- every field is undocumented`);

    const documentedTop = new Set(rows.flatMap((r) => r.names));
    const all = leafPaths(shapeOf(name, REAL_SOURCES));

    const missingTop = all
      .filter((f) => !f.path.includes("."))
      .filter((f) => !documentedTop.has(f.path))
      .map((f) => f.path);
    assert.deepEqual(missingTop, [], `${label}: top-level fields with no table row: ${missingTop.join(", ")}`);

    // Nested keys are documented inside their top-level parent's row -- the convention `write`
    // already follows for approvalHash/duplicateOf/dispatchedAt. Absence of a mention is the bug.
    const missingNested = all
      .filter((f) => f.path.includes("."))
      .filter((f) => {
        const key = f.path.split(".").pop()!;
        const row = rows.find((r) => r.names.includes(f.top));
        return !row || !new RegExp("`" + key + "`").test(row.text);
      })
      .map((f) => f.path);
    assert.deepEqual(
      missingNested,
      [],
      `${label}: nested keys never named in their parent field's row: ${missingNested.join(", ")}`
    );
  });
}
```

- [ ] **Step 2: Run the test and confirm it fails for the right reason**

Run:

```bash
npm test 2>&1 | grep -A 12 "spec-record-shape\|SPEC §4"
```

Expected: the two `§4.1`/`§4.2` *interface block* tests **pass** (the blocks are currently accurate),
and the two *documented* tests **fail**:

- `SPEC §4.2: every RunRecord field is documented` fails on
  `` §4.2 has no `| Field | Semantics |` table -- every field is undocumented ``.
- `SPEC §4.1: every StepRecord field is documented` fails listing nested keys never named in their
  parent row — expected to include `write.resource.id` and `write.resource.version`.

**Record the exact failure output before touching SPEC.md.** The list the test prints is your work
list for Step 3 — do not work from this plan's guess at it. If the interface-block tests fail
instead, stop and report: that means `src/runner.ts` and SPEC drifted structurally, which is a
larger finding than this task assumed.

- [ ] **Step 3: Fix SPEC.md §4.2 — add the semantics table**

Add a `| Field | Semantics |` table immediately after §4.2's closing ``` fence, with one row for
every `RunRecord` field the test named. Then **delete** the three prose paragraphs for `passed`,
`manifestIgnored`, and `mockFailures` that currently sit between the fence and `### 4.3`, moving
their text into the corresponding rows **verbatim** — same claims, same caveats, same
cross-references (`0.19.0+, §6.1b`, `§6.1d`, `reelier push` (§8) refuses to push it). Do not
paraphrase them and do not drop the `§`-references.

Rows required (match §4.1's voice — when present, when absent, what a consumer MUST NOT infer):

| Field | What the row must establish |
|---|---|
| `skill` | the skill's name as run |
| `startedAt`, `finishedAt` | ISO-8601 instants bounding the run; `ms` is duration, and per §4.1 duration is never an assertion input |
| `passed` | existing prose, moved verbatim |
| `skillContentSha256` | sha256 of the exact skill file that produced this run; when absent; that it identifies content, never authorship. Cross-reference the `/api/v1/runs` mention at SPEC.md:1415 rather than restating it |
| `manifestIgnored` | existing prose, moved verbatim |
| `mockFailures` | existing prose, moved verbatim |
| `steps` | one `StepRecord` per executed step, in execution order; forward-reference §4.1 |
| `totals` | name **every** sub-key (`steps`, `passed`, `unchecked`, `skipped`, `failed`, `ms`, `llmInputTokens`, `llmOutputTokens`) inside this one row, per the nested-key convention. Point at §4.3 for the honesty rule rather than restating it, and state plainly that `totals.unchecked` is never evidence of a passing check |

- [ ] **Step 4: Fix SPEC.md §4.1 — name the undocumented nested keys**

For each path the test reported, name the key backticked inside its top-level parent's existing row.
Expected minimum: extend the `write` row's `resource` sentence to name `id` and `version` and say
they are best-effort and individually absent rather than fabricated. Add whatever else the test
listed. **Do not add new rows** — nested keys belong in the parent's prose, which is the convention
the guard enforces.

- [ ] **Step 5: Run the test and confirm it passes**

```bash
npm test 2>&1 | grep "SPEC §4"
```

Expected: all four `SPEC §4.x` tests pass.

- [ ] **Step 6: Run the full suite — no regressions**

```bash
npm test 2>&1 | tail -8
```

Expected: `pass 1129`, `fail 0`, `skipped 1` (baseline 1125 pass + the 4 new tests). If any
previously-passing test now fails, stop and report rather than adjusting it.

- [ ] **Step 7: Commit**

```bash
git add test/spec-record-shape.test.ts SPEC.md docs/superpowers/plans/2026-07-31-spec-record-shape-drift-guard.md
git commit -m "test(spec): fail when a record field ships undocumented, and document RunRecord

SPEC.md 4.1 gained refs/stateCheck/dispatchedAt rows in 0.25.0-0.27.0, but
4.2 never had a semantics table at all -- skill, startedAt, finishedAt,
skillContentSha256, steps and every totals.* sub-key were undocumented, and
write.resource's id/version were never named. A third party implementing
from 4.2 could not know what the run record carries.

The guard parses src/runner.ts, SPEC's own interface blocks, and the
semantics tables with one TypeScript parser and asserts all three agree.
The types are the source of truth; SPEC is what changes when it fails."
```

---

## Task exit gate (from the wave plan)

- [ ] The guard fails on pre-edit SPEC and passes after — **evidence: the Step 2 failure output and
      the Step 5 pass output, both pasted into the report.**
- [ ] SPEC §4.1/§4.2 is a complete description of what this version emits — no field in
      `StepRecord`/`RunRecord` lacks documentation.
- [ ] Full suite green with no pre-existing test modified.

## Self-review notes

- **Spec coverage:** the wave plan's Task 0 has four bullets — diff live types vs SPEC (Step 1's
  interface-block test automates this permanently), document the missing fields (Steps 3-4),
  add the regression test (Step 1), verify fail-then-pass (Steps 2 and 5). All four are covered.
- **Scope:** the wave plan named `refs`/`stateCheck`/`write.dispatchedAt` as the gaps. They are
  already documented on `main` — verified 2026-07-31. The real gap is §4.2 and the nested keys, and
  this plan targets what is actually missing rather than what the wave plan predicted.
- **Type consistency:** the test defines `FieldNode`, `paths`, `leafPaths`, `shapeOf`, `section`,
  `fencedTs`, `tableRows` and uses exactly those names throughout. No production API is added.
