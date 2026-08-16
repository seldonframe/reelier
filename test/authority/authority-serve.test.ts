import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseAuthorityServeMode } from "../../src/authority/cli.js";
import { validateAuthorityHostConfig } from "../../src/authority/host/config.js";
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

test("the Fly Authority Cell bootstrap initializes through the image entrypoint without exposing HTTP", async () => {
  const manifest = await readFile(path.resolve("infra/fly/authority-cell/authority-cell-bootstrap.toml"), "utf8");
  assert.match(manifest, /app = "authority bootstrap --path \/data\/authority"/);
  assert.doesNotMatch(manifest, /\/bin\/sh|http_service|authority serve/);
  assert.match(manifest, /destination = "\/data"/);
});

test("authority bootstrap remains alive after initialization until it receives a shutdown signal", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-authority-bootstrap-"));
  const child = spawn(process.execPath, [path.resolve("dist-test/src/cli.js"), "authority", "bootstrap", "--path", root], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("authority bootstrap did not become ready")), 5_000);
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        if (!chunk.includes('"service":"authority-bootstrap"')) return;
        clearTimeout(timer);
        resolve();
      });
      child.once("error", reject);
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(child.exitCode, null);
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once("exit", resolve));
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("every Fly certification manifest resolves the repository Dockerfile from its own directory", async () => {
  for (const name of ["authority-cell-bootstrap", "authority-cell", "agent-runtime", "egress-gateway"]) {
    const manifest = await readFile(path.resolve(`infra/fly/authority-cell/${name}.toml`), "utf8");
    assert.match(manifest, /dockerfile = "\.\.\/\.\.\/\.\.\/Dockerfile"/, `${name} must not resolve a nonexistent adjacent Dockerfile`);
  }
});

test("every Fly certification file mount resolves from the repository deploy context", async () => {
  for (const name of ["authority-cell-bootstrap", "authority-cell", "agent-runtime", "egress-gateway"]) {
    const manifest = await readFile(path.resolve(`infra/fly/authority-cell/${name}.toml`), "utf8");
    const localPaths = [...manifest.matchAll(/local_path = "([^"]+)"/g)].map(match => match[1]);
    assert.ok(localPaths.length > 0, `${name} must mount its probe manifest`);
    for (const localPath of localPaths) await access(path.resolve(localPath));
  }
});

test("the root CLI preserves authority HTTP and certification options as values", () => {
  const parsed = parseArgv(["serve", "--transport", "http", "--host", "0.0.0.0", "--port", "8080", "--certification-config", "/data/authority/certification.local.json"]);
  assert.deepEqual(parsed.positional, ["serve"]);
  assert.equal(parsed.opts.transport, "http");
  assert.equal(parsed.opts.host, "0.0.0.0");
  assert.equal(parsed.opts.port, "8080");
  assert.equal(parsed.opts["certification-config"], "/data/authority/certification.local.json");
});

test("the root CLI treats certification config as a value option", () => {
  const parsed = parseArgv(["authority", "certify", "preflight", "--config", "authority/certification.local.json"]);
  assert.deepEqual(parsed.positional, ["authority", "certify", "preflight"]);
  assert.equal(parsed.opts.config, "authority/certification.local.json");
});

test("authority ingress accepts one durable principal registry and refuses mixed authentication", () => {
  const base = { version: 1 as const, tenant: "tenant_1", requester: "operator", definitions: [], ledgerDir: "ledger", decisionDir: "decisions", receiptDir: "receipts", endpoints: [] };
  const config = validateAuthorityHostConfig({ ...base, ingress: { principalRegistryFile: "principals.jsonl" } }, "C:/authority");
  assert.match(config.ingress?.principalRegistryFile ?? "", /principals\.jsonl$/);
  assert.throws(() => validateAuthorityHostConfig({ ...base, ingress: { principalRegistryFile: "principals.jsonl", bearerRef: "env:TOKEN" } }, "C:/authority"), /mutually exclusive/);
  assert.throws(() => validateAuthorityHostConfig({ ...base, ingress: { principalRegistryFile: "principals.jsonl", extra: true } }, "C:/authority"), /closed/);
});
