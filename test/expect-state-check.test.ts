// S4 of the state-conditioned-approval design (Wave 2 spec §5, §10 S4):
// the execute-time comparison, recorder mode. Match / mismatch / unevaluated
// each pinned end-to-end with fake tools; the recorder NEVER blocks (I-9);
// expect-less skills are byte-untouched (I-2); attest is untouched (I-4);
// every dispatched write on an expect-bearing step carries a stateCheck
// (I-15, B1) and L2 declines expect-bearing steps before resolveL2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runSkill } from "../src/runner.js";
import { parseSkill } from "../src/skill.js";
import { computeApprovalHash } from "../src/approval.js";
import { mintExpectKey, expectMac, projectObservationTyped, writeKeystoreEntry } from "../src/expect-mac.js";
import { renderStateCheckLines, stateCheckFindingsCount, findingsSummaryTag } from "../src/attest-render.js";
import type { StepStateCheck } from "../src/runner.js";
import type { Tool } from "../src/tools.js";
import type { Observation } from "../src/assert.js";
import type { LlmClient, LlmCallInput, LlmCallResult } from "../src/llm.js";

const PROJECTION = ["compiled_truth"];
const APPROVED_BODY = { compiled_truth: "# approved content", status_note: "x" };

/** Build a bound skill exactly as `approve --probe` would stamp it: mint key, keystore entry, MAC over the typed projection of `boundBody`, approval hash over the final trio. */
async function boundSkill(dir: string, boundBody: Record<string, unknown>, opts: { asserts?: string[]; projection?: string[] } = {}) {
  const projection = opts.projection ?? PROJECTION;
  const asserts = opts.asserts ?? ["status == 200"];
  const keystorePath = path.join(dir, "expect-keys.json");
  const { key, keyId } = mintExpectKey();
  await writeKeystoreEntry(keystorePath, keyId, { key: key.toString("base64"), createdAt: "2026-07-29T06:00:00.000Z" });
  const typed = projectObservationTyped({ body: JSON.stringify(boundBody), headers: {} , status: 200}, projection);
  const pre = expectMac(key, "get_page", typed);
  const expect = { at: "2026-07-29T06:00:00.000Z", keyId, pre };

  const base = `---
name: state-check-skill
description: a state-bound write
---

### Step 1 — bound write
- intent: w
- action: put_page {"markdown":"# approved content","slug":"demo","title":"Demo"}
${asserts.map((a) => `- assert: ${a}`).join("\n")}
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"demo"},"projection":${JSON.stringify(projection)}}
- expect: {"at":"${expect.at}","keyId":"${expect.keyId}","pre":"${expect.pre}"}
`;
  const step = parseSkill(`${base}- approve: sha256:${"0".repeat(64)}\n`).steps[0];
  const hash = computeApprovalHash({ actionTool: step.actionTool, actionArgs: step.actionArgs, attest: step.attest, expect: step.expect });
  const source = `${base}- approve: ${hash}\n`;
  return { source, keystorePath, keyId };
}

