// E2E: the seatbelt enforced at the real proxy chokepoint (buildProxyServer),
// over a wrapped MCP fixture — same InMemoryTransport wiring as
// proxy-e2e.test.ts. Covers: a denied call is blocked (structured error to
// the agent, DENIED in the trace), a dry_run call returns a synthetic
// success (DRY-RUN marker in the trace, banner text in the response), and a
// malformed policy degrades to pass-through + a gap marker.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { connectDownstreamTransport } from "../src/mcp-client.js";
import { buildProxyServer, type TraceRecord } from "../src/recorder.js";
import { loadPolicyForWrap } from "../src/policy.js";

/** A fake downstream with tools that exercise every rule shape: a delete verb (deny by tool glob), a stripe-bound webhook call (deny by endpoint glob), a gmail send gated by --allow-writes, and a crm.* create call (dry_run). */
function buildFakeDownstream(): Server {
  const server = new Server({ name: "fake-downstream", version: "0.0.1" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: "gmail.delete_message", description: "Deletes a message.", inputSchema: { type: "object" as const, properties: {} } },
      { name: "http.post", description: "POST to a URL.", inputSchema: { type: "object" as const, properties: { url: { type: "string" } } } },
      { name: "gmail.send_email", description: "Sends an email.", inputSchema: { type: "object" as const, properties: {} } },
      { name: "crm.create_contact", description: "Creates a contact.", inputSchema: { type: "object" as const, properties: {} } },
      { name: "calendar.list_events", description: "Lists events.", inputSchema: { type: "object" as const, properties: {} } },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    return { content: [{ type: "text", text: `real-call:${name}` }] };
  });

  return server;
}

async function readTrace(filePath: string): Promise<TraceRecord[]> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as TraceRecord);
}

async function wireProxy(policyOptions: { policy?: import("../src/policy.js").Policy; policyGap?: string; allowWrites?: boolean }, traceDir: string) {
  const [downstreamClientSide, downstreamServerSide] = InMemoryTransport.createLinkedPair();
  const fakeDownstreamServer = buildFakeDownstream();
  await fakeDownstreamServer.connect(downstreamServerSide);
  const downstream = await connectDownstreamTransport(downstreamClientSide, "fake-downstream");

  const proxyServer = buildProxyServer([downstream], { traceDir, ...policyOptions });
  const [testClientSide, proxyServerSide] = InMemoryTransport.createLinkedPair();
  await proxyServer.connect(proxyServerSide);
  const testClient = new Client({ name: "reelier-test-client", version: "0.0.1" }, { capabilities: {} });
  await testClient.connect(testClientSide);

  return {
    testClient,
    async close() {
      await testClient.close();
      await downstream.close();
      await proxyServer.close();
      await fakeDownstreamServer.close();
    },
  };
}

test("policy e2e: a denied tool-glob call is blocked, never reaches downstream, and is DENIED in the trace", async () => {
  const traceDir = await mkdtemp(path.join(tmpdir(), "reelier-policy-e2e-"));
  try {
    const { testClient, close } = await wireProxy(
      { policy: { version: 1, deny: [{ tool: "*.delete_*" }], dryRun: [] } },
      traceDir
    );

    const startResult = await testClient.callTool({ name: "reelier_start_recording", arguments: { name: "demo" } });
    const tracePath = (startResult.content as Array<{ text: string }>)[0].text.replace("Recording started: ", "");

    const result = await testClient.callTool({ name: "gmail.delete_message", arguments: {} });
    assert.equal(result.isError, true);
    const text = (result.content as Array<{ text: string }>)[0].text;
    assert.match(text, /^blocked by reelier policy: tool:"\*\.delete_\*"$/);
    // Never dispatched downstream — a real call would have returned "real-call:gmail.delete_message".
    assert.doesNotMatch(text, /real-call/);

    await testClient.callTool({ name: "reelier_stop_recording", arguments: {} });
    await close();

    const records = await readTrace(tracePath);
    const resultRec = records.find((r) => r.t === "result");
    assert.ok(resultRec && resultRec.t === "result");
    if (resultRec && resultRec.t === "result") {
      assert.equal(resultRec.denied, true);
      assert.equal(resultRec.ok, false);
      assert.equal(resultRec.rule, 'tool:"*.delete_*"');
    }
  } finally {
    await rm(traceDir, { recursive: true, force: true });
  }
});

