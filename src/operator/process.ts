import { createHash, randomUUID } from "node:crypto";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import type { OperatorHarnessIdV1 } from "./harness.js";

export type OperatorHarnessEventKindV1 =
  | "started"
  | "text"
  | "tool-requested"
  | "tool-completed"
  | "completed"
  | "failed"
  | "unknown";

export interface OperatorHarnessLaunchRequestV1 {
  readonly harness: OperatorHarnessIdV1;
  readonly cwd: string;
  readonly prompt: string;
  readonly sessionId?: string;
  readonly resume?: boolean;
  readonly timeoutMs?: number;
}

export interface OperatorHarnessInvocationV1 {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

export interface OperatorHarnessEventV1 {
  readonly v: "reelier.operator-event/v1";
  readonly harness: OperatorHarnessIdV1;
  readonly sessionId: string;
  readonly kind: OperatorHarnessEventKindV1;
  readonly payloadDigest: string | null;
  readonly at: string;
}

export interface OperatorHarnessProcessV1 {
  readonly sessionId: string;
  readonly resumeIdentity: Promise<string | null>;
  readonly invocation: OperatorHarnessInvocationV1;
  readonly events: AsyncIterable<OperatorHarnessEventV1>;
  readonly stop: () => Promise<void>;
}

type SpawnLike = (
  executable: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly stdio: ["pipe", "pipe", "pipe"]; readonly windowsHide: boolean },
) => ChildProcess;

const executableFor: Record<OperatorHarnessIdV1, string> = {
  codex: "codex",
  "claude-code": "claude",
  "grok-build": "grok",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const OPAQUE_SESSION = /^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$/u;

function assertPrompt(prompt: string): void {
  if (typeof prompt !== "string" || prompt.length === 0 || prompt.length > 128_000) {
    throw new Error("operator prompt is empty or too large");
  }
}

function assertCwd(cwd: string): void {
  if (typeof cwd !== "string" || cwd.length === 0 || cwd.length > 4_096) throw new Error("operator cwd is invalid");
}

export function buildOperatorHarnessInvocationV1(input: OperatorHarnessLaunchRequestV1): OperatorHarnessInvocationV1 {
  assertCwd(input.cwd);
  assertPrompt(input.prompt);
  const sessionId = input.sessionId;
  if (input.resume && (!sessionId || sessionId.length > 256)) throw new Error("resume requires an opaque session id");
  const executable = executableFor[input.harness];
  if (!executable) throw new Error("unknown harness");
  let args: string[];
  if (input.harness === "codex") {
    args = ["exec", "--json", "--cd", input.cwd];
    if (input.resume) args.push("resume", sessionId!);
    args.push(input.prompt);
  } else if (input.harness === "claude-code") {
    args = ["--print", "--output-format", "stream-json", "--permission-mode", "default"];
    if (input.resume) args.push("--resume", sessionId!);
    else if (sessionId) {
      if (!UUID.test(sessionId)) throw new Error("Claude initial session id must be a UUID");
      args.push("--session-id", sessionId);
    }
    args.push(input.prompt);
  } else {
    args = ["--output-format", "stream-json", "--cwd", input.cwd];
    if (input.resume) args.push("--resume", sessionId!);
    args.push("-p", input.prompt);
  }
  return Object.freeze({ executable, args: Object.freeze(args), cwd: input.cwd });
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function classifyLine(value: string): OperatorHarnessEventKindV1 {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const type = (parsed as Record<string, unknown>).type;
      if (type === "tool_use" || type === "tool_call" || type === "function_call") return "tool-requested";
      if (type === "tool_result" || type === "tool_call_output" || type === "function_result") return "tool-completed";
      if (type === "result" || type === "completed" || type === "final") return "completed";
      if (type === "error" || type === "failed") return "failed";
    }
  } catch {
    return "text";
  }
  return "unknown";
}

