// Approval TTL — "expire as a no" (wave-5 T3).
//
// Reelier already had STATE-DRIFT expiry: `approve --probe` makes an approval
// die when the world moves. It had no TIME expiry. This adds one:
// `reelier approve --probe --expires 24h` resolves the duration against
// approve-time and stamps an ABSOLUTE ISO instant into `expect.expiresAt`.
// Absolute, not relative, because a stored duration would silently re-arm on
// every read — the opposite of expiring.
//
// The two controls are SIBLINGS, not variants, and a step may carry both:
//   --probe   → the approval dies when the world moves (state drift)
//   --expires → the approval dies when nobody answers (time)
// Neither is implemented in terms of the other, and neither swallows the other.
//
// The mechanism is deliberately small. An expired binding produces
// `stateCheck.outcome: "unevaluated"` with `reason: "approval-expired: …"`,
// and the EXISTING `state_gate: refuse` branch already refuses every
// non-`match` outcome before dispatch. There is no second gate path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseDuration, MAX_APPROVAL_TTL_MS } from "../src/duration.js";
import { parseSkill, SkillParseError } from "../src/skill.js";
import { serializeSkill } from "../src/writeback.js";
import { computeApprovalHash } from "../src/approval.js";
import { runSkill } from "../src/runner.js";
import { cmdApprove, type ParsedArgs, type ApproveDeps } from "../src/cli.js";
import { mintExpectKey, expectMac, expectFieldMac, projectObservationTyped, writeKeystoreEntry } from "../src/expect-mac.js";
import { renderStateCheckLines, stateCheckFindingsCount, findingsSummaryTag } from "../src/attest-render.js";
import type { Tool } from "../src/tools.js";

const EXPECT_AT = "2026-07-30T06:58:12.331Z";
const KEY_ID = "3c9a01d2e4f5b6a7";
const MAC_A = `hmac-sha256:${"a".repeat(64)}`;
const MAC_B = `hmac-sha256:${"b".repeat(64)}`;

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-ttl-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function captureOutput<T>(fn: () => Promise<T>): Promise<{ result: T; out: string }> {
  const chunks: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  // `approve --probe` writes its progress line with a bare process.stdout.write
  // (no newline, so the spinner can overwrite it) — capture that too, or the
  // suite's output stops being pristine.
  const origWrite = process.stdout.write.bind(process.stdout);
  console.log = (msg: unknown) => chunks.push(`${String(msg)}\n`);
  console.error = (msg: unknown) => chunks.push(`${String(msg)}\n`);
  (process.stdout as unknown as { write: (c: string) => boolean }).write = (c: string) => {
    chunks.push(String(c));
    return true;
  };
  try {
    return { result: await fn(), out: chunks.join("") };
  } finally {
    console.log = origLog;
    console.error = origErr;
    (process.stdout as unknown as { write: typeof origWrite }).write = origWrite;
  }
}

function fakeArgs(positional: string[], flags: string[] = [], opts: Record<string, string> = {}): ParsedArgs {
  return { positional, flags: new Set(flags), vars: {}, wraps: [], opts, fails: [] };
}

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
// Task 1a — the duration parser. First one in src/: nothing existed.
// ===========================================================================

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test("parseDuration: a single integer + unit from {m,h,d}, in ms", () => {
  assert.equal(parseDuration("30m"), 30 * 60_000);
  assert.equal(parseDuration("1m"), 60_000);
  assert.equal(parseDuration("24h"), 24 * HOUR);
  assert.equal(parseDuration("1h"), HOUR);
  assert.equal(parseDuration("7d"), 7 * DAY);
  assert.equal(parseDuration("1d"), DAY);
});

test("parseDuration: returns null on every rejection and NEVER throws", () => {
  const rejected = [
    "0h", // an approval valid for zero time is a usage error, not a TTL
    "0m",
    "0d",
    "-1h",
    "-0h",
    "+1h",
    "", // empty
    "  ",
    "24", // bare number, no unit
    "h", // unit, no number
    "24s", // unknown unit — seconds are not an approval cadence
    "24w",
    "24H", // case-sensitive: the CLI grammar is lowercase
    "1.5h", // float
    "1e3h",
    " 24h", // whitespace is not silently trimmed into a valid duration
    "24h ",
    "24h30m", // combinations are out of scope, and must not parse as "24h"
    "24hx",
    "0x18h",
    "Infinity",
    "NaN",
  ];
  for (const bad of rejected) {
    let out: number | null | undefined;
    assert.doesNotThrow(() => {
      out = parseDuration(bad);
    }, `parseDuration(${JSON.stringify(bad)}) must never throw`);
    assert.equal(out, null, `parseDuration(${JSON.stringify(bad)}) should be null`);
  }
});

test("parseDuration: caps absurd values — an approval valid for 100 years is not an approval", () => {
  // The cap is documented and exact: anything at or under it parses, anything
  // over it is null. Pinned at the boundary in BOTH directions so a
  // wrong-side-of-the-fence regression is visible.
  assert.equal(MAX_APPROVAL_TTL_MS, 365 * DAY);
  assert.equal(parseDuration("365d"), MAX_APPROVAL_TTL_MS);
  assert.equal(parseDuration("366d"), null);
  assert.equal(parseDuration("8760h"), 365 * DAY);
  assert.equal(parseDuration("8761h"), null);
  assert.equal(parseDuration("99999999999999999999d"), null);
});

// ===========================================================================
// Task 1b — the TTL is under the approval hash.
//
// Byte-identity is pinned against LITERAL digests captured from the build
// BEFORE this slice touched computeApprovalHash (the same literals
// test/expect-probe-args.test.ts:176 pins for the probeArgs case). A restated
// formula would pass against its own bug.
// ===========================================================================

const HASH_BASE = {
  actionTool: "put_page",
  actionArgs: { content: "# hi", slug: "reelier-demo-page" },
  attest: { tool: "get_page", args: { slug: "reelier-demo-page" }, projection: ["compiled_truth"] },
};
const EXPECT_BARE = { at: EXPECT_AT, keyId: KEY_ID, pre: MAC_A };

