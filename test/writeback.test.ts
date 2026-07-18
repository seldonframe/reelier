import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, readdir, writeFile as fsWriteFile, rename as fsRename, unlink as fsUnlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkill } from "../src/skill.js";
import { applyWriteback, serializeSkill, writeFileAtomic, type AtomicWriteFsOps } from "../src/writeback.js";
import { compile, renderSkillMd } from "../src/compile.js";
import type { TraceRecord } from "../src/recorder.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

function meta(name: string): TraceRecord {
  return { t: "meta", seq: 0, name, startedAt: "2026-01-01T00:00:00.000Z", wrapped: ["demo"] };
}
function note(seq: number, text: string): TraceRecord {
  return { t: "note", seq, ts: "2026-01-01T00:00:00.000Z", text };
}
function call(seq: number, i: number, tool: string, args: unknown): TraceRecord {
  return { t: "call", seq, i, ts: "2026-01-01T00:00:00.000Z", tool, args };
}
function mcpJsonResult(value: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}
function result(seq: number, i: number, ok: boolean, body: unknown): TraceRecord {
  return { t: "result", seq, i, ok, ms: 1, body };
}

test("serializeSkill round-trips the compiled-skill fixture (parse -> serialize -> parse is stable)", () => {
  const records: TraceRecord[] = [
    meta("roundtrip-skill"),
    note(1, "create a note"),
    call(2, 0, "create_note", { text: "hello world" }),
    result(3, 0, true, mcpJsonResult({ id: "note_rt1", text: "hello world" })),
    call(4, 1, "get_note", { id: "note_rt1" }), // no note -> open question
    result(5, 1, false, mcpJsonResult({ error: "not found" })), // not-ok -> open question
  ];
  const compiled = compile(records);
  const rendered = renderSkillMd(compiled, "roundtrip.jsonl");

  const skill = parseSkill(rendered);
  const reserialized = serializeSkill(skill);
  const reparsed = parseSkill(reserialized);

  assert.equal(reparsed.name, skill.name);
  assert.equal(reparsed.steps.length, skill.steps.length);
  assert.deepEqual(reparsed.steps[1].actionArgs, { id: "{{id}}" });

  // Idempotent: serializing the re-parsed skill again produces byte-identical output.
  const twice = serializeSkill(reparsed);
  assert.equal(twice, reserialized);

  // The trailing "## Open questions" / "## Changelog" sections survive verbatim.
  assert.match(reserialized, /## Open questions/);
  assert.match(reserialized, /## Changelog/);
  assert.match(reserialized, /compiled from roundtrip\.jsonl/);
});

test("serializeSkill round-trips the real sf-post-deploy-smoke.skill.md fixture", async () => {
  const fixturePath = path.join(REPO_ROOT, "skills", "sf-post-deploy-smoke.skill.md");
  const source = await readFile(fixturePath, "utf8");
  const skill = parseSkill(source);

  const rendered = serializeSkill(skill);
  const reparsed = parseSkill(rendered);

  assert.equal(reparsed.name, "sf-post-deploy-smoke");
  assert.equal(reparsed.steps.length, 4);
  assert.deepEqual(reparsed.steps.map((s) => s.title), skill.steps.map((s) => s.title));
  assert.deepEqual(reparsed.steps.map((s) => s.asserts), skill.steps.map((s) => s.asserts));

  // Idempotent re-serialize.
  assert.equal(serializeSkill(reparsed), rendered);

  // The HTML-comment preamble note is preserved verbatim.
  assert.match(rendered, /routes below were curled live on 2026-07-17/);
});

test("applyWriteback patches a step's asserts/binds, writes the file, and appends a changelog line (section created if absent)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-writeback-"));
  try {
    const source = `---
name: heal-me
description: a skill with one step to heal
---

# Heal me

## Steps

### Step 1 — get a note
- intent: fetch a note
- action: http.get {"url": "https://example.com/note"}
- assert: status == 200
- bind: id = json.id
- effect: read
`;
    const skillPath = path.join(dir, "heal-me.skill.md");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(skillPath, source, "utf8");

    const skill = parseSkill(source);
    assert.equal(skill.trailing, ""); // no pre-existing "## Changelog"

    await applyWriteback({
      skillPath,
      skill,
      stepN: 1,
      level: 1,
      patch: { asserts: ["status == 200"], binds: ["id = json.note.id"] },
      reason: "the id moved under a 'note' wrapper object",
    });

    const written = await readFile(skillPath, "utf8");
    assert.match(written, /bind: id = json\.note\.id/);
    assert.match(written, /## Changelog/);
    assert.match(written, /L1 heal, step 1 \(get a note\): the id moved under a 'note' wrapper object/);

    // Round-trips cleanly, and the in-memory skill was mutated too.
    const reparsed = parseSkill(written);
    assert.deepEqual(reparsed.steps[0].binds, ["id = json.note.id"]);
    assert.deepEqual(skill.steps[0].binds, ["id = json.note.id"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("applyWriteback appends to an existing '## Changelog' section rather than creating a duplicate", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-writeback-"));
  try {
    const source = `---
name: heal-again
description: a skill already healed once
---

## Steps

### Step 1 — get a note
- intent: fetch a note
- action: http.get {"url": "https://example.com/note"}
- assert: status == 200
- effect: read

## Changelog

- 2026-01-01 — compiled from trace.jsonl (1 calls, 1 steps)
`;
    const skillPath = path.join(dir, "heal-again.skill.md");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(skillPath, source, "utf8");

    const skill = parseSkill(source);
    await applyWriteback({
      skillPath,
      skill,
      stepN: 1,
      level: 2,
      patch: { asserts: ["status == 201"], binds: [], args: { url: "https://example.com/note?v=2" } },
      reason: "endpoint now returns 201",
    });

    const written = await readFile(skillPath, "utf8");
    const changelogOccurrences = written.match(/## Changelog/g) ?? [];
    assert.equal(changelogOccurrences.length, 1);
    assert.match(written, /compiled from trace\.jsonl/); // original line preserved
    assert.match(written, /L2 heal, step 1 \(get a note\): endpoint now returns 201/); // new line appended
    assert.match(written, /"url":"https:\/\/example\.com\/note\?v=2"/);

    const reparsed = parseSkill(written);
    assert.deepEqual(reparsed.steps[0].asserts, ["status == 201"]);
    assert.deepEqual(reparsed.steps[0].actionArgs, { url: "https://example.com/note?v=2" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Atomic write-back: write-temp-then-rename, so a torn/partial skill file is
// unrepresentable, with a Windows-shaped EEXIST/EPERM fallback.
// ---------------------------------------------------------------------------

/** List any stray `<name>.tmp-*` files left in `dir` — should always be empty after writeFileAtomic settles. */
async function listTempFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((e) => /\.tmp-/.test(e));
}

test("writeFileAtomic: content after write equals the input, and no temp file is left behind on success", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-atomic-"));
  try {
    const target = path.join(dir, "skill.skill.md");
    await writeFileAtomic(target, "hello world");
    assert.equal(await readFile(target, "utf8"), "hello world");
    assert.deepEqual(await listTempFiles(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeFileAtomic: overwrites an existing target file completely (rename-over-existing happy path)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-atomic-"));
  try {
    const target = path.join(dir, "skill.skill.md");
    await fsWriteFile(target, "old content", "utf8");
    await writeFileAtomic(target, "new content");
    assert.equal(await readFile(target, "utf8"), "new content");
    assert.deepEqual(await listTempFiles(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeFileAtomic: falls back to unlink-then-rename when the first rename throws EEXIST (simulated Windows behavior)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-atomic-"));
  try {
    const target = path.join(dir, "skill.skill.md");
    await fsWriteFile(target, "old content", "utf8");

    let renameCalls = 0;
    let unlinkCalls: string[] = [];
    const mockOps: AtomicWriteFsOps = {
      writeFile: fsWriteFile,
      unlink: (async (p: string) => {
        unlinkCalls.push(p);
        return fsUnlink(p);
      }) as typeof fsUnlink,
      rename: (async (from: string, to: string) => {
        renameCalls++;
        if (renameCalls === 1) {
          const err = new Error("EEXIST: file already exists") as NodeJS.ErrnoException;
          err.code = "EEXIST";
          throw err;
        }
        return fsRename(from, to);
      }) as typeof fsRename,
    };

    await writeFileAtomic(target, "new content via fallback", mockOps);

    assert.equal(renameCalls, 2, "expected the first rename to fail, then a retry after unlinking the target");
    assert.ok(unlinkCalls.includes(target), "the fallback must unlink the target before retrying rename");
    assert.equal(await readFile(target, "utf8"), "new content via fallback");
    assert.deepEqual(await listTempFiles(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeFileAtomic: falls back on EPERM too, retries exactly once, and a second failure propagates with the temp file still cleaned up", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-atomic-"));
  try {
    const target = path.join(dir, "skill.skill.md");
    await fsWriteFile(target, "old content", "utf8");

    let renameCalls = 0;
    const mockOps: AtomicWriteFsOps = {
      writeFile: fsWriteFile,
      unlink: fsUnlink,
      rename: (async () => {
        renameCalls++;
        const err = new Error("EPERM: operation not permitted") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      }) as typeof fsRename,
    };

    await assert.rejects(() => writeFileAtomic(target, "will not land", mockOps), /EPERM/);
    // Retried exactly once (the fallback's own unlink-then-rename), not looped further.
    assert.equal(renameCalls, 2);
    // The temp file is still cleaned up despite the permanent failure — never left behind.
    assert.deepEqual(await listTempFiles(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeFileAtomic: cleans up the temp file in the finally branch even when rename fails for an unrecognized reason", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-atomic-"));
  try {
    const target = path.join(dir, "skill.skill.md");
    const mockOps: AtomicWriteFsOps = {
      writeFile: fsWriteFile,
      unlink: fsUnlink,
      rename: (async () => {
        const err = new Error("ENOSPC: no space left on device") as NodeJS.ErrnoException;
        err.code = "ENOSPC";
        throw err;
      }) as typeof fsRename,
    };

    await assert.rejects(() => writeFileAtomic(target, "never lands", mockOps), /ENOSPC/);
    assert.deepEqual(await listTempFiles(dir), []);
    // The target itself was never created (write never got past the temp file + rename attempt).
    await assert.rejects(() => readFile(target, "utf8"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("applyWriteback (end-to-end via the escalation write-back path) never leaves a temp file behind", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-writeback-atomic-"));
  try {
    const source = `---
name: atomic-heal
description: a skill to heal atomically
---

## Steps

### Step 1 — get a note
- intent: fetch a note
- action: http.get {"url": "https://example.com/note"}
- assert: status == 200
- effect: read
`;
    const skillPath = path.join(dir, "atomic-heal.skill.md");
    await fsWriteFile(skillPath, source, "utf8");
    const skill = parseSkill(source);

    await applyWriteback({
      skillPath,
      skill,
      stepN: 1,
      level: 1,
      patch: { asserts: ["status == 200"], binds: [] },
      reason: "no-op heal for the atomic write-back test",
    });

    const written = await readFile(skillPath, "utf8");
    assert.equal(written, serializeSkill(skill));
    assert.deepEqual(await listTempFiles(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
