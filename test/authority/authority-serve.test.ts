import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseAuthorityServeMode } from "../../src/authority/cli.js";
import { parseArgv } from "../../src/cli.js";

test("authority serve defaults to stdio and accepts an explicit authenticated HTTP bind", () => {
  assert.deepEqual(parseAuthorityServeMode({}), { transport: "stdio" });
  assert.deepEqual(parseAuthorityServeMode({ transport: "http", host: "0.0.0.0", port: "8080" }), {
    transport: "http",
    host: "0.0.0.0",
    port: 8080,
  });
});

test("authority serve refuses ambiguous transports, ports, and bind hosts", () => {
  assert.throws(() => parseAuthorityServeMode({ transport: "sse" }), /transport/);
  assert.throws(() => parseAuthorityServeMode({ transport: "http", port: "0" }), /port/);
  assert.throws(() => parseAuthorityServeMode({ transport: "http", port: "8080x" }), /port/);
  assert.throws(() => parseAuthorityServeMode({ transport: "http", host: "0.0.0.0\nattacker" }), /host/);
  assert.throws(() => parseAuthorityServeMode({ transport: "stdio", port: "8080" }), /stdio/);
});

test("the Fly Authority Cell starts the authenticated HTTP transport with durable state", async () => {
  const manifest = await readFile(path.resolve("infra/fly/authority-cell/authority-cell.toml"), "utf8");
  assert.match(manifest, /authority serve --transport http --host 0\.0\.0\.0 --port 8080/);
  assert.match(manifest, /destination = "\/data"/);
  assert.doesNotMatch(manifest, /(?:TOKEN|PASSWORD|SECRET)\s*=\s*"[^\"]+"/i);
});

test("the root CLI preserves authority HTTP and certification options as values", () => {
  const parsed = parseArgv(["serve", "--transport", "http", "--host", "0.0.0.0", "--port", "8080", "--certification-config", "/data/authority/certification.local.json"]);
  assert.deepEqual(parsed.positional, ["serve"]);
  assert.equal(parsed.opts.transport, "http");
  assert.equal(parsed.opts.host, "0.0.0.0");
  assert.equal(parsed.opts.port, "8080");
  assert.equal(parsed.opts["certification-config"], "/data/authority/certification.local.json");
});
