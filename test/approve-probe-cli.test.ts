// S3 of the state-conditioned-approval design (Wave 2 spec §4, §10 S3):
// `reelier approve --probe` — the approval ceremony that binds a yes to the
// observed world. Driven through cmdApprove's injectable deps (fake tools,
// scripted answers, tmp keystore): no subprocess, no stdin, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cmdApprove, type ParsedArgs, type ApproveDeps } from "../src/cli.js";
import { parseSkill } from "../src/skill.js";
import { computeApprovalHash } from "../src/approval.js";
import { readKeystore } from "../src/expect-mac.js";
import type { Tool } from "../src/tools.js";

const SKILL_BINDABLE = `---
name: probe-bindable
description: one write step with a literal, explicitly-projected probe
---

### Step 1 — Capture a page into gbrain
- intent: Save a small page into gbrain by slug
- action: put_page {"markdown":"# hi","slug":"reelier-demo-page","title":"Demo"}
- assert: status == 200
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"reelier-demo-page"},"projection":["compiled_truth"]}
`;

const SKILL_TWO_BINDABLE = `---
name: probe-two-bindable
description: two bindable write steps
---

### Step 1 — write one
- intent: w1
- action: put_page {"markdown":"# a","slug":"a","title":"A"}
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"a"},"projection":["compiled_truth"]}

### Step 2 — write two
- intent: w2
- action: put_page {"markdown":"# b","slug":"b","title":"B"}
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"b"},"projection":["compiled_truth"]}
`;

function fakeArgs(positional: string[], flags: string[] = []): ParsedArgs {
  return { positional, flags: new Set(flags), vars: {}, wraps: [], opts: {}, fails: [] };
}

/** A gbrain-shaped fake: get_page is a read returning a stable body; put_page records every dispatch (must stay at zero — I-13). */
function fakeTools(state: { body?: Record<string, unknown>; writeCalls?: unknown[]; readCalls?: unknown[] } = {}) {
  const body = state.body ?? { compiled_truth: "# hi" };
  const writeCalls = (state.writeCalls ??= []);
  const readCalls = (state.readCalls ??= []);
  const tools: Record<string, Tool> = {
    get_page: {
      effect: "read",
      run: async (args) => {
        readCalls.push(args);
        return { status: 200, headers: {}, body: JSON.stringify(body) };
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
  return { tools, writeCalls, readCalls, body };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-approve-probe-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Captures console.log AND process.stdout.write (the probing line uses write). */
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
    const result = await fn();
    return { result, out: chunks.join("") };
  } finally {
    console.log = origLog;
    (process.stdout as unknown as { write: typeof origWrite }).write = origWrite;
  }
}

function scriptedAsk(answers: string[], asked: string[] = []) {
  let i = 0;
  return {
    asked,
    ask: async (q: string) => {
      asked.push(q);
      if (i >= answers.length) throw new Error(`unexpected prompt: ${q}`);
      return answers[i++];
    },
  };
}

function deps(dir: string, extra: Partial<ApproveDeps> = {}): ApproveDeps {
  return {
    env: { REELIER_EXPECT_KEYS: path.join(dir, "expect-keys.json") },
    homedir: dir,
    isTTY: true,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The ceremony (§6.1.5 stage 2 transcript shape) — interactive happy path
// ---------------------------------------------------------------------------

test("approve --probe: full ceremony — probes, shows values (TTY), mints, stamps the trio, changelog names state-bound", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_BINDABLE, "utf8");
    const { tools, writeCalls } = fakeTools();
    const { ask, asked } = scriptedAsk(["y"]);
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe"]), deps(dir, { tools, ask }))
    );
    assert.equal(code, 0);
    // Transcript shape (spec §6.1.5 stage 2):
    assert.match(out, /attest: get_page \{"slug":"reelier-demo-page"\} → projection \[compiled_truth\]/);
    assert.match(out, /probing pre-state \(get_page\)… ok/);
    assert.match(out, /body\.compiled_truth = "# hi"/);
    assert.match(out, /\(values shown for review only — never written to any file\)/);
    assert.match(out, /pre-state commitment: hmac-sha256:[0-9a-f]{4}…[0-9a-f]{4} \(key [0-9a-f]{16} in .*expect-keys\.json — the key never enters the skill file or any record\)/);
    assert.match(out, /unapproved/);
    assert.ok(asked.some((q) => /Approve this step against this observed state\? \(y\/N\)/.test(q)));
    assert.match(out, /approved 1, skipped 0, unchanged 0 · state-bound 1/);

    // The stamped file: trio present, hash covers expect, changelog says state-bound.
    const written = await readFile(skillPath, "utf8");
    const skill = parseSkill(written);
    const step = skill.steps[0];
    assert.ok(step.expect);
    assert.match(step.expect!.pre, /^hmac-sha256:[0-9a-f]{64}$/);
    assert.equal(
      step.approve,
      computeApprovalHash({ actionTool: step.actionTool, actionArgs: step.actionArgs, attest: step.attest, expect: step.expect })
    );
    assert.match(written, /- approved 1 write step\(s\), 1 state-bound \(reelier approve --probe\)/);

    // The key never enters the skill file; the keystore holds it.
    assert.ok(!written.includes("keys"));
    const store = await readKeystore(path.join(dir, "expect-keys.json"));
    assert.ok(store.keys[step.expect!.keyId]);

    // I-13: the probe never dispatched a write.
    assert.equal(writeCalls.length, 0);
  });
});