function gbrainTools(liveBody: () => Record<string, unknown> | string, opts: { probeDelayMs?: number } = {}) {
  const writeCalls: unknown[] = [];
  const tools: Record<string, Tool> = {
    get_page: {
      effect: "read",
      run: async (): Promise<Observation> => {
        if (opts.probeDelayMs) await new Promise((r) => setTimeout(r, opts.probeDelayMs));
        const body = liveBody();
        return { status: 200, headers: {}, body: typeof body === "string" ? body : JSON.stringify(body) };
      },
    },
    put_page: {
      effect: "idempotent-write",
      run: async (args): Promise<Observation> => {
        writeCalls.push(args);
        return { status: 200, headers: {}, body: JSON.stringify({ ok: true }) };
      },
    },
  };
  return { tools, writeCalls };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-state-check-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// match
// ---------------------------------------------------------------------------

test("match end-to-end: stateCheck {match, proceeded}, dispatchedAt stamped, run passes (I-15)", async () => {
  await withTempDir(async (dir) => {
    const { source, keystorePath } = await boundSkill(dir, APPROVED_BODY);
    const { tools, writeCalls } = gbrainTools(() => APPROVED_BODY);
    const record = await runSkill(parseSkill(source), { tools, expectKeystorePath: keystorePath, cwd: dir });
    const step = record.steps[0];
    assert.equal(record.passed, true);
    assert.equal(writeCalls.length, 1, "the write dispatched");
    assert.ok(step.write, "write receipt present");
    assert.ok(step.stateCheck, "I-15: a dispatched write on an expect-bearing step carries a stateCheck");
    assert.equal(step.stateCheck!.outcome, "match");
    assert.equal(step.stateCheck!.action, "proceeded");
    assert.equal(step.stateCheck!.expectedAt, "2026-07-29T06:00:00.000Z");
    assert.ok(step.stateCheck!.observedAt, "observedAt present on an evaluated check");
    assert.equal(step.stateCheck!.reason, undefined, "reason present iff unevaluated");
    assert.match(step.write!.dispatchedAt!, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(Date.parse(step.write!.dispatchedAt!) >= Date.parse(step.stateCheck!.observedAt!) - 1, "observation strictly before dispatch (I-3)");
  });
});

// ---------------------------------------------------------------------------
// mismatch — the recorder stamps and PROCEEDS (I-9, never-list #5)
// ---------------------------------------------------------------------------

test("mismatch: write still dispatches, outcome stays passed, stateCheck {mismatch, stamped} (I-9)", async () => {
  await withTempDir(async (dir) => {
    const { source, keystorePath } = await boundSkill(dir, APPROVED_BODY);
    const { tools, writeCalls } = gbrainTools(() => ({ compiled_truth: "clobbered: another agent rewrote this page overnight" }));
    const record = await runSkill(parseSkill(source), { tools, expectKeystorePath: keystorePath, cwd: dir });
    const step = record.steps[0];
    assert.equal(writeCalls.length, 1, "recorder mode NEVER blocks the write");
    assert.equal(step.outcome, "passed", "the stamp never flips the outcome");
    assert.equal(record.passed, true, "the stamp never flips the run");
    assert.equal(step.stateCheck!.outcome, "mismatch");
    assert.equal(step.stateCheck!.action, "stamped");
    assert.equal(step.stateCheck!.absentFields, undefined, "no absent fields: the declared field was present, just different");
  });
});

test("mismatch with declared fields absent at execute: absentFields carries names only (B5/A1)", async () => {
  await withTempDir(async (dir) => {
    const { source, keystorePath } = await boundSkill(dir, { compiled_truth: "# approved content", etag: "v1" }, { projection: ["compiled_truth", "etag"] });
    // etag vanished at execute; compiled_truth unchanged → commitment differs
    // AND a declared field is absent → real mismatch + absentFields.
    const { tools } = gbrainTools(() => ({ compiled_truth: "# approved content" }));
    const record = await runSkill(parseSkill(source), { tools, expectKeystorePath: keystorePath, cwd: dir });
    const step = record.steps[0];
    assert.equal(step.stateCheck!.outcome, "mismatch");
    assert.deepEqual(step.stateCheck!.absentFields, ["body.etag"]);
  });
});

// ---------------------------------------------------------------------------
// unevaluated — its own state, never a pass, never a block
// ---------------------------------------------------------------------------

test("unevaluated (key-unavailable): deletion IS revocation; write proceeds; exact reason string", async () => {
  await withTempDir(async (dir) => {
    const { source, keystorePath, keyId } = await boundSkill(dir, APPROVED_BODY);
    await rm(keystorePath, { force: true }); // revocation = deletion (C7)
    const { tools, writeCalls } = gbrainTools(() => APPROVED_BODY);
    const record = await runSkill(parseSkill(source), { tools, expectKeystorePath: keystorePath, cwd: dir });
    const step = record.steps[0];
    assert.equal(writeCalls.length, 1);
    assert.equal(step.stateCheck!.outcome, "unevaluated");
    assert.equal(step.stateCheck!.action, "proceeded");
    assert.equal(step.stateCheck!.reason, `key-unavailable: keyId '${keyId}'`);
    assert.equal(record.passed, true);
  });
});

test("unevaluated (empty-projection): probe resolved but no declared fields; exact reason string (A12)", async () => {
  await withTempDir(async (dir) => {
    const { source, keystorePath } = await boundSkill(dir, APPROVED_BODY);
    const { tools } = gbrainTools(() => ({ unrelated: 1 }));
    const record = await runSkill(parseSkill(source), { tools, expectKeystorePath: keystorePath, cwd: dir });
    const step = record.steps[0];
    assert.equal(step.stateCheck!.outcome, "unevaluated");
    assert.equal(step.stateCheck!.reason, "empty-projection: probe returned no declared fields");
    assert.ok(step.stateCheck!.observedAt, "the observation DID resolve — observedAt present");
  });
});

test("unevaluated (probe-timeout): registry-normalized reason; observedAt absent (no observation)", async () => {
  await withTempDir(async (dir) => {
    const { source, keystorePath } = await boundSkill(dir, APPROVED_BODY);
    const { tools } = gbrainTools(() => APPROVED_BODY, { probeDelayMs: 300 });
    const record = await runSkill(parseSkill(source), { tools, expectKeystorePath: keystorePath, probeTimeoutMs: 50, cwd: dir });
    const step = record.steps[0];
    assert.equal(step.stateCheck!.outcome, "unevaluated");
    assert.equal(step.stateCheck!.reason, "probe-timeout: probe timeout after 50ms");
    assert.equal(step.stateCheck!.observedAt, undefined, "unevaluated before any observation");
  });
});

// ---------------------------------------------------------------------------
// I-2 zero-touch: expect-less skills are byte-untouched
// ---------------------------------------------------------------------------

test("I-2: a skill without expect produces a record with NO stateCheck key and NO dispatchedAt anywhere", async () => {
  const plain = `---
name: no-expect
description: approved write, no binding
---

### Step 1 — write
- intent: w
- action: put_page {"markdown":"# x","slug":"demo","title":"D"}
- assert: status == 200
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"demo"},"projection":["compiled_truth"]}
`;
  const step = parseSkill(`${plain}- approve: sha256:${"0".repeat(64)}\n`).steps[0];
  const hash = computeApprovalHash({ actionTool: step.actionTool, actionArgs: step.actionArgs, attest: step.attest, expect: step.expect });
  const { tools } = gbrainTools(() => APPROVED_BODY);
  await withTempDir(async (dir) => {
    const record = await runSkill(parseSkill(`${plain}- approve: ${hash}\n`), { tools, cwd: dir });
    const json = JSON.stringify(record);
    assert.ok(!json.includes('"stateCheck"'), "no stateCheck key may appear");
    assert.ok(!json.includes('"dispatchedAt"'), "no dispatchedAt key may appear");
    assert.equal(record.passed, true);
  });
});

// ---------------------------------------------------------------------------
// I-4: attest is untouched — the same observation feeds both commitments
// ---------------------------------------------------------------------------

test("I-4: the bound step still carries a normal declared-probe attest beside its stateCheck", async () => {
  await withTempDir(async (dir) => {
    const { source, keystorePath } = await boundSkill(dir, APPROVED_BODY);
    const { tools } = gbrainTools(() => APPROVED_BODY);
    const record = await runSkill(parseSkill(source), { tools, expectKeystorePath: keystorePath, cwd: dir });
    const step = record.steps[0];
    assert.ok(step.attest, "attest present");
    assert.equal(step.attest!.method, "declared-probe");
    assert.equal(step.attest!.confidence, "exact");
    assert.match(step.attest!.pre!.hash, /^sha256:/, "attest commitment stays salted sha256, never the keyed hmac");
    assert.ok(step.stateCheck, "stateCheck present beside it");
  });
});

// ---------------------------------------------------------------------------
// B1 / I-15: expect-bearing steps are L2-ineligible
// ---------------------------------------------------------------------------

function spyLlm(responses: LlmCallResult[]): { llm: LlmClient; calls: LlmCallInput[] } {
  const calls: LlmCallInput[] = [];
  let i = 0;
  const llm: LlmClient = {
    async completeJson(input) {
      calls.push(input);
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return r;
    },
  };
  return { llm, calls };
}

test("B1: L2 declines an expect-bearing step before resolveL2 — no re-dispatch, exact decline string", async () => {
  await withTempDir(async (dir) => {
    // Asserts that FAIL against the write response force escalation.
    const { source, keystorePath } = await boundSkill(dir, APPROVED_BODY, { asserts: ["json.ok == false"] });
    const { tools, writeCalls } = gbrainTools(() => APPROVED_BODY);
    // L1 declines (real-failure verdict), so the ladder tries L2 — which must refuse.
    const { llm, calls } = spyLlm([
      { json: { verdict: "real-failure", reason: "cannot patch" }, usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    const record = await runSkill(parseSkill(source), {
      tools,
      expectKeystorePath: keystorePath,
      maxLevel: 2,
      llm,
    });
    const step = record.steps[0];
    assert.equal(step.outcome, "failed");
    assert.ok(
      step.failures.some((f) => f.includes("state-bound step: L2 heal ineligible")),
      `expected the B1 decline string in: ${JSON.stringify(step.failures)}`
    );
    assert.equal(writeCalls.length, 1, "I-15: the escalation channel never re-dispatched the state-bound write");
    // L1 was consulted; L2's completeJson was never reached for a patch.
    assert.equal(calls.length, 1, "resolveL2 must never be invoked for an expect-bearing step");
  });
});

// ---------------------------------------------------------------------------
// §5.4 render strings + forbidden phrases + A14 window rule
// ---------------------------------------------------------------------------

const CHECK_MATCH: StepStateCheck = {
  outcome: "match",
  action: "proceeded",
  expectedAt: "2026-07-30T06:58:12.331Z",
  observedAt: "2026-07-30T07:23:41.120Z",
};

test("render: match is a muted fact line with both timestamps and a measured window", () => {
  const lines = renderStateCheckLines(CHECK_MATCH, "2026-07-30T07:23:41.500Z");
  assert.equal(lines.length, 1);
  assert.equal(
    lines[0],
    "pre-state check: match (approved 2026-07-30T06:58:12.331Z · observed 2026-07-30T07:23:41.120Z · window 380 ms)"
  );
});

test("render: A14 — negative or absurd window omits the figure, never clamps, never fabricates", () => {
  const negative = renderStateCheckLines(CHECK_MATCH, "2026-07-30T07:23:40.000Z");
  assert.equal(negative[0], "pre-state check: match (approved 2026-07-30T06:58:12.331Z · observed 2026-07-30T07:23:41.120Z)");
  const absurd = renderStateCheckLines(CHECK_MATCH, "2026-07-30T09:00:00.000Z");
  assert.ok(!absurd[0].includes("window"));
  const noDispatch = renderStateCheckLines(CHECK_MATCH, undefined);
  assert.ok(!noDispatch[0].includes("window"));
});

test("render: mismatch is the ⚠ stamp with both timestamps, plus absent-field names when present (A1)", () => {
  const lines = renderStateCheckLines(
    {
      outcome: "mismatch",
      action: "stamped",
      expectedAt: "2026-07-30T06:58:12.331Z",
      observedAt: "2026-07-31T07:23:40.000Z",
      absentFields: ["body.etag"],
    },
    undefined
  );
  assert.equal(lines[0], "⚠ executed against state that differs from the state this approval was granted against —");
  assert.equal(lines[1], "  pre-state commitment mismatch (approved 2026-07-30T06:58:12.331Z · observed 2026-07-31T07:23:40.000Z)");
  assert.equal(lines[2], "  declared fields absent at execute: body.etag");
});

test("render: unevaluated is its own state with the verbatim reason", () => {
  const lines = renderStateCheckLines(
    { outcome: "unevaluated", action: "proceeded", expectedAt: "2026-07-30T06:58:12.331Z", reason: "key-unavailable: keyId 'aabbccdd00112233'" },
    undefined
  );
  assert.deepEqual(lines, ["pre-state check: not evaluated — key-unavailable: keyId 'aabbccdd00112233'"]);
});

test("forbidden phrases (§5.4, test-pinned): never on any stateCheck surface", () => {
  const outputs = [
    ...renderStateCheckLines(CHECK_MATCH, "2026-07-30T07:23:41.500Z"),
    ...renderStateCheckLines({ outcome: "mismatch", action: "stamped", expectedAt: "x", observedAt: "y", absentFields: ["body.a"] }, undefined),
    ...renderStateCheckLines({ outcome: "unevaluated", action: "proceeded", expectedAt: "x", reason: "empty-projection: probe returned no declared fields" }, undefined),
  ].join("\n");
  for (const forbidden of [
    /CAS/,
    /verified state/i,
    /state verified/i,
    /no drift/i,
    /\bsafe\b/i,
    /\batomic\b/i,
    /\bguaranteed\b/i,
    /\bverified\b/i,
    /state was .* when this write executed/i,
  ]) {
    assert.ok(!forbidden.test(outputs), `forbidden phrase ${forbidden} found in:\n${outputs}`);
  }
});

test("findings count: mismatches only — match and unevaluated are not findings", () => {
  assert.equal(
    stateCheckFindingsCount([
      { stateCheck: { outcome: "mismatch", action: "stamped", expectedAt: "x" } },
      { stateCheck: { outcome: "match", action: "proceeded", expectedAt: "x" } },
      { stateCheck: { outcome: "unevaluated", action: "proceeded", expectedAt: "x" } },
      {},
    ]),
    1
  );
});

test("findings summary tag: singular, plural, and absent forms (never wired to pass/fail)", () => {
  const mismatch = { stateCheck: { outcome: "mismatch", action: "stamped", expectedAt: "x" } as StepStateCheck };
  assert.equal(findingsSummaryTag([mismatch]), " · 1 finding");
  assert.equal(findingsSummaryTag([mismatch, mismatch]), " · 2 findings");
  assert.equal(findingsSummaryTag([{ stateCheck: { outcome: "match", action: "proceeded", expectedAt: "x" } }]), "");
});

// ---------------------------------------------------------------------------
// Review-round pins: §8.6 rows, caps, effect rule, coincident causes
// ---------------------------------------------------------------------------

test("§8.6: a dispatch that throws AFTER the check keeps the computed stateCheck (the check completed before dispatch)", async () => {
  await withTempDir(async (dir) => {
    const { source, keystorePath } = await boundSkill(dir, APPROVED_BODY);
    const { tools } = gbrainTools(() => ({ compiled_truth: "moved" })); // mismatch world → distinguishable outcome
    tools.put_page = {
      effect: "idempotent-write",
      run: async () => {
        throw new Error("boom after probe");
      },
    };
    const record = await runSkill(parseSkill(source), { tools, expectKeystorePath: keystorePath, cwd: dir });
    const step = record.steps[0];
    assert.equal(step.outcome, "failed");
    assert.equal(step.write, undefined, "no write receipt — no observation came back");
    assert.equal(step.stateCheck!.outcome, "mismatch", "the pre-dispatch check survives the throw");
    assert.equal(step.attest!.confidence, "partial");
    assert.equal(step.attest!.reason, "dispatch-failed");
  });
});

test("§8.6: probe-tool-unknown passes through the reason normalizer verbatim", async () => {
  await withTempDir(async (dir) => {
    const { source, keystorePath } = await boundSkill(dir, APPROVED_BODY);
    const { tools } = gbrainTools(() => APPROVED_BODY);
    delete (tools as Record<string, unknown>).get_page;
    const record = await runSkill(parseSkill(source), { tools, expectKeystorePath: keystorePath, cwd: dir });
    assert.equal(record.steps[0].stateCheck!.outcome, "unevaluated");
    assert.equal(record.steps[0].stateCheck!.reason, "probe-tool-unknown: 'get_page'");
  });
});

test("§8.6: an approval-mismatch refusal carries NO stateCheck (refused before the check)", async () => {
  await withTempDir(async (dir) => {
    const { source, keystorePath } = await boundSkill(dir, APPROVED_BODY);
    const tampered = source.replace('"markdown":"# approved content"', '"markdown":"# tampered"');
    const { tools, writeCalls } = gbrainTools(() => APPROVED_BODY);
    const record = await runSkill(parseSkill(tampered), { tools, expectKeystorePath: keystorePath, cwd: dir });
    const step = record.steps[0];
    assert.equal(step.outcome, "failed");
    assert.ok(step.failures.some((f) => /Approval mismatch/.test(f)));
    assert.ok(!JSON.stringify(step).includes('"stateCheck"'));
    assert.equal(writeCalls.length, 0, "the refusal happened before any dispatch");
  });
});

test("§8.6: a mocked (--fail) expect-bearing step carries no stateCheck and no dispatchedAt", async () => {
  await withTempDir(async (dir) => {
    const { source, keystorePath } = await boundSkill(dir, APPROVED_BODY);
    const { tools, writeCalls } = gbrainTools(() => APPROVED_BODY);
    const record = await runSkill(parseSkill(source), { tools, expectKeystorePath: keystorePath, cwd: dir, mockFailures: { 1: 500 } });
    const json = JSON.stringify(record.steps[0]);
    assert.ok(!json.includes('"stateCheck"'));
    assert.ok(!json.includes('"dispatchedAt"'));
    assert.equal(writeCalls.length, 0);
  });
});

test("coincident causes: a deleted key wins over a probe failure — revocation is never masked (§5.1 a→b→c order)", async () => {
  await withTempDir(async (dir) => {
    const { source, keystorePath, keyId } = await boundSkill(dir, APPROVED_BODY);
    await rm(keystorePath, { force: true }); // revoke
    const { tools } = gbrainTools(() => APPROVED_BODY, { probeDelayMs: 300 }); // AND the probe times out
    const record = await runSkill(parseSkill(source), { tools, expectKeystorePath: keystorePath, cwd: dir, probeTimeoutMs: 50 });
    assert.equal(record.steps[0].stateCheck!.reason, `key-unavailable: keyId '${keyId}'`);
  });
});

test("B5 caps: absentFields is sliced to 32 entries, names to 120 chars", async () => {
  await withTempDir(async (dir) => {
    const longName = "f".repeat(140);
    const projection = [longName, ...Array.from({ length: 45 }, (_, i) => `absent_${i}`), "present"];
    const bound: Record<string, unknown> = { [longName]: "x", present: "y" };
    for (let i = 0; i < 45; i++) bound[`absent_${i}`] = "z";
    const { source, keystorePath } = await boundSkill(dir, bound, { projection });
    // At execute only `present` remains → commitment differs, 46 declared fields absent.
    const { tools } = gbrainTools(() => ({ present: "y" }));
    const record = await runSkill(parseSkill(source), { tools, expectKeystorePath: keystorePath, cwd: dir });
    const absent = record.steps[0].stateCheck!.absentFields!;
    assert.equal(absent.length, 32);
    for (const name of absent) assert.ok(name.length <= 120, `name over cap: ${name.length}`);
  });
});

test("effect flip (review blocking): 'expect' on an effect: read step is a parse error", () => {
  const flipped = `---
name: flipped
description: bound step flipped to read
---

### Step 1 — was a write
- intent: w
- action: put_page {"slug":"a"}
- effect: read
- attest: {"tool":"get_page","args":{"slug":"a"},"projection":["compiled_truth"]}
- approve: sha256:${"a".repeat(64)}
- expect: {"at":"2026-07-29T06:00:00.000Z","keyId":"3c9a01d2e4f5b6a7","pre":"hmac-sha256:${"9f".repeat(32)}"}
`;
  assert.throws(() => parseSkill(flipped), /'expect' requires a write-effect step/);
});

test("effect flip belt: a hand-crafted expect-bearing non-write step is refused by the runner, never dispatched", async () => {
  await withTempDir(async (dir) => {
    const { source, keystorePath } = await boundSkill(dir, APPROVED_BODY);
    const skill = parseSkill(source);
    // Simulate a hand-crafted Skill object that bypassed parseSkill's rule.
    (skill.steps[0] as { effect: string }).effect = "read";
    const { tools, writeCalls } = gbrainTools(() => APPROVED_BODY);
    const record = await runSkill(skill, { tools, expectKeystorePath: keystorePath, cwd: dir });
    const step = record.steps[0];
    assert.equal(step.outcome, "failed");
    assert.ok(step.failures.some((f) => /state-bound step with non-write effect/.test(f)));
    assert.equal(writeCalls.length, 0, "never dispatched");
  });
});
