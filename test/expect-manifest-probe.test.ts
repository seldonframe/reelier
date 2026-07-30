// S5 of the state-conditioned-approval design (Wave 2 spec §8.6 probe-tool
// row, §10 S5): the manifest covers the PROBE tool of expect-bearing steps —
// closing the recon hole where buildManifestForSkill mapped actionTool only,
// so a probe-tool schema drift sailed past preflight and only surfaced at
// step level as `unevaluated`. Skills without expect produce byte-identical
// manifests (the S5 accept clause).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildManifestForSkill, addProbeToolsToManifest, preflightManifest } from "../src/manifest.js";
import { parseSkill, type Skill, type Step } from "../src/skill.js";
import { cmdApprove, type ParsedArgs } from "../src/cli.js";
import { canonicalJson } from "../src/canonical-json.js";
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

function writeStep(n: number, extra: Partial<Step> = {}): Step {
  return {
    n,
    title: `step ${n}`,
    intent: "do it",
    actionTool: "put_page",
    actionArgs: { slug: "demo" },
    asserts: [],
    binds: [],
    effect: "idempotent-write",
    line: 1,
    ...extra,
  };
}

function skillOf(...steps: Step[]): Skill {
  return { name: "fixture", description: "fixture", preamble: "", trailing: "", steps };
}

const ATTEST = { tool: "get_page", args: { slug: "demo" }, projection: ["compiled_truth"] };
const EXPECT = { at: "2026-07-30T06:00:00.000Z", keyId: "3c9a01d2e4f5b6a7", pre: `hmac-sha256:${"9f".repeat(32)}` };

const GBRAIN = () =>
  fakeConnection("gbrain", [
    { name: "put_page", inputSchema: { type: "object", properties: { slug: {} } } },
    { name: "get_page", inputSchema: { type: "object", properties: { slug: {} } } },
  ]);

test("an expect-bearing step's probe tool lands in the manifest alongside its action tool", () => {
  const skill = skillOf(writeStep(1, { attest: ATTEST, approve: `sha256:${"a".repeat(64)}`, expect: EXPECT }));
  const manifest = buildManifestForSkill(skill, [GBRAIN()]);
  const names = manifest.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["get_page", "put_page"]);
});

test("S5 accept: a skill WITHOUT expect produces a byte-identical manifest — attest alone adds nothing", () => {
  // attest without expect: the probe is evidence-only; its drift degrades the
  // attest honestly at run time and must NOT start failing preflight closed
  // for skills that never opted into state binding (zero-touch discipline).
  const withAttestOnly = skillOf(writeStep(1, { attest: ATTEST, approve: `sha256:${"a".repeat(64)}` }));
  const plain = skillOf(writeStep(1, { approve: `sha256:${"a".repeat(64)}` }));
  const m1 = buildManifestForSkill(withAttestOnly, [GBRAIN()]);
  const m2 = buildManifestForSkill(plain, [GBRAIN()]);
  assert.equal(JSON.stringify(m1), JSON.stringify(m2));
  assert.deepEqual(
    m1.tools.map((t) => t.name),
    ["put_page"]
  );
});

test("preflight reports PROBE-tool drift before step 1 for a bound skill (the §8.6 row)", () => {
  const skill = skillOf(writeStep(1, { attest: ATTEST, approve: `sha256:${"a".repeat(64)}`, expect: EXPECT }));
  const manifest = buildManifestForSkill(skill, [GBRAIN()]);

  // The probe tool's schema drifts (gbrain release); the action tool is unchanged.
  const drifted = fakeConnection("gbrain", [
    { name: "put_page", inputSchema: { type: "object", properties: { slug: {} } } },
    { name: "get_page", inputSchema: { type: "object", properties: { slug: {}, format: {} } } },
  ]);
  const result = preflightManifest(manifest, [drifted]);
  assert.equal(result.ok, false);
  assert.equal(result.drifts.length, 1);
  assert.equal(result.drifts[0].name, "get_page");
  assert.match(result.drifts[0].note, /drifted/);
});

test("a probe tool not found live is simply omitted at build (build is not verify)", () => {
  const skill = skillOf(writeStep(1, { attest: ATTEST, approve: `sha256:${"a".repeat(64)}`, expect: EXPECT }));
  const noProbe = fakeConnection("gbrain", [{ name: "put_page", inputSchema: { type: "object" } }]);
  const manifest = buildManifestForSkill(skill, [noProbe]);
  assert.deepEqual(
    manifest.tools.map((t) => t.name),
    ["put_page"]
  );
});

// ---------------------------------------------------------------------------
// addProbeToolsToManifest (bind-time coverage — the review's blocking finding:
// buildManifestForSkill's only caller is `reelier manifest`, so without this,
// a bound skill kept an action-tools-only manifest on the real pipeline)
// ---------------------------------------------------------------------------

test("addProbeToolsToManifest: adds only missing probe tools of bound steps, never touches existing entries", () => {
  const skill = skillOf(writeStep(1, { attest: ATTEST, approve: `sha256:${"a".repeat(64)}`, expect: EXPECT }));
  const staleDigest = `sha256:${"d".repeat(64)}`; // deliberately NOT the live digest — must survive untouched
  const existing = { v: 1 as const, tools: [{ name: "put_page", server: "gbrain", digest: staleDigest }] };
  const { manifest, added } = addProbeToolsToManifest(existing, skill, [GBRAIN()]);
  assert.deepEqual(added, ["get_page"]);
  assert.equal(manifest.tools.find((t) => t.name === "put_page")!.digest, staleDigest, "existing entries are never re-digested");
  assert.ok(manifest.tools.find((t) => t.name === "get_page"));

  // Idempotent: a second pass adds nothing.
  const again = addProbeToolsToManifest(manifest, skill, [GBRAIN()]);
  assert.deepEqual(again.added, []);
  assert.equal(JSON.stringify(again.manifest), JSON.stringify(manifest));
});

