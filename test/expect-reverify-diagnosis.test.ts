// W3-S3 of the wave-3 spec (§3 W3-S3, registry item 5 / P1.5 review N11):
// the approve-time re-verify already recomputes the whole-projection MAC and
// already holds the per-field commitments — so when it reports "the world has
// moved" it can say WHICH field moved, for free. Before this slice it threw
// that diagnosis away and left the operator to diff by hand.
//
// Two claims, two labels:
//   `fields changed since approval: <names>`   — the phrase P1.5 shipped on
//     the CLI mismatch render and W3-S1 mirrors onto the cloud. One claim,
//     one label, wherever an operator meets it.
//   `committed fields absent at re-verify: <names>` — honest HERE (unlike the
//     runner's A1-constrained execute-time claim) because `expect.fields`'
//     key set IS the disclosed approve-time field set, per the P1.5
//     accepted-disclosure record.
//
// Terminal output only: no record, no receipt, no new persisted claim, no
// grammar and no hash change. Everything else about the world-moved path —
// skip, count, exit code, what is written to disk — stays byte-identical.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cmdApprove, type ParsedArgs, type ApproveDeps } from "../src/cli.js";
import { parseSkill, type Step } from "../src/skill.js";
import { serializeSkill } from "../src/writeback.js";
import { computeApprovalHash } from "../src/approval.js";
import type { Tool } from "../src/tools.js";

/** Two projected fields, so changed-only / absent-only / both are all reachable. */
const SKILL_TWO_FIELD = `---
name: probe-two-field
description: one write step whose probe projects two fields
---

### Step 1 — Capture a page into gbrain
- intent: Save a small page into gbrain by slug
- action: put_page {"content":"# hi","slug":"reelier-demo-page"}
- assert: status == 200
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"reelier-demo-page"},"projection":["compiled_truth","content_flag"]}
`;

function fakeArgs(positional: string[], flags: string[] = []): ParsedArgs {
  return { positional, flags: new Set(flags), vars: {}, wraps: [], opts: {}, fails: [] };
}

/** get_page returns whatever `shared.body` currently holds; put_page must never dispatch (I-13). */
function fakeTools(shared: { body: Record<string, unknown> }) {
  const writeCalls: unknown[] = [];
  const tools: Record<string, Tool> = {
    get_page: {
      effect: "read",
      run: async () => ({ status: 200, headers: {}, body: JSON.stringify(shared.body) }),
    },
    put_page: {
      effect: "idempotent-write",
      run: async (args) => {
        writeCalls.push(args);
        return { status: 200, headers: {}, body: "{}" };
      },
    },
  };
  return { tools, writeCalls };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-reverify-diag-"));
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
  return {
    env: { REELIER_EXPECT_KEYS: path.join(dir, "expect-keys.json") },
    homedir: dir,
    isTTY: true,
    ...extra,
  };
}

/**
 * Bind step 1 against `body`, then move the world to `moved` and re-run
 * `approve --probe` with `flags`. Returns the second run's transcript, exit
 * code, and whether the file changed.
 */
async function bindThenMove(
  dir: string,
  body: Record<string, unknown>,
  moved: Record<string, unknown>,
  flags: string[] = ["probe", "all"],
  mutateAfterBind?: (skillPath: string) => Promise<void>,
) {
  const skillPath = path.join(dir, "s.skill.md");
  await writeFile(skillPath, SKILL_TWO_FIELD, "utf8");
  const shared = { body };
  const { tools, writeCalls } = fakeTools(shared);
  await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools })));
  if (mutateAfterBind) await mutateAfterBind(skillPath);
  const afterBind = await readFile(skillPath, "utf8");

  shared.body = moved;
  const { result: code, out } = await captureOutput(() =>
    cmdApprove(fakeArgs([skillPath], flags), deps(dir, { tools })),
  );
  return { code, out, afterBind, afterSecond: await readFile(skillPath, "utf8"), writeCalls, skillPath };
}

// ---------------------------------------------------------------------------
// The transcript matrix: changed-only, absent-only, both
// ---------------------------------------------------------------------------

