// S8 of the state-conditioned-approval design (wave2 spec §5.5, §10 S8;
// built on the explicit founder go of 2026-07-30, recorded in the spec doc):
// gate mode — `state_gate: refuse` in .reelier/policy.yml turns the recorder's
// mismatch/unevaluated stamps into refusals BEFORE dispatch. The gate is an
// explicit per-repo opt-in, never a per-invocation flag (a flag is exactly
// the "talked out of it" surface the policy file exists to prevent, I-10).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parsePolicyStrict,
  loadPolicyForWrap,
  detectStateGateKey,
  resolveStateGateForRun,
  summarizePolicyForWrapStart,
} from "../src/policy.js";
import { parseSkill } from "../src/skill.js";
import { computeApprovalHash } from "../src/approval.js";
import { runSkill } from "../src/runner.js";
import { renderStateCheckLines } from "../src/attest-render.js";
import { mintExpectKey, expectMac, expectFieldMac, projectObservationTyped, writeKeystoreEntry } from "../src/expect-mac.js";
import { cmdRun } from "../src/cli.js";
import { runReplayTool } from "../src/serve.js";
import type { Tool } from "../src/tools.js";

// The two refusal strings are spec §5.5 verbatim — pinned as literals here
// (never asserted against the exported constant, which could drift in
// lockstep with a bad edit).
const REFUSAL_MISMATCH =
  "Refusing to dispatch write step: pre-state commitment mismatch — the world this approval was granted against has changed. " +
  "Re-approve with 'reelier approve --probe'. (--allow-writes/--yes do not override a state-gate refusal.)";
const refusalUnevaluated = (reason: string): string =>
  `Refusing to dispatch write step: pre-state binding could not be evaluated (${reason}) and this repo opts into the state gate. ` +
  "(--allow-writes/--yes do not override a state-gate refusal.)";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-s8-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Grammar: `state_gate: refuse` in the policy.yml subset
// ---------------------------------------------------------------------------

test("policy grammar: state_gate: refuse parses; any other value is a strict error naming the only mode", () => {
  const ok = parsePolicyStrict("version: 1\nstate_gate: refuse\ndeny:\n  - tool: gmail.*\n");
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.policy!.stateGate, "refuse");
  assert.equal(ok.policy!.deny.length, 1);

  const warn = parsePolicyStrict("state_gate: warn\n");
  assert.equal(warn.errors.length, 1);
  assert.match(warn.errors[0], /"state_gate: warn" is not supported — the only mode is "refuse"/);

  const empty = parsePolicyStrict("state_gate:\n");
  assert.ok(empty.errors.length >= 1, "a bare `state_gate:` (list header shape) must not silently opt in");

  const absent = parsePolicyStrict("version: 1\n");
  assert.deepEqual(absent.errors, []);
  assert.equal(absent.policy!.stateGate, undefined);
});

test("policy grammar: the wrap runtime ACCEPTS a state_gate file (adding the gate must never brick the wrap)", async () => {
  await withTempDir(async (dir) => {
    await mkdir(path.join(dir, ".reelier"), { recursive: true });
    await writeFile(path.join(dir, ".reelier", "policy.yml"), "state_gate: refuse\ndeny:\n  - tool: x_*\n", "utf8");
    const result = await loadPolicyForWrap(dir, path.join(dir, "nohome"));
    assert.equal(result.ok, true, "the wrap loader must not treat state_gate as an unknown key");
    assert.equal(result.policy.stateGate, "refuse");
    // The wrap banner names the gate and says WHERE it is enforced — the
    // wrap records, the run path gates; silence here would imply the wrap
    // itself refuses, which it never does.
    const banner = summarizePolicyForWrapStart(result).join("\n");
    assert.match(banner, /state_gate: refuse declared/);
    assert.match(banner, /reelier run/);
  });
});

// ---------------------------------------------------------------------------
// Textual opt-in detection (A3: strict consequences are scoped to files
// whose RAW TEXT contains a top-level state_gate key — a malformed file
// cannot opt a repo IN, and a comment is not intent)
// ---------------------------------------------------------------------------