test("approve --probe --all: values are NEVER printed (names only) — CI logs are retained artifacts (A2)", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_BINDABLE, "utf8");
    const { tools } = fakeTools();
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools, isTTY: true }))
    );
    assert.equal(code, 0);
    assert.ok(!out.includes('= "# hi"'), `values leaked into --all output:\n${out}`);
    assert.match(out, /projected fields: body\.compiled_truth/);
  });
});

test("approve --probe (non-TTY): names only, even interactively", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_BINDABLE, "utf8");
    const { tools } = fakeTools();
    const { ask } = scriptedAsk(["y"]);
    const { out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe"]), deps(dir, { tools, ask, isTTY: false }))
    );
    assert.ok(!out.includes('= "# hi"'));
    assert.match(out, /projected fields: body\.compiled_truth/);
  });
});

// ---------------------------------------------------------------------------
// Idempotency (§4.3, report-only per A14) and re-bind consent (A2)
// ---------------------------------------------------------------------------

test("second --probe run on an unchanged world prints 'unchanged (state re-verified…)' and writes nothing", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_BINDABLE, "utf8");
    const { tools } = fakeTools();
    await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools })));
    const afterFirst = await readFile(skillPath, "utf8");

    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools }))
    );
    assert.equal(code, 0);
    assert.match(out, /unchanged \(state re-verified against current binding\)/);
    assert.equal(await readFile(skillPath, "utf8"), afterFirst, "second --probe run must write nothing");
  });
});

test("--probe --all on a moved world: skips, counts, exits non-zero, re-binds NOTHING without --rebind (A2)", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_BINDABLE, "utf8");
    const shared = { body: { compiled_truth: "# hi" } as Record<string, unknown> };
    const { tools } = fakeTools(shared);
    await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools })));
    const afterFirst = await readFile(skillPath, "utf8");

    shared.body.compiled_truth = "clobbered: another agent rewrote this page overnight";
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools }))
    );
    assert.equal(code, 1, "a scripted approve that could not do what was asked must exit non-zero");
    assert.match(out, /but the world has moved since /);
    assert.match(out, /skipped \(world moved\): 1/);
    assert.equal(await readFile(skillPath, "utf8"), afterFirst, "no re-bind may happen without --rebind");
  });
});

