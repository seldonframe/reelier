import { test } from "node:test";
import assert from "node:assert/strict";
import { builtinTools } from "../src/tools.js";

// B2 — request-id refs (trust-ladder spec §3): http.get/http.post capture an
// ALLOWLIST of response headers into Observation.refs. Never a heuristic
// scrape beyond the named keys; absent entirely when nothing on the
// allowlist was present.

async function withFetch<T>(fn: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

function fakeResponse(headers: Record<string, string>, body = "{}"): typeof fetch {
  return (async () => {
    return {
      status: 200,
      headers: new Headers(headers),
      text: async () => body,
    } as unknown as Response;
  }) as typeof fetch;
}

test("http.get: captures an allowlisted request-id header into refs", async () => {
  await withFetch(fakeResponse({ "request-id": "req_abc123" }), async () => {
    const obs = await builtinTools["http.get"].run({ url: "https://example.com" }, { allowDestructive: false });
    assert.deepEqual(obs.refs, [{ source: "header", key: "request-id", value: "req_abc123" }]);
  });
});

test("http.get: captures every allowlisted header present, ignores everything else", async () => {
  await withFetch(
    fakeResponse({
      "x-request-id": "xr-1",
      "cf-ray": "ray-1",
      "content-type": "application/json",
      "x-totally-unrelated-header": "nope",
    }),
    async () => {
      const obs = await builtinTools["http.get"].run({ url: "https://example.com" }, { allowDestructive: false });
      assert.ok(obs.refs);
      const keys = obs.refs!.map((r) => r.key).sort();
      assert.deepEqual(keys, ["cf-ray", "x-request-id"]);
    }
  );
});

test("http.get: no allowlisted headers present -> refs is omitted entirely (not an empty array)", async () => {
  await withFetch(fakeResponse({ "content-type": "text/plain" }), async () => {
    const obs = await builtinTools["http.get"].run({ url: "https://example.com" }, { allowDestructive: false });
    assert.equal(obs.refs, undefined);
  });
});

test("http.post: captures stripe-request-id the same way as http.get", async () => {
  await withFetch(fakeResponse({ "stripe-request-id": "req_stripe_1" }), async () => {
    const obs = await builtinTools["http.post"].run(
      { url: "https://example.com", body: { a: 1 } },
      { allowDestructive: false }
    );
    assert.deepEqual(obs.refs, [{ source: "header", key: "stripe-request-id", value: "req_stripe_1" }]);
  });
});

test("http.get: a captured ref value matching a REELIER_REDACT-listed env var is redacted, not leaked", async () => {
  const originalEnv = process.env.REELIER_REDACT;
  const originalSecret = process.env.MY_TEST_SECRET;
  process.env.REELIER_REDACT = "MY_TEST_SECRET";
  process.env.MY_TEST_SECRET = "super-secret-value-123";
  try {
    await withFetch(fakeResponse({ "request-id": "super-secret-value-123" }), async () => {
      const obs = await builtinTools["http.get"].run({ url: "https://example.com" }, { allowDestructive: false });
      assert.ok(obs.refs);
      assert.equal(obs.refs![0].value, "«redacted:MY_TEST_SECRET»");
    });
  } finally {
    if (originalEnv === undefined) delete process.env.REELIER_REDACT;
    else process.env.REELIER_REDACT = originalEnv;
    if (originalSecret === undefined) delete process.env.MY_TEST_SECRET;
    else process.env.MY_TEST_SECRET = originalSecret;
  }
});
