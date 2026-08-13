import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as jsonHttps from "../../src/authority/drivers/json-https.js";
import * as deadlineModule from "../../src/authority/net/deadline.js";
import { createPinnedLookup, executeJsonHttpsEffect } from "../../src/authority/drivers/json-https.js";
import { createTotalDeadline } from "../../src/authority/net/deadline.js";

const driverUrl = new URL("../../src/authority/drivers/json-https.js", import.meta.url).href;

const transportHarness = String.raw`
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mock } from "node:test";

class FakeRequest extends EventEmitter {
  destroyed = false;
  writes = [];
  destroyError;
  write(value) { this.writes.push(Buffer.from(value)); return true; }
  end() {}
  destroy(error) { this.destroyed = true; this.destroyError = error; if (error) queueMicrotask(() => this.emit("error", error)); return this; }
}
class FakeResponse extends EventEmitter {
  destroyed = false;
  constructor(statusCode, headers = {}) { super(); this.statusCode = statusCode; this.headers = headers; }
  destroy() { this.destroyed = true; return this; }
}
class FakeSocket extends EventEmitter {
  destroyed = false;
  connecting = false;
  destroyError;
  destroy(error) { this.destroyed = true; this.destroyError = error; return this; }
}

const state = { lookup: async () => [{ address: "8.8.8.8", family: 4 }], httpsRequest: undefined, httpRequest: undefined, tlsConnect: undefined };
mock.timers.enable({ apis: ["setTimeout"] });
mock.module("node:dns/promises", { namedExports: { lookup: (...args) => state.lookup(...args) } });
mock.module("node:https", { namedExports: { request: (...args) => state.httpsRequest(...args) } });
mock.module("node:http", { namedExports: { request: (...args) => state.httpRequest(...args) } });
mock.module("node:tls", { namedExports: { connect: (...args) => state.tlsConnect(...args) } });
const { executeJsonHttpsRead } = await import(process.env.REELIER_DRIVER_URL);
const endpoint = { endpointId: "endpoint", baseUrl: "https://localhost", allowedMethods: ["GET"], allowedPathPrefixes: ["/read"], accountIdentity: "account" };
let nowMs = 0;
const read = (configuredEndpoint = endpoint, secrets = { async resolve() { throw new Error("unexpected credential resolution"); } }, extra = {}) => executeJsonHttpsRead(
  { endpointId: "endpoint", path: "/read" }, configuredEndpoint, secrets, { timeoutMs: 100, monotonicNow: () => nowMs, ...extra },
);
const waitFor = async predicate => {
  for (let attempt = 0; attempt < 10 && !predicate(); attempt += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(predicate(), true, "expected native transport stage to start");
};
const advance = async milliseconds => { nowMs += milliseconds; mock.timers.tick(milliseconds); await Promise.resolve(); };

if (process.env.REELIER_SCENARIO === "hung-dns") {
  let requests = 0;
  state.lookup = async () => new Promise(() => {});
  state.httpsRequest = () => { requests += 1; throw new Error("request must not start"); };
  const pending = read();
  await advance(99);
  assert.equal(requests, 0);
  await advance(1);
  await assert.rejects(pending, /deadline/i);
  assert.equal(requests, 0);
} else if (process.env.REELIER_SCENARIO === "direct-deadline") {
  const request = new FakeRequest();
  let pinnedAddress = "";
  state.httpsRequest = options => {
    options.lookup("localhost", { all: false }, (error, address) => { assert.equal(error, null); pinnedAddress = address; });
    return request;
  };
  const pending = read();
  await waitFor(() => pinnedAddress.length > 0);
  await advance(99);
  assert.equal(request.destroyed, false, "the 100ms deadline must not fire at 99ms");
  await advance(1);
  await assert.rejects(pending, /deadline/i);
  assert.equal(pinnedAddress, "8.8.8.8");
  assert.equal(request.destroyed, true);
} else if (process.env.REELIER_SCENARIO === "cleared-timer") {
  const request = new FakeRequest();
  let respond;
  state.httpsRequest = (_options, callback) => { respond = callback; return request; };
  const pending = read();
  await waitFor(() => respond !== undefined);
  const response = new FakeResponse(200); respond(response); response.emit("end");
  assert.equal((await pending).status, 200);
  await advance(100);
  assert.equal(request.destroyed, false, "a cleared request timer must not fire after success");
} else if (process.env.REELIER_SCENARIO === "redirect") {
  const request = new FakeRequest(); let respond;
  state.httpsRequest = (_options, callback) => { respond = callback; return request; };
  const pending = read(); await waitFor(() => respond !== undefined);
  respond(new FakeResponse(302, { location: "https://other.example" }));
  await assert.rejects(pending, /redirect/i); assert.equal(request.destroyed, true);
} else if (process.env.REELIER_SCENARIO === "byte-cap") {
  const request = new FakeRequest(); let respond;
  state.httpsRequest = (_options, callback) => { respond = callback; return request; };
  const pending = read(endpoint, undefined, { maxResponseBytes: 3 }); await waitFor(() => respond !== undefined);
  const response = new FakeResponse(200); respond(response); response.emit("data", Buffer.from("four"));
  await assert.rejects(pending, /configured limit/i); assert.equal(request.destroyed, true);
} else if (process.env.REELIER_SCENARIO === "body-deadline") {
  const request = new FakeRequest(); let respond;
  state.httpsRequest = (_options, callback) => { respond = callback; return request; };
  const pending = read(); await waitFor(() => respond !== undefined);
  const response = new FakeResponse(200); respond(response); response.emit("data", Buffer.from("partial"));
  await advance(100); await assert.rejects(pending, /deadline/i); assert.equal(request.destroyed, true);
  response.emit("end"); assert.equal(request.destroyed, true);
} else {
  const stage = process.env.REELIER_SCENARIO;
  const connectRequest = new FakeRequest(); const rawSocket = new FakeSocket(); const secureSocket = new FakeSocket(); const tunneledRequest = new FakeRequest();
  let tunnelCallback;
  state.httpRequest = (options, callback) => { if (options.method === "CONNECT") return connectRequest; tunnelCallback = callback; return tunneledRequest; };
  state.tlsConnect = () => secureSocket;
  const proxyEndpoint = { ...endpoint, egressProxy: { baseUrl: "http://proxy.internal", bearerRef: "env:PROXY" } };
  const pending = read(proxyEndpoint, { async resolve() { return "opaque"; } });
  await waitFor(() => connectRequest.listenerCount("connect") > 0);
  if (stage !== "proxy-connect") connectRequest.emit("connect", { statusCode: 200 }, rawSocket, Buffer.alloc(0));
  if (stage === "proxy-late") { secureSocket.emit("secureConnect"); await waitFor(() => tunnelCallback !== undefined); }
  await advance(100); await assert.rejects(pending, /deadline/i);
  assert.equal(connectRequest.destroyed, true);
  assert.equal(rawSocket.destroyed, stage !== "proxy-connect");
  assert.equal(secureSocket.destroyed, stage !== "proxy-connect");
  if (stage === "proxy-late") {
    assert.equal(tunneledRequest.destroyed, true);
    const late = new FakeResponse(200); tunnelCallback(late);
    assert.equal(late.destroyed, true, "a response delivered after failure must be destroyed immediately");
    assert.equal(late.listenerCount("data") + late.listenerCount("end") + late.listenerCount("error"), 0, "a late response must never enter body parsing");
  }
}
`;