test("--probe --all --rebind on a moved world: re-binds under a NEW key with explicit consent semantics", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_BINDABLE, "utf8");
    const shared = { body: { compiled_truth: "# hi" } as Record<string, unknown> };
    const { tools } = fakeTools(shared);
    await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools })));
    const firstKeyId = parseSkill(await readFile(skillPath, "utf8")).steps[0].expect!.keyId;

    shared.body.compiled_truth = "moved";
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all", "rebind"]), deps(dir, { tools }))
    );
    assert.equal(code, 0);
    assert.match(out, /re-bound to current state/);
    const step = parseSkill(await readFile(skillPath, "utf8")).steps[0];
    assert.notEqual(step.expect!.keyId, firstKeyId, "re-bind mints a fresh key (rotation = re-approval)");
    assert.equal(
      step.approve,
      computeApprovalHash({ actionTool: step.actionTool, actionArgs: step.actionArgs, attest: step.attest, expect: step.expect })
    );
    // Superseded key is NOT pruned (parallel checkouts / git revert — A10).
    const store = await readKeystore(path.join(dir, "expect-keys.json"));
    assert.ok(store.keys[firstKeyId]);
    assert.ok(store.keys[step.expect!.keyId]);
  });
});

// ---------------------------------------------------------------------------
// Mint order (§4.2.4): keystore BEFORE skill file — crash leaves an orphan
// key and an unmodified skill, never a keyless expect
// ---------------------------------------------------------------------------

test("a crash between keystore write and file write leaves an orphan key and an UNMODIFIED skill", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_TWO_BINDABLE, "utf8");
    const { tools } = fakeTools();
    // Step 1 gets consent (keystore entry lands); step 2's prompt throws —
    // cmdApprove dies before the single end-of-loop file write.
    let calls = 0;
    const ask = async (q: string) => {
      calls++;
      if (calls === 1) return "y";
      throw new Error("simulated crash mid-ceremony");
    };
    await assert.rejects(() => captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe"]), deps(dir, { tools, ask }))));
    assert.equal(await readFile(skillPath, "utf8"), SKILL_TWO_BINDABLE, "skill file must be untouched");
    const store = await readKeystore(path.join(dir, "expect-keys.json"));
    assert.equal(Object.keys(store.keys).length, 1, "the minted key survives as a harmless orphan");
  });
});

// ---------------------------------------------------------------------------
// Bindability refusals (§4.2.1 + A7) and degrade paths (§4.4)
// ---------------------------------------------------------------------------

const SKILL_PLACEHOLDER_ATTEST = `---
name: probe-placeholder-attest
description: attest args carry a run-time bind
---

### Step 1 — write
- intent: w
- action: put_page {"markdown":"# a","slug":"a","title":"A"}
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"{{page_slug}}"},"projection":["compiled_truth"]}
`;

const SKILL_DATEVAR_ATTEST = `---
name: probe-datevar-attest
description: attest args carry a computed date var
---

### Step 1 — write
- intent: w
- action: put_page {"markdown":"# a","slug":"a","title":"A"}
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"report-{{today}}"},"projection":["compiled_truth"]}
`;

const SKILL_PLACEHOLDER_ACTION = `---
name: probe-placeholder-action
description: action args carry a run-time bind (A7)
---

### Step 1 — write
- intent: w
- action: put_page {"markdown":"{{content}}","slug":"a","title":"A"}
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"a"},"projection":["compiled_truth"]}
`;

const SKILL_DEFAULT_PROJECTION = `---
name: probe-default-projection
description: attest without explicit projection
---

### Step 1 — write
- intent: w
- action: put_page {"markdown":"# a","slug":"a","title":"A"}
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"a"}}
`;

