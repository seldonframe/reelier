// P1.5 of the state-conditioned-approval design — the three deferrals the
// wave2 spec named and 0.25.0 shipped without (§3.5 per-field MACs, §6.1.3
// projection namespaces, §3.4 --prune-keys), sanctioned by the founder
// 2026-07-30. Design record: the P1.5 addendum in the wave2 spec doc.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseSkill, SkillParseError } from "../src/skill.js";
import { serializeSkill } from "../src/writeback.js";
import { computeApprovalHash } from "../src/approval.js";
import { digestSha256 } from "../src/canonical-json.js";
import { runSkill, projectObservation } from "../src/runner.js";
import {
  mintExpectKey,
  expectMac,
  expectFieldMac,
  projectObservationTyped,
  writeKeystoreEntry,
  readKeystore,
  removeKeystoreEntries,
} from "../src/expect-mac.js";
import { cmdApprove, type ParsedArgs } from "../src/cli.js";
import { renderStateCheckLines } from "../src/attest-render.js";
import type { Tool } from "../src/tools.js";
import type { Observation } from "../src/assert.js";

const KEY = Buffer.alloc(32, 0x11);

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-p15-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Projection namespaces (§6.1.3): header.<name> + explicit body.<key>;
// bare names stay body keys (legacy identity); `status` DEFERRED (recorded)
// ---------------------------------------------------------------------------

const OBS: Observation = {
  status: 200,
  headers: { etag: 'W/"v7"', "last-modified": "Wed" },
  body: JSON.stringify({ etag: "body-etag", compiled_truth: "# hi", n: 3 }),
};

test("namespaces: header.<name> projects the header; body.<key> and bare <key> project the body key", () => {
  const out = projectObservation(OBS, ["header.etag", "body.etag", "compiled_truth"]);
  assert.deepEqual(out, {
    "header.etag": 'W/"v7"',
    "body.etag": "body-etag",
    "body.compiled_truth": "# hi",
  });
});

test("namespaces: header entries project even when the body is not JSON (no rec needed)", () => {
  const out = projectObservation({ status: 200, headers: { etag: "x" }, body: "not json" }, ["header.etag", "foo"]);
  assert.deepEqual(out, { "header.etag": "x" });
});

test("namespaces: legacy bare-name selection is byte-identical (zero-touch)", () => {
  const legacy = projectObservation(OBS, ["etag", "compiled_truth", "absent"]);
  assert.deepEqual(legacy, { "body.etag": "body-etag", "body.compiled_truth": "# hi" });
});

test("namespaces: the typed twin mirrors selection exactly, types preserved (drift pin extended)", () => {
  const typed = projectObservationTyped(OBS, ["header.etag", "body.n", "compiled_truth", "absent"]);
  assert.deepEqual(typed, { "header.etag": 'W/"v7"', "body.n": 3, "body.compiled_truth": "# hi" });
  const stringified = projectObservation(OBS, ["header.etag", "body.n", "compiled_truth", "absent"]);
  assert.deepEqual(Object.fromEntries(Object.entries(typed).map(([k, v]) => [k, String(v)])), stringified);
});

// ---------------------------------------------------------------------------
// Per-field MACs (§3.5): expect.fields — diagnosis, additively
// ---------------------------------------------------------------------------

test("expectFieldMac: deterministic, key-bound, field-bound, and domain-separated from the whole-projection MAC", () => {
  const m1 = expectFieldMac(KEY, "get_page", "body.etag", "v7");
  assert.equal(m1, expectFieldMac(KEY, "get_page", "body.etag", "v7"));
  assert.match(m1, /^hmac-sha256:[0-9a-f]{64}$/);
  assert.notEqual(m1, expectFieldMac(KEY, "get_page", "body.rev", "v7"));
  assert.notEqual(m1, expectFieldMac(KEY, "other_probe", "body.etag", "v7"));
  assert.notEqual(m1, expectFieldMac(Buffer.alloc(32, 0x22), "get_page", "body.etag", "v7"));
  // A6 type tags apply per-field too.
  assert.notEqual(expectFieldMac(KEY, "t", "f", 1), expectFieldMac(KEY, "t", "f", "1"));
  // Domain separation: a single-field projection's whole MAC never equals
  // that field's field-MAC.
  assert.notEqual(expectMac(KEY, "get_page", { "body.etag": "v7" }), m1);
});