async function runTransportScenario(scenario: string): Promise<void> {
  const child = spawn(process.execPath, ["--experimental-test-module-mocks", "--input-type=module", "--eval", transportHarness], {
    env: { ...process.env, REELIER_DRIVER_URL: driverUrl, REELIER_SCENARIO: scenario },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = ""; let stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
  const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  assert.equal(code, 0, `scenario ${scenario} failed\nstdout:\n${stdout}\nstderr:\n${stderr}`);
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

test("production authority modules expose no transport or timer override", () => {
  assert.equal(Object.hasOwn(jsonHttps, "__testSetJsonHttpsTransport"), false);
  assert.equal(Object.hasOwn(deadlineModule, "__testSetTotalDeadlineTimers"), false);
});

test("native HTTPS rejects hung DNS only when the total deadline expires", () => runTransportScenario("hung-dns"));
test("native HTTPS pins the selected address and destroys the request exactly at expiry", () => runTransportScenario("direct-deadline"));
test("native HTTPS clears its transport timer after successful settlement", () => runTransportScenario("cleared-timer"));
test("native HTTPS refuses redirects and destroys the request", () => runTransportScenario("redirect"));
test("native HTTPS destroys and refuses a response that crosses the byte cap", () => runTransportScenario("byte-cap"));
test("native HTTPS destroys an active body stream at expiry and suppresses its late end", () => runTransportScenario("body-deadline"));
test("proxy transport destroys active CONNECT resources at expiry", () => runTransportScenario("proxy-connect"));
test("proxy transport destroys active TLS resources at expiry", () => runTransportScenario("proxy-tls"));
test("proxy transport contains a response delivered after terminal failure", () => runTransportScenario("proxy-late"));
