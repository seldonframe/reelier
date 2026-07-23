import { test } from "node:test";
import assert from "node:assert/strict";
import { buildManifestForSkill, preflightManifest } from "../src/manifest.js";
import type { Skill } from "../src/skill.js";
import type { DownstreamConnection } from "../src/mcp-client.js";

function fakeConnection(name: string, tools: DownstreamConnection["tools"]): DownstreamConnection {
  return {
    name,
    tools,
    async call() {
      throw new Error("not called in this test");
    },
    async close() {},
  };
}

function skillUsing(...tools: string[]): Skill {
  return {
    name: "fixture",
    description: "fixture",
    preamble: "",
    trailing: "",
    steps: tools.map((tool, i) => ({
      n: i + 1,
      title: `step ${i + 1}`,
      intent: "do it",
      actionTool: tool,
      actionArgs: {},
      asserts: [],
      binds: [],
      effect: "read" as const,
      line: 1,
    })),
  };
}

test("buildManifestForSkill: includes only tools the skill's steps actually use, omits tools not found live", () => {
  const downstream = fakeConnection("server-a", [
    { name: "create_contact", inputSchema: { type: "object" } },
    { name: "unused_tool", inputSchema: { type: "object" } },
  ]);
  const skill = skillUsing("create_contact", "never_wrapped_tool");

  const manifest = buildManifestForSkill(skill, [downstream]);

  assert.equal(manifest.v, 1);
  assert.equal(manifest.tools.length, 1);
  assert.equal(manifest.tools[0].name, "create_contact");
  assert.equal(manifest.tools[0].server, "server-a");
  assert.match(manifest.tools[0].digest, /^sha256:[0-9a-f]{64}$/);
});

test("buildManifestForSkill: two builds against the same live schema produce the same digest (stable)", () => {
  const downstream = fakeConnection("server-a", [{ name: "create_contact", inputSchema: { type: "object", properties: { email: {} } } }]);
  const skill = skillUsing("create_contact");
  const m1 = buildManifestForSkill(skill, [downstream]);
  const m2 = buildManifestForSkill(skill, [downstream]);
  assert.deepEqual(m1, m2);
});

test("preflightManifest: ok=true when every recorded digest matches live", () => {
  const downstream = fakeConnection("server-a", [{ name: "create_contact", inputSchema: { type: "object" } }]);
  const skill = skillUsing("create_contact");
  const manifest = buildManifestForSkill(skill, [downstream]);

  const result = preflightManifest(manifest, [downstream]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.drifts, []);
});

test("preflightManifest: schema drift -> ok=false with a 'schema drifted' note", () => {
  const before = fakeConnection("server-a", [{ name: "create_contact", inputSchema: { type: "object", properties: { email: {} } } }]);
  const skill = skillUsing("create_contact");
  const manifest = buildManifestForSkill(skill, [before]);

  const after = fakeConnection("server-a", [
    { name: "create_contact", inputSchema: { type: "object", properties: { email: {}, phone: {} } } },
  ]);
  const result = preflightManifest(manifest, [after]);
  assert.equal(result.ok, false);
  assert.equal(result.drifts.length, 1);
  assert.equal(result.drifts[0].name, "create_contact");
  assert.match(result.drifts[0].note, /schema drifted/);
});

test("preflightManifest: missing tool -> ok=false with a 'missing' note", () => {
  const before = fakeConnection("server-a", [{ name: "create_contact", inputSchema: { type: "object" } }]);
  const skill = skillUsing("create_contact");
  const manifest = buildManifestForSkill(skill, [before]);

  const after = fakeConnection("server-a", []);
  const result = preflightManifest(manifest, [after]);
  assert.equal(result.ok, false);
  assert.match(result.drifts[0].note, /missing: tool not exposed/);
});

test("preflightManifest: tool found under a different exposed name (wrap-order collision rename) is named explicitly", () => {
  const before = fakeConnection("server-a", [{ name: "create_contact", inputSchema: { type: "object" } }]);
  const skill = skillUsing("create_contact");
  const manifest = buildManifestForSkill(skill, [before]);

  // Same schema, now exposed under a renamed key (simulating wrap-order collision renaming).
  const renamedRoute = fakeConnection("server-a", [{ name: "renamed_create_contact", inputSchema: { type: "object" } }]);
  const result = preflightManifest(manifest, [renamedRoute]);
  assert.equal(result.ok, false);
  assert.match(result.drifts[0].note, /schema found under 'renamed_create_contact'/);
});
