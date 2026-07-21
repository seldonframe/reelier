import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

// The test project (tsconfig.test.json) compiles src/ + test/ together into
// dist-test/{src,test}, so dist-test/test/compile-cli.test.js's "../src/cli.js"
// resolves to the freshly-compiled dist-test/src/cli.js — exercise the CLI as
// a real subprocess the way a user would, always reflecting the code under test.
const CLI_PATH = fileURLToPath(new URL("../src/cli.js", import.meta.url));

const SAMPLE_TRACE = [
  JSON.stringify({ t: "meta", seq: 0, name: "cli-demo", startedAt: "2026-01-01T00:00:00.000Z", wrapped: ["demo"] }),
  JSON.stringify({ t: "note", seq: 1, ts: "2026-01-01T00:00:00.000Z", text: "add two numbers" }),
  JSON.stringify({ t: "call", seq: 2, i: 0, ts: "2026-01-01T00:00:00.000Z", tool: "add", args: { a: 1, b: 2 } }),
  JSON.stringify({
    t: "result",
    seq: 3,
    i: 0,
    ok: true,
    ms: 3,
    body: { content: [{ type: "text", text: JSON.stringify({ result: 3 }) }] },
  }),
].join("\n") + "\n";

test("cli compile: writes a skill, refuses to overwrite without --force, and --force allows it", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-compile-cli-"));
  try {
    const tracePath = path.join(dir, "trace.jsonl");
    await writeFile(tracePath, SAMPLE_TRACE, "utf8");
    const outPath = path.join(dir, "out.skill.md");

    const first = await execFileAsync("node", [CLI_PATH, "compile", tracePath, "-o", outPath]);
    assert.match(first.stdout, /Wrote /);
    assert.match(first.stdout, /steps:\s+1/);

    const rendered = await readFile(outPath, "utf8");
    assert.match(rendered, /name: cli-demo/);

    // Second compile without --force must refuse and leave the file untouched.
    await assert.rejects(execFileAsync("node", [CLI_PATH, "compile", tracePath, "-o", outPath]), (err: unknown) => {
      const e = err as { code?: number; stderr?: string };
      assert.equal(e.code, 1);
      assert.match(e.stderr ?? "", /Refusing to overwrite/);
      return true;
    });

    // With --force it succeeds.
    const forced = await execFileAsync("node", [CLI_PATH, "compile", tracePath, "-o", outPath, "--force"]);
    assert.match(forced.stdout, /Wrote /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// --from-skill: Agent-Skills instruction skill + recorded trace → compiled
// deterministic skill carrying the source's identity. Steps come ONLY from
// the trace — never generated from the instruction text.
// ---------------------------------------------------------------------------

const SOURCE_SKILL = [
  "---",
  "name: demo-checklist",
  "description: Checks the demo add flow end to end.",
  "allowed-tools: Read, Bash",
  "---",
  "",
  "# Demo checklist",
  "",
  "1. Add the two numbers.",
  "2. Confirm the result is three.",
  "",
].join("\n");

test("cli compile --from-skill: carries name + description, records provenance, steps come only from the trace", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-from-skill-cli-"));
  try {
    const tracePath = path.join(dir, "trace.jsonl");
    await writeFile(tracePath, SAMPLE_TRACE, "utf8");
    const skillPath = path.join(dir, "demo-instructions.md");
    await writeFile(skillPath, SOURCE_SKILL, "utf8");

    const res = await execFileAsync("node", [CLI_PATH, "compile", tracePath, "--from-skill", skillPath], { cwd: dir });
    assert.match(res.stdout, /Wrote /);
    assert.match(res.stdout, /compiled from demo-instructions\.md \+ trace\.jsonl/);

    const rendered = await readFile(path.join(dir, "demo-checklist.skill.md"), "utf8");
    // Carried frontmatter identity (not the trace's meta name "cli-demo").
    assert.match(rendered, /^name: demo-checklist$/m);
    assert.match(rendered, /^description: Checks the demo add flow end to end\.$/m);
    // Provenance: preamble line + changelog line name both sources.
    assert.match(rendered, /Compiled from demo-instructions\.md \+ trace\.jsonl — every step below comes from that recorded trace; none were generated from the instruction text\./);
    assert.match(rendered, /— compiled from demo-instructions\.md \+ trace\.jsonl \(1 calls, 1 steps\)/);
    // Steps come only from the trace: exactly the one recorded call, and no
    // step invented from the instruction text.
    assert.equal((rendered.match(/### Step /g) ?? []).length, 1);
    assert.match(rendered, /- action: add \{"a":1,"b":2\}/);
    assert.ok(!rendered.includes("Confirm the result"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli compile --from-skill: name collision with an existing file suffixes the compiled name instead of overwriting", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-from-skill-collide-"));
  try {
    const tracePath = path.join(dir, "trace.jsonl");
    await writeFile(tracePath, SAMPLE_TRACE, "utf8");
    const skillPath = path.join(dir, "demo-instructions.md");
    await writeFile(skillPath, SOURCE_SKILL, "utf8");
    const existingPath = path.join(dir, "demo-checklist.skill.md");
    await writeFile(existingPath, "existing content — must stay byte-identical", "utf8");

    const res = await execFileAsync("node", [CLI_PATH, "compile", tracePath, "--from-skill", skillPath], { cwd: dir });
    assert.match(res.stdout, /collides with existing demo-checklist\.skill\.md — compiled skill is named 'demo-checklist-2'/);

    const suffixed = await readFile(path.join(dir, "demo-checklist-2.skill.md"), "utf8");
    assert.match(suffixed, /^name: demo-checklist-2$/m);
    // The pre-existing file was never touched.
    assert.equal(await readFile(existingPath, "utf8"), "existing content — must stay byte-identical");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli compile --from-skill: no trace given exits non-zero with the honest record-one-first error", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-from-skill-notrace-"));
  try {
    const skillPath = path.join(dir, "demo-instructions.md");
    await writeFile(skillPath, SOURCE_SKILL, "utf8");

    await assert.rejects(
      execFileAsync("node", [CLI_PATH, "compile", "--from-skill", skillPath], { cwd: dir }),
      (err: unknown) => {
        const e = err as { code?: number; stderr?: string };
        assert.equal(e.code, 1);
        assert.match(e.stderr ?? "", /--from-skill needs a recorded run to compile from — Reelier never generates steps from instruction text\./);
        assert.match(e.stderr ?? "", /reelier mcp --wrap "<your mcp server command>"/);
        assert.match(e.stderr ?? "", /reelier compile <trace\.jsonl> --from-skill <SKILL\.md>/);
        assert.match(e.stderr ?? "", /`reelier scan` lists replayable ones/);
        return true;
      }
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli compile --from-skill: refuses -o pointing at the source instruction skill (even with --force)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-from-skill-samefile-"));
  try {
    const tracePath = path.join(dir, "trace.jsonl");
    await writeFile(tracePath, SAMPLE_TRACE, "utf8");
    const skillPath = path.join(dir, "demo-instructions.md");
    await writeFile(skillPath, SOURCE_SKILL, "utf8");

    await assert.rejects(
      execFileAsync("node", [CLI_PATH, "compile", tracePath, "--from-skill", skillPath, "-o", skillPath, "--force"], { cwd: dir }),
      (err: unknown) => {
        const e = err as { code?: number; stderr?: string };
        assert.equal(e.code, 1);
        assert.match(e.stderr ?? "", /Refusing to write the compiled skill over its own source/);
        return true;
      }
    );
    // The source skill was never touched.
    assert.equal(await readFile(skillPath, "utf8"), SOURCE_SKILL);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