test("W3-S3: world moved by a VALUE change → names the changed field, and no absence line", async () => {
  await withTempDir(async (dir) => {
    const { code, out } = await bindThenMove(
      dir,
      { compiled_truth: "# hi", content_flag: "clean" },
      { compiled_truth: "clobbered: another agent rewrote this page overnight", content_flag: "clean" },
    );
    assert.equal(code, 1, "world-moved under --all still exits non-zero");
    assert.match(out, /but the world has moved since /);
    assert.match(out, /^ {2}fields changed since approval: body\.compiled_truth$/m);
    assert.ok(!/committed fields absent at re-verify/.test(out), "nothing was absent — never print an empty claim");
    const changedLine = out.split("\n").find((l) => l.includes("fields changed since approval"))!;
    assert.ok(!changedLine.includes("content_flag"), "an unchanged field is never named as changed");
  });
});

test("W3-S3: world moved by an ABSENCE → prints ONLY the absence line (an all-absence divergence names no change)", async () => {
  await withTempDir(async (dir) => {
    const { code, out } = await bindThenMove(
      dir,
      { compiled_truth: "# hi", content_flag: "clean" },
      { compiled_truth: "# hi" }, // content_flag gone; compiled_truth byte-identical
    );
    assert.equal(code, 1);
    assert.match(out, /but the world has moved since /);
    assert.match(out, /^ {2}committed fields absent at re-verify: body\.content_flag$/m);
    assert.ok(
      !/fields changed since approval/.test(out),
      "no field's committed value differs — printing a change line would be a claim we did not earn",
    );
  });
});

test("W3-S3: both at once → both lines, changed first, each naming only its own fields", async () => {
  await withTempDir(async (dir) => {
    const { out } = await bindThenMove(
      dir,
      { compiled_truth: "# hi", content_flag: "clean" },
      { compiled_truth: "moved" },
    );
    assert.match(out, /^ {2}fields changed since approval: body\.compiled_truth$/m);
    assert.match(out, /^ {2}committed fields absent at re-verify: body\.content_flag$/m);
    assert.ok(
      out.indexOf("fields changed since approval") < out.indexOf("committed fields absent at re-verify"),
      "changed before absent — the same order the runner's mismatch stamp uses",
    );
  });
});

// ---------------------------------------------------------------------------
// Fieldless (pre-P1.5) bindings, and the paths that must gain no output
// ---------------------------------------------------------------------------

test("W3-S3: a FIELDLESS binding keeps today's whole-MAC report, verbatim — no diagnosis is fabricated", async () => {
  await withTempDir(async (dir) => {
    const stripFields = async (skillPath: string) => {
      const skill = parseSkill(await readFile(skillPath, "utf8"));
      const step = skill.steps[0];
      delete step.expect!.fields;
      step.approve = computeApprovalHash({
        actionTool: step.actionTool,
        actionArgs: step.actionArgs,
        attest: step.attest,
        expect: step.expect,
      });
      await writeFile(skillPath, serializeSkill(skill), "utf8");
    };
    const { code, out, afterBind, afterSecond } = await bindThenMove(
      dir,
      { compiled_truth: "# hi", content_flag: "clean" },
      { compiled_truth: "moved" },
      ["probe", "all"],
      stripFields,
    );
    assert.ok(!/"fields"/.test(afterBind), "the fixture really is a 0.25.0-era fieldless binding");
    assert.equal(code, 1);
    assert.match(out, /but the world has moved since /);
    assert.ok(!/fields changed since approval/.test(out), "a fieldless binding has no per-field evidence to report");
    assert.ok(!/committed fields absent at re-verify/.test(out));
    assert.equal(afterSecond, afterBind, "still nothing written");
  });
});

test("W3-S3: a MATCHING re-verify gains no new output at all", async () => {
  await withTempDir(async (dir) => {
    const { code, out, afterBind, afterSecond } = await bindThenMove(
      dir,
      { compiled_truth: "# hi", content_flag: "clean" },
      { compiled_truth: "# hi", content_flag: "clean" },
    );
    assert.equal(code, 0);
    assert.match(out, /unchanged \(state re-verified against current binding\)/);
    assert.ok(!/fields changed since approval/.test(out));
    assert.ok(!/committed fields absent at re-verify/.test(out));
    assert.equal(afterSecond, afterBind);
  });
});

