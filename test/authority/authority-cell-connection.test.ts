import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAuthorityCommand } from "../../src/authority/cli.js";
import { parseAuthorityCellConnectionV1 } from "../../src/authority/client/config.js";
import { checkAuthorityCellLive } from "../../src/authority/client/http.js";

const digest = "sha256:7f46242b26d9c921f4e1ec9de6418ac5fc8c03d70c4415c25e799ae0e73a1512";

test("authority connect writes only a normalized opaque client connection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-authority-cell-client-"));
  const file = path.join(root, "authority-cell-connection.json");
  const output: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => output.push(values.join(" "));
  try {
    const exitCode = await runAuthorityCommand({ positional: ["connect"], flags: new Set(), opts: {
      endpoint: "https://CELL.EXAMPLE:443/api/",
      "token-ref": "env:REELIER_CELL_TOKEN",
      "cell-id": "cell_linux_1",
      "adapter-contract-digest": digest,
      path: file,
    } });

    assert.equal(exitCode, 0);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
      v: "reelier.authority-cell-connection/v1",
      endpoint: "https://cell.example/api",
      transport: "http",
      bearerTokenRef: "env:REELIER_CELL_TOKEN",
      expectedCellId: "cell_linux_1",
      adapterContractDigest: digest,
    });
    assert.equal(output.join("\n").includes("REELIER_CELL_TOKEN"), false);
  } finally {
    console.log = original;
    await rm(root, { recursive: true, force: true });
  }
});

test("connection parser rejects unsafe URLs and never invokes accessors", () => {
  const value = Object.create(null, { v: { value: "reelier.authority-cell-connection/v1", enumerable: true }, endpoint: { get() { throw new Error("must not run"); }, enumerable: true }, transport: { value: "http", enumerable: true }, bearerTokenRef: { value: "env:CELL_TOKEN", enumerable: true }, expectedCellId: { value: "cell_1", enumerable: true }, adapterContractDigest: { value: digest, enumerable: true } });
  assert.throws(() => parseAuthorityCellConnectionV1(value), /closed/i);
  for (const endpoint of ["http://cell.example", "https://user:pass@cell.example", "https://cell.example/?x=1", "https://cell.example/#fragment", "http://localhost.evil"]) {
    assert.throws(() => parseAuthorityCellConnectionV1({ v: "reelier.authority-cell-connection/v1", endpoint, transport: "http", bearerTokenRef: "env:CELL_TOKEN", expectedCellId: "cell_1", adapterContractDigest: digest }), /endpoint/i);
  }
  for (const endpoint of ["https://127.0.0.1", "https://10.0.0.1", "https://169.254.1.1", "https://0.0.0.0", "https://224.0.0.1", "https://[::1]", "https://[fe80::1]", "https://[fc00::1]", "https://[ff00::1]"]) {
    assert.throws(() => parseAuthorityCellConnectionV1({ v: "reelier.authority-cell-connection/v1", endpoint, transport: "http", bearerTokenRef: "env:CELL_TOKEN", expectedCellId: "cell_1", adapterContractDigest: digest }), /endpoint/i);
  }
});

test("live cell check refuses redirect and redacts token resolver failures", async () => {
  const secret = "never-print-this-token";
  const connection = { v: "reelier.authority-cell-connection/v1", endpoint: "https://cell.example", transport: "http", bearerTokenRef: "env:CELL_TOKEN", expectedCellId: "cell_1", adapterContractDigest: digest } as const;
  const failed = await checkAuthorityCellLive(connection, { resolveToken: async () => { throw new Error(secret); } });
  assert.deepEqual(failed, { state: "absent", reasonCode: "token-unavailable" });
  let redirect = "";
  const result = await checkAuthorityCellLive(connection, { resolveToken: async () => secret, resolveAddresses: async () => ["8.8.8.8"], request: async (_url, init) => { redirect = String(init.redirect); return new Response(JSON.stringify({ v: "reelier.authority-cell-identity/v1", cellId: "cell_1", adapterContractDigest: digest }), { status: 200 }); } });
  assert.equal(result.state, "verified");
  assert.equal(redirect, "error");
});

test("doctor treats an unavailable token reference as absent without exposing it", async () => {
  const connection = { v: "reelier.authority-cell-connection/v1", endpoint: "https://cell.example", transport: "http", bearerTokenRef: "env:CELL_TOKEN", expectedCellId: "cell_1", adapterContractDigest: digest } as const;
  const result = await checkAuthorityCellLive(connection, { resolveToken: async () => { throw new Error("secret-must-not-leak"); } });
  assert.deepEqual(result, { state: "absent", reasonCode: "token-unavailable" });
});

test("doctor rejects stale Cell and adapter identities exactly", async () => {
  const connection = { v: "reelier.authority-cell-connection/v1", endpoint: "https://cell.example", transport: "http", bearerTokenRef: "env:CELL_TOKEN", expectedCellId: "cell_1", adapterContractDigest: digest } as const;
  const response = (cellId: string, adapterContractDigest: string) => new Response(JSON.stringify({ v: "reelier.authority-cell-identity/v1", cellId, adapterContractDigest }), { status: 200 });
  const staleCell = await checkAuthorityCellLive(connection, { resolveToken: async () => "opaque", resolveAddresses: async () => ["8.8.8.8"], request: async () => response("cell_old", digest) });
  assert.deepEqual(staleCell, { state: "failed", reasonCode: "cell-id-mismatch", cellId: "cell_old" });
  const staleContract = await checkAuthorityCellLive(connection, { resolveToken: async () => "opaque", resolveAddresses: async () => ["8.8.8.8"], request: async () => response("cell_1", `sha256:${"c".repeat(64)}`) });
  assert.deepEqual(staleContract, { state: "failed", reasonCode: "adapter-contract-mismatch", cellId: "cell_1", adapterContractDigest: `sha256:${"c".repeat(64)}` });
});

test("doctor refuses parent symlink token ancestry before reading the token", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-cell-token-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "reelier-cell-token-outside-"));
  try {
    await writeFile(path.join(outside, "token"), "opaque-token");
    await symlink(outside, path.join(root, "linked"), "junction");
    const connection = { v: "reelier.authority-cell-connection/v1", endpoint: "https://cell.example", transport: "http", bearerTokenRef: `file:${path.join(root, "linked", "token")}`, expectedCellId: "cell_1", adapterContractDigest: digest } as const;
    const result = await checkAuthorityCellLive(connection, { credentialRoot: root } as never);
    assert.deepEqual(result, { state: "absent", reasonCode: "token-unavailable" });
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test("doctor refuses private DNS answers before bearer dispatch", async () => {
  const connection = { v: "reelier.authority-cell-connection/v1", endpoint: "https://cell.example", transport: "http", bearerTokenRef: "env:CELL_TOKEN", expectedCellId: "cell_1", adapterContractDigest: digest } as const;
  let dispatched = false;
  const result = await checkAuthorityCellLive(connection, { resolveToken: async () => "opaque", resolveAddresses: async () => ["8.8.8.8", "10.0.0.1"], request: async () => { dispatched = true; throw new Error("must not dispatch"); } });
  assert.deepEqual(result, { state: "failed", reasonCode: "endpoint-address-refused" });
  assert.equal(dispatched, false);
});
