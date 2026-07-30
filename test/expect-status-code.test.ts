// W3-S5 of the wave-3 spec (§3 W3-S5; wave-2 §6.1.3's deferred absence-CAS):
// a `status.code` projection entry that reads the HTTP status, so "approve
// this write against a resource that is currently ABSENT" becomes expressible
// on substrates that distinguish absence — which, honestly, means the http
// builtins and not MCP.
//
// I-19 is permanent and load-bearing: a BARE `status` means the top-level body
// key named "status", forever. It already does in shipped skills (one lives in
// test/attest-approve-advisory.test.ts), and silently re-pointing it would
// change what an existing approval binds. Only `status.code` addresses the
// HTTP status; the body key literally named "status.code" stays addressable as
// `body.status.code`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cmdApprove, type ParsedArgs, type ApproveDeps } from "../src/cli.js";
import { parseSkill } from "../src/skill.js";
import { projectObservation } from "../src/runner.js";
import { projectObservationTyped } from "../src/expect-mac.js";
import type { Tool } from "../src/tools.js";

function obs(status: number, body: unknown, headers: Record<string, string> = {}) {
  return { status, headers, body: typeof body === "string" ? body : JSON.stringify(body) };
}

// ---------------------------------------------------------------------------
// Selection, in BOTH twins — the fork was sanctioned for the ENCODING, never
// the SELECTION, so these two must agree on every case below.
// ---------------------------------------------------------------------------

test("W3-S5: `status.code` reads the HTTP status, in both projection twins", () => {
  const o = obs(404, { compiled_truth: "x" });
  assert.deepEqual(projectObservation(o, ["status.code"]), { "status.code": "404" });
  assert.deepEqual(projectObservationTyped(o, ["status.code"]), { "status.code": 404 });
});

test("W3-S5: the typed twin keeps it a NUMBER — `404` and \"404\" must never commit alike (A6)", () => {
  const typed = projectObservationTyped(obs(404, {}), ["status.code"]);
  assert.equal(typeof typed["status.code"], "number");
  assert.notDeepEqual(typed, { "status.code": "404" });
});

test("W3-S5 / I-19: a BARE `status` is still the top-level body key, permanently", () => {
  const o = obs(404, { status: "active" });
  assert.deepEqual(projectObservation(o, ["status"]), { "body.status": "active" });
  assert.deepEqual(projectObservationTyped(o, ["status"]), { "body.status": "active" });
  // And when no such body key exists, a bare `status` projects NOTHING — it
  // does not quietly fall through to the HTTP status.
  assert.deepEqual(projectObservation(obs(404, { other: 1 }), ["status"]), {});
  assert.deepEqual(projectObservationTyped(obs(404, { other: 1 }), ["status"]), {});
});

test("W3-S5 / I-19: `body.status.code` is the escape hatch for a body key literally named that", () => {
  const o = obs(200, { "status.code": "from-the-body" });
  assert.deepEqual(projectObservation(o, ["body.status.code"]), { "body.status.code": "from-the-body" });
  assert.deepEqual(projectObservationTyped(o, ["body.status.code"]), { "body.status.code": "from-the-body" });
  // Same observation, the OTHER spelling: the HTTP status, not the body key.
  assert.deepEqual(projectObservationTyped(o, ["status.code"]), { "status.code": 200 });
});

test("W3-S5: `status.code` projects even when the body is absent, empty, or not JSON — that IS the point", () => {
  for (const body of ["", "not json", "[]", "null"]) {
    assert.deepEqual(projectObservationTyped({ status: 404, headers: {}, body }, ["status.code"]), { "status.code": 404 });
  }
});

test("W3-S5: bindings carrying neither spelling are byte-identical — zero-touch for every shipped skill", () => {
  const o = obs(200, { compiled_truth: "x", etag: "v1" }, { etag: "W/\"1\"" });
  for (const proj of [["compiled_truth"], ["body.etag"], ["header.etag"], ["compiled_truth", "header.etag"]]) {
    assert.deepEqual(projectObservation(o, proj), projectObservation(o, proj));
  }
  assert.deepEqual(projectObservation(o, ["compiled_truth", "header.etag"]), {
    "body.compiled_truth": "x",
    "header.etag": 'W/"1"',
  });
  assert.deepEqual(projectObservationTyped(o, ["compiled_truth", "header.etag"]), {
    "body.compiled_truth": "x",
    "header.etag": 'W/"1"',
  });
});

