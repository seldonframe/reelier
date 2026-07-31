// W3-S4 of the wave-3 spec (§3 W3-S4; wave-2 conflict C4, §4.2/§8.3):
// parameterized probe args and the `expect.probeArgs` commitment, landed
// together and additively.
//
// THE LOAD-BEARING HALF IS THE DISPATCH BAN (I-18). The exfiltration boundary
// that forced literal-only probes in P1 — an unreviewed probe-arg template
// carrying live values out through a probe URL — is NOT preserved by the
// approval hash: the hash covers the file's template text and the committed
// MAC, both unchanged by run-time fills, so it cannot see what a --var puts
// in. It is preserved by comparing the filled-args MAC BEFORE any probe
// dispatches. A build that exfiltrates first and then honestly reports
// `unevaluated` satisfies a comparison-only invariant and is still wrong, so
// every dispatch pin below is a tool spy at ZERO, in recorder AND gate mode.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cmdApprove, type ParsedArgs, type ApproveDeps } from "../src/cli.js";
import { parseSkill, SkillParseError } from "../src/skill.js";
import { serializeSkill } from "../src/writeback.js";
import { computeApprovalHash } from "../src/approval.js";
import { runSkill } from "../src/runner.js";
import { mintExpectKey, probeArgsMac, expectMac, expectFieldMac, readKeystore, writeKeystoreEntry } from "../src/expect-mac.js";
import type { Tool } from "../src/tools.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A parameterized probe: the slug arrives from an operator-supplied --var. */
const SKILL_PARAM = `---
name: probe-parameterized
description: one write step whose probe args carry a {{var}} placeholder
---

### Step 1 — Capture a page into gbrain
- intent: Save a small page into gbrain by slug
- action: put_page {"content":"# hi","slug":"reelier-demo-page"}
- assert: status == 200
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"{{target}}"},"projection":["compiled_truth"]}
`;

const SKILL_COMPUTED_DATE = SKILL_PARAM.replace('"slug":"{{target}}"', '"slug":"page-{{today}}"');

function fakeArgs(positional: string[], flags: string[] = [], vars: Record<string, string> = {}): ParsedArgs {
  return { positional, flags: new Set(flags), vars, wraps: [], opts: {}, fails: [] };
}

