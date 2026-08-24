import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { buildOperatorHarnessInvocationV1, createOperatorHarnessProcessV1 } from "../../src/operator/process.js";

test("harness invocations are deterministic and resume only with an opaque session", () => {
  const invocation = buildOperatorHarnessInvocationV1({ harness: "codex", cwd: "C:/repo", prompt: "finish the issue" });
  assert.deepEqual(invocation, { executable: "codex", args: ["exec", "--json", "--approve-for-me", "--cd", "C:/repo", "finish the issue"], cwd: "C:/repo" });
  assert.equal(invocation.args.includes("--sandbox"), false);
  assert.equal(invocation.args.includes("--dangerously-bypass-approvals-and-sandbox"), false);
  assert.throws(() => buildOperatorHarnessInvocationV1({ harness: "claude-code", cwd: "C:/repo", prompt: "x", resume: true }));
  const resumed = buildOperatorHarnessInvocationV1({ harness: "claude-code", cwd: "C:/repo", prompt: "x", resume: true, sessionId: "session-1" });
  assert.deepEqual(resumed.args, ["--print", "--output-format", "stream-json", "--permission-mode", "default", "--resume", "session-1", "x"]);
  const assigned = buildOperatorHarnessInvocationV1({ harness: "claude-code", cwd: "C:/repo", prompt: "x", sessionId: "51a8a908-118b-4195-8266-7e8c3a8fc709" });
  assert.deepEqual(assigned.args, ["--print", "--output-format", "stream-json", "--permission-mode", "default", "--session-id", "51a8a908-118b-4195-8266-7e8c3a8fc709", "x"]);
});

test("process events contain only digests and stop is bounded", async () => {
  class FakeChild extends EventEmitter {
    killed = false;
    stdout: Readable;
    constructor() {
      super();
      const emitClose = () => this.emit("close", 0, null);
      this.stdout = Readable.from(['{"type":"thread.started","thread_id":"01a01530-38b5-7831-8309-5d61e42408c5"}\n', '{"type":"tool_use","secret":"do-not-store"}\n', "done\n"]);
      setTimeout(emitClose, 5);
    }
    kill() { this.killed = true; queueMicrotask(() => this.emit("close", 0, null)); return true; }
  }
  const child = new FakeChild();
  const adapter = createOperatorHarnessProcessV1({
    now: () => "2026-08-21T00:00:00.000Z",
    defaultTimeoutMs: 5_000,
    resolveExecutable: async (executable) => ({ executable, argsPrefix: [] }),
    spawn: () => child as never,
  });
  const process = await adapter.launch({ harness: "codex", cwd: "C:/repo", prompt: "secret prompt" });
  const events = [];
  for await (const item of process.events) events.push(item);
  assert.equal(events[0]?.kind, "started");
  assert.equal(events.some((item) => item.kind === "tool-requested"), true);
  assert.equal(events.some((item) => item.payloadDigest?.includes("secret")), false);
  assert.equal(events.at(-1)?.kind, "completed");
  assert.equal(await process.resumeIdentity, "01a01530-38b5-7831-8309-5d61e42408c5");
  await process.stop();
  assert.equal(child.killed, false);
});

test("Codex and Claude usage becomes closed numeric telemetry without model output", async () => {
  const run = async (harness: "codex" | "claude-code", line: string) => {
    class UsageChild extends EventEmitter {
      killed = false;
      stdout = Readable.from([`${line}\n`]);
      stderr = new PassThrough();
      stdin = { end() {} };
      kill() { this.killed = true; return true; }
    }
    const child = new UsageChild();
    const process = await createOperatorHarnessProcessV1({
      resolveExecutable: async (executable) => ({ executable, argsPrefix: [] }),
      spawn: () => { setTimeout(() => child.emit("close", 0, null), 5); return child as never; },
      defaultTimeoutMs: 5_000,
    }).launch({ harness, cwd: "C:/repo", prompt: "private mission" });
    const events = [];
    for await (const event of process.events) events.push(event);
    return events.find((event) => event.usage !== undefined);
  };

  const codex = await run("codex", JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1_200, cached_input_tokens: 400, output_tokens: 300 }, secret: "never persist" }));
  assert.deepEqual(codex?.usage, { inputTokens: 1_200, cachedInputTokens: 400, outputTokens: 300, contextUnits: 1_500 });
  const claude = await run("claude-code", JSON.stringify({ type: "result", total_cost_usd: 0.123456, usage: { input_tokens: 100, output_tokens: 50 }, result: "never persist" }));
  assert.deepEqual(claude?.usage, { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50, contextUnits: 150, totalCostMicros: 123_456 });
  assert.doesNotMatch(JSON.stringify([codex, claude]), /never persist|private mission/i);
});

