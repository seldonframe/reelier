import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAuthorityCommand } from "../../src/authority/cli.js";
import { defaultAuthorityCellConnectionFile, parseAuthorityCellConnectionV1, writeAuthorityCellConnection } from "../../src/authority/client/config.js";
import { checkAuthorityCellLive } from "../../src/authority/client/http.js";

const digest = "sha256:7f46242b26d9c921f4e1ec9de6418ac5fc8c03d70c4415c25e799ae0e73a1512";

test("authority connect writes only a normalized opaque client connection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-authority-cell-client-"));
  const file = path.join(root, "authority-cell-connection.json");
  const output: string[] = [];
  const original = console.log;
  console.log = (...values: unknown[]) => output.push(values.join(" "));
  try {
    const runClientCommand = runAuthorityCommand as unknown as (command: Parameters<typeof runAuthorityCommand>[0], runtime: Readonly<{ platform: NodeJS.Platform; env: NodeJS.ProcessEnv; homedir: string }>) => Promise<number>;
    const exitCode = await runClientCommand({ positional: ["connect"], flags: new Set(), opts: {
      endpoint: "https://CELL.EXAMPLE:443/api/",
      "token-ref": "env:REELIER_CELL_TOKEN",
      "cell-id": "cell_linux_1",
      "adapter-contract-digest": digest,
      path: file,
    } }, { platform: "linux", env: {}, homedir: root });

    assert.equal(exitCode, 0);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
      v: "reelier.authority-cell-connection/v1",
      endpoint: "https://cell.example/api",
      transport: "http",
      bearerTokenRef: "env:REELIER_CELL_TOKEN",
      expectedCellId: "cell_linux_1",
      adapterContractDigest: digest,
    });
    const status = JSON.parse(output.join("\n")) as Record<string, unknown>;
    assert.equal(status.pathnameConfinement, "unchecked");
    assert.equal(output.join("\n").includes("REELIER_CELL_TOKEN"), false);
  } finally {
    console.log = original;
    await rm(root, { recursive: true, force: true });
  }
});

test("native Windows derives the default connection path from per-user local application data", () => {
  const localAppData = "C:\\Users\\operator\\AppData\\Local";
  const resolveDefault = defaultAuthorityCellConnectionFile as unknown as (runtime: Readonly<{ platform: NodeJS.Platform; env: NodeJS.ProcessEnv; homedir: string }>) => string;
  assert.equal(
    resolveDefault({ platform: "win32", env: { LOCALAPPDATA: localAppData }, homedir: "C:\\Users\\operator" }),
    path.win32.join(localAppData, "Reelier", "authority-cell-connection.json"),
  );
});

test("native Windows refuses custom connection output and reports no stronger pathname confinement", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-windows-cell-client-"));
  const custom = path.join(root, "workspace", "connection.json");
  const stdout: string[] = [];
  const stderr: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...values: unknown[]) => stdout.push(values.join(" "));
  console.error = (...values: unknown[]) => stderr.push(values.join(" "));
  try {
    const runClientCommand = runAuthorityCommand as unknown as (command: Parameters<typeof runAuthorityCommand>[0], runtime: Readonly<{ platform: NodeJS.Platform; env: NodeJS.ProcessEnv; homedir: string }>) => Promise<number>;
    const exitCode = await runClientCommand({ positional: ["connect"], flags: new Set(), opts: {
      endpoint: "https://cell.example",
      "token-ref": "env:REELIER_CELL_TOKEN",
      "cell-id": "cell_linux_1",
      "adapter-contract-digest": digest,
      path: custom,
    } }, { platform: "win32", env: { LOCALAPPDATA: root }, homedir: root });

    assert.equal(exitCode, 1);
    assert.equal(stdout.length, 0);
    const status = JSON.parse(stderr.join("\n")) as Record<string, unknown>;
    assert.equal(status.status, "refused");
    assert.equal(status.pathnameConfinement, "unchecked");
    await assert.rejects(() => access(custom));
  } finally {
    console.log = originalLog;
    console.error = originalError;
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
  const failed = await checkAuthorityCellLive(connection, { resolveToken: async () => { throw new Error(secret); }, resolveAddresses: async () => ["8.8.8.8"] });
  assert.deepEqual(failed, { state: "absent", reasonCode: "token-unavailable" });
  let redirect = "";
  const result = await checkAuthorityCellLive(connection, { resolveToken: async () => secret, resolveAddresses: async () => ["8.8.8.8"], request: async (_url, init) => { redirect = String(init.redirect); return new Response(JSON.stringify({ v: "reelier.authority-cell-identity/v1", cellId: "cell_1", adapterContractDigest: digest }), { status: 200 }); } });
  assert.equal(result.state, "verified");
  assert.equal(redirect, "error");
});

