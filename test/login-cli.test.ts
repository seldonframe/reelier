import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { cmdLogin, cmdWhoami } from "../src/cli.js";
import { writeCliConfig, readCliConfig, DEFAULT_CLOUD_URL } from "../src/cloud-config.js";

// Exercises cmdLogin/cmdWhoami's console output directly, mirroring
// test/push-cli.test.ts's withCapturedLogs/withEnv/withFetch helpers (kept
// local rather than shared, same reasoning as that file: cli.ts and its
// collaborators are tested at a different layer than push.ts/login.ts).

type FakeResponseSpec = { status: number; body?: unknown };

function fakeFetch(responses: FakeResponseSpec[]): { fn: typeof fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const spec = responses[i++];
    if (!spec) throw new Error(`fetch called more times than expected (call #${calls.length})`);
    const text = JSON.stringify(spec.body ?? {});
    return {
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      text: async () => text,
      json: async () => JSON.parse(text),
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

async function withCapturedLogs<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const originalLog = console.log;
  const originalError = console.error;
  const lines: string[] = [];
  console.log = ((...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  }) as typeof console.log;
  console.error = console.log;
  try {
    const result = await run();
    return { result, lines };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

async function withHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(path.join(tmpdir(), "reelier-login-cli-"));
  try {
    return await withEnv({ HOME: home, USERPROFILE: home }, () => fn(home));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

// --- cmdWhoami ---------------------------------------------------------

test("cmdWhoami: no key anywhere (no env, no config file) -> exact 'not logged in' message, exit 1", async () => {
  await withHome(async () => {
    await withEnv({ REELIER_CLOUD_KEY: undefined, REELIER_CLOUD_URL: undefined }, async () => {
      const { fn } = fakeFetch([]); // never called
      const { result, lines } = await withCapturedLogs(() => cmdWhoami(fn));
      assert.equal(result, 1);
      assert.ok(lines.includes("Not logged in. Run 'reelier login'."));
    });
  });
});

test("cmdWhoami: 401 -> exact 'invalid or revoked' message, exit 1", async () => {
  await withHome(async (home) => {
    await writeCliConfig({ apiKey: "sk-stale-key" }, home);
    await withEnv({ REELIER_CLOUD_KEY: undefined, REELIER_CLOUD_URL: undefined }, async () => {
      const { fn } = fakeFetch([{ status: 401 }]);
      const { result, lines } = await withCapturedLogs(() => cmdWhoami(fn));
      assert.equal(result, 1);
      assert.ok(lines.includes("API key is invalid or revoked. Run 'reelier login' again."));
    });
  });
});

test("cmdWhoami: 200 -> prints '<githubLogin ?? name> (<baseUrl>)'", async () => {
  await withHome(async (home) => {
    await writeCliConfig({ apiKey: "sk-good-key" }, home);
    await withEnv({ REELIER_CLOUD_KEY: undefined, REELIER_CLOUD_URL: undefined }, async () => {
      const { fn } = fakeFetch([{ status: 200, body: { tenant: { name: "acme", githubLogin: "maxim" } } }]);
      const { result, lines } = await withCapturedLogs(() => cmdWhoami(fn));
      assert.equal(result, 0);
      assert.ok(lines.includes(`maxim (${DEFAULT_CLOUD_URL})`));
    });
  });
});

test("cmdWhoami: 200 with no githubLogin -> falls back to tenant name", async () => {
  await withHome(async (home) => {
    await writeCliConfig({ apiKey: "sk-good-key" }, home);
    await withEnv({ REELIER_CLOUD_KEY: undefined, REELIER_CLOUD_URL: undefined }, async () => {
      const { fn } = fakeFetch([{ status: 200, body: { tenant: { name: "acme", githubLogin: null } } }]);
      const { result, lines } = await withCapturedLogs(() => cmdWhoami(fn));
      assert.equal(result, 0);
      assert.ok(lines.includes(`acme (${DEFAULT_CLOUD_URL})`));
    });
  });
});

test("cmdWhoami: fetchImpl throws (network error) -> exit 1, clean message, no stack trace", async () => {
  await withHome(async (home) => {
    await writeCliConfig({ apiKey: "sk-good-key" }, home);
    await withEnv({ REELIER_CLOUD_KEY: undefined, REELIER_CLOUD_URL: undefined }, async () => {
      const fn = (async () => {
        throw new Error("getaddrinfo ENOTFOUND www.reelier.com");
      }) as typeof fetch;
      const { result, lines } = await withCapturedLogs(() => cmdWhoami(fn));
      assert.equal(result, 1);
      assert.ok(lines.includes("Failed to look up identity: getaddrinfo ENOTFOUND www.reelier.com"));
      assert.ok(!lines.some((l) => l.includes("at ")), "no stack trace in captured output");
    });
  });
});

// --- cmdLogin ------------------------------------------------------------

test("cmdLogin happy path: the raw API key string never appears in captured output; the user code does", async () => {
  await withHome(async (home) => {
    await withEnv({ REELIER_CLOUD_URL: undefined }, async () => {
      const SECRET_KEY = "sk-super-secret-do-not-print-12345";
      const { fn } = fakeFetch([
        {
          status: 200,
          body: {
            deviceCode: "dc-1",
            userCode: "BCDF-2345",
            verificationUri: "https://www.reelier.com/device",
            verificationUriComplete: "https://www.reelier.com/device?user_code=BCDF-2345",
            expiresIn: 900,
            interval: 5,
          },
        },
        { status: 400, body: { error: "authorization_pending" } },
        { status: 200, body: { apiKey: SECRET_KEY, tenant: { name: "acme", githubLogin: "maxim" } } },
      ]);
      const sleeps: number[] = [];
      const sleepImpl = async (ms: number) => {
        sleeps.push(ms);
      };
      const spawnCalls: unknown[] = [];
      const fakeChild = { unref: () => {}, on: () => {} };
      const spawnImpl = ((...args: unknown[]) => {
        spawnCalls.push(args);
        return fakeChild as unknown as ReturnType<typeof import("node:child_process").spawn>;
      }) as typeof import("node:child_process").spawn;

      const { result, lines } = await withCapturedLogs(() => cmdLogin(fn, sleepImpl, spawnImpl));

      assert.equal(result, 0);
      const combined = lines.join("\n");
      assert.ok(!combined.includes(SECRET_KEY), `captured output must never contain the raw key; got:\n${combined}`);
      assert.ok(combined.includes("BCDF-2345"), "captured output must contain the user code");
      assert.ok(combined.includes("Logged in as maxim."));
      assert.deepEqual(sleeps, [5000]);
      assert.equal(spawnCalls.length, 1);

      // and the key WAS actually persisted (just never printed)
      const saved = await readCliConfig(home);
      assert.equal(saved.apiKey, SECRET_KEY);
      assert.equal(saved.tenantName, "acme");
      assert.equal(saved.githubLogin, "maxim");
      assert.equal(saved.cloudUrl, undefined); // DEFAULT_CLOUD_URL is omitted from the file
    });
  });
});

test("cmdLogin: startLogin failure -> honest message, exit 1, nothing printed contains a key (none exists)", async () => {
  await withHome(async () => {
    const { fn } = fakeFetch([{ status: 500, body: { error: "boom" } }]);
    const { result, lines } = await withCapturedLogs(() => cmdLogin(fn));
    assert.equal(result, 1);
    assert.ok(lines.some((l) => l.startsWith("Failed to start login:")));
  });
});
