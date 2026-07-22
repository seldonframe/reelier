import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { getSkill, parseSkillRef } from "../src/get.js";

const SKILL_MD = `---
name: fetched-fixture
description: a skill fetched from the registry
---

### Step 1 — one
- intent: first step
- action: http.get {"url": "https://example.com/1"}
- assert: status == 200
- effect: read
`;

const SKILL_SHA = createHash("sha256").update(SKILL_MD, "utf8").digest("hex");

const WRITES_SKILL_MD = `---
name: writes-fixture
description: a skill that performs a write
---

### Step 1 — create it
- intent: create a thing
- action: create_thing {"name": "x"}
- assert: status == 200
- effect: idempotent-write
`;
const WRITES_SKILL_SHA = createHash("sha256").update(WRITES_SKILL_MD, "utf8").digest("hex");

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "reelier-get-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

type FakeResponseSpec = { status: number; body?: unknown } | { networkError: string };

function fakeFetch(responses: FakeResponseSpec[]): { fn: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const fn = (async (url: string) => {
    calls.push(url);
    const spec = responses[i++];
    if (!spec) throw new Error(`fetch called more times than expected (call #${calls.length})`);
    if ("networkError" in spec) throw new Error(spec.networkError);
    return {
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      text: async () => JSON.stringify(spec.body ?? {}),
    } as unknown as Response;
  }) as typeof fetch;
  return { fn, calls };
}

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function withFetch<T>(fn: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function readOnlyBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    skillMd: SKILL_MD,
    version: 1,
    contentSha256: SKILL_SHA,
    effectGrade: "read_only",
    license: "MIT",
    endpoints: ["https://example.com"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// parseSkillRef
// ---------------------------------------------------------------------------

test("parseSkillRef: plain owner/skill", () => {
  assert.deepEqual(parseSkillRef("acme/status-check"), { owner: "acme", skill: "status-check" });
});

test("parseSkillRef: @N version pin", () => {
  assert.deepEqual(parseSkillRef("acme/status-check@3"), {
    owner: "acme",
    skill: "status-check",
    versionPin: 3,
  });
});

test("parseSkillRef: @sha256: pin", () => {
  const hex = "a".repeat(64);
  assert.deepEqual(parseSkillRef(`acme/status-check@sha256:${hex}`), {
    owner: "acme",
    skill: "status-check",
    shaPin: hex,
  });
});

test("parseSkillRef: rejects missing slash", () => {
  assert.throws(() => parseSkillRef("no-slash-here"), /owner.*skill/i);
});

test("parseSkillRef: rejects malformed sha pin", () => {
  assert.throws(() => parseSkillRef("acme/x@sha256:nothex"), /Invalid @sha256/);
});

test("parseSkillRef: rejects non-integer version pin", () => {
  assert.throws(() => parseSkillRef("acme/x@abc"), /Invalid @<N>/);
});

// ---------------------------------------------------------------------------
// getSkill — collision paths, tamper, and the WRITES trust-block data
// ---------------------------------------------------------------------------

test("getSkill: fresh fetch writes the file and reports 'written'", async () => {
  await withTempDir(async (dir) => {
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example" }, async () => {
      const { fn, calls } = fakeFetch([{ status: 200, body: readOnlyBody() }]);
      const outcome = await withFetch(fn, () => getSkill("acme/fetched-fixture", { cwd: dir }));

      assert.equal(outcome.kind, "written");
      if (outcome.kind !== "written") return;
      assert.equal(outcome.path, path.join(dir, "skills", "fetched-fixture.skill.md"));
      assert.equal(outcome.result.effectGrade, "read_only");
      assert.equal(outcome.steps.length, 1);
      assert.equal(outcome.steps[0].effect, "read");

      const written = await readFile(outcome.path, "utf8");
      assert.equal(written, SKILL_MD);

      assert.equal(calls.length, 1);
      assert.equal(calls[0], "https://cloud.example/api/v1/registry/acme/fetched-fixture");
    });
  });
});

test("getSkill: @N pin sends ?version= query param", async () => {
  await withTempDir(async (dir) => {
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example" }, async () => {
      const { fn, calls } = fakeFetch([{ status: 200, body: readOnlyBody({ version: 3 }) }]);
      await withFetch(fn, () => getSkill("acme/fetched-fixture@3", { cwd: dir }));
      assert.equal(calls[0], "https://cloud.example/api/v1/registry/acme/fetched-fixture?version=3");
    });
  });
});