test("grammar: expect.fields parses, serializes canonically, and is covered by the approval hash", () => {
  const fields = `{"body.etag":"hmac-sha256:${"a".repeat(64)}","header.etag":"hmac-sha256:${"b".repeat(64)}"}`;
  const src = `---
name: p15
description: d
---

### Step 1 — w
- intent: i
- action: put_page {"slug":"x"}
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"x"},"projection":["etag","header.etag"]}
- approve: sha256:${"0".repeat(64)}
- expect: {"at":"2026-07-30T00:00:00.000Z","fields":${fields},"keyId":"3c9a01d2e4f5b6a7","pre":"hmac-sha256:${"9f".repeat(32)}"}
`;
  const skill = parseSkill(src);
  const step = skill.steps[0];
  assert.equal(Object.keys(step.expect!.fields!).length, 2);
  // Round-trip byte-stable, canonical order (at, fields, keyId, pre).
  const rendered = serializeSkill(skill);
  assert.ok(rendered.includes('"at":"2026-07-30T00:00:00.000Z","fields":{"body.etag"'));
  assert.equal(serializeSkill(parseSkill(rendered)), rendered);
  // Hash coverage: dropping or editing fields is an approval mismatch.
  const withFields = computeApprovalHash({ actionTool: step.actionTool, actionArgs: step.actionArgs, attest: step.attest, expect: step.expect });
  const without = computeApprovalHash({
    actionTool: step.actionTool,
    actionArgs: step.actionArgs,
    attest: step.attest,
    expect: { at: step.expect!.at, keyId: step.expect!.keyId, pre: step.expect!.pre },
  });
  assert.notEqual(withFields, without);
});

test("grammar: fieldless expect hashes byte-identically to 0.25.0 (P1 identity preserved)", () => {
  const expect = { at: "2026-07-30T06:58:12.331Z", keyId: "3c9a01d2e4f5b6a7", pre: `hmac-sha256:${"9f".repeat(32)}` };
  const attest = { tool: "get_page", args: { slug: "demo" }, projection: ["compiled_truth"] };
  // Pinned against the 0.25.0 formula: digestSha256({args, attest, expect:{at,keyId,pre}, tool}).
  const h = computeApprovalHash({ actionTool: "put_page", actionArgs: { slug: "demo" }, attest, expect });
  assert.equal(
    h,
    digestSha256({
      args: { slug: "demo" },
      attest: { args: attest.args, projection: attest.projection, tool: attest.tool },
      expect: { at: expect.at, keyId: expect.keyId, pre: expect.pre },
      tool: "put_page",
    })
  );
});

test("grammar: malformed fields are loud — non-object, bad MAC shape, empty name", () => {
  const base = (fields: string) => `---
name: p15
description: d
---

### Step 1 — w
- intent: i
- action: put_page {"slug":"x"}
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"x"},"projection":["etag"]}
- approve: sha256:${"0".repeat(64)}
- expect: {"at":"2026-07-30T00:00:00.000Z","fields":${fields},"keyId":"3c9a01d2e4f5b6a7","pre":"hmac-sha256:${"9f".repeat(32)}"}
`;
  for (const bad of ["[]", '"x"', '{"body.etag":"sha256:' + "a".repeat(64) + '"}', '{"":"hmac-sha256:' + "a".repeat(64) + '"}']) {
    assert.throws(() => parseSkill(base(bad)), SkillParseError, `should reject fields=${bad}`);
  }
});

// ---------------------------------------------------------------------------
// End-to-end: approve --probe emits fields; the runner diagnoses which
// field changed (changedFields, mismatch-only)
// ---------------------------------------------------------------------------