/** Records EVERY probe dispatch with its filled args — the spy I-18 is pinned against. */
function spyTools(shared: { body: Record<string, unknown> }) {
  const probeCalls: unknown[] = [];
  const writeCalls: unknown[] = [];
  const tools: Record<string, Tool> = {
    get_page: {
      effect: "read",
      run: async (args) => {
        probeCalls.push(args);
        return { status: 200, headers: {}, body: JSON.stringify(shared.body) };
      },
    },
    put_page: {
      effect: "idempotent-write",
      run: async (args) => {
        writeCalls.push(args);
        return { status: 200, headers: {}, body: "{}" };
      },
    },
  };
  return { tools, probeCalls, writeCalls };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-probe-args-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function captureOutput<T>(fn: () => Promise<T>): Promise<{ result: T; out: string }> {
  const chunks: string[] = [];
  const origLog = console.log;
  const origWrite = process.stdout.write.bind(process.stdout);
  console.log = (msg: unknown) => chunks.push(`${String(msg)}\n`);
  (process.stdout as unknown as { write: (c: string) => boolean }).write = (c: string) => {
    chunks.push(String(c));
    return true;
  };
  try {
    return { result: await fn(), out: chunks.join("") };
  } finally {
    console.log = origLog;
    (process.stdout as unknown as { write: typeof origWrite }).write = origWrite;
  }
}

function deps(dir: string, extra: Partial<ApproveDeps> = {}): ApproveDeps {
  return { env: { REELIER_EXPECT_KEYS: path.join(dir, "expect-keys.json") }, homedir: dir, isTTY: true, ...extra };
}

const EXPECT_AT = "2026-07-30T06:58:12.331Z";
const KEY_ID = "3c9a01d2e4f5b6a7";
const MAC_A = `hmac-sha256:${"a".repeat(64)}`;
const MAC_B = `hmac-sha256:${"b".repeat(64)}`;

function skillWithExpect(expectJson: string): string {
  return `---
name: g
description: d
---

### Step 1 — w
- intent: i
- action: put_page {"slug":"s"}
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"s"},"projection":["compiled_truth"]}
- approve: sha256:${"0".repeat(64)}
- expect: ${expectJson}
`;
}

// ===========================================================================
// Grammar (skill.ts) — additive, closed, alphabetical
// ===========================================================================

test("W3-S4 grammar: probeArgs accepts hmac-sha256:<64 hex> and rejects every other shape", () => {
  const ok = parseSkill(skillWithExpect(`{"at":"${EXPECT_AT}","keyId":"${KEY_ID}","pre":"${MAC_A}","probeArgs":"${MAC_B}"}`));
  assert.equal(ok.steps[0].expect!.probeArgs, MAC_B);
  for (const bad of [`"sha256:${"a".repeat(64)}"`, `"hmac-sha256:${"A".repeat(64)}"`, `"hmac-sha256:${"a".repeat(63)}"`, `""`, `42`, `null`, `{}`]) {
    assert.throws(
      () => parseSkill(skillWithExpect(`{"at":"${EXPECT_AT}","keyId":"${KEY_ID}","pre":"${MAC_A}","probeArgs":${bad}}`)),
      SkillParseError,
      `should reject probeArgs ${bad}`,
    );
  }
});

test("W3-S4 grammar: the closed unknown-key error names probeArgs, verbatim", () => {
  assert.throws(
    () => parseSkill(skillWithExpect(`{"at":"${EXPECT_AT}","keyId":"${KEY_ID}","pre":"${MAC_A}","nope":"x"}`)),
    (err: Error) => {
      assert.equal(err.message.split("\n")[0].includes(`Unknown 'expect' key "nope" — expected pre/keyId/at/fields/probeArgs`), true, err.message);
      return true;
    },
  );
});

test("W3-S4 grammar: probeArgs without pre on the same expect is a parse error", () => {
  assert.throws(() => parseSkill(skillWithExpect(`{"at":"${EXPECT_AT}","keyId":"${KEY_ID}","probeArgs":"${MAC_B}"}`)), SkillParseError);
});

test("W3-S4 grammar: serialization is alphabetical (at, fields, keyId, pre, probeArgs) and round-trips byte-stably", () => {
  const src = skillWithExpect(
    `{"at":"${EXPECT_AT}","fields":{"body.compiled_truth":"${MAC_A}"},"keyId":"${KEY_ID}","pre":"${MAC_A}","probeArgs":"${MAC_B}"}`,
  );
  const once = serializeSkill(parseSkill(src));
  assert.equal(serializeSkill(parseSkill(once)), once, "byte-stable round-trip");
  const line = once.split("\n").find((l) => l.startsWith("- expect:"))!;
  assert.ok(
    line.indexOf('"at"') < line.indexOf('"fields"') &&
      line.indexOf('"fields"') < line.indexOf('"keyId"') &&
      line.indexOf('"keyId"') < line.indexOf('"pre"') &&
      line.indexOf('"pre"') < line.indexOf('"probeArgs"'),
    `alphabetical, matching canonicalJson's sort so file and hash input agree: ${line}`,
  );
});

// ===========================================================================
// I-17: probeArgs enters the hash only when present — pinned against LITERALS
// captured from the 0.26.0 build, never a restated formula (registry item 8)
// ===========================================================================

test("W3-S4 / I-17: a binding with neither fields nor probeArgs hashes byte-identically to 0.26.0", () => {
  const attest = { tool: "get_page", args: { slug: "reelier-demo-page" }, projection: ["compiled_truth"] };
  const base = { actionTool: "put_page", actionArgs: { content: "# hi", slug: "reelier-demo-page" }, attest };
  const e = { at: EXPECT_AT, keyId: KEY_ID, pre: MAC_A };
  // Literal digests captured by running 0.26.0's computeApprovalHash before
  // this slice touched it. A restated formula would pass against its own bug.
  assert.equal(
    computeApprovalHash({ ...base, attest: undefined, expect: undefined }),
    "sha256:380a406c04f06e6a2a4a3fa15a571459623d30e009f3e350802a4989e7ae83b7",
  );
  assert.equal(computeApprovalHash({ ...base, expect: undefined }), "sha256:90e4fe48c0395762f04362e4a852d903dcfad25f58cdb26976400cef7e4be34b");
  assert.equal(computeApprovalHash({ ...base, expect: e }), "sha256:d9a268d91e885f3c857f577b763e42280cd8a7087a6ec54b4af0323634f8cd43");
  assert.equal(
    computeApprovalHash({ ...base, expect: { ...e, fields: { "body.compiled_truth": MAC_B } } }),
    "sha256:94bfc0642ba701105be0c47fada3ce02788b7c314edff53592b37269d40ed7ac",
  );
});

test("W3-S4 / I-17: adding probeArgs MOVES the hash — the commitment is under the yes, like everything else", () => {
  const attest = { tool: "get_page", args: { slug: "reelier-demo-page" }, projection: ["compiled_truth"] };
  const base = { actionTool: "put_page", actionArgs: { content: "# hi", slug: "reelier-demo-page" }, attest };
  const e = { at: EXPECT_AT, keyId: KEY_ID, pre: MAC_A };
  const bare = computeApprovalHash({ ...base, expect: e });
  const withArgs = computeApprovalHash({ ...base, expect: { ...e, probeArgs: MAC_B } });
  assert.notEqual(withArgs, bare, "hand-editing probeArgs away is an approval mismatch, refused by the existing gate");
  assert.notEqual(withArgs, computeApprovalHash({ ...base, expect: { ...e, probeArgs: MAC_A } }));
});

// ===========================================================================
// probeArgsMac: domain separation
// ===========================================================================

test("W3-S4: probeArgsMac is deterministic and domain-separated from the other two MACs", () => {
  const { key } = mintExpectKey();
  const args = { slug: "reelier-demo-page" };
  assert.equal(probeArgsMac(key, "get_page", args), probeArgsMac(key, "get_page", { slug: "reelier-demo-page" }));
  assert.notEqual(probeArgsMac(key, "get_page", args), probeArgsMac(key, "get_other", args));
  assert.notEqual(probeArgsMac(key, "get_page", args), probeArgsMac(mintExpectKey().key, "get_page", args));
  // Distinct input SHAPES: {args,probe,v} vs {probe,projection,v} vs {field,probe,v,value}.
  assert.notEqual(probeArgsMac(key, "get_page", { slug: "x" }), expectMac(key, "get_page", { slug: "x" }));
  assert.notEqual(probeArgsMac(key, "get_page", { slug: "x" }), expectFieldMac(key, "get_page", "slug", "x"));
  assert.match(probeArgsMac(key, "get_page", args), /^hmac-sha256:[0-9a-f]{64}$/);
  // Type-tagging survives: "1" and 1 must not collide (A6's false-MATCH class).
  assert.notEqual(probeArgsMac(key, "get_page", { n: 1 }), probeArgsMac(key, "get_page", { n: "1" }));
});

// ===========================================================================
// Approve side: --var fills, and the ceremony shows the FILLED args
// ===========================================================================

test("W3-S4 approve: a placeholder probe arg binds when filled from --var, and the FILLED args print verbatim", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_PARAM, "utf8");
    const { tools, probeCalls, writeCalls } = spyTools({ body: { compiled_truth: "# hi" } });
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"], { target: "reelier-demo-page" }), deps(dir, { tools })),
    );
    assert.equal(code, 0, out);
    assert.deepEqual(probeCalls, [{ slug: "reelier-demo-page" }], "the probe dispatched once, with the filled args");
    assert.deepEqual(writeCalls, [], "no write dispatches during a ceremony (I-13)");
    assert.match(out, /probe args \(filled\): \{"slug":"reelier-demo-page"\}/);
    const step = parseSkill(await readFile(skillPath, "utf8")).steps[0];
    assert.match(step.expect!.probeArgs!, /^hmac-sha256:[0-9a-f]{64}$/);
    const store = await readKeystore(path.join(dir, "expect-keys.json"));
    const key = Buffer.from(store.keys[step.expect!.keyId].key, "base64");
    assert.equal(step.expect!.probeArgs, probeArgsMac(key, "get_page", { slug: "reelier-demo-page" }));
  });
});