test("TTL hash coverage: a skill with NO expect at all hashes byte-identically", () => {
  assert.equal(
    computeApprovalHash({ emit: undefined, ...HASH_BASE, attest: undefined, expect: undefined }),
    "sha256:380a406c04f06e6a2a4a3fa15a571459623d30e009f3e350802a4989e7ae83b7",
  );
  assert.equal(
    computeApprovalHash({ emit: undefined, ...HASH_BASE, expect: undefined }),
    "sha256:90e4fe48c0395762f04362e4a852d903dcfad25f58cdb26976400cef7e4be34b",
  );
});

test("TTL hash coverage: a binding with expect: but NO expiresAt hashes byte-identically", () => {
  assert.equal(computeApprovalHash({ emit: undefined, ...HASH_BASE, expect: EXPECT_BARE }), "sha256:d9a268d91e885f3c857f577b763e42280cd8a7087a6ec54b4af0323634f8cd43");
  assert.equal(
    computeApprovalHash({ emit: undefined, ...HASH_BASE, expect: { ...EXPECT_BARE, fields: { "body.compiled_truth": MAC_B } } }),
    "sha256:94bfc0642ba701105be0c47fada3ce02788b7c314edff53592b37269d40ed7ac",
  );
});

test("TTL hash coverage: adding expiresAt MOVES the hash, and changing it moves it again", () => {
  const bare = computeApprovalHash({ emit: undefined, ...HASH_BASE, expect: EXPECT_BARE });
  const a = computeApprovalHash({ emit: undefined, ...HASH_BASE, expect: { ...EXPECT_BARE, expiresAt: "2026-08-02T00:00:00.000Z" } });
  const b = computeApprovalHash({ emit: undefined, ...HASH_BASE, expect: { ...EXPECT_BARE, expiresAt: "2027-08-02T00:00:00.000Z" } });
  assert.notEqual(a, bare, "a TTL is under the yes, like everything else in expect:");
  assert.notEqual(b, a, "extending the TTL is a different approval");
});

test("TTL grammar: expiresAt accepts an ISO-8601 instant, rejects a relative duration and every other shape", () => {
  const ok = parseSkill(skillWithExpect(`{"at":"${EXPECT_AT}","expiresAt":"2026-08-02T00:00:00.000Z","keyId":"${KEY_ID}","pre":"${MAC_A}"}`));
  assert.equal(ok.steps[0].expect!.expiresAt, "2026-08-02T00:00:00.000Z");
  for (const bad of [`"24h"`, `"tomorrow"`, `"2026-08-02"`, `"2026/08/02T00:00:00Z"`, `""`, `42`, `null`, `{}`]) {
    assert.throws(
      () => parseSkill(skillWithExpect(`{"at":"${EXPECT_AT}","expiresAt":${bad},"keyId":"${KEY_ID}","pre":"${MAC_A}"}`)),
      SkillParseError,
      `should reject expiresAt ${bad}`,
    );
  }
});

test("TTL grammar: the closed unknown-key error names expiresAt, verbatim", () => {
  assert.throws(
    () => parseSkill(skillWithExpect(`{"at":"${EXPECT_AT}","keyId":"${KEY_ID}","pre":"${MAC_A}","nope":"x"}`)),
    (err: Error) => {
      assert.equal(
        err.message.split("\n")[0].includes(`Unknown 'expect' key "nope" — expected pre/keyId/at/expiresAt/fields/probeArgs`),
        true,
        err.message,
      );
      return true;
    },
  );
});

test("TTL grammar: serialization is alphabetical (at, expiresAt, fields, keyId, pre, probeArgs) and round-trips byte-stably", () => {
  const src = skillWithExpect(
    `{"at":"${EXPECT_AT}","expiresAt":"2026-08-02T00:00:00.000Z","fields":{"body.compiled_truth":"${MAC_A}"},"keyId":"${KEY_ID}","pre":"${MAC_A}","probeArgs":"${MAC_B}"}`,
  );
  const once = serializeSkill(parseSkill(src));
  assert.equal(serializeSkill(parseSkill(once)), once, "byte-stable round-trip");
  const line = once.split("\n").find((l) => l.startsWith("- expect:"))!;
  const order = ['"at"', '"expiresAt"', '"fields"', '"keyId"', '"pre"', '"probeArgs"'].map((k) => line.indexOf(k));
  assert.deepEqual(
    order,
    [...order].sort((x, y) => x - y),
    `alphabetical, matching canonicalJson's sort so file and hash input agree: ${line}`,
  );
});

// ===========================================================================
// Task 2 — expire at execute time.
// ===========================================================================

/** Spies on BOTH the probe and the write: "the probe never ran" is a claim only a spy at zero can make. */
function spiedTools(body: () => Record<string, unknown>) {
  const probes: unknown[] = [];
  const writes: unknown[] = [];
  const tools: Record<string, Tool> = {
    get_page: {
      effect: "read",
      run: async (args) => {
        probes.push(args);
        return { status: 200, headers: {}, body: JSON.stringify(body()) };
      },
    },
    put_page: {
      effect: "idempotent-write",
      run: async (args) => {
        writes.push(args);
        return { status: 200, headers: {}, body: "{}" };
      },
    },
  };
  return { tools, probes, writes };
}

/** A probe tool that EXPLODES if dispatched — proves expiry is decided before any call goes out. */
function explodingProbeTools() {
  const writes: unknown[] = [];
  const probes: unknown[] = [];
  const tools: Record<string, Tool> = {
    get_page: {
      effect: "read",
      run: async (args) => {
        probes.push(args);
        throw new Error("the probe must never be dispatched on an expired approval");
      },
    },
    put_page: {
      effect: "idempotent-write",
      run: async (args) => {
        writes.push(args);
        return { status: 200, headers: {}, body: "{}" };
      },
    },
  };
  return { tools, probes, writes };
}

const BOUND_AT = "2026-08-01T00:00:00.000Z";
const EXPIRES_AT = "2026-08-02T00:00:00.000Z";
const T_EXPIRY = Date.parse(EXPIRES_AT);

/**
 * A bound skill, stamped exactly as `approve --probe [--expires]` would.
 * `expiresAt: null` means no TTL — the 0.28.0 shape, byte-for-byte.
 */