// ---------------------------------------------------------------------------
// Bind-time behavior: the MCP refusal, and the two fixed-point notes
// ---------------------------------------------------------------------------

function fakeArgs(positional: string[], flags: string[] = [], vars: Record<string, string> = {}): ParsedArgs {
  return { positional, flags: new Set(flags), vars, wraps: [], opts: {}, fails: [] };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-status-code-"));
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

const SKILL = (projection: string) => `---
name: status-bind
description: bind on the probed resource's HTTP status
---

### Step 1 — create the page
- intent: create
- action: put_page {"content":"# hi","slug":"reelier-demo-page"}
- assert: status == 200
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"reelier-demo-page"},"projection":${projection}}
`;

/** `server` set = a wrapped MCP tool; absent = an http builtin. That is the real bind-time predicate. */
function tools(kind: "mcp" | "http", status = 404, body: unknown = {}) {
  const probeCalls: unknown[] = [];
  const reg: Record<string, Tool> = {
    get_page: {
      effect: "read",
      ...(kind === "mcp" ? { server: "gbrain" } : {}),
      run: async (args) => {
        probeCalls.push(args);
        return { status, headers: {}, body: JSON.stringify(body) };
      },
    },
    put_page: {
      effect: "idempotent-write",
      ...(kind === "mcp" ? { server: "gbrain" } : {}),
      run: async () => ({ status: 200, headers: {}, body: "{}" }),
    },
  };
  return { tools: reg, probeCalls };
}

/**
 * The fixed-point lint family only — the unrelated manifest advisory is also
 * a `note:` line and always prints, so counting every note would pin the
 * wrong thing. "One note per binding" is a claim about THIS lint.
 */
const FIXED_POINT_NOTE_RE = /(binding on HTTP status|are version-class — mutated by every write|no version-class field in this projection)/;
function fixedPointNotes(out: string): string[] {
  return out.split("\n").filter((l) => FIXED_POINT_NOTE_RE.test(l));
}

test("W3-S5: approve --probe REFUSES to bind status.code through a wrapped MCP tool, naming A12", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL('["status.code"]'), "utf8");
    const { tools: reg, probeCalls } = tools("mcp", 200);
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools: reg })),
    );
    assert.equal(code, 1, "the standard --all degrade: skip, count, non-zero");
    assert.match(
      out,
      /skipped \(probe failed\): 'status\.code' cannot be state-bound through the MCP tool 'get_page' — MCP has no HTTP status, so an isError result is fabricated as 500 and flows through as a successful observation \(A12\): a binding stamped at 500 would MATCH on every future error/,
    );
    assert.ok(!/warning: /.test(out), "A7's precedent is REFUSE, not lint — a warn here would ship the misleading binding");
    assert.deepEqual(probeCalls, [], "refused structurally, before any dispatch");
    assert.equal(await readFile(skillPath, "utf8"), SKILL('["status.code"]'), "nothing stamped");
  });
});

test("W3-S5: the MCP refusal covers a MIXED projection too, and offers the interactive downgrade", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL('["compiled_truth","status.code"]'), "utf8");
    const { tools: reg } = tools("mcp", 200, { compiled_truth: "x" });
    const asked: string[] = [];
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe"]), deps(dir, { tools: reg, ask: async (q) => (asked.push(q), "n") })),
    );
    assert.match(out, /not state-bindable: 'status\.code' cannot be state-bound through the MCP tool/);
    assert.ok(
      asked.some((q) => /Approve WITHOUT state binding\? \(y\/N\)/.test(q)),
      `§4.4's explicit downgrade offer, never a silent one: ${JSON.stringify(asked)}`,
    );
    assert.equal(code, 0, "declining the downgrade is a skip, not an error, on the interactive path");
    assert.ok(!/expect:/.test(await readFile(skillPath, "utf8")));
  });
});