test("W3-S4 approve: filled probe args print even under --all — they are operator INPUTS, not observed state (A2 does not apply)", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_PARAM, "utf8");
    const { tools } = spyTools({ body: { compiled_truth: "# hi" } });
    const { out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"], { target: "reelier-demo-page" }), deps(dir, { tools, isTTY: false })),
    );
    assert.match(out, /probe args \(filled\): \{"slug":"reelier-demo-page"\}/);
    assert.ok(!/compiled_truth = /.test(out), "A2 still withholds observed VALUES under --all");
  });
});

test("W3-S4 approve: a placeholder with NO --var refuses to bind, naming the var to pass", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_PARAM, "utf8");
    const { tools, probeCalls } = spyTools({ body: { compiled_truth: "# hi" } });
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools })),
    );
    assert.equal(code, 1, "never silently weaker than what was asked for");
    assert.match(out, /skipped \(probe failed\): attest args contain placeholders with no --var supplied \(\{\{target\}\}\) — pass --var target=value to bind a parameterized probe/);
    assert.deepEqual(probeCalls, [], "a structurally unbindable step never dispatches a probe");
    assert.ok(!/expect:/.test(await readFile(skillPath, "utf8")), "nothing bound");
  });
});

test("W3-S4 approve: computed date vars stay REFUSED — an arg that changes daily can never re-verify", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_COMPUTED_DATE, "utf8");
    const { tools, probeCalls } = spyTools({ body: { compiled_truth: "# hi" } });
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"], { today: "nope" }), deps(dir, { tools })),
    );
    assert.equal(code, 1);
    assert.match(
      out,
      /skipped \(probe failed\): attest args use computed date vars \(\{\{today\}\}\) — approve-day and execute-day fills would target different observations \(not state-bindable in v1\)/,
    );
    assert.deepEqual(probeCalls, [], "refused before any dispatch");
  });
});

