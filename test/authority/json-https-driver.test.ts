import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { __testSetJsonHttpsTransport, createPinnedLookup, executeJsonHttpsEffect, executeJsonHttpsRead } from "../../src/authority/drivers/json-https.js";
import { createTotalDeadline } from "../../src/authority/net/deadline.js";

class FakeRequest extends EventEmitter {
  destroyed = false;
  readonly writes: Buffer[] = [];
  destroyError: Error | undefined;
  write(value: Uint8Array) { this.writes.push(Buffer.from(value)); return true; }
  end() {}
  destroy(error?: Error) { this.destroyed = true; this.destroyError = error; if (error) queueMicrotask(() => this.emit("error", error)); return this; }
}

class FakeResponse extends EventEmitter {
  constructor(readonly statusCode: number, readonly headers: Readonly<Record<string, string | string[] | undefined>> = {}) { super(); }
}

class FakeSocket extends EventEmitter {
  destroyed = false;
  connecting = false;
  destroyError: Error | undefined;
  destroy(error?: Error) { this.destroyed = true; this.destroyError = error; return this; }
}

function controlledTimers() {
  const callbacks: Array<() => void> = [];
  return {
    timers: {
      setTimeout(callback: () => void) { callbacks.push(callback); return { unref() {} }; },
      clearTimeout() {},
    },
    fireNext() { const pending = callbacks.splice(0); assert.ok(pending.length, "expected a pending transport timer"); for (const callback of pending) callback(); },
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 10 && !predicate(); attempt += 1) await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(predicate(), true, "expected native transport stage to start");
}

const endpoint = { endpointId: "endpoint", baseUrl: "https://localhost", allowedMethods: ["GET"] as const, allowedPathPrefixes: ["/read"], accountIdentity: "account" };

function readWithTransport(transport: object, extra: object = {}) {
  const restore = __testSetJsonHttpsTransport(transport);
  return executeJsonHttpsRead({ endpointId: "endpoint", path: "/read" }, endpoint, { async resolve() { throw new Error("unexpected credential resolution"); } }, { timeoutMs: 100, monotonicNow: () => 0, ...extra }).finally(restore);
}

test("pinned DNS lookup supports Node's single-address callback shape", async () => {
  const lookup = createPinnedLookup("8.8.8.8");
  const result = await new Promise<{ address: string | import("node:dns").LookupAddress[]; family?: number }>((resolve, reject) => {
    lookup("example.test", { all: false }, (error, address, family) => error ? reject(error) : resolve({ address, family }));
  });
  assert.deepEqual(result, { address: "8.8.8.8", family: 4 });
});

test("pinned DNS lookup supports Node 24's all-addresses callback shape", async () => {
  const lookup = createPinnedLookup("2606:4700:4700::1111");
  const result = await new Promise<{ address: string | import("node:dns").LookupAddress[]; family?: number }>((resolve, reject) => {
    lookup("example.test", { all: true }, (error, address, family) => error ? reject(error) : resolve({ address, family }));
  });
  assert.deepEqual(result, { address: [{ address: "2606:4700:4700::1111", family: 6 }], family: undefined });
});

test("pinned DNS lookup refuses a non-IP pin", () => {
  assert.throws(() => createPinnedLookup("example.test"), /valid IP address/);
});