test("--probe --all refuses every non-bindable class: skip + count + non-zero, nothing stamped weaker", async () => {
  for (const [name, src, reasonRe] of [
    // W3-S4 relaxed P1's blanket literal-only rule exactly as far as an
    // operator-supplied --var reaches: a placeholder with NO --var to fill it
    // is still refused, still skipped, still non-zero, still stamps nothing.
    // (The filled case is pinned in test/expect-probe-args.test.ts.)
    ["placeholder attest (no --var)", SKILL_PLACEHOLDER_ATTEST, /placeholders with no --var supplied \(\{\{page_slug\}\}\)/],
    ["date-var attest", SKILL_DATEVAR_ATTEST, /computed date vars.*different observations/],
    ["placeholder action (A7)", SKILL_PLACEHOLDER_ACTION, /write-target honesty/],
    ["default projection", SKILL_DEFAULT_PROJECTION, /requires an explicit projection/],
  ] as const) {
    await withTempDir(async (dir) => {
      const skillPath = path.join(dir, "s.skill.md");
      await writeFile(skillPath, src, "utf8");
      const { tools, writeCalls } = fakeTools();
      const { result: code, out } = await captureOutput(() =>
        cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools }))
      );
      assert.equal(code, 1, `${name}: must exit non-zero`);
      assert.match(out, reasonRe, `${name}: reason line`);
      assert.match(out, /skipped \(probe failed\): 1/);
      assert.equal(await readFile(skillPath, "utf8"), src, `${name}: nothing may be stamped`);
      assert.equal(writeCalls.length, 0);
    });
  }
});

test("--probe interactive degrade: probe tool unknown → explicit 'Approve WITHOUT state binding?' downgrade stamps a plain approval", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_BINDABLE, "utf8");
    // Registry without get_page: the probe can't run at all.
    const tools: Record<string, Tool> = {
      put_page: { effect: "idempotent-write", run: async () => ({ status: 200, headers: {}, body: "{}" }) },
    };
    const { ask, asked } = scriptedAsk(["y"]);
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe"]), deps(dir, { tools, ask }))
    );
    assert.equal(code, 0);
    assert.ok(asked.some((q) => /Approve WITHOUT state binding\? \(y\/N\)/.test(q)));
    assert.match(out, /probe-tool-unknown/);
    const step = parseSkill(await readFile(skillPath, "utf8")).steps[0];
    assert.equal(step.expect, undefined, "downgrade stamps a plain shape-only approval");
    assert.equal(
      step.approve,
      computeApprovalHash({ actionTool: step.actionTool, actionArgs: step.actionArgs, attest: step.attest, expect: undefined })
    );
  });
});

test("I-13: --probe refuses a non-read probe tool (probe-not-read) and never dispatches it", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_BINDABLE, "utf8");
    const dispatched: unknown[] = [];
    const tools: Record<string, Tool> = {
      get_page: {
        effect: "idempotent-write", // hostile classification: the "probe" is actually a write
        run: async (args) => {
          dispatched.push(args);
          return { status: 200, headers: {}, body: "{}" };
        },
      },
      put_page: { effect: "idempotent-write", run: async () => ({ status: 200, headers: {}, body: "{}" }) },
    };
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools }))
    );
    assert.equal(code, 1);
    assert.match(out, /probe-not-read/);
    assert.equal(dispatched.length, 0, "a non-read probe tool must never be dispatched at approve time");
  });
});

test("--probe: empty projection refuses to bind (nothing to condition on)", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_BINDABLE, "utf8");
    const { tools } = fakeTools({ body: { unrelated_field: "x" } });
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools }))
    );
    assert.equal(code, 1);
    assert.match(out, /empty-projection: probe returned no declared fields/);
  });
});

// ---------------------------------------------------------------------------
// The fixed-point lint and ABA note (§6.1.2, §8.2.3)
// ---------------------------------------------------------------------------

test("--probe warns (warn-only) on version-class projection fields; notes ABA when none present", async () => {
  await withTempDir(async (dir) => {
    const volatileSkill = SKILL_BINDABLE.replace('"projection":["compiled_truth"]', '"projection":["updated_at"]');
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, volatileSkill, "utf8");
    const { tools } = fakeTools({ body: { updated_at: "2026-07-29" } });
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools }))
    );
    assert.equal(code, 0, "warn-only: the binding still lands");
    assert.match(out, /warning: projection field\(s\) updated_at are version-class/);
  });
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_BINDABLE, "utf8");
    const { tools } = fakeTools();
    const { out } = await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools })));
    assert.match(out, /note: no version-class field in this projection/);
  });
});