test("W3-S4 approve: a fully-literal probe still binds WITHOUT probeArgs — 0.26.0 bindings are unchanged", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_PARAM.replace('"slug":"{{target}}"', '"slug":"reelier-demo-page"'), "utf8");
    const { tools } = spyTools({ body: { compiled_truth: "# hi" } });
    const { result: code } = await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools })));
    assert.equal(code, 0);
    const step = parseSkill(await readFile(skillPath, "utf8")).steps[0];
    assert.equal(step.expect!.probeArgs, undefined, "no placeholders, no probeArgs commitment — additive means additive");
  });
});

// ===========================================================================
// Re-verify: probe-args-differ is its own loud class, and dispatches NOTHING
// ===========================================================================

async function bindParam(dir: string, vars: Record<string, string>) {
  const skillPath = path.join(dir, "s.skill.md");
  await writeFile(skillPath, SKILL_PARAM, "utf8");
  const { tools, probeCalls, writeCalls } = spyTools({ body: { compiled_truth: "# hi" } });
  await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"], vars), deps(dir, { tools })));
  probeCalls.length = 0;
  return { skillPath, tools, probeCalls, writeCalls };
}

test("W3-S4 re-verify: a DIFFERENT --var is probe-args-differ — counted, non-zero, never 'unchanged', never 'the world has moved', ZERO dispatches", async () => {
  await withTempDir(async (dir) => {
    const { skillPath, tools, probeCalls } = await bindParam(dir, { target: "reelier-demo-page" });
    const before = await readFile(skillPath, "utf8");
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"], { target: "some-other-page" }), deps(dir, { tools })),
    );
    assert.equal(code, 1);
    assert.match(out, /re-verify unavailable \(probe-args-differ: filled probe args differ from the approved ones\)/);
    assert.match(out, /re-verify unavailable: 1/);
    assert.ok(!/unchanged \(state re-verified/.test(out), "an induced difference must never read as 'unchanged'");
    assert.ok(!/the world has moved/.test(out), "the ARGS differ, not the world — never borrow the other verdict");
    assert.deepEqual(probeCalls, [], "I-18: the comparison happens BEFORE any probe dispatch");
    assert.equal(await readFile(skillPath, "utf8"), before, "nothing rebound");
  });
});

test("W3-S4 re-verify: a MISSING --var lands the same loud class, with zero dispatches", async () => {
  await withTempDir(async (dir) => {
    const { skillPath, tools, probeCalls } = await bindParam(dir, { target: "reelier-demo-page" });
    const { result: code, out } = await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools })));
    assert.equal(code, 1);
    assert.match(out, /re-verify unavailable \(probe-args-differ: filled probe args differ from the approved ones\)/);
    assert.deepEqual(probeCalls, [], "an unfillable template is not the approved filled shape — and still dispatches nothing");
  });
});

test("W3-S4 re-verify: the SAME --var re-verifies normally — the W3-S6 exit-bar shape", async () => {
  await withTempDir(async (dir) => {
    const { skillPath, tools, probeCalls } = await bindParam(dir, { target: "reelier-demo-page" });
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"], { target: "reelier-demo-page" }), deps(dir, { tools })),
    );
    assert.equal(code, 0);
    assert.match(out, /unchanged \(state re-verified against current binding\)/);
    assert.deepEqual(probeCalls, [{ slug: "reelier-demo-page" }], "matching args → the probe runs, exactly once");
  });
});

test("W3-S4 re-verify: matching --var with a MOVED world still reports world-moved (the two verdicts stay distinct)", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_PARAM, "utf8");
    const shared = { body: { compiled_truth: "# hi" } as Record<string, unknown> };
    const { tools } = spyTools(shared);
    await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"], { target: "p" }), deps(dir, { tools })));
    shared.body = { compiled_truth: "clobbered" };
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"], { target: "p" }), deps(dir, { tools })),
    );
    assert.equal(code, 1);
    assert.match(out, /but the world has moved since /);
    assert.ok(!/probe-args-differ/.test(out));
  });
});

