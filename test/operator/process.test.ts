import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { buildOperatorHarnessInvocationV1, createOperatorHarnessProcessV1 } from "../../src/operator/process.js";

test("harness invocations are deterministic and resume only with an opaque session", () => {
  const invocation = buildOperatorHarnessInvocationV1({ harness: "codex", cwd: "C:/repo", prompt: "finish the issue" });
  assert.deepEqual(invocation, { executable: "codex", args: ["exec", "--json", "--cd", "C:/repo", "finish the issue"], cwd: "C:/repo" });
  assert.throws(() => buildOperatorHarnessInvocationV1({ harness: "claude-code", cwd: "C:/repo", prompt: "x", resume: true }));
  const resumed = buildOperatorHarnessInvocationV1({ harness: "claude-code", cwd: "C:/repo", prompt: "x", resume: true, sessionId: "session-1" });
  assert.deepEqual(resumed.args, ["--print", "--output-format", "stream-json", "--permission-mode", "default", "--resume", "session-1", "x"]);
});

test("process events contain only digests and stop is bounded", async () => {
  class FakeChild extends EventEmitter {
    killed = false;
    stdout: Readable;
    constructor() {
      super();
      const emitClose = () => this.emit("close", 0, null);
      this.stdout = Readable.from(['{"type":"tool_use","secret":"do-not-store"}\n', "done\n"]);
      setTimeout(emitClose, 5);
    }
    kill() { this.killed = true; queueMicrotask(() => this.emit("close", 0, null)); return true; }
  }
  const child = new FakeChild();
  const adapter = createOperatorHarnessProcessV1({
    now: () => "2026-08-21T00:00:00.000Z",
    defaultTimeoutMs: 5_000,
    spawn: () => child as never,
  });
  const process = await adapter.launch({ harness: "codex", cwd: "C:/repo", prompt: "secret prompt" });
  const events = [];
  for await (const item of process.events) events.push(item);
  assert.equal(events[0]?.kind, "started");
  assert.equal(events.some((item) => item.kind === "tool-requested"), true);
  assert.equal(events.some((item) => item.payloadDigest?.includes("secret")), false);
  assert.equal(events.at(-1)?.kind, "completed");
  await process.stop();
  assert.equal(child.killed, false);
});