test("fixed-point lint sees through P1.5 namespaces: header.etag/body.etag warn, never the false ABA note", async () => {
  // Review finding (blocking): a prefix-blind lint printed "no version-class
  // field" — an affirmatively false consent-transcript line — for the MOST
  // version-class projection expressible, the exact fields namespaces exist
  // to reach (http's native etag / last-modified).
  await withTempDir(async (dir) => {
    const nsSkill = SKILL_BINDABLE.replace('"projection":["compiled_truth"]', '"projection":["header.etag","body.etag"]');
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, nsSkill, "utf8");
    const tools: Record<string, Tool> = {
      get_page: {
        effect: "read",
        run: async () => ({ status: 200, headers: { etag: 'W/"v7"' }, body: JSON.stringify({ etag: "b7" }) }),
      },
      put_page: { effect: "idempotent-write", run: async () => ({ status: 200, headers: {}, body: "{}" }) },
    };
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools }))
    );
    assert.equal(code, 0, "warn-only: the binding still lands");
    assert.match(out, /warning: projection field\(s\) header\.etag, body\.etag are version-class/);
    assert.doesNotMatch(out, /note: no version-class field in this projection/);
  });
});

// ---------------------------------------------------------------------------
// Without --probe: the §4.4 stale-binding refusal and --drop-expect
// ---------------------------------------------------------------------------

test("plain approve on a CHANGED state-bound step refuses with the spec's remedy string, exits non-zero", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_BINDABLE, "utf8");
    const { tools } = fakeTools();
    await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools })));

    // Hand-edit the action args: the approval (which covers expect) goes stale.
    const bound = await readFile(skillPath, "utf8");
    await writeFile(skillPath, bound.replace('"markdown":"# hi"', '"markdown":"# edited"'), "utf8");
    const before = await readFile(skillPath, "utf8");

    const { result: code, out } = await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["all"]), deps(dir)));
    assert.equal(code, 1);
    assert.match(out, /state-bound step changed — re-approve with --probe, or pass --drop-expect to approve without state binding/);
    assert.match(out, /skipped \(state-bound changed\): 1/);
    assert.equal(await readFile(skillPath, "utf8"), before, "nothing stamped");
  });
});

test("--drop-expect is the explicit downgrade: strips the binding and stamps a plain approval", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_BINDABLE, "utf8");
    const { tools } = fakeTools();
    await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools })));
    const bound = await readFile(skillPath, "utf8");
    await writeFile(skillPath, bound.replace('"markdown":"# hi"', '"markdown":"# edited"'), "utf8");

    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["all", "drop-expect"]), deps(dir))
    );
    assert.equal(code, 0);
    assert.match(out, /dropping state binding \(--drop-expect\)/);
    const step = parseSkill(await readFile(skillPath, "utf8")).steps[0];
    assert.equal(step.expect, undefined);
    assert.equal(
      step.approve,
      computeApprovalHash({ actionTool: step.actionTool, actionArgs: step.actionArgs, attest: step.attest, expect: undefined })
    );
  });
});

test("plain approve (no --probe) on an untouched bound step stays a no-op: 'unchanged', zero writes", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_BINDABLE, "utf8");
    const { tools } = fakeTools();
    await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools })));
    const afterBind = await readFile(skillPath, "utf8");
    const { result: code, out } = await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["all"]), deps(dir)));
    assert.equal(code, 0);
    assert.match(out, /unchanged/);
    assert.equal(await readFile(skillPath, "utf8"), afterBind);
  });
});

// ---------------------------------------------------------------------------
// Binding an ALREADY-approved (unbound) step: --probe adds the condition
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Review-round pins: flag conflict, informed re-bind, re-verify unavailability,
// keystore degrade, mixed outcomes
// ---------------------------------------------------------------------------