test("doctor treats an unavailable token reference as absent without exposing it", async () => {
  const connection = { v: "reelier.authority-cell-connection/v1", endpoint: "https://cell.example", transport: "http", bearerTokenRef: "env:CELL_TOKEN", expectedCellId: "cell_1", adapterContractDigest: digest } as const;
  const result = await checkAuthorityCellLive(connection, { resolveToken: async () => { throw new Error("secret-must-not-leak"); }, resolveAddresses: async () => ["8.8.8.8"] });
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
    const result = await checkAuthorityCellLive(connection, { credentialRoot: root, resolveAddresses: async () => ["8.8.8.8"] });
    assert.deepEqual(result, { state: "absent", reasonCode: "token-unavailable" });
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test("doctor refuses private and mixed DNS answers before token resolution or request dispatch", async () => {
  const connection = { v: "reelier.authority-cell-connection/v1", endpoint: "https://cell.example", transport: "http", bearerTokenRef: "env:CELL_TOKEN", expectedCellId: "cell_1", adapterContractDigest: digest } as const;
  for (const addresses of [["10.0.0.1"], ["8.8.8.8", "10.0.0.1"]]) {
    let tokenResolverCalls = 0;
    let requestCalls = 0;
    const result = await checkAuthorityCellLive(connection, { resolveToken: async () => { tokenResolverCalls += 1; return "opaque"; }, resolveAddresses: async () => addresses, request: async () => { requestCalls += 1; throw new Error("must not dispatch"); } });
    assert.deepEqual(result, { state: "failed", reasonCode: "endpoint-address-refused" }, addresses.join(","));
    assert.equal(tokenResolverCalls, 0, addresses.join(","));
    assert.equal(requestCalls, 0, addresses.join(","));
  }
});

test("doctor decodes every mapped IPv6 private form before token resolution or request dispatch", async () => {
  const connection = { v: "reelier.authority-cell-connection/v1", endpoint: "https://cell.example", transport: "http", bearerTokenRef: "env:CELL_TOKEN", expectedCellId: "cell_1", adapterContractDigest: digest } as const;
  for (const address of ["::ffff:127.0.0.1", "0:0:0:0:0:ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1", "::ffff:10.0.0.1", "::ffff:a9fe:0101", "::ffff:0:0", "::ffff:e000:1"]) {
    let tokenResolverCalls = 0;
    let requestCalls = 0;
    const result = await checkAuthorityCellLive(connection, { resolveToken: async () => { tokenResolverCalls += 1; return "opaque"; }, resolveAddresses: async () => [address], request: async () => { requestCalls += 1; throw new Error("must not dispatch"); } });
    assert.deepEqual(result, { state: "failed", reasonCode: "endpoint-address-refused" }, address);
    assert.equal(tokenResolverCalls, 0, address);
    assert.equal(requestCalls, 0, address);
  }
});

test("doctor refuses unsafe literal endpoints before token resolution or request dispatch", async () => {
  for (const endpoint of ["https://127.0.0.1", "https://10.0.0.1", "https://169.254.1.1", "https://0.0.0.0", "https://224.0.0.1", "https://[::1]", "https://[fe80::1]", "https://[fc00::1]", "https://[ff00::1]", "https://[0:0:0:0:0:ffff:127.0.0.1]"]) {
    let tokenResolverCalls = 0;
    let requestCalls = 0;
    const result = await checkAuthorityCellLive({ v: "reelier.authority-cell-connection/v1", endpoint, transport: "http", bearerTokenRef: "env:CELL_TOKEN", expectedCellId: "cell_1", adapterContractDigest: digest }, { resolveToken: async () => { tokenResolverCalls += 1; return "opaque"; }, request: async () => { requestCalls += 1; throw new Error("must not dispatch"); } });
    assert.deepEqual(result, { state: "failed", reasonCode: "connection-invalid" }, endpoint);
    assert.equal(tokenResolverCalls, 0, endpoint);
    assert.equal(requestCalls, 0, endpoint);
  }
});

test("doctor applies the IPv4 deny policy to a bracketed expanded dotted mapped literal", async () => {
  const connection = { v: "reelier.authority-cell-connection/v1", endpoint: "https://[0:0:0:0:0:ffff:127.0.0.1]", transport: "http", bearerTokenRef: "env:CELL_TOKEN", expectedCellId: "cell_1", adapterContractDigest: digest } as const;
  let resolvedToken = false;
  let dispatched = false;
  const result = await checkAuthorityCellLive(connection, { resolveToken: async () => { resolvedToken = true; return "opaque"; }, request: async () => { dispatched = true; throw new Error("must not dispatch"); } });
  assert.deepEqual(result, { state: "failed", reasonCode: "connection-invalid" });
  assert.equal(resolvedToken, false);
  assert.equal(dispatched, false);
});

test("connection writer refuses a symlinked parent before an outside write", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-cell-config-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "reelier-cell-config-outside-"));
  try {
    await symlink(outside, path.join(root, "linked"), "junction");
    const target = path.join(root, "linked", "connection.json");
    await assert.rejects(() => writeAuthorityCellConnection(target, { v: "reelier.authority-cell-connection/v1", endpoint: "https://cell.example", transport: "http", bearerTokenRef: "env:CELL_TOKEN", expectedCellId: "cell_1", adapterContractDigest: digest }), /unsafe|symlink|connection/i);
    await assert.rejects(() => access(path.join(outside, "connection.json")));
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});