async function boundSkill(
  dir: string,
  observedState: Record<string, unknown>,
  opts: { expiresAt?: string | null; tamperExpiresAt?: string } = {},
) {
  const keystorePath = path.join(dir, "keys.json");
  const { key, keyId } = mintExpectKey();
  await writeKeystoreEntry(keystorePath, keyId, { key: key.toString("base64"), createdAt: BOUND_AT });
  const typed = projectObservationTyped({ headers: {}, status: 200, body: JSON.stringify(observedState) }, ["compiled_truth"]);
  const pre = expectMac(key, "get_page", typed);
  const fields = Object.fromEntries(Object.entries(typed).map(([n, v]) => [n, expectFieldMac(key, "get_page", n, v)]));
  const expect = {
    at: BOUND_AT,
    ...(opts.expiresAt != null ? { expiresAt: opts.expiresAt } : {}),
    fields,
    keyId,
    pre,
  };
  const base = `---
name: ttl-bound
description: d
---

### Step 1 — w
- intent: i
- action: put_page {"slug":"demo"}
- assert: status == 200
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"demo"},"projection":["compiled_truth"]}
- expect: ${JSON.stringify(expect)}
`;
  const probeStep = parseSkill(`${base}- approve: sha256:${"0".repeat(64)}\n`).steps[0];
  const hash = computeApprovalHash({ emit: undefined,
    actionTool: probeStep.actionTool,
    actionArgs: probeStep.actionArgs,
    attest: probeStep.attest,
    expect: probeStep.expect,
  });
  // The tamper happens AFTER the hash is computed over the honest binding —
  // exactly what hand-editing the committed file does.
  const finalBase = opts.tamperExpiresAt !== undefined ? base.replace(JSON.stringify(expect.expiresAt ?? ""), JSON.stringify(opts.tamperExpiresAt)) : base;
  return { skill: parseSkill(`${finalBase}- approve: ${hash}\n`), keystorePath };
}

test("TTL end-to-end: hand-editing expiresAt in the file is an approval MISMATCH — the hole the hash closes", async () => {
  await withTempDir(async (dir) => {
    // Approved with a 1-day TTL; someone quietly extends it by a year.
    const { skill, keystorePath } = await boundSkill(dir, { compiled_truth: "# v1" }, {
      expiresAt: EXPIRES_AT,
      tamperExpiresAt: "2027-08-02T00:00:00.000Z",
    });
    const { tools, probes, writes } = spiedTools(() => ({ compiled_truth: "# v1" }));
    const record = await runSkill(skill, {
      tools,
      expectKeystorePath: keystorePath,
      cwd: dir,
      // Well before either instant: only the tamper can fail this run.
      now: Date.parse(BOUND_AT) + 1000,
    });
    const step = record.steps[0];
    assert.equal(step.outcome, "failed");
    assert.match(step.failures[0], /Approval mismatch on write step/);
    assert.equal(step.write, undefined, "no write block — dispatch never issued");
    assert.equal(writes.length, 0, "the write tool was never dispatched");
    assert.equal(probes.length, 0, "the probe never ran either — the mismatch is decided first");
  });
});

test("TTL recorder mode: an expired approval EXECUTES and stamps the finding — recorder records, gate refuses", async () => {
  await withTempDir(async (dir) => {
    const { skill, keystorePath } = await boundSkill(dir, { compiled_truth: "# v1" }, { expiresAt: EXPIRES_AT });
    const { tools, probes, writes } = spiedTools(() => ({ compiled_truth: "# v1" }));
    const record = await runSkill(skill, { tools, expectKeystorePath: keystorePath, cwd: dir, now: T_EXPIRY + 60_000 });
    const step = record.steps[0];
    assert.equal(step.stateCheck!.outcome, "unevaluated", "never a pass, and never a mismatch — its own reason");
    assert.match(step.stateCheck!.reason!, /^approval-expired: /);
    assert.equal(step.stateCheck!.action, "stamped", "the recorder stamps a finding it did not act on");
    assert.equal(step.stateCheck!.observedAt, undefined, "the VERDICT used no observation — the pre-probe never ran");
    assert.equal(writes.length, 1, "recorder mode does not block: the write dispatched");
    assert.ok(step.write, "and the receipt records it");

    // Founder decision 2026-08-01: the probes are ASYMMETRIC on purpose. The
    // pre-probe is skipped (the verdict is already decided, and a probe that
    // failed would mislabel it `probe-failed`); the post-probe RUNS, because
    // the write already went out and this is the receipt's only evidence of
    // what it actually did. Withholding it bought symmetry and cost the
    // operator the one thing they most want to see.
    assert.equal(probes.length, 1, "exactly one probe: the post side, not the pre side");
    assert.ok(step.attest, "an expired approval still attests");
    assert.equal(step.attest!.method, "declared-probe");
    assert.equal(step.attest!.confidence, "partial", "one-sided evidence is 'partial' — never 'absent', never 'exact'");
    assert.equal(step.attest!.pre, undefined, "no fabricated pre observation");
    assert.ok(step.attest!.post, "and a REAL post observation");
    assert.match(step.attest!.post!.hash, /^sha256:[0-9a-f]{64}$/);
    assert.match(step.attest!.reason!, /^pre: approval-expired: /, "the missing half is named honestly");
    assert.equal(step.attest!.delta, undefined, "no delta — a one-sided attest has nothing to compare");
  });
});

test("TTL gate mode: the post-probe asymmetry does NOT apply — no dispatch means nothing to observe afterward", async () => {
  await withTempDir(async (dir) => {
    const { skill, keystorePath } = await boundSkill(dir, { compiled_truth: "# v1" }, { expiresAt: EXPIRES_AT });
    const { tools, probes, writes } = spiedTools(() => ({ compiled_truth: "# v1" }));
    const record = await runSkill(skill, {
      tools,
      expectKeystorePath: keystorePath,
      cwd: dir,
      stateGate: "refuse",
      now: T_EXPIRY + 60_000,
    });
    assert.equal(record.steps[0].outcome, "failed");
    assert.equal(record.steps[0].attest, undefined);
    assert.equal(writes.length, 0);
    assert.equal(probes.length, 0, "neither probe — the refusal returns before the post side is reached");
  });
});