test("detectStateGateKey: top-level key only — comments, indentation, and prefixed names never count", () => {
  assert.equal(detectStateGateKey("state_gate: refuse\n"), true);
  assert.equal(detectStateGateKey("version: 1\nstate_gate: refuse\n"), true);
  // Space before the colon: the subset parser rejects the LINE, but the
  // intent is unmistakable — the detector must catch it so the malformed
  // file fails CLOSED (more forgiving than the parser, in the safe
  // direction: toward refusing, never toward silently ignoring intent).
  assert.equal(detectStateGateKey("state_gate : refuse\n"), true);
  assert.equal(detectStateGateKey("# state_gate: refuse\n"), false);
  assert.equal(detectStateGateKey("  state_gate: refuse\n"), false);
  assert.equal(detectStateGateKey("my_state_gate: refuse\n"), false);
  assert.equal(detectStateGateKey("deny:\n  - tool: state_gate\n"), false);
  assert.equal(detectStateGateKey(""), false);
});

// ---------------------------------------------------------------------------
// Run-path resolution (§5.5): first existing candidate decides, whole-file
// (same precedence rule as loadPolicyForWrap — never a per-key merge)
// ---------------------------------------------------------------------------

test("resolveStateGateForRun: off with no files; refuse from a valid opt-in; project file decides even when only global has the gate", async () => {
  await withTempDir(async (dir) => {
    const home = path.join(dir, "home");
    assert.deepEqual(await resolveStateGateForRun(dir, home), { mode: "off" });

    // Global opt-in, no project file → global decides.
    await mkdir(path.join(home, ".reelier"), { recursive: true });
    await writeFile(path.join(home, ".reelier", "policy.yml"), "state_gate: refuse\n", "utf8");
    const viaGlobal = await resolveStateGateForRun(dir, home);
    assert.equal(viaGlobal.mode, "refuse");

    // A project file WITHOUT the key wins over a global WITH it — first
    // existing file decides, whole-file, exactly like loadPolicyForWrap.
    await mkdir(path.join(dir, ".reelier"), { recursive: true });
    await writeFile(path.join(dir, ".reelier", "policy.yml"), "version: 1\n", "utf8");
    assert.deepEqual(await resolveStateGateForRun(dir, home), { mode: "off" });

    // Project opt-in → refuse, and the resolution names the file.
    await writeFile(path.join(dir, ".reelier", "policy.yml"), "state_gate: refuse\n", "utf8");
    const viaProject = await resolveStateGateForRun(dir, home);
    assert.equal(viaProject.mode, "refuse");
    assert.ok((viaProject as { sourcePath: string }).sourcePath.includes(dir));
  });
});

test("resolveStateGateForRun: malformed WITH the key → refuse-run; malformed WITHOUT → off + gap warning (fail open)", async () => {
  await withTempDir(async (dir) => {
    const home = path.join(dir, "nohome");
    await mkdir(path.join(dir, ".reelier"), { recursive: true });

    await writeFile(path.join(dir, ".reelier", "policy.yml"), "state_gate: refuse\ndeny: [broken\n", "utf8");
    const withKey = await resolveStateGateForRun(dir, home);
    assert.equal(withKey.mode, "refuse-run");
    assert.ok((withKey as { errors: string[] }).errors.length >= 1);

    await writeFile(path.join(dir, ".reelier", "policy.yml"), "deny: [broken\n", "utf8");
    const withoutKey = await resolveStateGateForRun(dir, home);
    assert.equal(withoutKey.mode, "off");
    assert.match((withoutKey as { warning?: string }).warning ?? "", /malformed/);
    assert.match((withoutKey as { warning?: string }).warning ?? "", /state gate OFF/);
  });
});

// ---------------------------------------------------------------------------
// The gate at the runner (§5.5): refuse BEFORE dispatch on mismatch or
// unevaluated; match proceeds; recorder mode byte-identical when not opted in
// ---------------------------------------------------------------------------

