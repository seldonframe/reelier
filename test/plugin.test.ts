import assert from "node:assert/strict";
import test from "node:test";
import { parseReelierPluginV1, validateReelierPluginV1, type ReelierPluginV1 } from "../src/plugin.js";

const manifest: ReelierPluginV1 = {
  schemaVersion: "ReelierPluginV1",
  id: "com.example.writer",
  name: "Example writer",
  version: "1.2.3",
  capabilities: ["discovery"],
};

test("validateReelierPluginV1 accepts the declarative v1 manifest", () => {
  assert.deepEqual(validateReelierPluginV1(manifest), { ok: true, value: manifest });
  assert.deepEqual(parseReelierPluginV1(JSON.stringify(manifest)), manifest);
});

test("validateReelierPluginV1 rejects unknown fields and invalid versions", () => {
  const result = validateReelierPluginV1({ ...manifest, version: "latest", unexpected: true });
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(result.errors, ["unexpected is not allowed", "version must be a valid semver"]);
  assert.throws(() => parseReelierPluginV1("not json"), /invalid JSON/);
});

test("certification validation requires pinned, signed execution metadata", async () => {
  const { validateReelierPluginForCertification } = await import("../src/plugin.js");
  const result = validateReelierPluginForCertification(manifest);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.errors.join(" "), /pinned|signature/i);
  assert.equal(validateReelierPluginV1({ ...manifest, capabilities: ["discovery", "discovery"] }).ok, false);
});
