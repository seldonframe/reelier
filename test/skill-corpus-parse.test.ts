import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkill, type Skill } from "../src/skill.js";
import { serializeSkill } from "../src/writeback.js";

/**
 * The whole shipped skill corpus, swept in one place.
 *
 * Every `*.skill.md` under `examples/` and `skills/` MUST parse, and MUST
 * survive `parseSkill → serializeSkill → parseSkill` unchanged. Individual
 * fixtures were covered before this sweep existed (e.g.
 * test/writeback.test.ts's sf-post-deploy-smoke round-trip), but nothing
 * parsed them ALL — so "the corpus still parses" was a claim no test could
 * check. It is the before/after picture for any parser change: a new step
 * key, a new grammar rule, a stricter rejection all have to leave every one
 * of these files byte-stable through a round-trip.
 */

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** A floor, not an equality: adding an example must never fail this suite. */
const MIN_CORPUS_FILES = 36;

function skillFilesUnder(dir: string): string[] {
  const root = path.join(REPO_ROOT, dir);
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".skill.md"))
    .map((e) => path.join((e as unknown as { parentPath?: string; path?: string }).parentPath ?? (e as unknown as { path: string }).path, e.name))
    .sort();
}

const corpus = [...skillFilesUnder("examples"), ...skillFilesUnder("skills")].sort();

/** A skill with every step's source-line pointer dropped — see the round-trip assertion below. */
function withoutLines(skill: Skill): unknown {
  return { ...skill, steps: skill.steps.map(({ line: _line, ...rest }) => rest) };
}

test(`the shipped skill corpus is at least ${MIN_CORPUS_FILES} files`, () => {
  assert.ok(
    corpus.length >= MIN_CORPUS_FILES,
    `expected at least ${MIN_CORPUS_FILES} *.skill.md files under examples/ and skills/, found ${corpus.length}:\n` +
      corpus.map((f) => `  ${path.relative(REPO_ROOT, f)}`).join("\n")
  );
});

for (const file of corpus) {
  const rel = path.relative(REPO_ROOT, file).split(path.sep).join("/");

  test(`corpus: ${rel} parses and round-trips unchanged`, async () => {
    const source = await readFile(file, "utf8");

    const skill = parseSkill(source);
    assert.ok(skill.steps.length > 0, `${rel} parsed with zero steps`);

    const serialized = serializeSkill(skill);
    const reparsed = parseSkill(serialized);

    // Same skill, field for field — the parse is not perturbed by the trip.
    // `Step.line` is excluded, and only that: it is a pointer into the SOURCE
    // text, and serializeSkill canonicalizes step-block formatting (it does
    // not promise a byte-for-byte copy of hand-written input — SPEC §3.8), so
    // a hand-formatted file legitimately re-parses at a different line. Every
    // field that carries meaning is compared.
    assert.deepEqual(withoutLines(reparsed), withoutLines(skill), `${rel} did not survive parse → serialize → parse`);
    // And idempotent from the second pass onward (SPEC §3.8).
    assert.equal(serializeSkill(reparsed), serialized, `${rel} re-serialize is not byte-stable`);
  });
}