function gbrainTools(body: () => Record<string, unknown>) {
  const tools: Record<string, Tool> = {
    get_page: { effect: "read", run: async () => ({ status: 200, headers: {}, body: JSON.stringify(body()) }) },
    put_page: { effect: "idempotent-write", run: async () => ({ status: 200, headers: {}, body: "{}" }) },
  };
  return tools;
}

const TWO_FIELD_SKILL = `---
name: p15-two-fields
description: two-field binding
---

### Step 1 — w
- intent: i
- action: put_page {"slug":"demo"}
- assert: status == 200
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"demo"},"projection":["compiled_truth","rev"]}
`;

test("e2e: approve --probe emits per-field MACs; a one-field drift names exactly that field (changedFields)", async () => {
  await withTempDir(async (dir) => {
    const skillPath = path.join(dir, "s.skill.md");
    await writeFile(skillPath, TWO_FIELD_SKILL, "utf8");
    const state = { compiled_truth: "# v1", rev: "r1" };
    const tools = gbrainTools(() => state);
    const args: ParsedArgs = { positional: [skillPath], flags: new Set(["probe", "all"]), vars: {}, wraps: [], opts: {}, fails: [] };
    const keystorePath = path.join(dir, "keys.json");
    const code = await cmdApprove(args, { tools, env: { REELIER_EXPECT_KEYS: keystorePath }, homedir: dir, isTTY: false });
    assert.equal(code, 0);
    const bound = parseSkill(await (await import("node:fs/promises")).readFile(skillPath, "utf8").then(String));
    const fields = bound.steps[0].expect!.fields!;
    assert.deepEqual(Object.keys(fields).sort(), ["body.compiled_truth", "body.rev"]);

    // Drift ONE of the two fields; the diagnosis names it — and only it.
    state.compiled_truth = "# v2";
    const record = await runSkill(bound, { tools, expectKeystorePath: keystorePath, cwd: dir });
    const check = record.steps[0].stateCheck!;
    assert.equal(check.outcome, "mismatch");
    assert.deepEqual(check.changedFields, ["body.compiled_truth"]);
    assert.equal(check.absentFields, undefined);

    // Render appends the names.
    const lines = renderStateCheckLines(check, record.steps[0].write?.dispatchedAt);
    assert.ok(lines.some((l) => l.includes("fields changed since approval: body.compiled_truth")), lines.join("\n"));
  });
});

test("e2e: a fieldless (0.25.0-era) binding still mismatches with NO changedFields — never fabricated", async () => {
  await withTempDir(async (dir) => {
    const keystorePath = path.join(dir, "keys.json");
    const { key, keyId } = mintExpectKey();
    await writeKeystoreEntry(keystorePath, keyId, { key: key.toString("base64"), createdAt: "2026-07-30T00:00:00.000Z" });
    const typed = projectObservationTyped({ headers: {}, status: 200, body: JSON.stringify({ compiled_truth: "# v1" }) }, ["compiled_truth"]);
    const pre = expectMac(key, "get_page", typed);
    const base = `---
name: p15-fieldless
description: d
---

### Step 1 — w
- intent: i
- action: put_page {"slug":"demo"}
- assert: status == 200
- effect: idempotent-write
- attest: {"tool":"get_page","args":{"slug":"demo"},"projection":["compiled_truth"]}
- expect: {"at":"2026-07-30T00:00:00.000Z","keyId":"${keyId}","pre":"${pre}"}
`;
    const step = parseSkill(`${base}- approve: sha256:${"0".repeat(64)}\n`).steps[0];
    const hash = computeApprovalHash({ actionTool: step.actionTool, actionArgs: step.actionArgs, attest: step.attest, expect: step.expect });
    const skill = parseSkill(`${base}- approve: ${hash}\n`);
    const tools = gbrainTools(() => ({ compiled_truth: "# MOVED" }));
    const record = await runSkill(skill, { tools, expectKeystorePath: keystorePath, cwd: dir });
    assert.equal(record.steps[0].stateCheck!.outcome, "mismatch");
    assert.equal(record.steps[0].stateCheck!.changedFields, undefined);
  });
});

