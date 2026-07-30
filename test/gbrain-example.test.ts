// Grammar-validity guard for examples/gbrain/gbrain-capture-enrich.skill.md:
// parses the example with the real parser (src/skill.ts) and pins its step
// count, tool names, and effect classifications so a future edit to the
// example (or a future SPEC.md/parser change) can't silently drift the
// recon facts the example was authored to demonstrate — most importantly
// the fail-closed rung-6 default-deny classification on gbrain's
// unrecognized `extract_entities`/`extraction_pending` verbs (see
// examples/gbrain/README.md "Fail-closed by design").

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseSkill } from "../src/skill.js";

const SKILL_PATH = path.join(process.cwd(), "examples", "gbrain", "gbrain-capture-enrich.skill.md");

test("examples/gbrain/gbrain-capture-enrich.skill.md parses with the real SKILL.md grammar", async () => {
  const source = await readFile(SKILL_PATH, "utf8");
  const skill = parseSkill(source);

  assert.equal(skill.name, "gbrain-capture-enrich");
  assert.equal(skill.steps.length, 4);

  const [capture, extract, pending, backlinks] = skill.steps;

  assert.equal(capture.actionTool, "put_page");
  assert.equal(capture.effect, "idempotent-write");

  assert.equal(extract.actionTool, "extract_entities");
  assert.equal(extract.effect, "destructive");

  assert.equal(pending.actionTool, "extraction_pending");
  assert.equal(pending.effect, "destructive");

  assert.equal(backlinks.actionTool, "get_backlinks");
  assert.equal(backlinks.effect, "read");
  assert.ok(
    // Live-behavior correction (e2e run 30534736372): quarantined stubs
    // write NO backlink rows, so the self-verifying punchline lives on the
    // extraction_pending step (rows carry extracted_from = source slug).
    pending.asserts.some((a) => a.includes('body contains "reelier-demo-page"')),
    "extraction_pending step must carry the self-verifying attribution assert"
  );

  // Neither field can be honestly produced without a live gbrain instance to
  // stamp against (see the file's own HONESTY NOTE) — this test also guards
  // against either being added without a real recording behind it.
  assert.equal(skill.manifest, undefined);
  for (const step of skill.steps) {
    assert.equal(step.approve, undefined);
  }
});
