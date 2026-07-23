import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  discoverSkillFiles,
  renderCiWorkflow,
  writeCiWorkflow,
  ciWorkflowPath,
  PLACEHOLDER_SKILL_PATH,
} from "../src/ci-scaffold.js";

test("discoverSkillFiles: finds *.skill.md files, excludes node_modules/.git, sorted", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-ci-scan-"));
  try {
    await mkdir(path.join(dir, "examples", "portfolio"), { recursive: true });
    await mkdir(path.join(dir, "node_modules", "some-pkg"), { recursive: true });
    await mkdir(path.join(dir, ".git", "objects"), { recursive: true });
    await writeFile(path.join(dir, "examples", "portfolio", "b.skill.md"), "---\nname: b\n---\n");
    await writeFile(path.join(dir, "examples", "portfolio", "a.skill.md"), "---\nname: a\n---\n");
    await writeFile(path.join(dir, "node_modules", "some-pkg", "fake.skill.md"), "---\nname: fake\n---\n");
    await writeFile(path.join(dir, ".git", "objects", "fake2.skill.md"), "---\nname: fake2\n---\n");
    await writeFile(path.join(dir, "not-a-skill.md"), "nope");

    const found = await discoverSkillFiles(dir);
    assert.deepEqual(found, ["examples/portfolio/a.skill.md", "examples/portfolio/b.skill.md"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("discoverSkillFiles: missing directory yields an empty list, never throws", async () => {
  const found = await discoverSkillFiles(path.join(tmpdir(), "reelier-ci-scan-does-not-exist-xyz"));
  assert.deepEqual(found, []);
});

test("renderCiWorkflow: with discovered skills — triggers, permissions, matrix", () => {
  const yaml = renderCiWorkflow(["examples/a.skill.md", "examples/b.skill.md"]);
  assert.match(yaml, /pull_request: \{\}/);
  assert.match(yaml, /schedule:/);
  assert.match(yaml, /workflow_dispatch: \{\}/);
  assert.match(yaml, /contents: read/);
  assert.match(yaml, /pull-requests: write/);
  assert.match(yaml, /id-token: write/);
  assert.match(yaml, /uses: seldonframe\/reelier@v1/);
  assert.match(yaml, /- "examples\/a\.skill\.md"/);
  assert.match(yaml, /- "examples\/b\.skill\.md"/);
  assert.doesNotMatch(yaml, new RegExp(PLACEHOLDER_SKILL_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("renderCiWorkflow: zero skills writes a clearly-marked placeholder, never a silently-invented path", () => {
  const yaml = renderCiWorkflow([]);
  assert.match(yaml, new RegExp(PLACEHOLDER_SKILL_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(yaml, /reelier init/);
  assert.match(yaml, /No \*\.skill\.md files were found/);
});

test("writeCiWorkflow: writes the file, discovers skills, refuses to overwrite without --force, --force allows it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-ci-write-"));
  try {
    await mkdir(path.join(dir, "examples"), { recursive: true });
    await writeFile(path.join(dir, "examples", "demo.skill.md"), "---\nname: demo\n---\n");

    const first = await writeCiWorkflow(dir, dir, false);
    assert.equal(first.wrote, true);
    assert.equal(first.refused, false);
    assert.deepEqual(first.skillPaths, ["examples/demo.skill.md"]);
    assert.equal(first.path, ciWorkflowPath(dir));

    const written = await readFile(first.path, "utf8");
    assert.match(written, /examples\/demo\.skill\.md/);

    // Second call without --force must refuse and leave the file untouched.
    const second = await writeCiWorkflow(dir, dir, false);
    assert.equal(second.wrote, false);
    assert.equal(second.refused, true);

    const untouched = await readFile(first.path, "utf8");
    assert.equal(untouched, written);

    // Add a second skill, then --force regenerates and picks it up.
    await writeFile(path.join(dir, "examples", "demo2.skill.md"), "---\nname: demo2\n---\n");
    const third = await writeCiWorkflow(dir, dir, true);
    assert.equal(third.wrote, true);
    assert.equal(third.refused, false);
    assert.deepEqual(third.skillPaths, ["examples/demo.skill.md", "examples/demo2.skill.md"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeCiWorkflow: zero skills still writes the workflow with the placeholder path", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-ci-write-empty-"));
  try {
    const result = await writeCiWorkflow(dir, dir, false);
    assert.equal(result.wrote, true);
    assert.deepEqual(result.skillPaths, []);
    const written = await readFile(result.path, "utf8");
    assert.match(written, new RegExp(PLACEHOLDER_SKILL_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