test("policy e2e: endpoint-glob deny blocks a call whose args carry a matching destination URL", async () => {
  const traceDir = await mkdtemp(path.join(tmpdir(), "reelier-policy-e2e-"));
  try {
    const { testClient, close } = await wireProxy(
      { policy: { version: 1, deny: [{ endpoint: "*.stripe.com" }], dryRun: [] } },
      traceDir
    );
    const result = await testClient.callTool({ name: "http.post", arguments: { url: "https://api.stripe.com/v1/charges" } });
    assert.equal(result.isError, true);
    assert.match((result.content as Array<{ text: string }>)[0].text, /endpoint:"\*\.stripe\.com"/);
    await close();
  } finally {
    await rm(traceDir, { recursive: true, force: true });
  }
});

test("policy e2e: unless --allow-writes escapes a deny rule when the flag is set, blocks otherwise", async () => {
  const traceDir = await mkdtemp(path.join(tmpdir(), "reelier-policy-e2e-"));
  const policy = { version: 1 as const, deny: [{ tool: "gmail.send_email", unless: "--allow-writes" }], dryRun: [] };
  try {
    // Without --allow-writes: blocked.
    {
      const { testClient, close } = await wireProxy({ policy, allowWrites: false }, traceDir);
      const result = await testClient.callTool({ name: "gmail.send_email", arguments: {} });
      assert.equal(result.isError, true);
      await close();
    }
    // With --allow-writes: passes through to the real downstream.
    {
      const { testClient, close } = await wireProxy({ policy, allowWrites: true }, traceDir);
      const result = await testClient.callTool({ name: "gmail.send_email", arguments: {} });
      assert.equal(result.isError, undefined);
      assert.equal((result.content as Array<{ text: string }>)[0].text, "real-call:gmail.send_email");
      await close();
    }
  } finally {
    await rm(traceDir, { recursive: true, force: true });
  }
});

test("policy e2e: dry_run rule returns a synthetic success marked DRY-RUN, never forwards the call, trace carries dryRun:true", async () => {
  const traceDir = await mkdtemp(path.join(tmpdir(), "reelier-policy-e2e-"));
  try {
    const { testClient, close } = await wireProxy(
      { policy: { version: 1, deny: [], dryRun: [{ tool: "crm.*" }] } },
      traceDir
    );

    const startResult = await testClient.callTool({ name: "reelier_start_recording", arguments: { name: "demo" } });
    const tracePath = (startResult.content as Array<{ text: string }>)[0].text.replace("Recording started: ", "");

    const result = await testClient.callTool({ name: "crm.create_contact", arguments: { name: "Ada" } });
    assert.equal(result.isError, undefined); // a synthetic SUCCESS, not an error
    const text = (result.content as Array<{ text: string }>)[0].text;
    assert.match(text, /^\[DRY-RUN\]/);
    assert.doesNotMatch(text, /real-call/); // never forwarded downstream

    await testClient.callTool({ name: "reelier_stop_recording", arguments: {} });
    await close();

    const records = await readTrace(tracePath);
    const resultRec = records.find((r) => r.t === "result");
    assert.ok(resultRec && resultRec.t === "result");
    if (resultRec && resultRec.t === "result") {
      assert.equal(resultRec.dryRun, true);
      assert.equal(resultRec.ok, true); // a dry-run "succeeds" — it just never happened
      assert.equal(resultRec.denied, undefined);
    }
  } finally {
    await rm(traceDir, { recursive: true, force: true });
  }
});

test("policy e2e: precedence — deny beats dry_run when a call matches both lists", async () => {
  const traceDir = await mkdtemp(path.join(tmpdir(), "reelier-policy-e2e-"));
  try {
    const { testClient, close } = await wireProxy(
      { policy: { version: 1, deny: [{ tool: "crm.delete_*" }], dryRun: [{ tool: "crm.*" }] } },
      traceDir
    );
    const result = await testClient.callTool({ name: "crm.create_contact", arguments: {} });
    // Doesn't match the deny rule (delete_* only) — falls through to dry_run.
    assert.match((result.content as Array<{ text: string }>)[0].text, /^\[DRY-RUN\]/);
    await close();
  } finally {
    await rm(traceDir, { recursive: true, force: true });
  }
});