test("TTL gate mode: expired + state_gate refuse → failed, no write block, no attest, nothing dispatched", async () => {
  await withTempDir(async (dir) => {
    const { skill, keystorePath } = await boundSkill(dir, { compiled_truth: "# v1" }, { expiresAt: EXPIRES_AT });
    const { tools, probes, writes } = spiedTools(() => ({ compiled_truth: "# v1" }));
    const record = await runSkill(skill, {
      tools,
      expectKeystorePath: keystorePath,
      cwd: dir,
      stateGate: "refuse",
      now: T_EXPIRY + 60_000,
    });
    const step = record.steps[0];
    assert.equal(step.outcome, "failed");
    assert.equal(step.stateCheck!.outcome, "unevaluated");
    assert.equal(step.stateCheck!.action, "refused");
    assert.match(step.stateCheck!.reason!, /^approval-expired: /);
    assert.match(step.failures[0], /approval-expired/);
    assert.match(step.failures[0], /do not override a state-gate refusal/);
    assert.equal(step.write, undefined, "no write block — dispatch provably never issued");
    assert.equal(step.attest, undefined, "no attest — nothing was executed to attest");
    assert.equal(writes.length, 0, "the write tool was never dispatched");
    assert.equal(probes.length, 0, "and neither was the probe");
  });
});

test("TTL gate mode: no flag rescues an expired approval — --allow-writes and --yes are not consulted", async () => {
  await withTempDir(async (dir) => {
    const { skill, keystorePath } = await boundSkill(dir, { compiled_truth: "# v1" }, { expiresAt: EXPIRES_AT });
    const { tools, writes } = spiedTools(() => ({ compiled_truth: "# v1" }));
    const record = await runSkill(skill, {
      tools,
      expectKeystorePath: keystorePath,
      cwd: dir,
      stateGate: "refuse",
      allowWrites: true,
      allowDestructive: true,
      now: T_EXPIRY + 60_000,
    });
    assert.equal(record.steps[0].outcome, "failed");
    assert.equal(record.steps[0].stateCheck!.action, "refused");
    assert.match(record.steps[0].stateCheck!.reason!, /^approval-expired: /);
    assert.equal(writes.length, 0);
  });
});

test("TTL not yet expired: normal behaviour, and a record identical to the same run with no TTL at all", async () => {
  await withTempDir(async (dir) => {
    const before = T_EXPIRY - 60_000;
    const withTtl = await boundSkill(dir, { compiled_truth: "# v1" }, { expiresAt: EXPIRES_AT });
    const a = await runSkill(withTtl.skill, {
      tools: spiedTools(() => ({ compiled_truth: "# v1" })).tools,
      expectKeystorePath: withTtl.keystorePath,
      cwd: dir,
      now: before,
    });
    assert.equal(a.steps[0].outcome, "passed");
    assert.equal(a.steps[0].stateCheck!.outcome, "match");
    assert.equal(a.steps[0].stateCheck!.action, "proceeded");
    assert.equal(a.steps[0].stateCheck!.reason, undefined);

    const noTtl = await boundSkill(dir, { compiled_truth: "# v1" }, { expiresAt: null });
    const b = await runSkill(noTtl.skill, {
      tools: spiedTools(() => ({ compiled_truth: "# v1" })).tools,
      expectKeystorePath: noTtl.keystorePath,
      cwd: dir,
      now: before,
    });
    // Compare the stateCheck shape rather than the whole record: `ms` and the
    // wall-clock `observedAt`/`dispatchedAt` stamps are not clock-injected on
    // purpose (they measure the run, not the approval).
    assert.deepEqual(Object.keys(a.steps[0].stateCheck!).sort(), Object.keys(b.steps[0].stateCheck!).sort());
    assert.equal(a.steps[0].stateCheck!.outcome, b.steps[0].stateCheck!.outcome);
    assert.equal(a.steps[0].stateCheck!.action, b.steps[0].stateCheck!.action);
  });
});

test("TTL boundary: expiry is >= — the instant named in expiresAt is already expired, one ms earlier is not", async () => {
  await withTempDir(async (dir) => {
    const mk = () => boundSkill(dir, { compiled_truth: "# v1" }, { expiresAt: EXPIRES_AT });
    const justBefore = await mk();
    const atInstant = await mk();
    const a = await runSkill(justBefore.skill, {
      tools: spiedTools(() => ({ compiled_truth: "# v1" })).tools,
      expectKeystorePath: justBefore.keystorePath,
      cwd: dir,
      now: T_EXPIRY - 1,
    });
    assert.equal(a.steps[0].stateCheck!.outcome, "match", "one ms before the instant, the approval still holds");
    const b = await runSkill(atInstant.skill, {
      tools: spiedTools(() => ({ compiled_truth: "# v1" })).tools,
      expectKeystorePath: atInstant.keystorePath,
      cwd: dir,
      now: T_EXPIRY,
    });
    assert.equal(b.steps[0].stateCheck!.outcome, "unevaluated", "at the instant itself, it has expired (fail-closed boundary)");
    assert.match(b.steps[0].stateCheck!.reason!, /^approval-expired: /);
  });
});

test("TTL before probe: with a probe that throws if dispatched, an expired binding still reports approval-expired", async () => {
  await withTempDir(async (dir) => {
    const { skill, keystorePath } = await boundSkill(dir, { compiled_truth: "# v1" }, { expiresAt: EXPIRES_AT });
    const { tools, probes, writes } = explodingProbeTools();
    const record = await runSkill(skill, {
      tools,
      expectKeystorePath: keystorePath,
      cwd: dir,
      stateGate: "refuse",
      now: T_EXPIRY + 60_000,
    });
    const step = record.steps[0];
    assert.match(step.stateCheck!.reason!, /^approval-expired: /);
    assert.doesNotMatch(step.stateCheck!.reason!, /probe-failed/, "expiry is a pre-probe fact — never mislabelled as a probe failure");
    assert.equal(probes.length, 0, "the probe tool was never called");
    assert.equal(writes.length, 0);
  });
});

