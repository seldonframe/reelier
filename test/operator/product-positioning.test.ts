import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

test("the installed package leads with free Mission Control and paid managed authority", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { description?: unknown };
  assert.equal(
    pkg.description,
    "Local Mission Control for coding agents, with optional managed authority for verified GitHub and Linear Outcomes.",
  );

  const readme = await readFile(path.join(root, "README.md"), "utf8");
  const introduction = readme.slice(0, 8_000);
  assert.match(introduction, /Free Local Mission Control\. Paid Managed Autopilot\./);
  assert.match(introduction, /npx reelier@latest init/);
  assert.match(introduction, /no account, model key, or infrastructure setup/i);
  assert.match(introduction, /Harness completion is not Outcome completion/);
  assert.match(introduction, /Managed Personal[^\n]*\$49\/month/);
  assert.doesNotMatch(introduction, /reelier init \[--dry-run\] performs one checkpointed local inspection/);
  assert.doesNotMatch(introduction, /100(?:x|×) (?:better|faster|autonomy)/i);
});
