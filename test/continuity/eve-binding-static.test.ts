import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

const fixtureRoot = resolve("conformance/continuity-adapter/v1/eve-fixture");
const rootPackageJson = JSON.parse(
  await readFile(resolve(fixtureRoot, "../../../..", "package.json"), "utf8"),
);

function exportedSchemaKeys(source: string): string[] {
  const match = /export const MODEL_INPUT_KEYS = \[([^\]]*)\] as const;/s.exec(source);
  assert.ok(match, "MODEL_INPUT_KEYS must be an exported literal array");
  return [...match[1].matchAll(/"([^"]+)"/g)].map(item => item[1]);
}

test("Eve fixture is isolated and its model-facing schemas exclude authority", async () => {
  const packageJson = JSON.parse(await readFile(join(fixtureRoot, "package.json"), "utf8"));
  assert.equal(packageJson.dependencies.eve, "0.39.0");
  assert.equal(packageJson.dependencies.reelier, "file:../../../..");
  assert.equal(rootPackageJson.dependencies?.eve, undefined);
  assert.equal(rootPackageJson.devDependencies?.eve, undefined);

  const checkpoint = await readFile(join(fixtureRoot, "agent/tools/continuity_checkpoint.ts"), "utf8");
  assert.deepEqual(exportedSchemaKeys(checkpoint), ["events", "evidenceRefs", "expectedCursor", "agentMemo"]);
  for (const forbidden of ["taskId", "actorPrincipalId", "workloadId", "jobCardDigest", "authoritySnapshotDigest"]) {
    assert.equal(exportedSchemaKeys(checkpoint).includes(forbidden), false);
  }
  const outcome = await readFile(join(fixtureRoot, "agent/tools/reelier_outcome_request.ts"), "utf8");
  assert.deepEqual(exportedSchemaKeys(outcome), ["choices", "requestId", "sourceRefs"]);
  const status = await readFile(join(fixtureRoot, "agent/tools/reelier_outcome_status.ts"), "utf8");
  assert.deepEqual(exportedSchemaKeys(status), ["requestId"]);
});

test("active Eve process conformance documentation matches the pinned fixture version", async () => {
  const packageJson = JSON.parse(await readFile(join(fixtureRoot, "package.json"), "utf8"));
  const readme = await readFile(resolve(fixtureRoot, "..", "README.md"), "utf8");
  assert.match(readme, new RegExp(`^## Eve ${packageJson.dependencies.eve.replaceAll(".", "\\.")} process conformance$`, "m"));
  assert.doesNotMatch(readme, /^## Eve 0\.37\.1 process conformance$/m);
});