test("normal HTTPS effects reject oversized uploads before resolving credentials", async () => {
  let credentialResolved = false;
  await assert.rejects(() => executeJsonHttpsEffect({ endpointId: "endpoint", method: "POST", path: "/write", query: "", headers: {}, bodyBase64: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64") } as never, { endpointId: "endpoint", baseUrl: "https://api.example", allowedMethods: ["POST"], allowedPathPrefixes: ["/write"], secretRef: "env:SECRET", accountIdentity: "account" }, { async resolve() { credentialResolved = true; throw new Error("must not resolve"); } }), /configured limit/i);
  assert.equal(credentialResolved, false);
});

test("total deadlines expose one absolute expiry for native HTTPS dispatch", () => {
  const deadline = createTotalDeadline({ timeoutMs: 100, monotonicNow: () => 50 });
  assert.equal(deadline.startedAtMs, 50);
  assert.equal(deadline.expiresAtMs, 150);
  assert.equal(deadline.absoluteDeadlineMs, 150);
});

test("native HTTPS rejects hung DNS at the total deadline without starting a request", async () => {
  const clock = controlledTimers();
  let requests = 0;
  const pending = readWithTransport({
    lookup: async () => new Promise<never>(() => {}),
    httpsRequest() { requests += 1; throw new Error("request must not start"); },
    ...clock.timers,
  });
  const refused = assert.rejects(pending, /deadline/i);
  await Promise.resolve();
  clock.fireNext();
  await refused;
  assert.equal(requests, 0);
});

test("native HTTPS pins the selected validated address and destroys an active request at expiry", async () => {
  const clock = controlledTimers();
  const request = new FakeRequest();
  let pinnedAddress = "";
  const pending = readWithTransport({
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    httpsRequest(options: { lookup: (hostname: string, options: { all: boolean }, callback: (error: Error | null, address: string) => void) => void }) {
      options.lookup("localhost", { all: false }, (error, address) => { assert.equal(error, null); pinnedAddress = address; });
      return request;
    },
    ...clock.timers,
  });
  const refused = assert.rejects(pending, /deadline/i);
  await waitFor(() => pinnedAddress.length > 0);
  clock.fireNext();
  await refused;
  assert.equal(pinnedAddress, "8.8.8.8");
  assert.equal(request.destroyed, true);
});

test("native HTTPS refuses redirects and destroys the request", async () => {
  const request = new FakeRequest();
  let respond: ((response: FakeResponse) => void) | undefined;
  const pending = readWithTransport({
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    httpsRequest(_options: unknown, callback: (response: FakeResponse) => void) { respond = callback; return request; },
    ...controlledTimers().timers,
  });
  const refused = assert.rejects(pending, /redirect/i);
  await waitFor(() => respond !== undefined);
  assert.ok(respond); respond(new FakeResponse(302, { location: "https://other.example" }));
  await refused;
  assert.equal(request.destroyed, true);
});

test("native HTTPS destroys and refuses a response that crosses the byte cap", async () => {
  const request = new FakeRequest();
  let respond: ((response: FakeResponse) => void) | undefined;
  const pending = readWithTransport({
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    httpsRequest(_options: unknown, callback: (response: FakeResponse) => void) { respond = callback; return request; },
    ...controlledTimers().timers,
  }, { maxResponseBytes: 3 });
  const refused = assert.rejects(pending, /configured limit/i);
  await waitFor(() => respond !== undefined);
  assert.ok(respond); const response = new FakeResponse(200); respond(response); response.emit("data", Buffer.from("four"));
  await refused;
  assert.equal(request.destroyed, true);
});

test("native HTTPS destroys an active body stream at expiry and suppresses its late end", async () => {
  const clock = controlledTimers();
  const request = new FakeRequest();
  let respond: ((response: FakeResponse) => void) | undefined;
  const pending = readWithTransport({
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    httpsRequest(_options: unknown, callback: (response: FakeResponse) => void) { respond = callback; return request; },
    ...clock.timers,
  });
  const refused = assert.rejects(pending, /deadline/i);
  await waitFor(() => respond !== undefined);
  assert.ok(respond); const response = new FakeResponse(200); respond(response); response.emit("data", Buffer.from("partial"));
  clock.fireNext();
  await refused;
  assert.equal(request.destroyed, true);
  response.emit("end");
  assert.equal(request.destroyed, true);
});

for (const stage of ["connect", "tls"] as const) {
  test(`proxy transport destroys active ${stage.toUpperCase()} resources at expiry`, async () => {
    const clock = controlledTimers();
    const connectRequest = new FakeRequest();
    const rawSocket = new FakeSocket();
    const secureSocket = new FakeSocket();
    const restore = __testSetJsonHttpsTransport({
      lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      httpRequest() { return connectRequest; },
      tlsConnect() { return secureSocket; },
      ...clock.timers,
    } as never);
    const pending = executeJsonHttpsRead({ endpointId: "endpoint", path: "/read" }, { ...endpoint, egressProxy: { baseUrl: "http://proxy.internal", bearerRef: "env:PROXY" } }, { async resolve() { return "opaque"; } }, { timeoutMs: 100, monotonicNow: () => 0 }).finally(restore);
    const refused = assert.rejects(pending, /deadline/i);
    await waitFor(() => connectRequest.listenerCount("connect") > 0);
    if (stage === "tls") connectRequest.emit("connect", { statusCode: 200 }, rawSocket, Buffer.alloc(0));
    clock.fireNext();
    await refused;
    assert.equal(connectRequest.destroyed, true);
    assert.equal(rawSocket.destroyed, stage === "tls");
    assert.equal(secureSocket.destroyed, stage === "tls");
  });
}

test("proxy transport destroys CONNECT and tunnel resources on expiry and ignores late success", async () => {
  const clock = controlledTimers();
  const connectRequest = new FakeRequest();
  const rawSocket = new FakeSocket();
  const secureSocket = new FakeSocket();
  const tunneledRequest = new FakeRequest();
  let tunnelCallback: ((response: FakeResponse) => void) | undefined;
  const restore = __testSetJsonHttpsTransport({
        lookup: async () => [{ address: "8.8.8.8", family: 4 }],
        httpRequest(options: { method: string }, callback?: (response: FakeResponse) => void) {
          if (options.method === "CONNECT") return connectRequest;
          tunnelCallback = callback; return tunneledRequest;
        },
        tlsConnect() { return secureSocket; },
        ...clock.timers,
  } as never);
  const pending = executeJsonHttpsRead({ endpointId: "endpoint", path: "/read" }, { ...endpoint, egressProxy: { baseUrl: "http://proxy.internal", bearerRef: "env:PROXY" } }, { async resolve() { return "opaque"; } }, { timeoutMs: 100, monotonicNow: () => 0 }).finally(restore);
  const refused = assert.rejects(pending, /deadline/i);
  await waitFor(() => connectRequest.listenerCount("connect") > 0);
  connectRequest.emit("connect", { statusCode: 200 }, rawSocket, Buffer.alloc(0));
  secureSocket.emit("secureConnect");
  await waitFor(() => tunnelCallback !== undefined);
  assert.ok(tunnelCallback);
  clock.fireNext();
  await refused;
  assert.equal(connectRequest.destroyed, true);
  assert.equal(rawSocket.destroyed, true);
  assert.equal(secureSocket.destroyed, true);
  assert.equal(tunneledRequest.destroyed, true);
  const late = new FakeResponse(200); tunnelCallback(late); late.emit("end");
  assert.equal(tunneledRequest.destroyed, true);
});