test("getSkill: @sha256: pin sends ?sha256= query param", async () => {
  await withTempDir(async (dir) => {
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example" }, async () => {
      const { fn, calls } = fakeFetch([{ status: 200, body: readOnlyBody() }]);
      await withFetch(fn, () => getSkill(`acme/fetched-fixture@sha256:${SKILL_SHA}`, { cwd: dir }));
      assert.equal(calls[0], `https://cloud.example/api/v1/registry/acme/fetched-fixture?sha256=${SKILL_SHA}`);
    });
  });
});

test("getSkill: same-hash collision -> 'already up to date', no write, exit-shaped no-op", async () => {
  await withTempDir(async (dir) => {
    const skillsDir = path.join(dir, "skills");
    await mkdir(skillsDir, { recursive: true });
    const outPath = path.join(skillsDir, "fetched-fixture.skill.md");
    await writeFile(outPath, SKILL_MD, "utf8");
    const mtimeBefore = (await readFile(outPath, "utf8")).length;

    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example" }, async () => {
      const { fn } = fakeFetch([{ status: 200, body: readOnlyBody() }]);
      const outcome = await withFetch(fn, () => getSkill("acme/fetched-fixture", { cwd: dir }));

      assert.equal(outcome.kind, "up-to-date");
      if (outcome.kind !== "up-to-date") return;
      assert.equal(outcome.path, outPath);
      assert.equal(outcome.version, 1);

      // File content is untouched (same bytes — a real rewrite would still
      // be byte-identical, so assert it wasn't touched via length/content).
      const after = await readFile(outPath, "utf8");
      assert.equal(after.length, mtimeBefore);
      assert.equal(after, SKILL_MD);
    });
  });
});

test("getSkill: different-hash collision -> hard error naming the mismatch, no write, no --force", async () => {
  await withTempDir(async (dir) => {
    const skillsDir = path.join(dir, "skills");
    await mkdir(skillsDir, { recursive: true });
    const outPath = path.join(skillsDir, "fetched-fixture.skill.md");
    const localContent = "---\nname: fetched-fixture\ndescription: local, different content\n---\n\n### Step 1 — x\n- intent: x\n- action: http.get {}\n- effect: read\n";
    await writeFile(outPath, localContent, "utf8");

    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example" }, async () => {
      const { fn } = fakeFetch([{ status: 200, body: readOnlyBody() }]);
      const outcome = await withFetch(fn, () => getSkill("acme/fetched-fixture", { cwd: dir }));

      assert.equal(outcome.kind, "hash-mismatch");
      if (outcome.kind !== "hash-mismatch") return;
      assert.equal(outcome.incomingSha, SKILL_SHA);
      assert.notEqual(outcome.existingSha, SKILL_SHA);

      // Never clobbered.
      const after = await readFile(outPath, "utf8");
      assert.equal(after, localContent);
    });
  });
});

test("getSkill: --force overwrites a different-hash collision", async () => {
  await withTempDir(async (dir) => {
    const skillsDir = path.join(dir, "skills");
    await mkdir(skillsDir, { recursive: true });
    const outPath = path.join(skillsDir, "fetched-fixture.skill.md");
    await writeFile(outPath, "---\nname: fetched-fixture\ndescription: stale\n---\n\n### Step 1 — x\n- intent: x\n- action: http.get {}\n- effect: read\n", "utf8");

    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example" }, async () => {
      const { fn } = fakeFetch([{ status: 200, body: readOnlyBody() }]);
      const outcome = await withFetch(fn, () => getSkill("acme/fetched-fixture", { cwd: dir, force: true }));

      assert.equal(outcome.kind, "written");
      const after = await readFile(outPath, "utf8");
      assert.equal(after, SKILL_MD);
    });
  });
});

test("getSkill: tamper — server body's actual sha256 does not match its own declared contentSha256 -> nothing written", async () => {
  await withTempDir(async (dir) => {
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example" }, async () => {
      // The server declares a contentSha256 that doesn't match the skillMd
      // bytes actually returned in the body — simulating a tampered/corrupt
      // response in transit or at rest.
      const { fn } = fakeFetch([
        { status: 200, body: readOnlyBody({ contentSha256: "0".repeat(64) }) },
      ]);
      const outcome = await withFetch(fn, () => getSkill("acme/fetched-fixture", { cwd: dir }));

      assert.equal(outcome.kind, "tamper");
      if (outcome.kind !== "tamper") return;
      assert.equal(outcome.source, "server");
      assert.equal(outcome.expectedSha, "0".repeat(64));
      assert.equal(outcome.actualSha, SKILL_SHA);

      // Nothing written at all.
      const skillsDir = path.join(dir, "skills");
      await assert.rejects(() => readFile(path.join(skillsDir, "fetched-fixture.skill.md"), "utf8"));
    });
  });
});

