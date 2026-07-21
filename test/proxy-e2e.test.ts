import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { connectDownstreamTransport } from "../src/mcp-client.js";
import { buildProxyServer, type TraceRecord } from "../src/recorder.js";

/** A tiny fake downstream MCP server: `echo {text}` and `fail_tool {}` (returns isError). */
function buildFakeDownstream(): Server {
  const server = new Server({ name: "fake-downstream", version: "0.0.1" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "echo",
        description: "Echoes back the given text.",
        inputSchema: { type: "object" as const, properties: { text: { type: "string" } }, required: ["text"] },
        annotations: { readOnlyHint: true },
      },
      {
        name: "fail_tool",
        description: "Always fails.",
        inputSchema: { type: "object" as const, properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    if (name === "echo") {
      const text = (args as { text: string }).text;
      return { content: [{ type: "text", text }] };
    }
    if (name === "fail_tool") {
      return { content: [{ type: "text", text: "boom" }], isError: true };
    }
    throw new Error(`Unknown tool: ${name}`);
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

test("proxy E2E: list tools, record a session, and verify exact trace + verbatim passthrough", async () => {
  const traceDir = await mkdtemp(path.join(tmpdir(), "reelier-proxy-e2e-"));
  try {
    // Wire proxy client <-> fake downstream.
    const [downstreamClientSide, downstreamServerSide] = InMemoryTransport.createLinkedPair();
    const fakeDownstreamServer = buildFakeDownstream();
    await fakeDownstreamServer.connect(downstreamServerSide);
    const downstream = await connectDownstreamTransport(downstreamClientSide, "fake-downstream");

    // Wire test-client <-> proxy.
    const proxyServer = buildProxyServer([downstream], { traceDir });
    const [testClientSide, proxyServerSide] = InMemoryTransport.createLinkedPair();
    await proxyServer.connect(proxyServerSide);
    const testClient = new Client({ name: "reelier-test-client", version: "0.0.1" }, { capabilities: {} });
    await testClient.connect(testClientSide);

    // 1. tools/list shows downstream tools + 3 reelier_* controls.
    const listed = await testClient.listTools();
    const names = listed.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "echo",
      "fail_tool",
      "reelier_note",
      "reelier_start_recording",
      "reelier_stop_recording",
    ]);

    // 2. start recording.
    const startResult = await testClient.callTool({
      name: "reelier_start_recording",
      arguments: { name: "demo" },
    });
    const startText = (startResult.content as Array<{ text: string }>)[0].text;
    assert.match(startText, /^Recording started: /);
    const tracePath = startText.replace("Recording started: ", "");

    // 3. narrate intent.
    await testClient.callTool({ name: "reelier_note", arguments: { text: "about to echo a secret-shaped value" } });

    // 4. a passing call, with a secret-shaped arg to exercise redaction.
    const echoResult = await testClient.callTool({
      name: "echo",
      arguments: { text: "sk-abcdefghijklmno" },
    });
    // Passthrough result equals the downstream's result verbatim (never redacted on the live path).
    assert.deepEqual(echoResult.content, [{ type: "text", text: "sk-abcdefghijklmno" }]);
    assert.equal(echoResult.isError, undefined);

    // 5. a failing call.
    const failResult = await testClient.callTool({ name: "fail_tool", arguments: {} });
    assert.equal(failResult.isError, true);
    assert.deepEqual(failResult.content, [{ type: "text", text: "boom" }]);

    // 6. stop recording.
    const stopResult = await testClient.callTool({ name: "reelier_stop_recording", arguments: {} });
    const stopText = (stopResult.content as Array<{ text: string }>)[0].text;
    assert.match(stopText, /^Recording stopped: .* \(2 calls\)$/);

    await testClient.close();
    await downstream.close();
    await proxyServer.close();
    await fakeDownstreamServer.close();

    // Assert the trace file contents exactly: meta, note, call(echo), result(echo),
    // call(fail_tool), result(fail_tool). Control-tool calls (start/note/stop)
    // are never themselves recorded as "call"/"result" entries.
    const records = await readTrace(tracePath);
    assert.equal(records.length, 6);
    assert.deepEqual(
      records.map((r) => r.t),
      ["meta", "note", "call", "result", "call", "result"]
    );
    assert.deepEqual(
      records.map((r) => r.seq),
      [0, 1, 2, 3, 4, 5]
    );

    assert.equal(records[0].t, "meta");
    if (records[0].t === "meta") {
      assert.equal(records[0].name, "demo");
      assert.deepEqual(records[0].wrapped, ["fake-downstream"]);
      // Annotation hints from the downstream's tools/list are captured into
      // meta — only for tools that declared any (fail_tool declared none).
      assert.deepEqual(records[0].toolAnnotations, { echo: { readOnlyHint: true } });
    }

    assert.equal(records[1].t, "note");
    if (records[1].t === "note") {
      assert.equal(records[1].text, "about to echo a secret-shaped value");
    }

    assert.equal(records[2].t, "call");
    if (records[2].t === "call") {
      assert.equal(records[2].i, 0);
      assert.equal(records[2].tool, "echo");
      // Redaction applied at trace-write time: the sk-... arg is masked in the file.
      assert.deepEqual(records[2].args, { text: "«redacted»" });
    }

    assert.equal(records[3].t, "result");
    if (records[3].t === "result") {
      assert.equal(records[3].i, 0);
      assert.equal(records[3].ok, true);
      assert.equal(typeof records[3].ms, "number");
      assert.deepEqual(records[3].body, { content: [{ type: "text", text: "«redacted»" }] });
    }

    assert.equal(records[4].t, "call");
    if (records[4].t === "call") {
      assert.equal(records[4].i, 1);
      assert.equal(records[4].tool, "fail_tool");
      assert.deepEqual(records[4].args, {});
    }

    assert.equal(records[5].t, "result");
    if (records[5].t === "result") {
      assert.equal(records[5].i, 1);
      assert.equal(records[5].ok, false);
      assert.equal(typeof records[5].ms, "number");
      assert.deepEqual(records[5].body, { content: [{ type: "text", text: "boom" }], isError: true });
    }
  } finally {
    await rm(traceDir, { recursive: true, force: true });
  }
});
