import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

/**
 * SPEC.md §4.6.1 must name every sibling the push body actually carries.
 *
 * Sibling fields ride alongside `record` in the push body and are NOT covered by
 * `digestSha256(record)` — so a signature that verifies says nothing about them. §4.6.1 is the
 * list a consumer reads to know which is which. If a future release adds a sibling and the table
 * stays silent, that consumer is left crediting the signature with covering a field it never
 * touched, which is the overclaim never-list #8 forbids.
 *
 * Same discipline as test/spec-record-shape.test.ts: a pure lint over two sources already in the
 * repo (src/push.ts and SPEC.md), no network, no fixtures. The code is the source of truth; when
 * this test fails, SPEC.md is what changes.
 */

/** Two levels up from dist-test/test/ — same derivation as test/spec-record-shape.test.ts. */
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** `record` is the digest input itself, never a sibling — it is the one key excluded by design. */
const DIGEST_INPUT_KEY = "record";

/**
 * Collect property names from an object literal, descending through the
 * `...(cond ? { key } : {})` spread form the push body uses for every optional sibling. Anything
 * else (a spread of an identifier, a computed key) is reported so it can never be silently missed.
 */
function collectKeys(obj: ts.ObjectLiteralExpression, unresolved: string[]): string[] {
  const keys: string[] = [];
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
      const name = prop.name;
      if (ts.isIdentifier(name) || ts.isStringLiteral(name)) keys.push(name.text);
      else unresolved.push(prop.getText());
      continue;
    }
    if (ts.isSpreadAssignment(prop)) {
      let expr: ts.Expression = prop.expression;
      while (ts.isParenthesizedExpression(expr)) expr = expr.expression;
      if (ts.isConditionalExpression(expr)) {
        for (const branch of [expr.whenTrue, expr.whenFalse]) {
          let b: ts.Expression = branch;
          while (ts.isParenthesizedExpression(b)) b = b.expression;
          if (ts.isObjectLiteralExpression(b)) keys.push(...collectKeys(b, unresolved));
        }
        continue;
      }
      unresolved.push(prop.getText());
      continue;
    }
    unresolved.push(prop.getText());
  }
  return keys;
}

/** The push body is the single `JSON.stringify({...})` object literal that carries `record`. */
function pushBodyKeys(): { keys: string[]; unresolved: string[] } {
  const file = path.join(REPO_ROOT, "src", "push.ts");
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const unresolved: string[] = [];
  const found: string[][] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "stringify" &&
      node.arguments.length > 0 &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      const keys = collectKeys(node.arguments[0], unresolved);
      if (keys.includes(DIGEST_INPUT_KEY)) found.push(keys);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  assert.equal(
    found.length,
    1,
    `expected exactly one JSON.stringify body carrying \`${DIGEST_INPUT_KEY}\` in src/push.ts, found ${found.length}`,
  );
  return { keys: found[0], unresolved };
}

/** Every backticked identifier in the first column of §4.6.1's table. */
function specSiblings(): string[] {
  const spec = readFileSync(path.join(REPO_ROOT, "SPEC.md"), "utf8");
  const start = spec.indexOf("#### 4.6.1");
  assert.notEqual(start, -1, "SPEC.md §4.6.1 is missing");
  const end = spec.indexOf("#### 4.6.2", start);
  assert.notEqual(end, -1, "SPEC.md §4.6.2 is missing (used as §4.6.1's end boundary)");

  const names = new Set<string>();
  for (const line of spec.slice(start, end).split("\n")) {
    if (!line.startsWith("|")) continue;
    const firstCol = line.split("|")[1] ?? "";
    if (/^\s*(Sibling|-+|:?-+:?)\s*$/.test(firstCol)) continue;
    for (const m of firstCol.matchAll(/`([A-Za-z][A-Za-z0-9_]*)`/g)) names.add(m[1]);
  }
  return [...names].sort();
}

test("§4.6.1 names every push-body sibling, and invents none", () => {
  const { keys, unresolved } = pushBodyKeys();
  assert.deepEqual(unresolved, [], `unrecognized push-body property form(s) — teach the parser: ${unresolved.join(" | ")}`);

  const actual = [...new Set(keys.filter((k) => k !== DIGEST_INPUT_KEY))].sort();
  const documented = specSiblings();

  const undocumented = actual.filter((k) => !documented.includes(k));
  const phantom = documented.filter((k) => !actual.includes(k));

  assert.deepEqual(
    undocumented,
    [],
    `push body carries sibling(s) §4.6.1 does not name: ${undocumented.join(", ")} — ` +
      `a consumer would credit the signature with covering them. Document them in SPEC.md §4.6.1.`,
  );
  assert.deepEqual(
    phantom,
    [],
    `§4.6.1 names sibling(s) the push body no longer carries: ${phantom.join(", ")} — remove them from SPEC.md.`,
  );
});

test("`record` is the digest input and is never listed as a sibling", () => {
  assert.ok(
    !specSiblings().includes(DIGEST_INPUT_KEY),
    "§4.6.1 lists `record` as a sibling — it is the digest input itself (§0.2), not a sibling",
  );
});

test("§0.2's whole-record digest rule still holds in src/push.ts", () => {
  const file = path.join(REPO_ROOT, "src", "push.ts");
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);

  const args: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "digestSha256") {
      args.push(node.arguments.map((a) => a.getText()).join(", "));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  assert.ok(args.length > 0, "no digestSha256 call found in src/push.ts");
  for (const arg of args) {
    assert.equal(
      arg,
      "record",
      `digestSha256 is called with \`${arg}\` — §0.2 requires the digest input be the complete record, ` +
        `never an enumerated subset (a subset silently stops covering the next additive field).`,
    );
  }
});