test("TTL composes with --probe: expired wins over state drift; unexpired drift still reports mismatch", async () => {
  await withTempDir(async (dir) => {
    // Both controls on one step, both would fire: the world moved AND the
    // clock ran out. Expiry is decided first, and says so honestly — it does
    // not claim the world moved, because it never looked.
    const expired = await boundSkill(dir, { compiled_truth: "# v1" }, { expiresAt: EXPIRES_AT });
    const drifted = spiedTools(() => ({ compiled_truth: "# MOVED" }));
    const a = await runSkill(expired.skill, {
      tools: drifted.tools,
      expectKeystorePath: expired.keystorePath,
      cwd: dir,
      now: T_EXPIRY + 60_000,
    });
    assert.equal(a.steps[0].stateCheck!.outcome, "unevaluated");
    assert.match(a.steps[0].stateCheck!.reason!, /^approval-expired: /);
    // The VERDICT consumed no observation — that is what "expiry needs no
    // probe" means, and `observedAt` is where it is visible. Recorder mode
    // still runs the POST probe afterwards (founder decision 2026-08-01), so
    // the spy sits at exactly one: the post side, never the pre side. Under
    // the gate it sits at zero, pinned separately.
    assert.equal(a.steps[0].stateCheck!.observedAt, undefined, "the expiry verdict looked at nothing");
    assert.equal(drifted.probes.length, 1, "post-probe only — the pre side never ran");

    // Same step, same drift, inside the TTL → the state-drift control fires
    // and the TTL does not swallow it.
    const fresh = await boundSkill(dir, { compiled_truth: "# v1" }, { expiresAt: EXPIRES_AT });
    const drifted2 = spiedTools(() => ({ compiled_truth: "# MOVED" }));
    const b = await runSkill(fresh.skill, {
      tools: drifted2.tools,
      expectKeystorePath: fresh.keystorePath,
      cwd: dir,
      now: T_EXPIRY - 60_000,
    });
    assert.equal(b.steps[0].stateCheck!.outcome, "mismatch");
    assert.equal(b.steps[0].stateCheck!.reason, undefined);
    assert.deepEqual(b.steps[0].stateCheck!.changedFields, ["body.compiled_truth"]);
    assert.ok(drifted2.probes.length > 0, "the probe DID run — this is the state-drift control, not the clock");
  });
});

test("TTL is inert on a binding without one: an expect: with no expiresAt never expires, at any clock", async () => {
  await withTempDir(async (dir) => {
    const { skill, keystorePath } = await boundSkill(dir, { compiled_truth: "# v1" }, { expiresAt: null });
    const { tools } = spiedTools(() => ({ compiled_truth: "# v1" }));
    const record = await runSkill(skill, {
      tools,
      expectKeystorePath: keystorePath,
      cwd: dir,
      stateGate: "refuse",
      now: Date.parse("2099-01-01T00:00:00.000Z"),
    });
    assert.equal(record.steps[0].outcome, "passed");
    assert.equal(record.steps[0].stateCheck!.outcome, "match");
  });
});

// ===========================================================================
// Task 3 — the CLI surface. `--expires` is a sibling of `--probe`, and the
// expect-only limitation is refused out loud rather than silently accepted.
// ===========================================================================

const CLI_SKILL = `---
name: ttl-cli
description: one write step with a declared probe
---

### Step 1 — Capture a page
- intent: Save a page
- action: put_page {"content":"# hi","slug":"demo"}
- assert: status == 200
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"demo"},"projection":["compiled_truth"]}
`;

const CLI_SKILL_NO_ATTEST = CLI_SKILL.split("\n").filter((l) => !l.startsWith("- attest:")).join("\n");

function approveDeps(dir: string, atMs: number): ApproveDeps {
  return {
    env: { REELIER_EXPECT_KEYS: path.join(dir, "expect-keys.json") },
    homedir: dir,
    isTTY: false,
    now: () => atMs,
    tools: {
      get_page: { effect: "read", run: async () => ({ status: 200, headers: {}, body: JSON.stringify({ compiled_truth: "# v1" }) }) },
      put_page: { effect: "idempotent-write", run: async () => ({ status: 200, headers: {}, body: "{}" }) },
    },
  };
}

test("CLI: approve --probe --expires 24h stamps an absolute instant, and the TTL survives approve → run", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "s.md");
    await writeFile(file, CLI_SKILL);
    const at = Date.parse(BOUND_AT);
    const { result: code } = await captureOutput(() =>
      cmdApprove(fakeArgs([file], ["all", "probe"], { expires: "24h" }), approveDeps(dir, at)),
    );
    assert.equal(code, 0);
    const stamped = parseSkill(await readFile(file, "utf8"));
    // Absolute, not relative: re-reading the file a week later must not re-arm it.
    assert.equal(stamped.steps[0].expect!.expiresAt, new Date(at + 24 * HOUR).toISOString());

    const keystorePath = path.join(dir, "expect-keys.json");
    const fresh = spiedTools(() => ({ compiled_truth: "# v1" }));
    const inside = await runSkill(stamped, { tools: fresh.tools, expectKeystorePath: keystorePath, cwd: dir, now: at + HOUR });
    assert.equal(inside.steps[0].stateCheck!.outcome, "match");

    const late = spiedTools(() => ({ compiled_truth: "# v1" }));
    const outside = await runSkill(stamped, {
      tools: late.tools,
      expectKeystorePath: keystorePath,
      cwd: dir,
      stateGate: "refuse",
      now: at + 25 * HOUR,
    });
    assert.equal(outside.steps[0].outcome, "failed");
    assert.match(outside.steps[0].stateCheck!.reason!, /^approval-expired: /);
    assert.equal(late.writes.length, 0);
  });
});

test("CLI: --expires without --probe is refused, naming the expect-only limitation", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "s.md");
    await writeFile(file, CLI_SKILL);
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([file], ["all"], { expires: "24h" }), approveDeps(dir, Date.parse(BOUND_AT))),
    );
    assert.equal(code, 1);
    assert.match(out, /--expires requires --probe/);
    assert.match(out, /expect:/, "the error names the limitation rather than leaving it to be discovered");
    assert.equal(await readFile(file, "utf8"), CLI_SKILL, "and the file is untouched");
  });
});

test("CLI: an unparseable --expires is a clean usage error, never a crash and never a silent no-TTL approval", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "s.md");
    await writeFile(file, CLI_SKILL);
    for (const bad of ["24", "0h", "1.5h", "100y", "366d"]) {
      const { result: code, out } = await captureOutput(() =>
        cmdApprove(fakeArgs([file], ["all", "probe"], { expires: bad }), approveDeps(dir, Date.parse(BOUND_AT))),
      );
      assert.equal(code, 1, `--expires ${bad} should exit 1`);
      assert.match(out, /Invalid --expires/, out);
      assert.equal(await readFile(file, "utf8"), CLI_SKILL, `--expires ${bad} must not stamp anything`);
    }
  });
});