test("--probe --drop-expect is a refused flag conflict (blocking review finding: it bypassed the A2 rebind gate)", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_BINDABLE, "utf8");
    const shared = { body: { compiled_truth: "# hi" } as Record<string, unknown> };
    const { tools } = fakeTools(shared);
    await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools })));
    const bound = await readFile(skillPath, "utf8");

    shared.body.compiled_truth = "moved";
    const { result: code } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all", "drop-expect"]), deps(dir, { tools }))
    );
    assert.equal(code, 1);
    assert.equal(await readFile(skillPath, "utf8"), bound, "the conflict must re-bind NOTHING");
  });
});

test("interactive re-bind shows the new observation BEFORE consent (a yes is never blind)", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_BINDABLE, "utf8");
    const shared = { body: { compiled_truth: "# hi" } as Record<string, unknown> };
    const { tools } = fakeTools(shared);
    const first = scriptedAsk(["y"]);
    await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe"]), deps(dir, { tools, ask: first.ask })));

    shared.body.compiled_truth = "moved to a new value";
    const { ask, asked } = scriptedAsk(["y"]);
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe"]), deps(dir, { tools, ask }))
    );
    assert.equal(code, 0);
    const valueIdx = out.indexOf('body.compiled_truth = "moved to a new value"');
    assert.ok(valueIdx >= 0, `re-bind must display the observed values:\n${out}`);
    assert.ok(asked.some((q) => /Re-bind this approval to the current state\? \(y\/N\)/.test(q)));
    assert.match(out, /re-bound to current state/);
    // The consent prompt comes AFTER the display: the world-moved line
    // precedes the value line in the transcript.
    assert.ok(out.indexOf("but the world has moved") < valueIdx);
  });
});

test("interactive re-bind declined: skipped, exit 0, file unchanged", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_BINDABLE, "utf8");
    const shared = { body: { compiled_truth: "# hi" } as Record<string, unknown> };
    const { tools } = fakeTools(shared);
    await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools })));
    const bound = await readFile(skillPath, "utf8");

    shared.body.compiled_truth = "moved";
    const { ask } = scriptedAsk(["n"]);
    const { result: code } = await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe"]), deps(dir, { tools, ask })));
    assert.equal(code, 0, "an interactive decline is a human choice — exit 0");
    assert.equal(await readFile(skillPath, "utf8"), bound);
  });
});

test("re-verify unavailability (deleted key) is its own loud class: counted, non-zero, never 'unchanged'", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_BINDABLE, "utf8");
    const { tools } = fakeTools();
    await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools })));
    const bound = await readFile(skillPath, "utf8");

    // Revocation = deletion (spec §3.4): the whole keystore file goes away.
    await rm(path.join(dir, "expect-keys.json"), { force: true });
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools }))
    );
    assert.equal(code, 1, "an induced re-verify failure must never exit clean (A6/B7)");
    assert.match(out, /re-verify unavailable \(key-unavailable: keyId '[0-9a-f]{16}'\)/);
    assert.match(out, /re-verify unavailable: 1/);
    assert.ok(!/unchanged \(state re-verified/.test(out));
    assert.equal(await readFile(skillPath, "utf8"), bound, "binding left as-is");
  });
});

test("keystore unwritable is the §4.4 degrade class, not a crash: --all skips, counts, exits non-zero", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_BINDABLE, "utf8");
    // Point the keystore INSIDE a regular file so mkdir/write must fail.
    const blocker = path.join(dir, "blocker");
    await writeFile(blocker, "i am a file", "utf8");
    const { tools } = fakeTools();
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), {
        env: { REELIER_EXPECT_KEYS: path.join(blocker, "keys.json") },
        homedir: dir,
        isTTY: true,
        tools,
      })
    );
    assert.equal(code, 1);
    assert.match(out, /approve-probe-failed: keystore-unavailable/);
    assert.match(out, /skipped \(probe failed\): 1/);
    assert.equal(await readFile(skillPath, "utf8"), SKILL_BINDABLE, "nothing stamped");
  });
});

