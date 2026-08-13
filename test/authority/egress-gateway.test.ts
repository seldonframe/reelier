import test from "node:test";
import assert from "node:assert/strict";
import { connect as netConnect } from "node:net";
import { PassThrough } from "node:stream";
import { createAuthorityEgressGateway, parseAuthorityEgressGatewayConfig } from "../../src/authority/host/egress-gateway.js";
import { assertAllPublicAddresses } from "../../src/authority/client/ip.js";

const config = {
  v: "reelier.egress-gateway-config/v1",
  bearerRef: "env:REELIER_EGRESS_GATEWAY_BEARER",
  allowedHosts: ["api.github.com", "api.vercel.com"],
} as const;

test("egress gateway configuration is closed and contains references, never values", () => {
  const parsed = parseAuthorityEgressGatewayConfig(config);
  assert.deepEqual(parsed.allowedHosts, ["api.github.com", "api.vercel.com"]);
  assert.throws(() => parseAuthorityEgressGatewayConfig({ ...config, bearer: "plaintext" }), /closed/);
  assert.throws(() => parseAuthorityEgressGatewayConfig({ ...config, allowedHosts: ["127.0.0.1"] }), /host/);
});

test("egress gateway shares the authority public-address classifier", () => {
  assert.throws(() => assertAllPublicAddresses(["93.184.216.34", "::ffff:127.0.0.1"]), /public/i);
});

test("egress gateway refuses missing auth and undeclared destinations before dialing", async () => {
  let dials = 0;
  const gateway = createAuthorityEgressGateway({
    config,
    secrets: { async resolve() { return "gateway-private"; } },
    async resolve() { return [{ address: "93.184.216.34", family: 4 }]; },
    async dial() { dials += 1; return new PassThrough(); },
  });
  const address = await gateway.start(0, "127.0.0.1");
  const missing = await connectRequest(address.port, "api.github.com:443", undefined);
  assert.match(missing, /^HTTP\/1\.1 407/);
  const denied = await connectRequest(address.port, "evil.example:443", "gateway-private");
  assert.match(denied, /^HTTP\/1\.1 403/);
  assert.equal(dials, 0);
  await gateway.close();
});

test("egress gateway pins a public DNS answer and opens only an authenticated declared tunnel", async () => {
  const dialed: Array<{ address: string; port: number }> = [];
  const gateway = createAuthorityEgressGateway({
    config,
    secrets: { async resolve() { return "gateway-private"; } },
    async resolve(host) { assert.equal(host, "api.github.com"); return [{ address: "93.184.216.34", family: 4 }]; },
    async dial(input) { dialed.push(input); return new PassThrough(); },
  });
  const address = await gateway.start(0, "127.0.0.1");
  const response = await connectRequest(address.port, "api.github.com:443", "gateway-private");
  assert.match(response, /^HTTP\/1\.1 200 Connection Established/);
  assert.deepEqual(dialed, [{ address: "93.184.216.34", port: 443 }]);
  assert.equal(response.includes("gateway-private"), false);
  await gateway.close();
});

test("egress gateway refuses any private or mixed DNS result", async () => {
  let dials = 0;
  const gateway = createAuthorityEgressGateway({
    config,
    secrets: { async resolve() { return "gateway-private"; } },
    async resolve() { return [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]; },
    async dial() { dials += 1; return new PassThrough(); },
  });
  const address = await gateway.start(0, "127.0.0.1");
  const response = await connectRequest(address.port, "api.github.com:443", "gateway-private");
  assert.match(response, /^HTTP\/1\.1 502/);
  assert.equal(dials, 0);
  await gateway.close();
});

async function connectRequest(port: number, target: string, bearer: string | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host: "127.0.0.1", port });
    let output = "";
    socket.setTimeout(2_000);
    socket.once("connect", () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${bearer ? `Proxy-Authorization: Bearer ${bearer}\r\n` : ""}\r\n`));
    socket.on("data", chunk => { output += chunk.toString("utf8"); if (output.includes("\r\n\r\n")) { socket.destroy(); resolve(output); } });
    socket.once("timeout", () => { socket.destroy(); reject(new Error("gateway test timed out")); });
    socket.once("error", reject);
  });
}