test("W3-S4 re-verify: --rebind re-commits probeArgs over THIS invocation's vars, and the consent copy says so", async () => {
  await withTempDir(async (dir) => {
    const { skillPath, tools } = await bindParam(dir, { target: "page-a" });
    const first = parseSkill(await readFile(skillPath, "utf8")).steps[0].expect!.probeArgs!;
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all", "rebind"], { target: "page-b" }), deps(dir, { tools })),
    );
    assert.equal(code, 0, out);
    assert.match(out, /re-pointing this binding at different probe args \(--rebind\)/);
    assert.match(out, /re-binding probe args to this invocation's --var values/);
    const step = parseSkill(await readFile(skillPath, "utf8")).steps[0];
    assert.notEqual(step.expect!.probeArgs, first, "--rebind is consent, and consent re-commits the args");
    const store = await readKeystore(path.join(dir, "expect-keys.json"));
    const key = Buffer.from(store.keys[step.expect!.keyId].key, "base64");
    assert.equal(step.expect!.probeArgs, probeArgsMac(key, "get_page", { slug: "page-b" }));
    assert.equal(
      step.approve,
      computeApprovalHash({ actionTool: step.actionTool, actionArgs: step.actionArgs, attest: step.attest, expect: step.expect }),
    );
  });
});

// ===========================================================================
// RUN SIDE — I-18. The dispatch ban, proven with a spy, in BOTH modes.
// ===========================================================================

async function runBound(
  dir: string,
  vars: Record<string, string>,
  opts: { stateGate?: "refuse" } = {},
  mutate?: (skillPath: string) => Promise<void>,
) {
  const skillPath = path.join(dir, "s.skill.md");
  await writeFile(skillPath, SKILL_PARAM, "utf8");
  const bindTools = spyTools({ body: { compiled_truth: "# hi" } });
  await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"], { target: "reelier-demo-page" }), deps(dir, { tools: bindTools.tools })));
  if (mutate) await mutate(skillPath);
  const skill = parseSkill(await readFile(skillPath, "utf8"));
  const { tools, probeCalls, writeCalls } = spyTools({ body: { compiled_truth: "# hi" } });
  const record = await runSkill(skill, {
    tools,
    vars,
    cwd: dir,
    expectKeystorePath: path.join(dir, "expect-keys.json"),
    ...opts,
  });
  return { record, probeCalls, writeCalls };
}

test("W3-S4 / I-18 (recorder): a drifted --var dispatches NEITHER probe — unevaluated, probe-args-mismatch, no observedAt", async () => {
  await withTempDir(async (dir) => {
    const { record, probeCalls, writeCalls } = await runBound(dir, { target: "attacker-controlled-page" });
    const step = record.steps[0];
    assert.deepEqual(probeCalls, [], "ZERO probe dispatches — pre AND post. This is the exfiltration channel.");
    assert.equal(step.stateCheck!.outcome, "unevaluated");
    assert.equal(step.stateCheck!.action, "proceeded", "recorder mode fails OPEN on the write, unconditionally");
    assert.equal(step.stateCheck!.reason, "probe-args-mismatch: filled probe args differ from the approved ones");
    assert.equal(step.stateCheck!.observedAt, undefined, "unevaluated before any observation");
    assert.equal(writeCalls.length, 1, "never-list #5: the trust layer is not the reason a write fails");
    assert.notEqual(step.attest!.confidence, "exact", "the attest degrades honestly — never a fabricated observation");
  });
});

test("W3-S4 / I-18 (gate): the same drift refuses BEFORE anything dispatches — no probe, no write", async () => {
  await withTempDir(async (dir) => {
    const { record, probeCalls, writeCalls } = await runBound(dir, { target: "attacker-controlled-page" }, { stateGate: "refuse" });
    const step = record.steps[0];
    assert.deepEqual(probeCalls, [], "ZERO probe dispatches");
    assert.deepEqual(writeCalls, [], "ZERO write dispatches");
    assert.equal(step.stateCheck!.outcome, "unevaluated");
    assert.equal(step.stateCheck!.action, "refused");
    assert.equal(step.stateCheck!.reason, "probe-args-mismatch: filled probe args differ from the approved ones");
    assert.equal(step.write, undefined, "dispatch provably never issued");
    assert.equal(step.outcome, "failed");
  });
});

test("W3-S4 / I-18: a MISSING run --var is the same class — unfilled is not the approved filled shape", async () => {
  await withTempDir(async (dir) => {
    const { record, probeCalls, writeCalls } = await runBound(dir, {});
    assert.deepEqual(probeCalls, []);
    assert.equal(record.steps[0].stateCheck!.reason, "probe-args-mismatch: filled probe args differ from the approved ones");
    assert.equal(writeCalls.length, 1, "recorder still fails open");
  });
});