test("a harness that closes between the started event and the next iterator read terminates honestly", async () => {
  class FastChild extends EventEmitter {
    killed = false;
    stdout = new PassThrough();
    stderr = new PassThrough();
    stdin = { end() {} };
    kill() { this.killed = true; return true; }
  }
  const child = new FastChild();
  const process = await createOperatorHarnessProcessV1({
    resolveExecutable: async (executable) => ({ executable, argsPrefix: [] }),
    spawn: () => child as never,
    defaultTimeoutMs: 5_000,
  }).launch({ harness: "codex", cwd: "C:/repo", prompt: "finish quickly" });
  const iterator = process.events[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value?.kind, "started");

  child.stdout.destroy();
  child.emit("close", 0, null);

  const terminal = await Promise.race([
    iterator.next(),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("missed harness close event")), 100)),
  ]);
  assert.equal(terminal.value?.kind, "completed");
  assert.equal((await iterator.next()).done, true);
});

test("a wall-clock kill is exposed as a closed timeout event without output text", async () => {
  class TimedChild extends EventEmitter {
    killed = false;
    stdout = new PassThrough();
    stderr = new PassThrough();
    stdin = { end() {} };
    kill() { this.killed = true; this.stdout.end(); queueMicrotask(() => this.emit("close", null, "SIGTERM")); return true; }
  }
  const child = new TimedChild();
  const process = await createOperatorHarnessProcessV1({ resolveExecutable: async (executable) => ({ executable, argsPrefix: [] }), spawn: () => child as never, defaultTimeoutMs: 1_000 }).launch({ harness: "codex", cwd: "C:/repo", prompt: "wait forever" });
  const eventsPromise = (async () => {
    const events = [];
    for await (const event of process.events) events.push(event);
    return events;
  })();
  const events = await eventsPromise;
  assert.equal(events.at(-1)?.kind, "timed-out");
  assert.equal(events.at(-1)?.payloadDigest, null);
});

test("the harness boundary closes unused stdin and drains stderr without recording it", async () => {
  class FakeChild extends EventEmitter {
    killed = false;
    stdout = Readable.from(["done\n"]);
    stderr = new PassThrough();
    stdinEnded = false;
    stdin = { end: () => { this.stdinEnded = true; } };
    kill() { this.killed = true; queueMicrotask(() => this.emit("close", 0, null)); return true; }
  }
  const child = new FakeChild();
  const adapter = createOperatorHarnessProcessV1({ resolveExecutable: async (executable) => ({ executable, argsPrefix: [] }), defaultTimeoutMs: 5_000, spawn: () => child as never });
  const process = await adapter.launch({ harness: "codex", cwd: "C:/repo", prompt: "private task" });
  assert.equal(child.stdinEnded, true);
  assert.equal(child.stderr.readableFlowing, true);
  setTimeout(() => child.emit("close", 0, null), 5);
  const events = [];
  for await (const item of process.events) events.push(item);
  assert.equal(JSON.stringify(events).includes("private task"), false);
});

test("the process runner launches the resolved Windows entrypoint with mission text as direct argv", async () => {
  class FakeChild extends EventEmitter {
    killed = false;
    stdout = Readable.from([]);
    stderr = new PassThrough();
    stdin = { end() {} };
    kill() { this.killed = true; return true; }
  }
  const child = new FakeChild();
  let launch: { executable: string; args: readonly string[] } | undefined;
  const adapter = createOperatorHarnessProcessV1({
    resolveExecutable: async () => ({ executable: "C:/node.exe", argsPrefix: ["C:/npm/node_modules/@openai/codex/bin/codex.js"] }),
    spawn: (executable, args) => { launch = { executable, args }; setTimeout(() => child.emit("close", 0, null), 5); return child as never; },
  });
  const missionText = "finish safely & never enter a shell";
  const running = await adapter.launch({ harness: "codex", cwd: "C:/repo", prompt: missionText });
  for await (const _event of running.events) { /* drain */ }
  assert.equal(launch?.executable, "C:/node.exe");
  assert.deepEqual(launch?.args.slice(-1), [missionText]);
  assert.equal(launch?.args[0], "C:/npm/node_modules/@openai/codex/bin/codex.js");
});
