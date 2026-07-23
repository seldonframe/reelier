import { test } from "node:test";
import assert from "node:assert/strict";
import { startLogin, pollForToken, openBrowser } from "../src/login.js";

type FakeResponseSpec = { status: number; body?: unknown } | { networkError: string };

function fakeFetch(responses: FakeResponseSpec[]): { fn: typeof fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  let i = 0;
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const spec = responses[i++];
    if (!spec) throw new Error(`fetch called more times than expected (this is call #${calls.length})`);
    if ("networkError" in spec) throw new Error(spec.networkError);
    return {
      status: spec.status,
      ok: spec.status >= 200 && spec.status < 300,
      text: async () => JSON.stringify(spec.body ?? {}),
    } as unknown as Response;
  }) as typeof fetch;
  return { fn, calls };
}

function recordingSleep(): { fn: (ms: number) => Promise<void>; sleeps: number[] } {
  const sleeps: number[] = [];
  const fn = async (ms: number) => {
    sleeps.push(ms);
  };
  return { fn, sleeps };
}

test("startLogin: POSTs to /api/v1/device/authorize with an empty JSON body", async () => {
  const { fn, calls } = fakeFetch([
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
  ]);
  const result = await startLogin("https://www.reelier.com", fn);
  assert.equal(result.userCode, "BCDF-2345");
  assert.equal(result.verificationUriComplete, "https://www.reelier.com/device?user_code=BCDF-2345");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://www.reelier.com/api/v1/device/authorize");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {});
});

test("pollForToken: pending, pending, ok resolves with the key and sleeps twice", async () => {
  const { fn, calls } = fakeFetch([
    { status: 400, body: { error: "authorization_pending" } },
    { status: 400, body: { error: "authorization_pending" } },
    { status: 200, body: { apiKey: "sk-abc123", tenant: { name: "acme", githubLogin: "maxim" } } },
  ]);
  const { fn: sleepFn, sleeps } = recordingSleep();
  const result = await pollForToken("https://www.reelier.com", "dc-1", {
    intervalSeconds: 5,
    fetchImpl: fn,
    sleepImpl: sleepFn,
  });
  assert.equal(result.apiKey, "sk-abc123");
  assert.equal(result.tenant.name, "acme");
  assert.equal(result.tenant.githubLogin, "maxim");
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [5000, 5000]);
  for (const call of calls) {
    assert.equal(call.url, "https://www.reelier.com/api/v1/device/token");
    assert.deepEqual(JSON.parse(String(call.init.body)), { deviceCode: "dc-1" });
  }
});

test("pollForToken: slow_down grows the interval by 5s for subsequent sleeps", async () => {
  const { fn } = fakeFetch([
    { status: 400, body: { error: "authorization_pending" } },
    { status: 400, body: { error: "slow_down" } },
    { status: 200, body: { apiKey: "sk-xyz", tenant: { name: "acme", githubLogin: null } } },
  ]);
  const { fn: sleepFn, sleeps } = recordingSleep();
  const result = await pollForToken("https://www.reelier.com", "dc-1", {
    intervalSeconds: 5,
    fetchImpl: fn,
    sleepImpl: sleepFn,
  });
  assert.equal(result.apiKey, "sk-xyz");
  assert.equal(result.tenant.githubLogin, null);
  // first sleep at base interval (5s), second sleep after slow_down grew it by 5s -> 10s
  assert.deepEqual(sleeps, [5000, 10000]);
});

test("pollForToken: expired_token throws the exact login-expired message", async () => {
  const { fn } = fakeFetch([{ status: 400, body: { error: "expired_token" } }]);
  const { fn: sleepFn } = recordingSleep();
  await assert.rejects(
    () => pollForToken("https://www.reelier.com", "dc-1", { fetchImpl: fn, sleepImpl: sleepFn }),
    /Login expired — run 'reelier login' again\./
  );
});

test("pollForToken: access_denied throws the exact denial message", async () => {
  const { fn } = fakeFetch([{ status: 400, body: { error: "access_denied" } }]);
  const { fn: sleepFn } = recordingSleep();
  await assert.rejects(
    () => pollForToken("https://www.reelier.com", "dc-1", { fetchImpl: fn, sleepImpl: sleepFn }),
    /Login was denied from the browser\./
  );
});

test("openBrowser: win32 spawns cmd /c start \"\" <url>, detached + unref", async () => {
  const calls: { cmd: string; args: string[]; opts: unknown }[] = [];
  const fakeChild = { unref: () => {}, on: () => {} };
  const spawnImpl = ((cmd: string, args: string[], opts?: unknown) => {
    calls.push({ cmd, args, opts });
    return fakeChild as unknown as ReturnType<typeof import("node:child_process").spawn>;
  }) as typeof import("node:child_process").spawn;
  openBrowser("https://www.reelier.com/device?user_code=X", "win32", spawnImpl);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "cmd");
  assert.deepEqual(calls[0].args, ["/c", "start", "", "https://www.reelier.com/device?user_code=X"]);
});

test("openBrowser: darwin spawns open <url>", async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const fakeChild = { unref: () => {}, on: () => {} };
  const spawnImpl = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return fakeChild as unknown as ReturnType<typeof import("node:child_process").spawn>;
  }) as typeof import("node:child_process").spawn;
  openBrowser("https://www.reelier.com/device", "darwin", spawnImpl);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "open");
  assert.deepEqual(calls[0].args, ["https://www.reelier.com/device"]);
});

test("openBrowser: other platforms spawn xdg-open <url>", async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  const fakeChild = { unref: () => {}, on: () => {} };
  const spawnImpl = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return fakeChild as unknown as ReturnType<typeof import("node:child_process").spawn>;
  }) as typeof import("node:child_process").spawn;
  openBrowser("https://www.reelier.com/device", "linux", spawnImpl);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "xdg-open");
  assert.deepEqual(calls[0].args, ["https://www.reelier.com/device"]);
});

test("openBrowser: swallows a spawn that throws synchronously", async () => {
  const spawnImpl = (() => {
    throw new Error("spawn ENOENT");
  }) as unknown as typeof import("node:child_process").spawn;
  assert.doesNotThrow(() => openBrowser("https://www.reelier.com/device", "linux", spawnImpl));
});

test("openBrowser: swallows an async spawn error via the child's error event", async () => {
  let errorHandler: ((err: Error) => void) | undefined;
  const fakeChild = {
    unref: () => {},
    on: (event: string, handler: (err: Error) => void) => {
      if (event === "error") errorHandler = handler;
    },
  };
  const spawnImpl = (() => fakeChild as unknown as ReturnType<typeof import("node:child_process").spawn>) as typeof import("node:child_process").spawn;
  assert.doesNotThrow(() => openBrowser("https://www.reelier.com/device", "linux", spawnImpl));
  assert.ok(errorHandler);
  assert.doesNotThrow(() => errorHandler!(new Error("ENOENT")));
});
