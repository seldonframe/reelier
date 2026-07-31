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