test("getSkill: tamper — content doesn't match an explicit @sha256: pin -> nothing written", async () => {
  await withTempDir(async (dir) => {
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example" }, async () => {
      // Server-declared hash matches its own body (internally consistent),
      // but the caller pinned a *different* hash than what's actually there.
      const { fn } = fakeFetch([{ status: 200, body: readOnlyBody() }]);
      const wrongPin = "f".repeat(64);
      const outcome = await withFetch(fn, () => getSkill(`acme/fetched-fixture@sha256:${wrongPin}`, { cwd: dir }));

      assert.equal(outcome.kind, "tamper");
      if (outcome.kind !== "tamper") return;
      assert.equal(outcome.source, "pin");
      assert.equal(outcome.expectedSha, wrongPin);
      assert.equal(outcome.actualSha, SKILL_SHA);

      const skillsDir = path.join(dir, "skills");
      await assert.rejects(() => readFile(path.join(skillsDir, "fetched-fixture.skill.md"), "utf8"));
    });
  });
});

test("getSkill: 410 removed -> 'removed' outcome with the reason, no write", async () => {
  await withTempDir(async (dir) => {
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example" }, async () => {
      const { fn } = fakeFetch([{ status: 410, body: { reason: "policy takedown: license violation" } }]);
      const outcome = await withFetch(fn, () => getSkill("acme/fetched-fixture", { cwd: dir }));

      assert.equal(outcome.kind, "removed");
      if (outcome.kind !== "removed") return;
      assert.equal(outcome.reason, "policy takedown: license violation");

      const skillsDir = path.join(dir, "skills");
      await assert.rejects(() => readFile(path.join(skillsDir, "fetched-fixture.skill.md"), "utf8"));
    });
  });
});

test("getSkill: WRITES-grade fixture reports effectGrade 'writes' and per-step effect", async () => {
  await withTempDir(async (dir) => {
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example" }, async () => {
      const { fn } = fakeFetch([
        {
          status: 200,
          body: {
            skillMd: WRITES_SKILL_MD,
            version: 1,
            contentSha256: WRITES_SKILL_SHA,
            effectGrade: "writes",
            license: "MIT",
            endpoints: [],
          },
        },
      ]);
      const outcome = await withFetch(fn, () => getSkill("acme/writes-fixture", { cwd: dir }));

      assert.equal(outcome.kind, "written");
      if (outcome.kind !== "written") return;
      assert.equal(outcome.result.effectGrade, "writes");
      assert.equal(outcome.steps.length, 1);
      assert.equal(outcome.steps[0].effect, "idempotent-write");
    });
  });
});

test("getSkill: 404 -> 'error' outcome naming the missing owner/skill, no write", async () => {
  await withTempDir(async (dir) => {
    await withEnv({ REELIER_CLOUD_URL: "https://cloud.example" }, async () => {
      const { fn } = fakeFetch([{ status: 404 }]);
      const outcome = await withFetch(fn, () => getSkill("acme/nonexistent-skill", { cwd: dir }));

      assert.equal(outcome.kind, "error");
      if (outcome.kind !== "error") return;
      assert.match(outcome.message, /No registry listing found for 'acme\/nonexistent-skill'/);

      const skillsDir = path.join(dir, "skills");
      await assert.rejects(() => readFile(path.join(skillsDir, "nonexistent-skill.skill.md"), "utf8"));
    });
  });
});

test("getSkill: missing REELIER_CLOUD_URL -> error outcome, no network call", async () => {
  await withTempDir(async (dir) => {
    await withEnv({ REELIER_CLOUD_URL: undefined }, async () => {
      const outcome = await getSkill("acme/fetched-fixture", { cwd: dir });
      assert.equal(outcome.kind, "error");
      if (outcome.kind !== "error") return;
      assert.match(outcome.message, /REELIER_CLOUD_URL/);
    });
  });
});