// ---------------------------------------------------------------------------
// --prune-keys (§3.4): orphaned keystore entries, listed and removed loudly
// ---------------------------------------------------------------------------

test("prune-keys: removes only entries referenced by NO skill under cwd; referenced keys survive", async () => {
  await withTempDir(async (dir) => {
    const keystorePath = path.join(dir, "keys.json");
    const live = mintExpectKey();
    const orphan = mintExpectKey();
    await writeKeystoreEntry(keystorePath, live.keyId, { key: live.key.toString("base64"), createdAt: "2026-07-30T00:00:00.000Z", skill: "s", step: 1 });
    await writeKeystoreEntry(keystorePath, orphan.keyId, { key: orphan.key.toString("base64"), createdAt: "2026-07-30T00:00:00.000Z" });
    // A skill under cwd references the live key (nested dir; node_modules is skipped).
    await mkdir(path.join(dir, "skills"), { recursive: true });
    await mkdir(path.join(dir, "node_modules", "junk"), { recursive: true });
    await writeFile(
      path.join(dir, "skills", "s.skill.md"),
      `- expect: {"at":"2026-07-30T00:00:00.000Z","keyId":"${live.keyId}","pre":"hmac-sha256:${"9f".repeat(32)}"}\n`,
      "utf8"
    );
    await writeFile(
      path.join(dir, "node_modules", "junk", "decoy.md"),
      `"keyId":"${orphan.keyId}"`,
      "utf8"
    );

    const args: ParsedArgs = { positional: [], flags: new Set(["prune-keys", "all"]), vars: {}, wraps: [], opts: {}, fails: [] };
    const code = await cmdApprove(args, { env: { REELIER_EXPECT_KEYS: keystorePath }, homedir: dir, isTTY: false, cwd: dir });
    assert.equal(code, 0);
    const store = await readKeystore(keystorePath);
    assert.ok(store.keys[live.keyId], "referenced key survives");
    assert.equal(store.keys[orphan.keyId], undefined, "orphan removed (node_modules decoy ignored)");
  });
});

test("prune-keys: interactive decline removes nothing; empty keystore is a clean no-op", async () => {
  await withTempDir(async (dir) => {
    const keystorePath = path.join(dir, "keys.json");
    const orphan = mintExpectKey();
    await writeKeystoreEntry(keystorePath, orphan.keyId, { key: orphan.key.toString("base64"), createdAt: "2026-07-30T00:00:00.000Z" });
    const args: ParsedArgs = { positional: [], flags: new Set(["prune-keys"]), vars: {}, wraps: [], opts: {}, fails: [] };
    const code = await cmdApprove(args, {
      env: { REELIER_EXPECT_KEYS: keystorePath },
      homedir: dir,
      isTTY: false,
      cwd: dir,
      ask: async () => "n",
    });
    assert.equal(code, 0);
    assert.ok((await readKeystore(keystorePath)).keys[orphan.keyId], "decline removes nothing");

    await rm(keystorePath, { force: true });
    const code2 = await cmdApprove(args, { env: { REELIER_EXPECT_KEYS: keystorePath }, homedir: dir, isTTY: false, cwd: dir });
    assert.equal(code2, 0);
  });
});

