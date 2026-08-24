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

// `responder` is called once per HTTP request the script makes and decides
// that request's response; requestIndex is 1-based. Most tests only need a
// fixed response regardless of request count, but the poll test below
// needs the registry to answer differently across a script-internal retry
// loop, so every test goes through the same per-request hook.
async function withRegistry(responder: (requestIndex: number) => { status: number; body: unknown }, run: (origin: string, tarballPath: string, outputPath: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), "reelier-reconcile-"));
  const tarballPath = path.join(dir, "reelier-0.33.0-beta.0.tgz");
  const outputPath = path.join(dir, "github-output.txt");
  writeFileSync(tarballPath, tarballBytes);
  writeFileSync(outputPath, "");
  let requestCount = 0;
  const server = createServer((_request, response) => {
    requestCount += 1;
    const { status, body } = responder(requestCount);
    response.statusCode = status;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(body ?? {}));
  });
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
//
// RECONCILE_POLL_BACKOFFS_MS overrides the script's post-publish poll
// backoff (production default ~5s/~10s) down to a few milliseconds so the
// poll-behavior tests below don't spend real wall-clock time sleeping.
function invoke(origin: string, tarballPath: string, outputPath: string, extra: string[] = []): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [scriptPath, "--package", "reelier", "--version", "0.33.0-beta.0", "--tarball", tarballPath, "--registry", origin, ...extra], { env: { ...process.env, GITHUB_OUTPUT: outputPath, RECONCILE_POLL_BACKOFFS_MS: "5,5" } });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("close", status => resolve({ status, stdout, stderr }));
  });
}

test("absent version reconciles to state=absent (exit 0)", async () => {
  await withRegistry(() => ({ status: 404, body: {} }), async (origin, tarball, output) => {
    const result = await invoke(origin, tarball, output);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(output, "utf8"), /state=absent/);
  });
});

test("matching published integrity reconciles to state=reconciled (exit 0)", async () => {
  await withRegistry(() => ({ status: 200, body: { versions: { "0.33.0-beta.0": { dist: { integrity } } } } }), async (origin, tarball, output) => {
    const result = await invoke(origin, tarball, output);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(output, "utf8"), /state=reconciled/);
  });
});

test("conflicting integrity is terminal (exit 1) and never resent", async () => {
  await withRegistry(() => ({ status: 200, body: { versions: { "0.33.0-beta.0": { dist: { integrity: "sha512-QUFB" } } } } }), async (origin, tarball, output) => {
    const result = await invoke(origin, tarball, output);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /conflicts with the local tarball/);
  });
});

test("uncertain registry state is pending (exit 2), never resent", async () => {
  await withRegistry(() => ({ status: 500, body: {} }), async (origin, tarball, output) => {
    const result = await invoke(origin, tarball, output);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /uncertain — pending, never resent/);
  });
});

test("--expect reconciled fails when the destination stayed absent", async () => {
  await withRegistry(() => ({ status: 404, body: {} }), async (origin, tarball, output) => {
    const result = await invoke(origin, tarball, output, ["--expect", "reconciled"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /destination state is absent, expected reconciled/);
  });
});

// B3 review, Important #2(a): a 200 response whose parsed body has no
// "versions" object is not the same thing as "package exists but this
// version doesn't" — it's a shape the real npm registry never sends for a
// package that exists, so treat it as anomalous/uncertain rather than
// silently reading it as "absent" (which used to make it publish-permitted).
test("200 packument without a versions object is anomalous (exit 2, uncertain)", async () => {
  await withRegistry(() => ({ status: 200, body: { name: "reelier" } }), async (origin, tarball, output) => {
    const result = await invoke(origin, tarball, output);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /anomalous/);
    assert.match(result.stderr, /uncertain — pending, never resent/);
  });
});

// B3 review, Important #2(b): the post-publish --expect reconciled path
// must poll the version-specific endpoint (not just the full packument)
// before declaring pending, because the registry can briefly lag behind a
// successful publish. First request still reports the version absent
// (registry hasn't caught up yet); second request reports it published
// with matching integrity. The script must retry rather than declaring
// "pending" (exit 2) off the first, stale answer.
test("--expect reconciled polls the version endpoint and reconciles on the second attempt", async () => {
  const requests: number[] = [];
  await withRegistry(requestIndex => {
    requests.push(requestIndex);
    return requestIndex === 1 ? { status: 404, body: {} } : { status: 200, body: { dist: { integrity } } };
  }, async (origin, tarball, output) => {
    const result = await invoke(origin, tarball, output, ["--expect", "reconciled"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(output, "utf8"), /state=reconciled/);
  });
  assert.deepEqual(requests, [1, 2], "expected exactly one retry: a stale absent answer, then a reconciled one, then no further polling");
});