function nativeResumeIdentity(value: string, harness: OperatorHarnessIdV1): string | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.getPrototypeOf(parsed) !== Object.prototype) return null;
    const record = parsed as Record<string, unknown>;
    const candidate = harness === "codex" && record.type === "thread.started"
      ? record.thread_id
      : harness === "claude-code" && record.type === "system" && record.subtype === "init"
        ? record.session_id
        : null;
    return typeof candidate === "string" && OPAQUE_SESSION.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function event(input: {
  harness: OperatorHarnessIdV1;
  sessionId: string;
  kind: OperatorHarnessEventKindV1;
  payload: string | null;
  now: () => string;
}): OperatorHarnessEventV1 {
  return Object.freeze({
    v: "reelier.operator-event/v1",
    harness: input.harness,
    sessionId: input.sessionId,
    kind: input.kind,
    payloadDigest: input.payload === null ? null : digest(input.payload),
    at: input.now(),
  });
}

export function createOperatorHarnessProcessV1(input: {
  readonly spawn?: SpawnLike;
  readonly now?: () => string;
  readonly defaultTimeoutMs?: number;
} = {}): { launch(request: OperatorHarnessLaunchRequestV1): Promise<OperatorHarnessProcessV1> } {
  const spawn = input.spawn ?? (nodeSpawn as unknown as SpawnLike);
  const now = input.now ?? (() => new Date().toISOString());
  const defaultTimeoutMs = input.defaultTimeoutMs ?? 30 * 60_000;

  return Object.freeze({
    async launch(request: OperatorHarnessLaunchRequestV1): Promise<OperatorHarnessProcessV1> {
      const sessionId = request.sessionId ?? randomUUID();
      const invocation = buildOperatorHarnessInvocationV1({ ...request, ...(request.harness === "claude-code" && !request.resume ? { sessionId } : {}) });
      const child = spawn(invocation.executable, invocation.args, {
        cwd: invocation.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 24 * 60 * 60_000) {
        child.kill("SIGTERM");
        throw new Error("operator timeout is invalid");
      }
      let stopped = false;
      let processClosed = false;
      let resumeIdentitySettled = false;
      let settleResumeIdentity!: (value: string | null) => void;
      const resumeIdentity = new Promise<string | null>((resolve) => { settleResumeIdentity = resolve; });
      const settle = (value: string | null): void => {
        if (resumeIdentitySettled) return;
        resumeIdentitySettled = true;
        settleResumeIdentity(value);
      };
      if (request.harness === "claude-code" && !request.resume) settle(sessionId);
      if (request.resume && request.sessionId) settle(request.sessionId);
      child.once("close", () => { processClosed = true; });
      const stop = async (): Promise<void> => {
        if (stopped) return;
        stopped = true;
        if (processClosed) return;
        if (!child.killed) child.kill("SIGTERM");
        await Promise.race([once(child, "close"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
      };
      const events = (async function* (): AsyncGenerator<OperatorHarnessEventV1> {
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          if (!child.killed) child.kill("SIGTERM");
        }, timeoutMs);
        yield event({ harness: request.harness, sessionId, kind: "started", payload: null, now });
        try {
          if (!child.stdout) throw new Error("harness stdout is unavailable");
          const closed = once(child, "close");
          const lines = createInterface({ input: child.stdout });
          for await (const line of lines) {
            const text = String(line);
            const native = nativeResumeIdentity(text, request.harness);
            if (native) settle(native);
            yield event({ harness: request.harness, sessionId, kind: classifyLine(text), payload: text, now });
          }
          const [code] = (await closed) as [number | null, NodeJS.Signals | null];
          if (timedOut || code !== 0) {
            yield event({ harness: request.harness, sessionId, kind: "failed", payload: timedOut ? "timeout" : String(code), now });
          } else {
            yield event({ harness: request.harness, sessionId, kind: "completed", payload: String(code), now });
          }
        } catch (error) {
          yield event({ harness: request.harness, sessionId, kind: "failed", payload: error instanceof Error ? error.message : "harness-failed", now });
        } finally {
          clearTimeout(timer);
          settle(null);
        }
      })();
      return Object.freeze({ sessionId, resumeIdentity, invocation, events, stop });
    },
  });
}