function spiedTools(body: () => Record<string, unknown>) {
  const writes: unknown[] = [];
  const tools: Record<string, Tool> = {
    get_page: { effect: "read", run: async () => ({ status: 200, headers: {}, body: JSON.stringify(body()) }) },
    put_page: {
      effect: "idempotent-write",
      run: async (args) => {
        writes.push(args);
        return { status: 200, headers: {}, body: "{}" };
      },
    },
  };
  return { tools, writes };
}

/** A bound skill: expect + fields stamped by hand exactly as `approve --probe` would. `extraStep` appends a second write step, so a refusal's effect on the REST of the run is observable. */
async function boundSkill(dir: string, observedState: Record<string, unknown>, opts: { extraStep?: boolean } = {}) {
  const keystorePath = path.join(dir, "keys.json");
  const { key, keyId } = mintExpectKey();
  await writeKeystoreEntry(keystorePath, keyId, { key: key.toString("base64"), createdAt: "2026-07-30T00:00:00.000Z" });
  const typed = projectObservationTyped({ headers: {}, body: JSON.stringify(observedState) }, ["compiled_truth"]);
  const pre = expectMac(key, "get_page", typed);
  const fields = Object.fromEntries(
    Object.entries(typed).map(([name, value]) => [name, expectFieldMac(key, "get_page", name, value)])
  );
  const base = `---
name: s8-bound
description: d
---

### Step 1 — w
- intent: i
- action: put_page {"slug":"demo"}
- assert: status == 200
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"demo"},"projection":["compiled_truth"]}
- expect: ${JSON.stringify({ at: "2026-07-30T00:00:00.000Z", keyId, pre, fields })}
`;
  const probe = parseSkill(`${base}- approve: sha256:${"0".repeat(64)}\n`).steps[0];
  const hash = computeApprovalHash({ actionTool: probe.actionTool, actionArgs: probe.actionArgs, attest: probe.attest, expect: probe.expect });
  const tail = opts.extraStep
    ? `
### Step 2 — second write
- intent: must never run after a refusal
- action: put_page {"slug":"demo-2"}
- assert: status == 200
- effect: idempotent-write
`
    : "";
  return { skill: parseSkill(`${base}- approve: ${hash}\n${tail}`), keystorePath };
}

test("gate + mismatch: refused BEFORE dispatch — outcome failed, exact spec string, zero dispatches, no write/attest, diagnosis kept", async () => {
  await withTempDir(async (dir) => {
    const { skill, keystorePath } = await boundSkill(dir, { compiled_truth: "# v1" });
    const { tools, writes } = spiedTools(() => ({ compiled_truth: "# MOVED" }));
    const record = await runSkill(skill, { tools, expectKeystorePath: keystorePath, cwd: dir, stateGate: "refuse" });
    const step = record.steps[0];
    assert.equal(step.outcome, "failed");
    assert.equal(step.failures[0], REFUSAL_MISMATCH);
    assert.equal(step.stateCheck!.outcome, "mismatch");
    assert.equal(step.stateCheck!.action, "refused");
    // The earned per-field diagnosis survives the refusal — it's an
    // observation, and the observation happened.
    assert.deepEqual(step.stateCheck!.changedFields, ["body.compiled_truth"]);
    assert.equal(step.write, undefined, "no write block — dispatch provably never issued");
    assert.equal(step.attest, undefined, "no attest — nothing was executed to attest");
    assert.equal(writes.length, 0, "the write tool was never dispatched");
    assert.equal(record.totals.failed, 1);
  });
});

test("gate + match: dispatches and passes exactly as recorder mode would (the gate only refuses non-match)", async () => {
  await withTempDir(async (dir) => {
    const { skill, keystorePath } = await boundSkill(dir, { compiled_truth: "# v1" });
    const { tools, writes } = spiedTools(() => ({ compiled_truth: "# v1" }));
    const record = await runSkill(skill, { tools, expectKeystorePath: keystorePath, cwd: dir, stateGate: "refuse" });
    assert.equal(record.steps[0].outcome, "passed");
    assert.equal(record.steps[0].stateCheck!.outcome, "match");
    assert.equal(record.steps[0].stateCheck!.action, "proceeded");
    assert.equal(writes.length, 1);
  });
});