test("W3-S4: a MATCHING run --var flows normally — probes dispatch, the comparison lands match", async () => {
  await withTempDir(async (dir) => {
    const { record, probeCalls, writeCalls } = await runBound(dir, { target: "reelier-demo-page" });
    assert.equal(record.steps[0].stateCheck!.outcome, "match");
    assert.equal(record.steps[0].stateCheck!.action, "proceeded");
    assert.equal(probeCalls.length, 2, "pre and post both dispatch once the args are proven approved");
    assert.deepEqual(probeCalls[0], { slug: "reelier-demo-page" });
    assert.equal(writeCalls.length, 1);
  });
});

test("W3-S4: THE BIND-COLLISION PIN — a step-output bind: named like the placeholder never reaches a dispatched probe arg", async () => {
  // The runner fills probe args from the WHOLE bindings map, which merges
  // --vars with step-output binds. A `bind:` colliding with a probe-arg
  // placeholder name IS the exfiltration channel: an earlier step's live
  // output would ride out through the probe URL. Probe args on a bound step
  // fill from run --vars ONLY, so the collision cannot fill anything — and
  // the unfilled shape is not the approved one, so nothing dispatches.
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    const twoStep = `---
name: bind-collision
description: step 1 binds a name that step 2's probe args also use as a placeholder
---

### Step 1 — read a secret
- intent: read
- action: get_page {"slug":"secrets"}
- effect: read
- bind: target = json.compiled_truth

### Step 2 — Capture a page into gbrain
- intent: w
- action: put_page {"content":"# hi","slug":"reelier-demo-page"}
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"{{target}}"},"projection":["compiled_truth"]}
`;
    await writeFile(skillPath, twoStep, "utf8");
    const bindTools = spyTools({ body: { compiled_truth: "reelier-demo-page" } });
    await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"], { target: "reelier-demo-page" }), deps(dir, { tools: bindTools.tools })),
    );
    const skill = parseSkill(await readFile(skillPath, "utf8"));
    assert.notEqual(skill.steps[1].expect, undefined, "step 2 really is bound");

    // Now the world hands step 1 a SECRET, which its bind would inject.
    const { tools, probeCalls } = spyTools({ body: { compiled_truth: "sk-live-EXFILTRATED-SECRET" } });
    const record = await runSkill(skill, {
      tools,
      vars: {}, // no --var: the ONLY way `target` could fill is the colliding bind
      cwd: dir,
      expectKeystorePath: path.join(dir, "expect-keys.json"),
    });

    const dispatched = JSON.stringify(probeCalls);
    assert.ok(!dispatched.includes("sk-live-EXFILTRATED-SECRET"), `a bound value reached a probe arg: ${dispatched}`);
    assert.equal(record.steps[1].stateCheck!.reason, "probe-args-mismatch: filled probe args differ from the approved ones");
    assert.equal(record.steps[1].stateCheck!.observedAt, undefined);
  });
});

test("W3-S4: transplant resistance — a probeArgs commitment lifted to another step matches nothing", async () => {
  await withTempDir(async (dir) => {
    const { key } = mintExpectKey();
    const args = { slug: "reelier-demo-page" };
    const mine = probeArgsMac(key, "get_page", args);
    assert.notEqual(probeArgsMac(mintExpectKey().key, "get_page", args), mine, "per-approval keys make a lifted commitment inert");
    assert.notEqual(probeArgsMac(key, "get_backlinks", args), mine, "the probe tool is bound into the commitment");
  });
});

// ===========================================================================
// Registry item 8: the 32-entry changedFields cap, untested until now
// ===========================================================================

// ===========================================================================
// Blocker 1 (wave-3 review, I-18) — `--drop-expect` and the interactive
// "Approve WITHOUT state binding?" downgrade must both REFUSE on a
// parameterized probe: stripping `expect` leaves the probe armed (attest
// present, approved) but ungated (the I-18 gate keys on
// `expect.probeArgs !== undefined`), so it would dispatch filling from the
// WHOLE bindings map again — exactly the channel this slice closed.
// ===========================================================================

test("W3-S4 review-fix (blocker 1a): --drop-expect refuses on a parameterized probe — nothing dropped, non-zero exit", async () => {
  await withTempDir(async (dir) => {
    const { skillPath, tools } = await bindParam(dir, { target: "reelier-demo-page" });
    const before = await readFile(skillPath, "utf8");
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["drop-expect", "all"]), deps(dir, { tools })),
    );
    assert.equal(code, 1, out);
    assert.match(
      out,
      /refusing to drop the binding on a parameterized probe — its args fill from run-time bindings, and without expect\.probeArgs nothing proves the filled args were approved\. Re-approve with --probe --var, or make the probe args literal\./,
    );
    assert.equal(await readFile(skillPath, "utf8"), before, "nothing written — the strip never persisted");
  });
});