test("W3-S5: `status.code` binds fine on an http builtin — no server, a real status", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL('["status.code"]'), "utf8");
    const { tools: reg } = tools("http", 404);
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools: reg })),
    );
    assert.equal(code, 0, out);
    assert.match(out, /projected fields: status\.code/);
    const step = parseSkill(await readFile(skillPath, "utf8")).steps[0];
    assert.notEqual(step.expect, undefined, "an absence binding is expressible now");
    assert.deepEqual(Object.keys(step.expect!.fields!), ["status.code"]);
  });
});

test("W3-S5: the fixed-point note is CONDITIONAL and never claims self-invalidation as fact", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL('["status.code"]'), "utf8");
    const { tools: reg } = tools("http", 404);
    const { out } = await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools: reg })));
    assert.match(
      out,
      /note: binding on HTTP status — if the approved write creates or deletes the probed resource, this binding self-invalidates after its own first run \(fixed-point rule\); if the probe targets a resource the write leaves untouched, it is a fixed point/,
    );
    // The volatile-field warning claims mutation as FACT. For a guard probe of
    // a resource the write never touches that is affirmatively false — the
    // same false-consent-transcript class the P1.5 review fixed for header.etag.
    assert.ok(!/are version-class — mutated by every write/.test(out));
  });
});

test("W3-S5: ONE note per binding — the ABA else-branch must not also fire for a status.code-only projection", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL('["status.code"]'), "utf8");
    const { tools: reg } = tools("http", 404);
    const { out } = await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools: reg })));
    assert.ok(
      !/no version-class field in this projection/.test(out),
      "two notes on one binding is how operators learn to read none of them",
    );
    assert.equal(fixedPointNotes(out).length, 1, "exactly one fixed-point note per binding");
  });
});

test("W3-S5: a projection MIXING status.code with an ordinary field still gets exactly one note", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL('["compiled_truth","status.code"]'), "utf8");
    const { tools: reg } = tools("http", 200, { compiled_truth: "x" });
    const { out } = await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools: reg })));
    assert.match(out, /note: binding on HTTP status/);
    assert.equal(fixedPointNotes(out).length, 1, "exactly one fixed-point note per binding");
  });
});

test("W3-S5: a projection WITHOUT status.code keeps today's two-branch lint, byte-identical", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL('["compiled_truth"]'), "utf8");
    const { tools: reg } = tools("http", 200, { compiled_truth: "x" });
    const { out } = await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools: reg })));
    assert.match(out, /note: no version-class field in this projection/);
    assert.ok(!/binding on HTTP status/.test(out));
  });
});

// ---------------------------------------------------------------------------
// Absence, end to end: bind while absent, match while absent, mismatch on create
// ---------------------------------------------------------------------------

test("W3-S5: the absence loop — bind on 404, match while still absent, mismatch once it exists", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL('["status.code"]'), "utf8");
    const live = { status: 404 };
    const reg: Record<string, Tool> = {
      get_page: { effect: "read", run: async () => ({ status: live.status, headers: {}, body: "{}" }) },
      put_page: { effect: "idempotent-write", run: async () => ({ status: 200, headers: {}, body: "{}" }) },
    };
    const { result: bindCode } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools: reg })),
    );
    assert.equal(bindCode, 0);

    // Still absent → re-verify matches.
    const { result: sameCode, out: sameOut } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools: reg })),
    );
    assert.equal(sameCode, 0);
    assert.match(sameOut, /unchanged \(state re-verified against current binding\)/);

    // The resource now EXISTS → the binding's whole point: it stops matching.
    live.status = 200;
    const { result: movedCode, out: movedOut } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools: reg })),
    );
    assert.equal(movedCode, 1);
    assert.match(movedOut, /but the world has moved since /);
    assert.match(movedOut, /fields changed since approval: status\.code/, "W3-S3's diagnosis names it");
  });
});