test("gate + unevaluated (key-unavailable): refused with the reason inside the spec string — revocation means fail-closed here", async () => {
  await withTempDir(async (dir) => {
    const { skill } = await boundSkill(dir, { compiled_truth: "# v1" });
    const { tools, writes } = spiedTools(() => ({ compiled_truth: "# v1" }));
    // Point at a keystore that does not exist: deletion IS revocation (C7).
    const record = await runSkill(skill, {
      tools,
      expectKeystorePath: path.join(dir, "no-such-keys.json"),
      cwd: dir,
      stateGate: "refuse",
    });
    const step = record.steps[0];
    assert.equal(step.outcome, "failed");
    assert.equal(step.stateCheck!.outcome, "unevaluated");
    assert.equal(step.stateCheck!.action, "refused");
    assert.equal(step.failures[0], refusalUnevaluated(step.stateCheck!.reason!));
    assert.match(step.failures[0], /key-unavailable/);
    assert.equal(writes.length, 0);
  });
});

test("I-10: --allow-writes/--yes do not override — gate refusal fires with every permissive flag set", async () => {
  await withTempDir(async (dir) => {
    const { skill, keystorePath } = await boundSkill(dir, { compiled_truth: "# v1" });
    const { tools, writes } = spiedTools(() => ({ compiled_truth: "# MOVED" }));
    const record = await runSkill(skill, {
      tools,
      expectKeystorePath: keystorePath,
      cwd: dir,
      stateGate: "refuse",
      allowWrites: true,
      allowDestructive: true,
    });
    assert.equal(record.steps[0].outcome, "failed");
    assert.equal(record.steps[0].stateCheck!.action, "refused");
    assert.equal(writes.length, 0);
  });
});

test("no opt-in: recorder mode untouched — the same mismatch stamps, dispatches, and passes (I-9)", async () => {
  await withTempDir(async (dir) => {
    const { skill, keystorePath } = await boundSkill(dir, { compiled_truth: "# v1" });
    const { tools, writes } = spiedTools(() => ({ compiled_truth: "# MOVED" }));
    const record = await runSkill(skill, { tools, expectKeystorePath: keystorePath, cwd: dir });
    assert.equal(record.steps[0].outcome, "passed");
    assert.equal(record.steps[0].stateCheck!.outcome, "mismatch");
    assert.equal(record.steps[0].stateCheck!.action, "stamped");
    assert.equal(writes.length, 1);
  });
});