// ---------------------------------------------------------------------------
// Review findings. Every test above started from an UNAPPROVED skill, so
// nothing in the suite exercised the path an operator actually takes when
// adding a TTL: a healthy, already-bound skill whose world has not moved.
// These start there.
// ---------------------------------------------------------------------------

/** Approve once (fresh bind), then hand the caller the file to approve again. */
async function alreadyBound(dir: string, at: number, extraOpts: Record<string, string> = {}): Promise<string> {
  const file = path.join(dir, "s.md");
  await writeFile(file, CLI_SKILL);
  const { result } = await captureOutput(() => cmdApprove(fakeArgs([file], ["all", "probe"], extraOpts), approveDeps(dir, at)));
  assert.equal(result, 0, "fixture setup: the first approve must succeed");
  return file;
}

test("CLI review-CRITICAL: --expires on an already-bound, unchanged step ARMS the TTL — never 'unchanged' with nothing written", async () => {
  await withTempDir(async (dir) => {
    const at = Date.parse(BOUND_AT);
    // Bound with NO TTL — the healthy steady state an operator starts from.
    const file = await alreadyBound(dir, at);
    assert.equal(parseSkill(await readFile(file, "utf8")).steps[0].expect!.expiresAt, undefined);
    const before = await readFile(file, "utf8");

    // The exact moment someone decides to add an expiry control.
    const later = at + 5 * HOUR;
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([file], ["all", "probe"], { expires: "24h" }), approveDeps(dir, later)),
    );
    assert.equal(code, 0);
    // The precise regression: the per-step "unchanged (state re-verified …)"
    // line, which used to be all this command did. (The summary's tally line
    // legitimately contains the word "unchanged" — assert on the step line.)
    assert.doesNotMatch(out, /unchanged \(state re-verified/, "reporting 'unchanged' while arming nothing is the failure this closes");
    assert.match(out, /arming an approval TTL/);
    assert.match(out, /approved 1, skipped 0, unchanged 0/, "and it is counted as an approval, not a no-op");

    const after = parseSkill(await readFile(file, "utf8"));
    assert.notEqual(await readFile(file, "utf8"), before, "the file must actually change");
    assert.equal(after.steps[0].expect!.expiresAt, new Date(later + 24 * HOUR).toISOString());
    // And the armed TTL is live: it must actually refuse past the instant.
    const late = spiedTools(() => ({ compiled_truth: "# v1" }));
    const record = await runSkill(after, {
      tools: late.tools,
      expectKeystorePath: path.join(dir, "expect-keys.json"),
      cwd: dir,
      stateGate: "refuse",
      now: later + 25 * HOUR,
    });
    assert.equal(record.steps[0].outcome, "failed");
    assert.match(record.steps[0].stateCheck!.reason!, /^approval-expired: /);
    assert.equal(late.writes.length, 0);
  });
});

test("CLI review-CRITICAL: re-running --expires on a bound step RENEWS the deadline, and says which one it replaced", async () => {
  await withTempDir(async (dir) => {
    const at = Date.parse(BOUND_AT);
    const file = await alreadyBound(dir, at, { expires: "24h" });
    const first = parseSkill(await readFile(file, "utf8")).steps[0].expect!.expiresAt!;

    const later = at + 12 * HOUR;
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([file], ["all", "probe"], { expires: "7d" }), approveDeps(dir, later)),
    );
    assert.equal(code, 0);
    assert.match(out, /renewing the approval TTL/);
    assert.match(out, new RegExp(`was ${first}`), "the operator is told which deadline they are replacing");
    const renewed = parseSkill(await readFile(file, "utf8")).steps[0].expect!.expiresAt;
    assert.equal(renewed, new Date(later + 7 * DAY).toISOString());
  });
});

test("CLI review-CRITICAL: with no --expires, an already-bound unchanged step is still a true no-op", async () => {
  await withTempDir(async (dir) => {
    const at = Date.parse(BOUND_AT);
    const file = await alreadyBound(dir, at, { expires: "24h" });
    const before = await readFile(file, "utf8");
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([file], ["all", "probe"]), approveDeps(dir, at + HOUR)),
    );
    assert.equal(code, 0);
    assert.match(out, /unchanged \(state re-verified against current binding\)/);
    assert.equal(await readFile(file, "utf8"), before, "idempotence is preserved when no TTL is requested");
  });
});

test("CLI review-IMPORTANT: a --rebind after benign drift CARRIES the TTL forward — never silently drops it", async () => {
  await withTempDir(async (dir) => {
    const at = Date.parse(BOUND_AT);
    const file = path.join(dir, "s.md");
    await writeFile(file, CLI_SKILL);
    let world = "# v1";
    const deps = (msAt: number): ApproveDeps => ({
      ...approveDeps(dir, msAt),
      tools: {
        get_page: { effect: "read", run: async () => ({ status: 200, headers: {}, body: JSON.stringify({ compiled_truth: world }) }) },
        put_page: { effect: "idempotent-write", run: async () => ({ status: 200, headers: {}, body: "{}" }) },
      },
    });
    await captureOutput(() => cmdApprove(fakeArgs([file], ["all", "probe"], { expires: "30d" }), deps(at)));
    const ttl = parseSkill(await readFile(file, "utf8")).steps[0].expect!.expiresAt!;
    assert.equal(ttl, new Date(at + 30 * DAY).toISOString());

    // A benign edit moves the world; the operator re-binds, with no --expires.
    world = "# v2";
    const { out } = await captureOutput(() =>
      cmdApprove(fakeArgs([file], ["all", "probe", "rebind"]), deps(at + DAY)),
    );
    const after = parseSkill(await readFile(file, "utf8")).steps[0].expect!;
    assert.equal(after.expiresAt, ttl, "the TTL set a month ago survives a routine re-bind, verbatim");
    // Presence only, on purpose: this runs under --all --rebind, where there
    // is no prompt to order the line against. That the instant precedes the
    // y/N on the interactive path is asserted by index in the issue #77 block
    // at the end of this file — the distinction that let the ordering bug sit
    // under a passing assertion.
    assert.match(out, /carried forward unchanged from the previous binding/, "and the operator is told, in the approve output");
    // Verbatim, not re-resolved: a re-bind extends nothing.
    assert.notEqual(after.expiresAt, new Date(at + DAY + 30 * DAY).toISOString());
  });
});

