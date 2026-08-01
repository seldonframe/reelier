import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import { expectMac, expectFieldMac, macEquals, mintExpectKey } from "../src/expect-mac.js";

/**
 * The `expect:` commitments (0.25.0) and the per-field commitments (0.26.0) are HMACs under a
 * secret held in the local keystore. Comparing them with `===` short-circuits on the first
 * differing character, which leaks a timing signal about a keyed value.
 *
 * Severity here is genuinely low: forging `step.expect.pre` requires write access to the skill
 * file, and the approval hash already covers `expect:` at a boundary no flag overrides. This is
 * defense in depth on a secret-keyed comparison, not a break. It is also the first thing a
 * security reviewer greps for, and `AUDIT-COMPLIANCE-1.0` §4.4 specs timing-safe comparison as a
 * MUST for exactly this class of check.
 *
 * Length is NOT secret: a MAC is a fixed-width `hmac-sha256:<64 hex>` string, so returning early
 * on a length mismatch reveals nothing an attacker does not already know from the format.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

test("macEquals is true for identical MACs and false for different ones", () => {
  const { key } = mintExpectKey();
  const a = expectMac(key, "http.get", { "body.total": 42 });
  const b = expectMac(key, "http.get", { "body.total": 42 });
  const c = expectMac(key, "http.get", { "body.total": 43 });

  assert.equal(a, b, "same key + same projection must produce the same MAC (pinned)");
  assert.equal(macEquals(a, b), true);
  assert.equal(macEquals(a, c), false);
});

test("macEquals never throws on a length mismatch (crypto.timingSafeEqual does)", () => {
  const { key } = mintExpectKey();
  const real = expectMac(key, "http.get", { "body.total": 42 });

  // A hand-edited or truncated `expect.pre` reaches this comparison as an ordinary string.
  // timingSafeEqual throws on unequal buffer lengths, so a naive swap would turn a mismatch
  // into a crash — and a crash in the state check is not a mismatch verdict, it is an outage.
  for (const bogus of ["", "hmac-sha256:", "hmac-sha256:abcd", real + "0", real.slice(0, -1)]) {
    assert.equal(macEquals(real, bogus), false, `expected false, not a throw, for ${JSON.stringify(bogus.slice(0, 24))}`);
    assert.equal(macEquals(bogus, real), false, "argument order must not matter");
  }
});

test("macEquals tolerates non-string input without throwing", () => {
  const { key } = mintExpectKey();
  const real = expectMac(key, "http.get", { "body.total": 42 });
  for (const bogus of [undefined, null, 42, {}, []] as unknown[]) {
    assert.equal(macEquals(real, bogus as string), false);
    assert.equal(macEquals(bogus as string, real), false);
  }
});

test("per-field MACs compare through macEquals too", () => {
  const { key } = mintExpectKey();
  const a = expectFieldMac(key, "http.get", "body.total", 42);
  const b = expectFieldMac(key, "http.get", "body.total", 42);
  const c = expectFieldMac(key, "http.get", "body.total", 43);
  assert.equal(macEquals(a, b), true);
  assert.equal(macEquals(a, c), false);
});

/**
 * Source guard: no keyed MAC may be compared with `===`/`!==` anywhere. The behavior tests above
 * cannot catch a NEW comparison site added later, and a per-field diagnosis site (runner.ts, added
 * in 0.26.0) was missed on the first pass at exactly this fix — so the lint is the part that
 * actually holds.
 */
const MAC_PRODUCERS = new Set(["expectMac", "expectFieldMac"]);

function rawMacComparisons(relPath: string): string[] {
  const file = path.join(REPO_ROOT, relPath);
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true);
  const offenders: string[] = [];

  const callsMacProducer = (node: ts.Node): boolean => {
    let found = false;
    const walk = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && MAC_PRODUCERS.has(n.expression.text)) found = true;
      ts.forEachChild(n, walk);
    };
    walk(node);
    return found;
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) &&
      (callsMacProducer(node.left) || callsMacProducer(node.right))
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      offenders.push(`${relPath}:${line + 1} — ${node.getText().replace(/\s+/g, " ").slice(0, 100)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return offenders;
}

test("no keyed MAC is compared with === or !==", () => {
  const offenders = [...rawMacComparisons("src/runner.ts"), ...rawMacComparisons("src/cli.ts")];
  assert.deepEqual(
    offenders,
    [],
    `keyed MAC compared with a short-circuiting operator — route it through macEquals:\n  ${offenders.join("\n  ")}`,
  );
});