test("prune-keys: the scan is at least as forgiving as the parser — re-spaced JSON and an uppercase .MD still protect keys", async () => {
  // Review finding (blocking): the reference regex demanded byte-canonical
  // spacing while the parser accepts any JSON spacing, so a formatter or
  // merge tool could hand --prune-keys --all a LIVE key to destroy.
  await withTempDir(async (dir) => {
    const keystorePath = path.join(dir, "keys.json");
    const spaced = mintExpectKey();
    const upper = mintExpectKey();
    await writeKeystoreEntry(keystorePath, spaced.keyId, { key: spaced.key.toString("base64"), createdAt: "2026-07-30T00:00:00.000Z" });
    await writeKeystoreEntry(keystorePath, upper.keyId, { key: upper.key.toString("base64"), createdAt: "2026-07-30T00:00:00.000Z" });
    await writeFile(
      path.join(dir, "spaced.skill.md"),
      `- expect: { "at": "2026-07-30T00:00:00.000Z", "keyId": "${spaced.keyId}", "pre": "hmac-sha256:${"9f".repeat(32)}" }\n`,
      "utf8"
    );
    await writeFile(path.join(dir, "UPPER.MD"), `"keyId":"${upper.keyId}"`, "utf8");
    const args: ParsedArgs = { positional: [], flags: new Set(["prune-keys", "all"]), vars: {}, wraps: [], opts: {}, fails: [] };
    const code = await cmdApprove(args, { env: { REELIER_EXPECT_KEYS: keystorePath }, homedir: dir, isTTY: false, cwd: dir });
    assert.equal(code, 0);
    const store = await readKeystore(keystorePath);
    assert.ok(store.keys[spaced.keyId], "a re-spaced (still parseable) reference protects its key");
    assert.ok(store.keys[upper.keyId], "case-insensitive filesystems mean case-insensitive extension matching");
  });
});

test("prune-keys: refuses to combine with a skill path or any approve flag — nothing deleted", async () => {
  // Review finding (blocking): dispatch-before-positional-check silently
  // swallowed `approve my.skill.md --all --prune-keys` — keys deleted with
  // no prompt while the operator believes they ran an approve.
  await withTempDir(async (dir) => {
    const keystorePath = path.join(dir, "keys.json");
    const orphan = mintExpectKey();
    await writeKeystoreEntry(keystorePath, orphan.keyId, { key: orphan.key.toString("base64"), createdAt: "2026-07-30T00:00:00.000Z" });
    const combos: Array<{ positional: string[]; flags: string[] }> = [
      { positional: ["some.skill.md"], flags: ["prune-keys", "all"] },
      { positional: [], flags: ["prune-keys", "probe"] },
      { positional: [], flags: ["prune-keys", "rebind"] },
      { positional: [], flags: ["prune-keys", "drop-expect"] },
    ];
    for (const combo of combos) {
      const args: ParsedArgs = { positional: combo.positional, flags: new Set(combo.flags), vars: {}, wraps: [], opts: {}, fails: [] };
      const code = await cmdApprove(args, { env: { REELIER_EXPECT_KEYS: keystorePath }, homedir: dir, isTTY: false, cwd: dir });
      assert.equal(code, 1, `must refuse: ${JSON.stringify(combo)}`);
    }
    assert.ok((await readKeystore(keystorePath)).keys[orphan.keyId], "refusal deletes nothing");
  });
});

test("prune-keys: a reference appearing during the confirmation prompt spares the key (post-consent re-scan)", async () => {
  // Review finding: the prompt has human latency; a concurrent approve may
  // stamp its skill file inside that window. Deletion is unrecoverable, so
  // anything referenced by consent time is spared.
  await withTempDir(async (dir) => {
    const keystorePath = path.join(dir, "keys.json");
    const orphan = mintExpectKey();
    await writeKeystoreEntry(keystorePath, orphan.keyId, { key: orphan.key.toString("base64"), createdAt: "2026-07-30T00:00:00.000Z" });
    const args: ParsedArgs = { positional: [], flags: new Set(["prune-keys"]), vars: {}, wraps: [], opts: {}, fails: [] };
    const code = await cmdApprove(args, {
      env: { REELIER_EXPECT_KEYS: keystorePath },
      homedir: dir,
      isTTY: false,
      cwd: dir,
      ask: async () => {
        await writeFile(
          path.join(dir, "late.skill.md"),
          `- expect: {"at":"2026-07-30T00:00:00.000Z","keyId":"${orphan.keyId}","pre":"hmac-sha256:${"9f".repeat(32)}"}\n`,
          "utf8"
        );
        return "y";
      },
    });
    assert.equal(code, 0);
    assert.ok((await readKeystore(keystorePath)).keys[orphan.keyId], "late reference spares the key");
  });
});