test("CLI review-MINOR: a carried TTL that has ALREADY elapsed says so — a dead deadline must not read as a live one", async () => {
  await withTempDir(async (dir) => {
    const at = Date.parse(BOUND_AT);
    const file = path.join(dir, "s.md");
    await writeFile(file, CLI_SKILL);
    let world = "# v1";
    const deps = (msAt: number): ApproveDeps => ({
      ...approveDeps(dir, msAt),
      tools: {
        get_page: { effect: "read", run: async () => ({ status: 200, headers: {}, body: JSON.stringify({ compiled_truth: world }) }) },
        put_page: { effect: "idempotent-write", run: async () => ({ status: 200, headers: {}, body: "{}" }) },
      },
    });
    await captureOutput(() => cmdApprove(fakeArgs([file], ["all", "probe"], { expires: "24h" }), deps(at)));
    const ttl = parseSkill(await readFile(file, "utf8")).steps[0].expect!.expiresAt!;

    // Drift arrives a week later — long after the 24h TTL ran out. The
    // re-bind carries the dead instant forward (correct: it must not renew),
    // but the operator has to be told the binding is expired on arrival.
    world = "# v2";
    const wayLater = at + 7 * DAY;
    const { out } = await captureOutput(() => cmdApprove(fakeArgs([file], ["all", "probe", "rebind"]), deps(wayLater)));
    const after = parseSkill(await readFile(file, "utf8"));
    assert.equal(after.steps[0].expect!.expiresAt, ttl, "still carried verbatim — a re-bind renews nothing");
    assert.match(out, /ALREADY ELAPSED/, "and the output does not let a dead deadline read as a live one");

    // The claim is earned: the freshly written binding really is expired.
    const late = spiedTools(() => ({ compiled_truth: "# v2" }));
    const record = await runSkill(after, {
      tools: late.tools,
      expectKeystorePath: path.join(dir, "expect-keys.json"),
      cwd: dir,
      stateGate: "refuse",
      now: wayLater,
    });
    assert.equal(record.steps[0].outcome, "failed");
    assert.match(record.steps[0].stateCheck!.reason!, /^approval-expired: /);
    assert.equal(late.writes.length, 0);
  });
});

test("CLI review-MINOR: --prune-keys refuses to swallow --expires", async () => {
  await withTempDir(async (dir) => {
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([], ["prune-keys", "all"], { expires: "24h" }), approveDeps(dir, Date.parse(BOUND_AT))),
    );
    assert.equal(code, 1);
    assert.match(out, /--prune-keys is a standalone command and cannot be combined with --expires/);
  });
});

test("review-IMPORTANT: an expired approval counts as a finding, so a recorder run cannot look clean at the summary", async () => {
  await withTempDir(async (dir) => {
    const { skill, keystorePath } = await boundSkill(dir, { compiled_truth: "# v1" }, { expiresAt: EXPIRES_AT });
    const { tools } = spiedTools(() => ({ compiled_truth: "# v1" }));
    const record = await runSkill(skill, { tools, expectKeystorePath: keystorePath, cwd: dir, now: T_EXPIRY + 60_000 });
    // Recorder mode: the step passes and the write went out — that is the
    // rule. But the summary must not read as if nothing was found.
    assert.equal(record.steps[0].outcome, "passed");
    assert.equal(stateCheckFindingsCount(record.steps), 1);
    assert.equal(findingsSummaryTag(record.steps), " · 1 finding");
    // The per-step line stays honest too, and never says "pass".
    const lines = renderStateCheckLines(record.steps[0].stateCheck!, undefined);
    assert.match(lines[0], /^pre-state check: not evaluated — approval-expired: /);
  });
});

test("review-IMPORTANT: the finding exception is narrow — other unevaluated reasons are still not findings", async () => {
  await withTempDir(async (dir) => {
    // key-unavailable: a gap in evidence, not something learned. Unchanged.
    const { skill } = await boundSkill(dir, { compiled_truth: "# v1" }, { expiresAt: null });
    const { tools } = spiedTools(() => ({ compiled_truth: "# v1" }));
    const record = await runSkill(skill, {
      tools,
      expectKeystorePath: path.join(dir, "no-such-keys.json"),
      cwd: dir,
      now: Date.parse(BOUND_AT),
    });
    assert.equal(record.steps[0].stateCheck!.outcome, "unevaluated");
    assert.match(record.steps[0].stateCheck!.reason!, /key-unavailable/);
    assert.equal(stateCheckFindingsCount(record.steps), 0);
    assert.equal(findingsSummaryTag(record.steps), "");
  });
});

test("CLI: --expires on a step with no attest: cannot bind — the step is skipped, never silently approved with a dead TTL", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "s.md");
    await writeFile(file, CLI_SKILL_NO_ATTEST);
    const { result: code } = await captureOutput(() =>
      cmdApprove(fakeArgs([file], ["all", "probe"], { expires: "24h" }), approveDeps(dir, Date.parse(BOUND_AT))),
    );
    const after = parseSkill(await readFile(file, "utf8"));
    // No attest → no expect → no TTL. Whatever the exit code, the one thing
    // that must never happen is a stamped approval that claims to expire.
    assert.equal(after.steps[0].expect, undefined);
    assert.ok(code === 0 || code === 1);
  });
});

// ===========================================================================
// Issue #77 — the resolved instant is shown BEFORE the consent prompt.
//
// `--expires 7d` resolves against the OBSERVATION time, not wall-clock-now.
// That is arithmetic no operator does in their head, and a date printed after
// the y/N is a date they had no opportunity to decline. These tests assert
// ORDERING — the index of the expiry line against the index of the prompt —
// because the pre-existing coverage asserted only that the instant appeared
// SOMEWHERE in the output, under `--all`, where the prompt is auto-answered.
// Presence was already true while the ordering was wrong; only an index
// comparison can tell the two apart.
// ===========================================================================

const FRESH_PROMPT = "Approve this step against this observed state?";
const REBIND_PROMPT = "Re-bind this approval to the current state?";