test("mixed --probe --all outcome: bindable step persists, non-bindable step skips, exit stays non-zero", async () => {
  await withTempDir(async (dir) => {
    const mixed = `---
name: probe-mixed
description: step 1 bindable, step 2 not
---

### Step 1 — bindable
- intent: w1
- action: put_page {"markdown":"# a","slug":"a","title":"A"}
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"a"},"projection":["compiled_truth"]}

### Step 2 — placeholder action (A7)
- intent: w2
- action: put_page {"markdown":"{{content}}","slug":"b","title":"B"}
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"b"},"projection":["compiled_truth"]}
`;
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, mixed, "utf8");
    const { tools } = fakeTools();
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools }))
    );
    assert.equal(code, 1, "the skipped class keeps the exit non-zero even though step 1 landed");
    assert.match(out, /approved 1, skipped 1, unchanged 0 · state-bound 1/);
    assert.match(out, /skipped \(probe failed\): 1/);
    const skill = parseSkill(await readFile(skillPath, "utf8"));
    assert.ok(skill.steps[0].expect, "step 1's binding persists");
    assert.equal(skill.steps[1].expect, undefined);
    assert.equal(skill.steps[1].approve, undefined, "step 2 must not be stamped weaker");
    assert.match(await readFile(skillPath, "utf8"), /- approved 1 write step\(s\), 1 state-bound \(reelier approve --probe\)/);
  });
});

test("interactive --probe on an approved-current unbindable step is a no-op: no prompt, no duplicate changelog", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    const noAttest = `---
name: probe-no-attest
description: write step without attest
---

### Step 1 — write
- intent: w
- action: put_page {"markdown":"# a","slug":"a","title":"A"}
- effect: idempotent-write
`;
    await writeFile(skillPath, noAttest, "utf8");
    const { tools } = fakeTools();
    await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["all"]), deps(dir)));
    const approved = await readFile(skillPath, "utf8");

    // scriptedAsk with NO answers: any prompt would throw.
    const { ask } = scriptedAsk([]);
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe"]), deps(dir, { tools, ask }))
    );
    assert.equal(code, 0);
    assert.match(out, /unchanged \(already approved; not state-bindable\)/);
    assert.equal(await readFile(skillPath, "utf8"), approved, "no restamp, no duplicate changelog line");
  });
});

test("--probe --all on a mixed skill: approved-current unbindable steps are 'unchanged', exit 0 (S7 integration finding)", async () => {
  await withTempDir(async (dir) => {
    const mixed = `---
name: probe-mixed-approved
description: step 1 bindable, step 2 attest-less — both pre-approved
---

### Step 1 — bindable
- intent: w1
- action: put_page {"markdown":"# a","slug":"a","title":"A"}
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"a"},"projection":["compiled_truth"]}

### Step 2 — attest-less
- intent: w2
- action: put_page {"markdown":"# b","slug":"b","title":"B"}
- effect: idempotent-write
`;
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, mixed, "utf8");
    const { tools } = fakeTools();
    // Pre-approve everything shape-only (the seed pattern), THEN bind.
    await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["all"]), deps(dir)));
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools }))
    );
    assert.equal(code, 0, "an approved-current unbindable step must not fail a scripted bind pass");
    assert.match(out, /unchanged \(already approved; not state-bindable\)/);
    assert.match(out, /approved 1, skipped 0, unchanged 1 · state-bound 1/);
    const skill = parseSkill(await readFile(skillPath, "utf8"));
    assert.ok(skill.steps[0].expect, "the bindable step bound");
    assert.equal(skill.steps[1].expect, undefined);
  });
});

test("--probe binds a previously approved-but-unbound step (re-stamps: the hash now covers expect)", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_BINDABLE, "utf8");
    const { tools } = fakeTools();
    await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["all"]), deps(dir)));
    const plain = parseSkill(await readFile(skillPath, "utf8")).steps[0];
    assert.ok(plain.approve);
    assert.equal(plain.expect, undefined);

    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools }))
    );
    assert.equal(code, 0);
    assert.match(out, /state-bound 1/);
    const step = parseSkill(await readFile(skillPath, "utf8")).steps[0];
    assert.ok(step.expect);
    assert.notEqual(step.approve, plain.approve, "the approval hash moved: it now covers expect");
  });
});
