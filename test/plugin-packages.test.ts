import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

// Same resolution convention as test/skill-version-pin.test.ts: the suite
// always runs from the repo root under `npm test`.
const repoRoot = process.cwd();
const SCRIPT = path.join(repoRoot, "scripts", "build-plugin-packages.mjs");
const SKILL_SOURCE = path.join(repoRoot, "integrations", "skills", "reelier-replay", "SKILL.md");
const packageVersion = (JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as { version: string }).version;

const ALLOWED_MANIFEST_KEYS = new Set([
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
]);

async function generateInto(outDir: string): Promise<void> {
  await execFileAsync(process.execPath, [SCRIPT, "--out", outDir], { cwd: repoRoot });
}

test("the generator emits a closed-schema Agent Plugins manifest and a byte-identical skill copy", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "reelier-plugin-pkg-"));
  try {
    await generateInto(out);
    const manifest = JSON.parse(await readFile(path.join(out, "agent-plugins", "plugin.json"), "utf8")) as Record<string, unknown>;
    assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
    assert.equal(manifest.name, "reelier");
    assert.equal(manifest.version, packageVersion);
    assert.equal(typeof manifest.description, "string");
    for (const key of Object.keys(manifest)) {
      assert.ok(ALLOWED_MANIFEST_KEYS.has(key), `plugin.json key '${key}' is not in the closed v1.0.0 schema`);
    }
    const packagedSkill = await readFile(path.join(out, "agent-plugins", "skills", "reelier-replay", "SKILL.md"), "utf8");
    assert.equal(packagedSkill, await readFile(SKILL_SOURCE, "utf8"));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("the generator emits a Claude-format package from the same source", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "reelier-plugin-pkg-"));
  try {
    await generateInto(out);
    const manifest = JSON.parse(await readFile(path.join(out, "claude", ".claude-plugin", "plugin.json"), "utf8")) as Record<string, unknown>;
    assert.equal(manifest.name, "reelier");
    assert.equal(manifest.version, packageVersion);
    const packagedSkill = await readFile(path.join(out, "claude", "skills", "reelier-replay", "SKILL.md"), "utf8");
    assert.equal(packagedSkill, await readFile(SKILL_SOURCE, "utf8"));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("the generator emits every declared skill into both packages", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "reelier-plugin-pkg-"));
  try {
    await generateInto(out);
    for (const pkg of ["agent-plugins", "claude"]) {
      for (const id of ["reelier-replay"]) {
        const skill = path.join(out, pkg, "skills", id, "SKILL.md");
        assert.ok(fs.existsSync(skill), `missing ${pkg}/skills/${id}/SKILL.md`);
      }
    }
    // The old single-skill path must be gone, not merely joined.
    assert.ok(!fs.existsSync(path.join(out, "claude", "skills", "reelier", "SKILL.md")));
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("the packages are skill-only: no MCP manifest anywhere, no mcpServers key in either plugin manifest", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "reelier-plugin-pkg-"));
  try {
    await generateInto(out);
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [full];
      });
    const files = walk(out);
    assert.ok(files.length >= 4);
    for (const file of files) {
      const base = path.basename(file);
      assert.notEqual(base, "mcp.json", `skill-only gate violated: ${file}`);
      assert.notEqual(base, ".mcp.json", `skill-only gate violated: ${file}`);
      if (base === "plugin.json") {
        assert.ok(!(await readFile(file, "utf8")).includes("mcpServers"), `skill-only gate violated: mcpServers in ${file}`);
      }
    }
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("--check passes on a fresh tree and fails once a generated file drifts", async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), "reelier-plugin-pkg-"));
  try {
    await generateInto(out);
    await execFileAsync(process.execPath, [SCRIPT, "--check", "--out", out], { cwd: repoRoot });
    await writeFile(path.join(out, "agent-plugins", "plugin.json"), "{ \"drifted\": true }\n", "utf8");
    await assert.rejects(
      execFileAsync(process.execPath, [SCRIPT, "--check", "--out", out], { cwd: repoRoot }),
      (err: Error & { code?: number }) => err.code === 1,
    );
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test("the committed plugin/ tree matches the generator's output — packages are generated, never hand-edited", async () => {
  await execFileAsync(process.execPath, [SCRIPT, "--check"], { cwd: repoRoot });
});