/**
 * A real readline echoes its question to stdout, so the prompt and the
 * console.log lines share one stream and can be ordered against each other.
 * `captureOutput` patches process.stdout.write, so this reproduces that.
 */
function promptingDeps(dir: string, atMs: number, answer = "y"): ApproveDeps {
  return {
    ...approveDeps(dir, atMs),
    ask: async (q: string) => {
      process.stdout.write(q);
      return answer;
    },
  };
}

/** Same, but the probe's view of the world is a live closure, so it can drift. */
function driftingDeps(dir: string, atMs: number, world: () => string, answer = "y"): ApproveDeps {
  return {
    ...promptingDeps(dir, atMs, answer),
    tools: {
      get_page: { effect: "read", run: async () => ({ status: 200, headers: {}, body: JSON.stringify({ compiled_truth: world() }) }) },
      put_page: { effect: "idempotent-write", run: async () => ({ status: 200, headers: {}, body: "{}" }) },
    },
  };
}

function assertBefore(out: string, needle: string, prompt: string, why: string): void {
  const iNeedle = out.indexOf(needle);
  const iPrompt = out.indexOf(prompt);
  assert.notEqual(iNeedle, -1, `${why}: ${JSON.stringify(needle)} never printed at all`);
  assert.notEqual(iPrompt, -1, `${why}: the prompt ${JSON.stringify(prompt)} never printed at all`);
  assert.ok(iNeedle < iPrompt, `${why} — ${JSON.stringify(needle)} is at index ${iNeedle}, the prompt at ${iPrompt}: the operator answered before seeing the date`);
}

test("issue #77: a fresh bind prints the resolved instant BEFORE the consent prompt, not after it", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "s.md");
    await writeFile(file, CLI_SKILL);
    const at = Date.parse(BOUND_AT);
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([file], ["probe"], { expires: "7d" }), promptingDeps(dir, at)),
    );
    assert.equal(code, 0);
    assertBefore(out, "  expires: ", FRESH_PROMPT, "the fresh-bind path must show the deadline before asking for consent");
  });
});

test("issue #77: the previewed instant and the instant written to the file are byte-identical", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "s.md");
    await writeFile(file, CLI_SKILL);
    const at = Date.parse(BOUND_AT);
    const { out } = await captureOutput(() => cmdApprove(fakeArgs([file], ["probe"], { expires: "7d" }), promptingDeps(dir, at)));

    const preConsent = out.slice(0, out.indexOf(FRESH_PROMPT));
    const previewed = /^ {2}expires: (\S+)/m.exec(preConsent)?.[1];
    const written = parseSkill(await readFile(file, "utf8")).steps[0].expect!.expiresAt;
    assert.equal(written, new Date(at + 7 * DAY).toISOString(), "sanity: resolved against the observation, not wall-clock-now");
    // One computation, two call sites — not two expressions that agree today.
    assert.equal(previewed, written, "the date the operator agreed to must be the date that was written");
  });
});

test("issue #77: a bind with NO TTL prints no expiry line at all — an absence is never rendered as a choice", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "s.md");
    await writeFile(file, CLI_SKILL);
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([file], ["probe"]), promptingDeps(dir, Date.parse(BOUND_AT))),
    );
    assert.equal(code, 0);
    assert.equal(parseSkill(await readFile(file, "utf8")).steps[0].expect!.expiresAt, undefined);
    // "expires: never" would read as a deliberate setting rather than as the
    // absence of one — brand invariant 1, one level down.
    assert.doesNotMatch(out, /expires:/, "no TTL means no expiry line, in either position");
  });
});

test("issue #77: a re-bind after drift shows the carried instant BEFORE the re-bind prompt", async () => {
  await withTempDir(async (dir) => {
    const at = Date.parse(BOUND_AT);
    const file = path.join(dir, "s.md");
    await writeFile(file, CLI_SKILL);
    let world = "# v1";
    await captureOutput(() => cmdApprove(fakeArgs([file], ["all", "probe"], { expires: "30d" }), driftingDeps(dir, at, () => world)));
    const ttl = parseSkill(await readFile(file, "utf8")).steps[0].expect!.expiresAt!;

    world = "# v2";
    const { out } = await captureOutput(() =>
      cmdApprove(fakeArgs([file], ["probe"]), driftingDeps(dir, at + DAY, () => world)),
    );
    assertBefore(out, `  expires: ${ttl}`, REBIND_PROMPT, "a re-bind carries a TTL forward, so the operator must see it before consenting");
    assert.equal(parseSkill(await readFile(file, "utf8")).steps[0].expect!.expiresAt, ttl, "and it is still carried verbatim");
  });
});

test("issue #77: a carried TTL that has ALREADY elapsed says so before the prompt, not after", async () => {
  await withTempDir(async (dir) => {
    const at = Date.parse(BOUND_AT);
    const file = path.join(dir, "s.md");
    await writeFile(file, CLI_SKILL);
    let world = "# v1";
    await captureOutput(() => cmdApprove(fakeArgs([file], ["all", "probe"], { expires: "24h" }), driftingDeps(dir, at, () => world)));

    // Drift arrives a week after the 24h deadline ran out: the re-bind carries
    // the dead instant forward (correct — it must not renew), and the operator
    // has to learn the binding is expired on arrival BEFORE they say yes.
    world = "# v2";
    const { out } = await captureOutput(() =>
      cmdApprove(fakeArgs([file], ["probe"]), driftingDeps(dir, at + 7 * DAY, () => world)),
    );
    assertBefore(out, "ALREADY ELAPSED", REBIND_PROMPT, "a dead deadline must not be disclosed only after consent");
  });
});

test("issue #77: --all auto-answers the prompt but never suppresses the instant", async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, "s.md");
    await writeFile(file, CLI_SKILL);
    const at = Date.parse(BOUND_AT);
    const { result: code, out } = await captureOutput(() =>
      cmdApprove(fakeArgs([file], ["all", "probe"], { expires: "7d" }), approveDeps(dir, at)),
    );
    assert.equal(code, 0);
    assert.match(out, new RegExp(`expires: ${new Date(at + 7 * DAY).toISOString()}`));
    assert.match(out, /approved 1, skipped 0/);
  });
});