test("W3-S3: a re-verify that cannot RUN stays its own loud class — no diagnosis is invented from nothing", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, SKILL_TWO_FIELD, "utf8");
    const shared = { body: { compiled_truth: "# hi", content_flag: "clean" } as Record<string, unknown> };
    const { tools } = fakeTools(shared);
    await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools })));

    // The probe now fails outright: no observation exists, so neither claim can be made.
    const broken: Record<string, Tool> = {
      ...tools,
      get_page: { effect: "read", run: async () => { throw new Error("connection reset"); } },
    };
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools: broken })),
    );
    assert.equal(code, 1);
    assert.match(out, /re-verify unavailable \(/);
    assert.ok(!/fields changed since approval/.test(out));
    assert.ok(!/committed fields absent at re-verify/.test(out));
  });
});

// ---------------------------------------------------------------------------
// A2: this is a NAMES claim, so it prints on every path — TTY and --all alike
// ---------------------------------------------------------------------------

test("W3-S3: the diagnosis is names-only, so it prints under --all and non-TTY exactly as on a TTY (A2 governs VALUES)", async () => {
  await withTempDir(async (dir) => {
    const moved = { compiled_truth: "moved", content_flag: "clean" };
    const start = { compiled_truth: "# hi", content_flag: "clean" };

    const scripted = await withTempDir(async (ttyDir) => {
      const skillPath = path.join(ttyDir, "s.skill.md");
      await writeFile(skillPath, SKILL_TWO_FIELD, "utf8");
      const shared = { body: { ...start } as Record<string, unknown> };
      const { tools } = fakeTools(shared);
      const asked: string[] = [];
      await captureOutput(() =>
        cmdApprove(fakeArgs([skillPath], ["probe"]), deps(ttyDir, { tools, isTTY: true, ask: async (q) => (asked.push(q), "y") })),
      );
      shared.body = { ...moved };
      const { out } = await captureOutput(() =>
        cmdApprove(fakeArgs([skillPath], ["probe"]), deps(ttyDir, { tools, isTTY: true, ask: async (q) => (asked.push(q), "n") })),
      );
      return out;
    });
    assert.match(scripted, /^ {2}fields changed since approval: body\.compiled_truth$/m, "TTY path");
    assert.match(scripted, /body\.compiled_truth = /, "the TTY still shows values, as A2 allows");

    const { out: allOut } = await bindThenMove(dir, { ...start }, { ...moved }, ["probe", "all"]);
    assert.match(allOut, /^ {2}fields changed since approval: body\.compiled_truth$/m, "--all path");
    assert.ok(!/body\.compiled_truth = /.test(allOut), "A2 still withholds VALUES under --all — names are not values");
  });
});

// ---------------------------------------------------------------------------
// Nothing else about the path may move
// ---------------------------------------------------------------------------

test("W3-S3: skip / count / exit-code / no-write behavior on the moved world is byte-identical", async () => {
  await withTempDir(async (dir) => {
    const { code, out, afterBind, afterSecond, writeCalls } = await bindThenMove(
      dir,
      { compiled_truth: "# hi", content_flag: "clean" },
      { compiled_truth: "moved" },
    );
    assert.equal(code, 1);
    assert.match(out, /skipped \(world moved\): 1/);
    assert.match(out, / {2}skipped \(world moved\) — pass --rebind to re-bind to the current state/);
    assert.equal(afterSecond, afterBind, "report-only: the binding is left exactly as it was (A14)");
    assert.deepEqual(writeCalls, [], "no write tool ever dispatches during an approval ceremony (I-13)");
  });
});

test("W3-S3: --rebind still re-binds, and the diagnosis is printed before the consent is taken", async () => {
  await withTempDir(async (dir) => {
    const { code, out, afterBind, afterSecond } = await bindThenMove(
      dir,
      { compiled_truth: "# hi", content_flag: "clean" },
      { compiled_truth: "moved", content_flag: "clean" },
      ["probe", "all", "rebind"],
    );
    assert.equal(code, 0);
    assert.match(out, /re-bound to current state/);
    assert.notEqual(afterSecond, afterBind, "--rebind is consent, and consent re-binds");
    assert.match(out, /^ {2}fields changed since approval: body\.compiled_truth$/m);
    assert.ok(
      out.indexOf("fields changed since approval") >= 0 &&
        out.indexOf("fields changed since approval") < out.indexOf("re-bound to current state"),
      "the operator sees what moved before the re-bind is recorded",
    );
  });
});