test("policy e2e: a call matching neither list passes through untouched", async () => {
  const traceDir = await mkdtemp(path.join(tmpdir(), "reelier-policy-e2e-"));
  try {
    const { testClient, close } = await wireProxy(
      { policy: { version: 1, deny: [{ tool: "*.delete_*" }], dryRun: [{ tool: "crm.*" }] } },
      traceDir
    );
    const result = await testClient.callTool({ name: "calendar.list_events", arguments: {} });
    assert.equal(result.isError, undefined);
    assert.equal((result.content as Array<{ text: string }>)[0].text, "real-call:calendar.list_events");
    await close();
  } finally {
    await rm(traceDir, { recursive: true, force: true });
  }
});

test("policy e2e: malformed policy at wrap runtime degrades to pass-through + a gap marker in the trace meta, never bricks the call", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "reelier-policy-e2e-cwd-"));
  const home = await mkdtemp(path.join(tmpdir(), "reelier-policy-e2e-home-"));
  const traceDir = await mkdtemp(path.join(tmpdir(), "reelier-policy-e2e-trace-"));
  try {
    await mkdir(path.join(cwd, ".reelier"), { recursive: true });
    await writeFile(path.join(cwd, ".reelier", "policy.yml"), "  bad: indent\n", "utf8");

    const loaded = await loadPolicyForWrap(cwd, home);
    assert.equal(loaded.ok, false);

    const { testClient, close } = await wireProxy(
      { policy: loaded.policy, policyGap: !loaded.ok ? loaded.error : undefined },
      traceDir
    );

    const startResult = await testClient.callTool({ name: "reelier_start_recording", arguments: { name: "demo" } });
    const tracePath = (startResult.content as Array<{ text: string }>)[0].text.replace("Recording started: ", "");

    // A call that WOULD have been denied under a valid policy still passes through — fail-safe, never bricked.
    const result = await testClient.callTool({ name: "gmail.delete_message", arguments: {} });
    assert.equal(result.isError, undefined);
    assert.equal((result.content as Array<{ text: string }>)[0].text, "real-call:gmail.delete_message");

    await testClient.callTool({ name: "reelier_stop_recording", arguments: {} });
    await close();

    const records = await readTrace(tracePath);
    const meta = records.find((r) => r.t === "meta");
    assert.ok(meta && meta.t === "meta");
    if (meta && meta.t === "meta") {
      assert.ok(meta.policyGap && meta.policyGap.length > 0);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
    await rm(traceDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// N1 e2e: buildProxyServer itself prints the unmatched-tool-rule warning at
// wrap start (not just the pure findUnmatchedToolRules helper) — captured
// via console.error, same pattern test/push.test.ts uses.
// ---------------------------------------------------------------------------

async function withCapturedConsoleError<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = ((...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  }) as typeof console.error;
  try {
    const result = await run();
    return { result, lines };
  } finally {
    console.error = original;
  }
}

test("policy e2e (N1): a deny rule matching none of the wrapped tools warns at wrap start, naming the rule and available tools", async () => {
  const traceDir = await mkdtemp(path.join(tmpdir(), "reelier-policy-e2e-"));
  try {
    const { lines } = await withCapturedConsoleError(async () => {
      const { close } = await wireProxy({ policy: { version: 1, deny: [{ tool: "*.frobnicate_*" }], dryRun: [] } }, traceDir);
      await close();
    });
    const warning = lines.find((l) => l.includes("WARNING") && l.includes("*.frobnicate_*"));
    assert.ok(warning, `expected an unmatched-rule warning, got: ${JSON.stringify(lines)}`);
    assert.match(warning!, /deny rule tool:"\*\.frobnicate_\*"/);
    assert.match(warning!, /matches none of the currently-wrapped tools/);
    assert.match(warning!, /gmail\.delete_message/); // one of the fixture's real tool names, in the sample
  } finally {
    await rm(traceDir, { recursive: true, force: true });
  }
});

test("policy e2e (N1): a deny rule that DOES match a wrapped tool prints no unmatched-rule warning", async () => {
  const traceDir = await mkdtemp(path.join(tmpdir(), "reelier-policy-e2e-"));
  try {
    const { lines } = await withCapturedConsoleError(async () => {
      const { close } = await wireProxy({ policy: { version: 1, deny: [{ tool: "*.delete_*" }], dryRun: [] } }, traceDir);
      await close();
    });
    assert.ok(!lines.some((l) => l.includes("WARNING")), `expected no warning, got: ${JSON.stringify(lines)}`);
  } finally {
    await rm(traceDir, { recursive: true, force: true });
  }
});