test("W3-S4 review-fix (blocker 1a): --drop-expect interactively also refuses, without even asking to approve", async () => {
  await withTempDir(async (dir) => {
    const { skillPath, tools } = await bindParam(dir, { target: "reelier-demo-page" });
    const before = await readFile(skillPath, "utf8");
    const asked: string[] = [];
    const ask = async (q: string) => {
      asked.push(q);
      throw new Error(`unexpected prompt: ${q}`);
    };
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["drop-expect"]), deps(dir, { tools, ask })),
    );
    assert.equal(code, 1, out);
    assert.match(out, /refusing to drop the binding on a parameterized probe/);
    assert.deepEqual(asked, [], "outright refusal — never even asks");
    assert.equal(await readFile(skillPath, "utf8"), before);
  });
});

test("W3-S4 review-fix (blocker 1a): the interactive 'Approve WITHOUT state binding?' downgrade refuses on a parameterized probe, never asking", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_PARAM, "utf8");
    // A probe tool that always fails (not a placeholder problem — the
    // structural checks pass because --var fills the template), so the run
    // reaches the "not state-bindable" downgrade offer.
    const brokenTools: Record<string, Tool> = {
      get_page: {
        effect: "read",
        run: async () => {
          throw new Error("boom");
        },
      },
      put_page: { effect: "idempotent-write", run: async () => ({ status: 200, headers: {}, body: "{}" }) },
    };
    const asked: string[] = [];
    const ask = async (q: string) => {
      asked.push(q);
      throw new Error(`unexpected prompt: ${q}`);
    };
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe"], { target: "reelier-demo-page" }), deps(dir, { tools: brokenTools, ask })),
    );
    assert.equal(code, 1, out);
    assert.match(out, /refusing to drop the binding on a parameterized probe/);
    assert.deepEqual(asked, [], "never asks — the refusal is outright, not a declined prompt");
    assert.ok(!/expect:/.test(await readFile(skillPath, "utf8")), "nothing bound, nothing downgraded");
  });
});

test("W3-S4 review-fix (blocker 1a): a literal-args (non-parameterized) bound step still drops its binding fine via --drop-expect — no regression", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_PARAM.replace('"slug":"{{target}}"', '"slug":"reelier-demo-page"'), "utf8");
    const { tools } = spyTools({ body: { compiled_truth: "# hi" } });
    await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools })));
    const boundBefore = parseSkill(await readFile(skillPath, "utf8")).steps[0];
    assert.notEqual(boundBefore.expect, undefined, "fixture sanity: really bound");
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["drop-expect", "all"]), deps(dir, { tools })),
    );
    assert.equal(code, 0, out);
    const step = parseSkill(await readFile(skillPath, "utf8")).steps[0];
    assert.equal(step.expect, undefined, "binding dropped, as before");
  });
});

test("W3-S4 review-fix (blocker 1b, I-18): expect present + parameterized attest.args + NO probeArgs is a tampered/impossible shape — zero dispatches, unevaluated", async () => {
  await withTempDir(async (dir) => {
    // `reelier approve --probe` always commits probeArgs when the attest
    // template is parameterized, so this shape can only arise by hand-editing
    // the file after approval — but the approve HASH still has to match (the
    // runner's belt-and-suspenders check at src/runner.ts ~line 815), so we
    // recompute it over the tampered fields, exactly as a hand-editor with
    // access to computeApprovalHash could.
    const keystorePath = path.join(dir, "expect-keys.json");
    const { key, keyId } = mintExpectKey();
    await writeKeystoreEntry(keystorePath, keyId, { key: key.toString("base64"), createdAt: EXPECT_AT });
    const attest = { tool: "get_page", args: { slug: "{{target}}" }, projection: ["compiled_truth"] };
    const actionTool = "put_page";
    const actionArgs = { content: "# hi", slug: "reelier-demo-page" };
    const expect = { at: EXPECT_AT, keyId, pre: MAC_A }; // tampered: no probeArgs
    const approve = computeApprovalHash({ actionTool, actionArgs, attest, expect });
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(
      skillPath,
      `---
name: tampered
description: hand-crafted — expect present, attest.args parameterized, no probeArgs commitment
---

### Step 1 — w
- intent: i
- action: ${actionTool} ${JSON.stringify(actionArgs)}
- effect: idempotent-write
- attest: ${JSON.stringify(attest)}
- approve: ${approve}
- expect: ${JSON.stringify(expect)}
`,
      "utf8",
    );
    const skill = parseSkill(await readFile(skillPath, "utf8"));
    assert.equal(skill.steps[0].expect!.probeArgs, undefined, "fixture sanity: no probeArgs commitment");
    const { tools, probeCalls, writeCalls } = spyTools({ body: { compiled_truth: "# hi" } });
    const record = await runSkill(skill, {
      tools,
      vars: { target: "reelier-demo-page" },
      cwd: dir,
      expectKeystorePath: keystorePath,
    });
    const step = record.steps[0];
    assert.deepEqual(probeCalls, [], "ZERO probe dispatches — a tampered shape must never dispatch either");
    assert.equal(step.stateCheck!.outcome, "unevaluated");
    assert.equal(step.stateCheck!.action, "proceeded", "recorder mode still fails open on the write");
    assert.equal(step.stateCheck!.reason, "probe-args-mismatch: filled probe args differ from the approved ones");
    assert.equal(step.stateCheck!.observedAt, undefined, "unevaluated before any observation");
    assert.equal(writeCalls.length, 1, "never-list #5: the trust layer is not the reason a write fails");
  });
});

