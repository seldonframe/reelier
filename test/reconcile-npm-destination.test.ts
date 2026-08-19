import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

const scriptPath = path.resolve("scripts/reconcile-npm-destination.mjs");
const tarballBytes = Buffer.from("reconcile-fixture-tarball");
const integrity = `sha512-${createHash("sha512").update(tarballBytes).digest("base64")}`;

async function withRegistry(handler: (status: number, body: unknown) => { status: number; body: unknown }, respond: { status: number; body: unknown }, run: (origin: string, tarballPath: string, outputPath: string) => Promise<void>): Promise<void> {
  void handler;
  const dir = mkdtempSync(path.join(os.tmpdir(), "reelier-reconcile-"));
  const tarballPath = path.join(dir, "reelier-0.32.1.tgz");
  const outputPath = path.join(dir, "github-output.txt");
  writeFileSync(tarballPath, tarballBytes);
  writeFileSync(outputPath, "");
  const server = createServer((_request, response) => { response.statusCode = respond.status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(respond.body ?? {})); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  try { await run(`http://127.0.0.1:${port}`, tarballPath, outputPath); }
  finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
}

// Async spawn, not spawnSync: the registry server above lives in this same
// process. spawnSync blocks this process's entire event loop until the
// child exits, so the in-process HTTP server could never accept or respond
// to the child's request — the child's fetch() would then hang forever,
// and so would spawnSync waiting on it. Reproduced directly (same-process
// server + spawnSync deadlocks; separate-process server + spawnSync
// resolves instantly), independent of platform. Async spawn keeps this
// process's event loop free to service the server while awaiting the exit.
function invoke(origin: string, tarballPath: string, outputPath: string, extra: string[] = []): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [scriptPath, "--package", "reelier", "--version", "0.32.1", "--tarball", tarballPath, "--registry", origin, ...extra], { env: { ...process.env, GITHUB_OUTPUT: outputPath } });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("close", status => resolve({ status, stdout, stderr }));
  });
}

test("absent version reconciles to state=absent (exit 0)", async () => {
  await withRegistry(() => ({ status: 404, body: {} }), { status: 404, body: {} }, async (origin, tarball, output) => {
    const result = await invoke(origin, tarball, output);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(output, "utf8"), /state=absent/);
  });
});

test("matching published integrity reconciles to state=reconciled (exit 0)", async () => {
  await withRegistry(() => ({ status: 200, body: {} }), { status: 200, body: { versions: { "0.32.1": { dist: { integrity } } } } }, async (origin, tarball, output) => {
    const result = await invoke(origin, tarball, output);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(output, "utf8"), /state=reconciled/);
  });
});

test("conflicting integrity is terminal (exit 1) and never resent", async () => {
  await withRegistry(() => ({ status: 200, body: {} }), { status: 200, body: { versions: { "0.32.1": { dist: { integrity: "sha512-QUFB" } } } } }, async (origin, tarball, output) => {
    const result = await invoke(origin, tarball, output);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /conflicts with the local tarball/);
  });
});

test("uncertain registry state is pending (exit 2), never resent", async () => {
  await withRegistry(() => ({ status: 500, body: {} }), { status: 500, body: {} }, async (origin, tarball, output) => {
    const result = await invoke(origin, tarball, output);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /uncertain — pending, never resent/);
  });
});

test("--expect reconciled fails when the destination stayed absent", async () => {
  await withRegistry(() => ({ status: 404, body: {} }), { status: 404, body: {} }, async (origin, tarball, output) => {
    const result = await invoke(origin, tarball, output, ["--expect", "reconciled"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /destination state is absent, expected reconciled/);
  });
});