test("W3-S3: the diagnosis never claims more than a name — no values, no forbidden phrases", async () => {
  await withTempDir(async (dir) => {
    const { out } = await bindThenMove(
      dir,
      { compiled_truth: "# hi", content_flag: "clean" },
      { compiled_truth: "a secret that must never be logged under --all", content_flag: "clean" },
    );
    const line = out.split("\n").find((l) => l.includes("fields changed since approval"))!;
    assert.ok(!line.includes("secret"), "a names-only claim never carries a value");
    for (const forbidden of [/verified/i, /\bsafe\b/i, /no drift/i, /\batomic\b/i, /guaranteed/i]) {
      assert.ok(!forbidden.test(line), `forbidden ${forbidden} in: ${line}`);
    }
  });
});

test("W3-S3: no grammar or hash change — the binding written by a --rebind is byte-shaped exactly as before", async () => {
  await withTempDir(async (dir) => {
    const { skillPath } = await bindThenMove(
      dir,
      { compiled_truth: "# hi", content_flag: "clean" },
      { compiled_truth: "moved", content_flag: "clean" },
      ["probe", "all", "rebind"],
    );
    const step = parseSkill(await readFile(skillPath, "utf8")).steps[0];
    assert.deepEqual(Object.keys(step.expect!).sort(), ["at", "fields", "keyId", "pre"]);
    assert.equal(
      step.approve,
      computeApprovalHash({ actionTool: step.actionTool, actionArgs: step.actionArgs, attest: step.attest, expect: step.expect }),
      "the hash formula is untouched by this slice",
    );
  });
});

// ---------------------------------------------------------------------------
// Review findings — the absence line must be EARNED, not merely derived from
// the file. Both cases below reach the same defect class from opposite sides:
// the line asserts "committed ... at approve time, absent now" for names that
// were never committed, and for fields that are present but unprojectable.
// ---------------------------------------------------------------------------

/** Re-stamp the file so a hand-edit to `expect` stays approval-hash-current. */
async function restamp(skillPath: string, edit: (step: Step) => void): Promise<void> {
  const skill = parseSkill(await readFile(skillPath, "utf8"));
  const step = skill.steps[0];
  edit(step);
  step.approve = computeApprovalHash({
    actionTool: step.actionTool,
    actionArgs: step.actionArgs,
    attest: step.attest,
    expect: step.expect,
  });
  await writeFile(skillPath, serializeSkill(skill), "utf8");
}

test("W3-S3 (review): a fields entry the projection never addresses is NEVER named as committed-and-absent", async () => {
  await withTempDir(async (dir) => {
    // The absent branch runs no MAC comparison, so a hand-added entry needs
    // only a syntactically valid hex value — not a forgeable MAC. Re-stamping
    // keeps the approval current, so the run reaches the diagnosis.
    const fake = `hmac-sha256:${"a".repeat(64)}`;
    const { out } = await bindThenMove(
      dir,
      { compiled_truth: "# hi", content_flag: "clean" },
      { compiled_truth: "moved", content_flag: "clean" },
      ["probe", "all"],
      (skillPath) =>
        restamp(skillPath, (step) => {
          step.expect!.fields!["body.never_projected"] = fake;
          step.expect!.fields!["constructor"] = fake;
          step.expect!.fields!["toString"] = fake;
        }),
    );
    const absentLine = out.split("\n").find((l) => l.includes("committed fields absent at re-verify")) ?? "";
    for (const fabricated of ["never_projected", "constructor", "toString"]) {
      assert.ok(
        !absentLine.includes(fabricated),
        `named ${fabricated} as committed-and-absent, but the projection never addresses it — unearned claim in: ${absentLine}`,
      );
    }
  });
});