test("W3-S4 review-fix (blocker 1b, I-18 gate mode): the same tampered shape refuses BEFORE anything dispatches", async () => {
  await withTempDir(async (dir) => {
    const keystorePath = path.join(dir, "expect-keys.json");
    const { key, keyId } = mintExpectKey();
    await writeKeystoreEntry(keystorePath, keyId, { key: key.toString("base64"), createdAt: EXPECT_AT });
    const attest = { tool: "get_page", args: { slug: "{{target}}" }, projection: ["compiled_truth"] };
    const actionTool = "put_page";
    const actionArgs = { content: "# hi", slug: "reelier-demo-page" };
    const expect = { at: EXPECT_AT, keyId, pre: MAC_A };
    const approve = computeApprovalHash({ actionTool, actionArgs, attest, expect });
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(
      skillPath,
      `---
name: tampered
description: d
---

### Step 1 — w
- intent: i
- action: ${actionTool} ${JSON.stringify(actionArgs)}
- effect: idempotent-write
- attest: ${JSON.stringify(attest)}
- approve: ${approve}
- expect: ${JSON.stringify(expect)}
`,
      "utf8",
    );
    const skill = parseSkill(await readFile(skillPath, "utf8"));
    const { tools, probeCalls, writeCalls } = spyTools({ body: { compiled_truth: "# hi" } });
    const record = await runSkill(skill, {
      tools,
      vars: { target: "reelier-demo-page" },
      cwd: dir,
      expectKeystorePath: keystorePath,
      stateGate: "refuse",
    });
    const step = record.steps[0];
    assert.deepEqual(probeCalls, [], "ZERO probe dispatches");
    assert.deepEqual(writeCalls, [], "ZERO write dispatches");
    assert.equal(step.stateCheck!.outcome, "unevaluated");
    assert.equal(step.stateCheck!.action, "refused");
    assert.equal(step.stateCheck!.reason, "probe-args-mismatch: filled probe args differ from the approved ones");
    assert.equal(step.write, undefined, "dispatch provably never issued");
    assert.equal(step.outcome, "failed");
  });
});

test("W3-S4: the 32-entry changedFields cap is real — a 40-field projection reports at most 32 names, each <= 120 chars", async () => {
  await withTempDir(async (dir) => {
    const names = Array.from({ length: 40 }, (_, i) => `f${String(i).padStart(2, "0")}`);
    const longName = "z".repeat(200);
    const projection = [...names, longName];
    const before: Record<string, unknown> = Object.fromEntries(projection.map((n) => [n, "before"]));
    const after: Record<string, unknown> = Object.fromEntries(projection.map((n) => [n, "after"]));
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(
      skillPath,
      `---
name: wide
description: d
---

### Step 1 — w
- intent: i
- action: put_page {"slug":"s"}
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"s"},"projection":${JSON.stringify(projection)}}
`,
      "utf8",
    );
    const shared = { body: before };
    const bindTools = spyTools(shared);
    await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools: bindTools.tools })));
    const skill = parseSkill(await readFile(skillPath, "utf8"));

    const runShared = { body: after };
    const { tools } = spyTools(runShared);
    const record = await runSkill(skill, {
      tools,
      vars: {},
      cwd: dir,
      expectKeystorePath: path.join(dir, "expect-keys.json"),
    });
    const changed = record.steps[0].stateCheck!.changedFields!;
    assert.equal(changed.length, 32, "capped at 32 entries before it ever ships");
    for (const n of changed) assert.ok(n.length <= 120, `name over the 120-char cap: ${n.length}`);
  });
});
