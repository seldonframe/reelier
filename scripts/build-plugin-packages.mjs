#!/usr/bin/env node
// Generates the two Reelier plugin packages from one shared source — never
// hand-maintain the outputs (docs/specs/agent-plugins-coverage-v1.md §3).
//
//   source of truth: integrations/claude-code/reelier/SKILL.md  (the portable
//                    Agent Skill — see commit 98ae6b7) + package.json (version)
//   outputs:         plugin/agent-plugins/  (Agent Plugins v1.0.0 format)
//                    plugin/claude/         (Claude Code plugin format)
//
// Both packages are SKILL-ONLY by design: no mcp.json, no `reelier serve`.
// The MCP component is gated on the workspace-semantics decision in the spec
// (§3) — `serve` resolves workspace paths from process.cwd() while plugin
// hosts default a subprocess's cwd to the plugin root, which would put
// compiled skills and .reelier records inside the plugin directory.
//
// Usage:
//   node scripts/build-plugin-packages.mjs            # write plugin/
//   node scripts/build-plugin-packages.mjs --out DIR  # write elsewhere
//   node scripts/build-plugin-packages.mjs --check    # verify committed tree
//                                                     # matches; exit 1 on drift

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const SKILL_SOURCE = path.join(repoRoot, "integrations", "claude-code", "reelier", "SKILL.md");

const README = `# Reelier plugin packages

**Generated — do not hand-edit.** Source of truth:
\`integrations/claude-code/reelier/SKILL.md\` (the portable Agent Skill) and
\`package.json\` (version). Regenerate with
\`node scripts/build-plugin-packages.mjs\`; drift is caught by
\`test/plugin-packages.test.ts\` via \`--check\`.

- \`agent-plugins/\` — [Agent Plugins v1.0.0](https://agent-plugins.org) format:
  \`plugin.json\` at the root plus \`skills/\`.
- \`claude/\` — Claude Code plugin format: \`.claude-plugin/plugin.json\` plus
  the same \`skills/\`.

Both packages are **skill-only by design**: no \`mcp.json\`, no
\`reelier serve\`. The MCP component is gated on the workspace-semantics
decision in \`docs/specs/agent-plugins-coverage-v1.md\` §3 — several \`serve\`
operations resolve workspace paths from \`process.cwd()\` (\`src/serve.ts\`),
while plugin hosts default a subprocess's working directory to the plugin
root; launched that way, \`serve\` would write compiled skills and
\`.reelier\` records into the plugin directory instead of the user's project.

What this plugin is: Reelier's Agent Skill, distributed. What it is not: it
does not put the Reelier wrap around any other server's writes, and
installing it does not make any write covered. Whether a given host loads
these packages is unchecked until observed per host (spec §4).
`;

async function buildFileMap() {
  const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const skill = await readFile(SKILL_SOURCE, "utf8");
  const description =
    "Reelier's Agent Skill: freeze a repeatable, tool-call-driven job into a deterministic, " +
    "replayable skill with a receipt per run. Skill-only package — it includes no MCP servers.";

  // Closed v1.0.0 schema: only $schema, name, version, description, author,
  // homepage, repository, license, keywords, extensions are permitted.
  const agentPluginsManifest = {
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: "reelier",
    version: pkg.version,
    description,
    homepage: "https://github.com/seldonframe/reelier",
    repository: "https://github.com/seldonframe/reelier",
    keywords: ["reelier", "replay", "receipts", "agent-skills"],
  };
  if (typeof pkg.license === "string") agentPluginsManifest.license = pkg.license;

  const claudeManifest = { name: "reelier", version: pkg.version, description };

  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
  return new Map([
    ["README.md", README],
    ["agent-plugins/plugin.json", json(agentPluginsManifest)],
    ["agent-plugins/skills/reelier/SKILL.md", skill],
    ["claude/.claude-plugin/plugin.json", json(claudeManifest)],
    ["claude/skills/reelier/SKILL.md", skill],
  ]);
}

async function listFiles(dir, prefix = "") {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await listFiles(path.join(dir, entry.name), rel)));
    else files.push(rel);
  }
  return files;
}

async function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes("--check");
  const outFlag = argv.indexOf("--out");
  const outDir = outFlag >= 0 ? path.resolve(argv[outFlag + 1] ?? "") : path.join(repoRoot, "plugin");
  if (outFlag >= 0 && !argv[outFlag + 1]) {
    console.error("--out requires a directory");
    process.exit(1);
  }

  const files = await buildFileMap();

  if (check) {
    const problems = [];
    for (const [rel, expected] of files) {
      let actual;
      try {
        actual = await readFile(path.join(outDir, rel), "utf8");
      } catch {
        problems.push(`missing: ${rel}`);
        continue;
      }
      if (actual !== expected) problems.push(`drifted: ${rel}`);
    }
    const present = await listFiles(outDir);
    for (const rel of present) {
      if (!files.has(rel)) problems.push(`unexpected file (not generated): ${rel}`);
    }
    if (problems.length > 0) {
      console.error(`plugin packages out of sync with their source (${outDir}):`);
      for (const problem of problems) console.error(`  ${problem}`);
      console.error("Regenerate with: node scripts/build-plugin-packages.mjs");
      process.exit(1);
    }
    console.log(`plugin packages in sync (${files.size} files, ${outDir})`);
    return;
  }

  for (const [rel, content] of files) {
    const target = path.join(outDir, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  console.log(`wrote ${files.size} files under ${outDir}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
