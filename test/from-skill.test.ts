import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInstructionSkillFrontmatter } from "../src/from-skill.js";

// ---------------------------------------------------------------------------
// Tolerant reads — real Agent-Skills frontmatter carries fields Reelier
// doesn't know (hyphenated keys, nested metadata); only name + description
// are carried, everything else is ignored without complaint.
// ---------------------------------------------------------------------------

test("from-skill frontmatter: parses name + description, tolerating unknown Agent-Skills fields", () => {
  const src = [
    "---",
    "name: deploy-check",
    'description: "Checks the deploy end to end."',
    "allowed-tools: Read, Bash",
    "license: MIT",
    "metadata:",
    "  version: 1.0.0",
    "---",
    "",
    "# Deploy check",
    "",
    "1. Open the dashboard.",
    "2. Confirm the deploy is green.",
  ].join("\n");
  const fm = parseInstructionSkillFrontmatter(src);
  assert.equal(fm.name, "deploy-check");
  assert.equal(fm.description, "Checks the deploy end to end.");
});

test("from-skill frontmatter: joins a block-scalar description into one line", () => {
  const src = [
    "---",
    "name: long-desc",
    "description: >",
    "  Checks the deploy",
    "  end to end.",
    "---",
    "body",
  ].join("\n");
  const fm = parseInstructionSkillFrontmatter(src);
  assert.equal(fm.description, "Checks the deploy end to end.");
});

test("from-skill frontmatter: single-quoted values are unquoted", () => {
  const src = ["---", "name: 'quoted-name'", "description: 'A quoted description.'", "---"].join("\n");
  const fm = parseInstructionSkillFrontmatter(src);
  assert.equal(fm.name, "quoted-name");
  assert.equal(fm.description, "A quoted description.");
});

// ---------------------------------------------------------------------------
// Honest errors — a missing/malformed input is an explicit error, never a
// guessed default (can't-fail law).
// ---------------------------------------------------------------------------

test("from-skill frontmatter: no fence at all errors honestly", () => {
  assert.throws(
    () => parseInstructionSkillFrontmatter("# Just a markdown file\n\nNo frontmatter here."),
    /has no frontmatter/
  );
});

test("from-skill frontmatter: unclosed fence errors honestly", () => {
  assert.throws(
    () => parseInstructionSkillFrontmatter("---\nname: x\ndescription: y\nno closing fence"),
    /never closed/
  );
});

test("from-skill frontmatter: missing name errors honestly", () => {
  assert.throws(() => parseInstructionSkillFrontmatter("---\ndescription: only a description\n---\n"), /no usable 'name'/);
});

test("from-skill frontmatter: missing description errors honestly", () => {
  assert.throws(() => parseInstructionSkillFrontmatter("---\nname: only-a-name\n---\n"), /no usable 'description'/);
});

test("from-skill frontmatter: empty description value errors honestly (never an empty carry)", () => {
  assert.throws(() => parseInstructionSkillFrontmatter("---\nname: n\ndescription:\n---\n"), /no usable 'description'/);
});

test("from-skill frontmatter: a path-hostile name is rejected, never sanitized silently", () => {
  assert.throws(
    () => parseInstructionSkillFrontmatter("---\nname: ../../etc/passwd\ndescription: d\n---\n"),
    /unsafe for a file name/
  );
});