test("removeKeystoreEntries: mintedBefore spares entries minted at/after the scan start (race guard under the lock)", async () => {
  await withTempDir(async (dir) => {
    const keystorePath = path.join(dir, "keys.json");
    const older = mintExpectKey();
    const newer = mintExpectKey();
    await writeKeystoreEntry(keystorePath, older.keyId, { key: older.key.toString("base64"), createdAt: "2026-07-30T00:00:00.000Z" });
    await writeKeystoreEntry(keystorePath, newer.keyId, { key: newer.key.toString("base64"), createdAt: "2026-07-30T12:00:00.000Z" });
    await removeKeystoreEntries(keystorePath, [older.keyId, newer.keyId], { mintedBefore: "2026-07-30T06:00:00.000Z" });
    const store = await readKeystore(keystorePath);
    assert.equal(store.keys[older.keyId], undefined, "minted before the scan — removable");
    assert.ok(store.keys[newer.keyId], "minted after the scan began — spared");
  });
});

// ---------------------------------------------------------------------------
// Hardening pins from the P1.5 adversarial review
// ---------------------------------------------------------------------------

test("namespaces: header names match case-insensitively, exact match first (replay fixtures need not lowercase)", () => {
  const obs: Observation = { status: 200, headers: { ETag: 'W/"v9"' }, body: "{}" };
  assert.deepEqual(projectObservation(obs, ["header.etag"]), { "header.etag": 'W/"v9"' });
  assert.deepEqual(projectObservationTyped(obs, ["header.etag"]), { "header.etag": 'W/"v9"' });
  // Exact match wins when both spellings exist.
  const both: Observation = { status: 200, headers: { etag: "exact", ETag: "folded" }, body: "{}" };
  assert.deepEqual(projectObservation(both, ["header.etag"]), { "header.etag": "exact" });
});

test("changedFields: a prototype-key fields entry (constructor) is never diagnosed — own properties only", async () => {
  // Review finding: `typed[name]` read through Object.prototype, so a
  // hand-crafted fields entry named "constructor" (approval hash is unkeyed
  // sha256 — writable by anyone who can write the file) would land a
  // fabricated name in a signed record.
  await withTempDir(async (dir) => {
    const keystorePath = path.join(dir, "keys.json");
    const { key, keyId } = mintExpectKey();
    await writeKeystoreEntry(keystorePath, keyId, { key: key.toString("base64"), createdAt: "2026-07-30T00:00:00.000Z" });
    const typed = projectObservationTyped({ headers: {}, status: 200, body: JSON.stringify({ compiled_truth: "# v1" }) }, ["compiled_truth"]);
    const pre = expectMac(key, "get_page", typed);
    const fields = {
      "body.compiled_truth": expectFieldMac(key, "get_page", "body.compiled_truth", "# v1"),
      constructor: expectFieldMac(key, "get_page", "constructor", "decoy"),
    };
    const base = `---
name: p15-proto
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
    const step = parseSkill(`${base}- approve: sha256:${"0".repeat(64)}\n`).steps[0];
    const hash = computeApprovalHash({ actionTool: step.actionTool, actionArgs: step.actionArgs, attest: step.attest, expect: step.expect });
    const skill = parseSkill(`${base}- approve: ${hash}\n`);
    const tools = gbrainTools(() => ({ compiled_truth: "# MOVED" }));
    const record = await runSkill(skill, { tools, expectKeystorePath: keystorePath, cwd: dir });
    const check = record.steps[0].stateCheck!;
    assert.equal(check.outcome, "mismatch");
    assert.deepEqual(check.changedFields, ["body.compiled_truth"], "the real drift is named; the prototype key never is");
  });
});
