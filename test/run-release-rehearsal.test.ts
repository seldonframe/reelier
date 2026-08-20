import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";

const script = path.resolve("scripts/run-release-rehearsal.mjs");
const token = "rat_rehearsal_test_secret";
const authorization = "release-authorization-rehearsal-01";
const refs = ["1", "2", "3", "4"].map(value => `jobref_${value.repeat(64)}`);

async function run(args: readonly string[], env: Readonly<Record<string, string>> = {}) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: path.resolve("."),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
  const status = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => resolve(code));
  });
  return { status, stdout, stderr };
}

test("rehearsal driver loads four opaque jobs and invokes each governed transition in catalog order", async () => {
  const observed: Array<Readonly<{ path: string; body: unknown }>> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    observed.push({ path: request.url ?? "", body });
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/v1/jobs") {
      response.end(JSON.stringify({ requestId: "", verdict: "accepted", reasonCode: "jobs-found", lifecycleState: "catalog", jobs: refs.map(jobRef => ({ jobRef })) }));
      return;
    }
    const load = /^\/v1\/jobs\/(jobref_[0-9a-f]{64})\/load$/.exec(request.url ?? "");
    if (request.method === "POST" && load) {
      response.end(JSON.stringify({ requestId: "", verdict: "accepted", reasonCode: "job-loaded", lifecycleState: "loaded", jobRef: load[1] }));
      return;
    }
    const invoke = /^\/v1\/jobs\/(jobref_[0-9a-f]{64})\/invoke$/.exec(request.url ?? "");
    if (request.method === "POST" && invoke) {
      const index = refs.indexOf(invoke[1]!);
      response.statusCode = 202;
      response.end(JSON.stringify({ requestId: `rehearsal_01_${index + 1}`, verdict: "accepted", reasonCode: "accepted", lifecycleState: "acknowledged", receiptRef: `receipt_${index + 1}` }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ verdict: "refused", reasonCode: "not-found" }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const result = await run([
      "--cell-url", `http://127.0.0.1:${address.port}`,
      "--token-ref", "env:REELIER_REHEARSAL_TOKEN",
      "--authorization-handle", authorization,
      "--request-prefix", "rehearsal_01",
    ], { REELIER_REHEARSAL_TOKEN: token });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout.includes(token), false);
    assert.equal(result.stderr.includes(token), false);
    const summary = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!) as Record<string, unknown>;
    assert.equal(summary.v, "reelier.release-rehearsal-run/v1");
    assert.equal(summary.status, "verified");
    assert.deepEqual(summary.receiptRefs, ["receipt_1", "receipt_2", "receipt_3", "receipt_4"]);
    assert.deepEqual(observed.map(item => item.path), [
      "/v1/jobs",
      ...refs.map(ref => `/v1/jobs/${ref}/load`),
      ...refs.map(ref => `/v1/jobs/${ref}/invoke`),
    ]);
    assert.deepEqual(observed.slice(5).map(item => item.body), refs.map((_, index) => ({
      requestId: `rehearsal_01_${index + 1}`,
      sourceRefs: { authorization },
      choices: {},
    })));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("duplicate-step resends identical semantics once and requires the same terminal receipt", async () => {
  const invokeCounts = new Map<string, number>();
  const invokeTimes: number[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/v1/jobs") {
      response.end(JSON.stringify({ requestId: "", verdict: "accepted", reasonCode: "jobs-found", lifecycleState: "catalog", jobs: refs.map(jobRef => ({ jobRef })) }));
      return;
    }
    const load = /^\/v1\/jobs\/(jobref_[0-9a-f]{64})\/load$/.exec(request.url ?? "");
    if (request.method === "POST" && load) {
      response.end(JSON.stringify({ requestId: "", verdict: "accepted", reasonCode: "job-loaded", lifecycleState: "loaded", jobRef: load[1] }));
      return;
    }
    const invoke = /^\/v1\/jobs\/(jobref_[0-9a-f]{64})\/invoke$/.exec(request.url ?? "");
    if (request.method === "POST" && invoke) {
      const index = refs.indexOf(invoke[1]!);
      invokeTimes[index] = Date.now();
      const requestId = `rehearsal_duplicate_${index + 1}`;
      assert.deepEqual(body, { requestId, sourceRefs: { authorization }, choices: {} });
      invokeCounts.set(requestId, (invokeCounts.get(requestId) ?? 0) + 1);
      response.statusCode = 202;
      response.end(JSON.stringify({ requestId, verdict: "accepted", reasonCode: "accepted", lifecycleState: "acknowledged", receiptRef: `receipt_${index + 1}` }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ verdict: "refused", reasonCode: "not-found" }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const result = await run([
      "--cell-url", `http://127.0.0.1:${address.port}`,
      "--token-ref", "env:REELIER_REHEARSAL_TOKEN",
      "--authorization-handle", authorization,
      "--request-prefix", "rehearsal_duplicate",
      "--duplicate-step", "2",
      "--ci-wait-seconds", "1",
    ], { REELIER_REHEARSAL_TOKEN: token });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.deepEqual(Object.fromEntries(invokeCounts), {
      rehearsal_duplicate_1: 1,
      rehearsal_duplicate_2: 2,
      rehearsal_duplicate_3: 1,
      rehearsal_duplicate_4: 1,
    });
    const summary = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!) as Record<string, unknown>;
    assert.equal(summary.duplicateStep, 2);
    assert.deepEqual(summary.receiptRefs, ["receipt_1", "receipt_2", "receipt_3", "receipt_4"]);
    assert.ok(invokeTimes[2]! - invokeTimes[1]! >= 900, `merge began only ${invokeTimes[2]! - invokeTimes[1]!}ms after PR creation`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("a refused transition stops before later jobs and never prints the bearer", async () => {
  const invoked: string[] = [];
  const server = createServer(async (request, response) => {
    for await (const _ of request) { /* drain */ }
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/v1/jobs") {
      response.end(JSON.stringify({ requestId: "", verdict: "accepted", reasonCode: "jobs-found", lifecycleState: "catalog", jobs: refs.map(jobRef => ({ jobRef })) }));
      return;
    }
    const load = /^\/v1\/jobs\/(jobref_[0-9a-f]{64})\/load$/.exec(request.url ?? "");
    if (request.method === "POST" && load) {
      response.end(JSON.stringify({ requestId: "", verdict: "accepted", reasonCode: "job-loaded", lifecycleState: "loaded", jobRef: load[1] }));
      return;
    }
    const invoke = /^\/v1\/jobs\/(jobref_[0-9a-f]{64})\/invoke$/.exec(request.url ?? "");
    if (request.method === "POST" && invoke) {
      const index = refs.indexOf(invoke[1]!);
      invoked.push(invoke[1]!);
      response.statusCode = 202;
      response.end(JSON.stringify(index === 1
        ? { requestId: "rehearsal_refusal_2", verdict: "refused", reasonCode: "dispatch-unavailable", lifecycleState: "unavailable" }
        : { requestId: `rehearsal_refusal_${index + 1}`, verdict: "accepted", reasonCode: "accepted", lifecycleState: "acknowledged", receiptRef: `receipt_${index + 1}` }));
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const result = await run([
      "--cell-url", `http://127.0.0.1:${address.port}`,
      "--token-ref", "env:REELIER_REHEARSAL_TOKEN",
      "--authorization-handle", authorization,
      "--request-prefix", "rehearsal_refusal",
    ], { REELIER_REHEARSAL_TOKEN: token });
    assert.equal(result.status, 1);
    assert.deepEqual(invoked, refs.slice(0, 2));
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.includes(token), false);
    assert.match(result.stderr, /Outcome rehearsal_refusal_2 refused: dispatch-unavailable \(unavailable\)/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
