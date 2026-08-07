import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

test("integration README lists every tool exposed by reelier serve", () => {
  const serveSource = readFileSync(join(ROOT, "src", "serve.ts"), "utf8");
  const readme = readFileSync(join(ROOT, "integrations", "README.md"), "utf8");
  const exposedTools = [...serveSource.matchAll(/name: "(reelier_[a-z_]+)"/g)].map((match) => match[1]);

  assert.deepEqual([...new Set(exposedTools)].sort(), [
    "reelier_diff",
    "reelier_from_session",
    "reelier_push",
    "reelier_replay",
    "reelier_scan",
  ]);

  for (const tool of exposedTools) {
    assert.ok(readme.includes(`| \`${tool}\` |`), `${tool} is missing from integrations/README.md`);
  }
});