test("gate + expect-less write: dispatches normally — the gate gates bindings, not writes in general", async () => {
  await withTempDir(async (dir) => {
    const { tools, writes } = spiedTools(() => ({}));
    const skill = parseSkill(`---
name: s8-plain
description: d
---

### Step 1 — w
- intent: i
- action: put_page {"slug":"demo"}
- assert: status == 200
- effect: idempotent-write
`);
    const record = await runSkill(skill, { tools, cwd: dir, stateGate: "refuse", allowWrites: true });
    assert.equal(record.steps[0].outcome, "passed");
    assert.equal(record.steps[0].stateCheck, undefined);
    assert.equal(writes.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Rendering honesty: a refused check never claims execution
// ---------------------------------------------------------------------------

test("render: refused mismatch says 'refused before dispatch', never the 'executed against' stamp; refused unevaluated names the gate", () => {
  const mismatchLines = renderStateCheckLines(
    {
      outcome: "mismatch",
      action: "refused",
      expectedAt: "2026-07-30T00:00:00.000Z",
      observedAt: "2026-07-30T01:00:00.000Z",
      changedFields: ["body.compiled_truth"],
    },
    undefined
  ).join("\n");
  assert.match(mismatchLines, /write refused before dispatch/);
  assert.match(mismatchLines, /fields changed since approval: body\.compiled_truth/);
  assert.doesNotMatch(mismatchLines, /executed against/, "nothing executed — the stamp copy would be a lie here");

  const unevalLines = renderStateCheckLines(
    { outcome: "unevaluated", action: "refused", expectedAt: "x", reason: "key-unavailable: keyId 'abc'" },
    undefined
  ).join("\n");
  assert.match(unevalLines, /not evaluated — key-unavailable/);
  assert.match(unevalLines, /write refused \(state gate\)/);

  // Forbidden phrases (§5.4) hold on the new surface too.
  for (const banned of ["verified", "safe", "no drift", "atomic", "guaranteed"]) {
    assert.ok(!mismatchLines.toLowerCase().includes(banned), `mismatch render contains "${banned}"`);
    assert.ok(!unevalLines.toLowerCase().includes(banned), `unevaluated render contains "${banned}"`);
    assert.ok(!REFUSAL_MISMATCH.toLowerCase().includes(banned), `refusal string contains "${banned}"`);
  }
});

// ---------------------------------------------------------------------------
// cmdRun: a malformed opt-in refuses the RUN before step 1 (fail closed —
// silently ignoring a declared operator intent is the one direction an
// opt-in gate must never fail)
// ---------------------------------------------------------------------------

test("BOM: a PowerShell-written (BOM-prefixed) opt-in still opts in — never a silent fail-open", async () => {
  // Review finding (blocking): Windows PowerShell 5.1's `>` and Out-File
  // write a UTF-8 BOM by default, so this is the LIKELIEST authoring path
  // on this project's own platform. A BOM masking the key made the gate
  // resolve OFF while warning that the file "contains no state_gate key" —
  // false, and it steers the operator away from the real defect.
  assert.equal(detectStateGateKey("﻿state_gate: refuse\n"), true);
  assert.deepEqual(parsePolicyStrict("﻿state_gate: refuse\n").errors, []);
  await withTempDir(async (dir) => {
    await mkdir(path.join(dir, ".reelier"), { recursive: true });
    await writeFile(path.join(dir, ".reelier", "policy.yml"), "﻿state_gate: refuse\n", "utf8");
    const resolved = await resolveStateGateForRun(dir, path.join(dir, "nohome"));
    assert.equal(resolved.mode, "refuse", "a BOM must never hide a declared opt-in");
  });
});

test("unreadable-but-existing policy file: warned as an UNKNOWN intent, never silently skipped to the next candidate", async () => {
  // Review finding: `catch { continue }` treated EACCES/EISDIR/locks as
  // file-absent — dropping a possible opt-in with no marker AND letting
  // the global file decide despite an existing project file.
  await withTempDir(async (dir) => {
    const home = path.join(dir, "home");
    await mkdir(path.join(home, ".reelier"), { recursive: true });
    await writeFile(path.join(home, ".reelier", "policy.yml"), "state_gate: refuse\n", "utf8");
    // A DIRECTORY at the project policy path: exists, unreadable as a file (EISDIR).
    await mkdir(path.join(dir, ".reelier", "policy.yml"), { recursive: true });
    const resolved = await resolveStateGateForRun(dir, home);
    assert.equal(resolved.mode, "off");
    assert.match((resolved as { warning?: string }).warning ?? "", /could not be read/);
    assert.match((resolved as { warning?: string }).warning ?? "", /UNKNOWN/);
  });
});

/**
 * The two real entrypoints (cmdRun, runReplayTool) build their own tool
 * registry, so these tests drive the http builtins with a stubbed global
 * fetch — the same technique test/serve.test.ts uses — rather than adding
 * a tools seam to production code. GET is the probe (read), POST is the
 * write; `moved` flips what the probe observes after binding.
 */
async function withStubbedFetch<T>(state: { body: () => string; posts: string[] }, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init?: { method?: string }) => {
    if ((init?.method ?? "GET") === "POST") state.posts.push(String(url));
    return {
      status: 200,
      ok: true,
      headers: new Headers(),
      text: async () => (init?.method === "POST" ? "{}" : state.body()),
    } as unknown as Response;
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

/** An http-builtin twin of boundSkill, written to disk exactly as `approve --probe` would leave it. */
async function writeHttpBoundSkill(dir: string, keystorePath: string, observed: Record<string, unknown>): Promise<string> {
  const { key, keyId } = mintExpectKey();
  await writeKeystoreEntry(keystorePath, keyId, { key: key.toString("base64"), createdAt: "2026-07-30T00:00:00.000Z" });
  const typed = projectObservationTyped({ headers: {}, body: JSON.stringify(observed) }, ["compiled_truth"]);
  const pre = expectMac(key, "http.get", typed);
  const base = `---
name: s8-http-bound
description: d
---

### Step 1 — w
- intent: i
- action: http.post {"url":"https://example.com/w","body":{"x":1}}
- assert: status == 200
- effect: idempotent-write
- attest: {"tool":"http.get","args":{"url":"https://example.com/s"},"projection":["compiled_truth"]}
- expect: ${JSON.stringify({ at: "2026-07-30T00:00:00.000Z", keyId, pre })}
`;
  const probe = parseSkill(`${base}- approve: sha256:${"0".repeat(64)}\n`).steps[0];
  const hash = computeApprovalHash({ actionTool: probe.actionTool, actionArgs: probe.actionArgs, attest: probe.attest, expect: probe.expect });
  const skillPath = path.join(dir, "gated.skill.md");
  await writeFile(skillPath, `${base}- approve: ${hash}\n`, "utf8");
  return skillPath;
}

test("cmdRun: a VALID opt-in threads into the runner — the drifted write is refused on the real CLI path", async () => {
  // Review finding: the one-line wiring from resolution to runSkill was
  // pinned by nothing — deleting it left all 955 tests green while every
  // opted-in repo silently reverted to recorder mode.
  await withTempDir(async (dir) => {
    const keystorePath = path.join(dir, "keys.json");
    const skillPath = await writeHttpBoundSkill(dir, keystorePath, { compiled_truth: "# v1" });
    await mkdir(path.join(dir, ".reelier"), { recursive: true });
    await writeFile(path.join(dir, ".reelier", "policy.yml"), "state_gate: refuse\n", "utf8");
    const state = { body: () => JSON.stringify({ compiled_truth: "# MOVED" }), posts: [] as string[] };

    const logs: string[] = [];
    const origLog = console.log;
    const origError = console.error;
    const origKeys = process.env.REELIER_EXPECT_KEYS;
    console.log = (msg: unknown) => logs.push(String(msg));
    console.error = (msg: unknown) => logs.push(String(msg));
    process.env.REELIER_EXPECT_KEYS = keystorePath;
    let code: number;
    try {
      code = await withStubbedFetch(state, () =>
        cmdRun(
          { positional: [skillPath], flags: new Set(["allow-writes"]), vars: {}, wraps: [], opts: {}, fails: [] },
          async () => {
            throw new Error("no downstream expected");
          },
          { cwd: dir, homedir: path.join(dir, "nohome") }
        )
      );
    } finally {
      console.log = origLog;
      console.error = origError;
      if (origKeys === undefined) delete process.env.REELIER_EXPECT_KEYS;
      else process.env.REELIER_EXPECT_KEYS = origKeys;
    }
    assert.equal(code, 1, "a refused run exits non-zero");
    assert.deepEqual(state.posts, [], "the gate refused before dispatch on the real CLI path");
    const out = logs.join("\n");
    assert.match(out, /Refusing to dispatch write step: pre-state commitment mismatch/);
    assert.match(out, /FAILED/);
  });
});

test("serve: the agent-facing reelier_replay tool honors the same opt-in — no bypass by picking the other entrypoint", async () => {
  // Review finding (BLOCKING): the gate resolved in cmdRun only, so an
  // agent driving `reelier serve`'s replay tool dispatched drifted writes
  // in an opted-in repo. The opt-in exists precisely because it cannot be
  // talked out of at invocation time (I-10) — a second ungated run path
  // makes the control a suggestion.
  await withTempDir(async (dir) => {
    const keystorePath = path.join(dir, "keys.json");
    const skillPath = await writeHttpBoundSkill(dir, keystorePath, { compiled_truth: "# v1" });
    await mkdir(path.join(dir, ".reelier"), { recursive: true });
    await writeFile(path.join(dir, ".reelier", "policy.yml"), "state_gate: refuse\n", "utf8");
    const state = { body: () => JSON.stringify({ compiled_truth: "# MOVED" }), posts: [] as string[] };

    const origKeys = process.env.REELIER_EXPECT_KEYS;
    process.env.REELIER_EXPECT_KEYS = keystorePath;
    try {
      const record = await withStubbedFetch(state, () => runReplayTool({ skillPath, cwd: dir, allowWrites: true }));
      assert.equal(record.steps[0].outcome, "failed");
      assert.equal(record.steps[0].stateCheck!.action, "refused");
      assert.equal(record.steps[0].write, undefined);
      assert.deepEqual(state.posts, [], "the MCP replay surface must not dispatch what 'reelier run' refuses");

      // And a malformed opt-in refuses the whole replay, same as cmdRun.
      await writeFile(path.join(dir, ".reelier", "policy.yml"), "state_gate: refuse\ndeny: [broken\n", "utf8");
      await assert.rejects(
        () => withStubbedFetch(state, () => runReplayTool({ skillPath, cwd: dir, allowWrites: true })),
        /Refusing to replay/
      );
    } finally {
      if (origKeys === undefined) delete process.env.REELIER_EXPECT_KEYS;
      else process.env.REELIER_EXPECT_KEYS = origKeys;
    }
  });
});

test("gate: a refused step is escalation-proof and stops the run — later steps never dispatch (I-15-adjacent)", async () => {
  // Review finding: refusals are escalation-proof only because the refusal
  // return omits `observation` (attemptEscalation is gated on it). Nothing
  // pinned that with escalation ENABLED, so a well-meant "richer records"
  // edit could silently make refusals L1/L2-healable. maxLevel 2 with NO
  // llm client: if a refusal ever reached escalation, this test breaks
  // loudly — which is the point.
  await withTempDir(async (dir) => {
    const { skill, keystorePath } = await boundSkill(dir, { compiled_truth: "# v1" }, { extraStep: true });
    const { tools, writes } = spiedTools(() => ({ compiled_truth: "# MOVED" }));
    const record = await runSkill(skill, {
      tools,
      expectKeystorePath: keystorePath,
      cwd: dir,
      stateGate: "refuse",
      allowWrites: true,
      maxLevel: 2,
    });
    assert.equal(record.steps[0].outcome, "failed");
    assert.equal(record.steps[0].level, 0, "a refusal is never healed");
    assert.equal(record.steps[0].escalationAttempted, undefined, "escalation never even started");
    assert.equal(record.steps[1].outcome, "skipped", "the run stops — later steps never dispatch");
    assert.equal(record.totals.llmInputTokens, 0);
    assert.equal(writes.length, 0);
  });
});

test("cmdRun: malformed policy WITH state_gate refuses the run loudly before anything else runs", async () => {
  await withTempDir(async (dir) => {
    await mkdir(path.join(dir, ".reelier"), { recursive: true });
    await writeFile(path.join(dir, ".reelier", "policy.yml"), "state_gate: refuse\ndeny: [broken\n", "utf8");
    let connected = 0;
    const errors: string[] = [];
    const origError = console.error;
    console.error = (msg: unknown) => errors.push(String(msg));
    try {
      const code = await cmdRun(
        { positional: [path.join(dir, "does-not-even-need-to-exist.skill.md")], flags: new Set(), vars: {}, wraps: [], opts: {}, fails: [] },
        async () => {
          connected++;
          throw new Error("unreachable");
        },
        { cwd: dir, homedir: path.join(dir, "nohome") }
      );
      assert.equal(code, 1);
    } finally {
      console.error = origError;
    }
    const all = errors.join("\n");
    assert.match(all, /state_gate/);
    assert.match(all, /reelier policy check/);
    assert.equal(connected, 0, "refused before any downstream wiring");
  });
});