test("preflight diagnostic: a vanished probe tool whose trivial digest matches OTHER live tools reads 'missing', not a bogus rename hint", () => {
  const skill = skillOf(writeStep(1, { attest: ATTEST, approve: `sha256:${"a".repeat(64)}`, expect: EXPECT }));
  const manifest = buildManifestForSkill(skill, [GBRAIN()]);
  // get_page vanishes; put_page remains with the IDENTICAL trivial schema.
  const withoutProbe = fakeConnection("gbrain", [{ name: "put_page", inputSchema: { type: "object", properties: { slug: {} } } }]);
  const result = preflightManifest(manifest, [withoutProbe]);
  const drift = result.drifts.find((d) => d.name === "get_page")!;
  assert.match(drift.note, /missing: tool not exposed/);
  assert.ok(!/collision renaming/.test(drift.note), "a multi-match digest must not produce a rename hint");
});

test("shared probe tool across several bound steps appears once", () => {
  const skill = skillOf(
    writeStep(1, { attest: ATTEST, approve: `sha256:${"a".repeat(64)}`, expect: EXPECT }),
    writeStep(2, { actionArgs: { slug: "other" }, attest: { ...ATTEST, args: { slug: "other" } }, approve: `sha256:${"b".repeat(64)}`, expect: EXPECT })
  );
  const manifest = buildManifestForSkill(skill, [GBRAIN()]);
  assert.equal(manifest.tools.filter((t) => t.name === "get_page").length, 1);
});

// ---------------------------------------------------------------------------
// The real pipeline (review blocking finding): approve --probe extends an
// existing manifest at bind time — no separate `reelier manifest` rerun needed
// ---------------------------------------------------------------------------

/** A live-ish gbrain fake: connection-level, so cmdApprove's own --wrap wiring, tool registry, and probe path all run for real. */
function fakeGbrainConnect(body: Record<string, unknown>) {
  const connection: DownstreamConnection = {
    name: "gbrain",
    tools: [
      { name: "put_page", inputSchema: { type: "object", properties: { slug: {} } } },
      { name: "get_page", inputSchema: { type: "object", properties: { slug: {} } } },
    ],
    async call(toolName: string) {
      if (toolName === "get_page") return { content: [{ type: "text", text: JSON.stringify(body) }] };
      throw new Error(`unexpected dispatch of ${toolName} at approve time`);
    },
    async close() {},
  };
  return async () => connection;
}

const BOUND_SRC = (manifestLine: string) => `---
name: probe-manifest-e2e
description: bind-time manifest coverage
${manifestLine}---

### Step 1 — bound write
- intent: w
- action: put_page {"markdown":"# hi","slug":"demo","title":"Demo"}
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"demo"},"projection":["compiled_truth"]}
`;

test("approve --probe adds the probe tool to an EXISTING manifest at bind time (and only then)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-probe-manifest-"));
  try {
    // Manifest stamped pre-binding: action tool only (the compile-time shape).
    const putDigest = `sha256:${"d".repeat(64)}`; // stale on purpose — approve must never re-digest it
    const manifestLine = `manifest: ${canonicalJson({ v: 1, tools: [{ name: "put_page", server: "gbrain", digest: putDigest }] })}\n`;
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, BOUND_SRC(manifestLine), "utf8");

    const args: ParsedArgs = { positional: [skillPath], flags: new Set(["probe", "all"]), vars: {}, wraps: ["gbrain serve"], opts: {}, fails: [] };
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (m: unknown) => logs.push(String(m));
    let code: number;
    try {
      code = await cmdApprove(args, {
        connect: fakeGbrainConnect({ compiled_truth: "# hi" }),
        env: { REELIER_EXPECT_KEYS: path.join(dir, "keys.json") },
        homedir: dir,
        isTTY: false,
      });
    } finally {
      console.log = origLog;
    }
    assert.equal(code, 0);
    assert.ok(logs.some((l) => /manifest: added probe tool\(s\) get_page/.test(l)), logs.join("\n"));

    const written = parseSkill(await readFile(skillPath, "utf8"));
    assert.ok(written.steps[0].expect, "the binding landed");
    const names = written.manifest!.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["get_page", "put_page"]);
    assert.equal(written.manifest!.tools.find((t) => t.name === "put_page")!.digest, putDigest, "existing entry untouched");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("approve --probe with NO manifest prints the advisory and stamps none (manifest stays operator opt-in)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-probe-manifest-"));
  try {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, BOUND_SRC(""), "utf8");
    const args: ParsedArgs = { positional: [skillPath], flags: new Set(["probe", "all"]), vars: {}, wraps: ["gbrain serve"], opts: {}, fails: [] };
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (m: unknown) => logs.push(String(m));
    let code: number;
    try {
      code = await cmdApprove(args, {
        connect: fakeGbrainConnect({ compiled_truth: "# hi" }),
        env: { REELIER_EXPECT_KEYS: path.join(dir, "keys.json") },
        homedir: dir,
        isTTY: false,
      });
    } finally {
      console.log = origLog;
    }
    assert.equal(code, 0);
    assert.ok(logs.some((l) => /probe-tool schema drift on state-bound steps is only detectable/.test(l)));
    const written = parseSkill(await readFile(skillPath, "utf8"));
    assert.equal(written.manifest, undefined, "approve never mints a FIRST manifest — that would flip on preflight enforcement as a side effect");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
