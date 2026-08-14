import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

test("the harness-neutral continuity kernel is available through a supported package subpath", async () => {
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "package.json"), "utf8")) as {
    exports: Record<string, string>;
  };
  assert.equal(packageJson.exports["./continuity"], "./dist/continuity/index.js");

  const continuity = await import("reelier/continuity");
  for (const name of [
    "FsContinuityLedger",
    "continuityEventsFromVerifiedAuthorityReceipt",
    "createContinuityRuntimeAdapter",
    "createResumeProjection",
    "foldContinuity",
    "normalizeContinuityCheckpoint",
    "renderResumeMarkdown",
  ]) {
    assert.equal(typeof continuity[name as keyof typeof continuity], "function", `${name} must be public`);
  }
});