// `null` first: a cleared flag is the commonest real shape here, and it is a
// one-token edit of the shipped fixture — which is exactly why the omission
// of it from the original matrix let the defect through.
for (const [label, moved] of [
  ["null (a cleared flag)", null],
  ["an object", { nested: true }],
  ["an array", [1, 2]],
] as const) {
  test(`W3-S3 (review): a projected field PRESENT as ${label} is never called absent`, async () => {
    await withTempDir(async (dir) => {
      const { out } = await bindThenMove(
        dir,
        { compiled_truth: "# hi", content_flag: "clean" },
        { compiled_truth: "moved", content_flag: moved },
      );
      const absentLine = out.split("\n").find((l) => l.includes("committed fields absent at re-verify")) ?? "";
      assert.ok(
        !absentLine.includes("content_flag"),
        `content_flag is in the observation — calling it absent is unearned: ${absentLine}`,
      );
      assert.match(
        out,
        /^ {2}committed fields the probe could not project at re-verify: body\.content_flag$/m,
        "the weaker, earned claim must still be made — silence would hide the divergence",
      );
    });
  });
}

test("W3-S3 (review): a committed field the projection never addresses is reported as the file oddity it is, not as a committed absence", async () => {
  await withTempDir(async (dir) => {
    const fake = `hmac-sha256:${"b".repeat(64)}`;
    const { out } = await bindThenMove(
      dir,
      { compiled_truth: "# hi", content_flag: "clean" },
      { compiled_truth: "moved", content_flag: "clean" },
      ["probe", "all"],
      (skillPath) => restamp(skillPath, (step) => { step.expect!.fields!["body.planted"] = fake; }),
    );
    assert.match(out, /^ {2}note: the binding commits fields this step never projects: body\.planted$/m);
  });
});

test("W3-S3 (review): a committed name that resolves through Object.prototype is never read as present", async () => {
  await withTempDir(async (dir) => {
    // `typed["toString"]` without an own-property guard resolves to
    // Object.prototype.toString — not undefined — so the name would flow into
    // the MAC comparison and land on the transcript as a CHANGED field.
    const fake = `hmac-sha256:${"c".repeat(64)}`;
    const { out } = await bindThenMove(
      dir,
      { compiled_truth: "# hi", content_flag: "clean" },
      { compiled_truth: "moved", content_flag: "clean" },
      ["probe", "all"],
      (skillPath) => restamp(skillPath, (step) => { step.expect!.fields!["toString"] = fake; }),
    );
    const changedLine = out.split("\n").find((l) => l.includes("fields changed since approval")) ?? "";
    assert.ok(!changedLine.includes("toString"), `prototype read leaked onto the transcript: ${changedLine}`);
  });
});

test("W3-S3 (review): a body that stops being JSON does not turn every committed body field into an absence claim", async () => {
  await withTempDir(async (dir) => {
    // A header keeps `typed` non-empty, so the whole-observation guard does
    // not fire and the diagnosis runs on a body that yielded nothing at all.
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(
      skillPath,
      SKILL_TWO_FIELD.replace(
        '"projection":["compiled_truth","content_flag"]',
        '"projection":["header.etag","compiled_truth","content_flag"]',
      ),
      "utf8",
    );
    const shared = { body: JSON.stringify({ compiled_truth: "# hi", content_flag: "clean" }), etag: "v1" };
    const tools: Record<string, Tool> = {
      get_page: {
        effect: "read",
        run: async () => ({ status: 200, headers: { etag: shared.etag }, body: shared.body }),
      },
      put_page: { effect: "idempotent-write", run: async () => ({ status: 200, headers: {}, body: "{}" }) },
    };
    await captureOutput(() => cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools })));

    shared.body = "<html>502 Bad Gateway</html>";
    shared.etag = "v2";
    const { out } = await captureOutput(() =>
      cmdApprove(fakeArgs([skillPath], ["probe", "all"]), deps(dir, { tools })),
    );
    const absentLine = out.split("\n").find((l) => l.includes("committed fields absent at re-verify")) ?? "";
    for (const field of ["compiled_truth", "content_flag"]) {
      assert.ok(
        !absentLine.includes(field),
        `the body did not parse, so nothing was observed for ${field} — absence is not what the probe established: ${absentLine}`,
      );
    }
  });
});
