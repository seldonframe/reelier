import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OperatorHarnessIdV1 } from "./harness.js";
import type { OperatorSupervisorStateV1 } from "./operator.js";

export type OperatorPersistedSessionV1 = Readonly<OperatorSupervisorStateV1 & { updatedAt: string }>;

const REQUIRED_KEYS = new Set(["v", "sessionId", "harness", "requestId", "promptDigest", "harnessLifecycle", "cellVerdict", "cellLifecycle", "updatedAt"]);
const OPTIONAL_KEYS = new Set(["receiptRef"]);
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

function bounded(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) throw new TypeError(`invalid session ${name}`);
  return value;
}

function parse(value: unknown): OperatorPersistedSessionV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("operator session shape is invalid");
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (keys.some((key) => typeof key !== "string" || (!REQUIRED_KEYS.has(key) && !OPTIONAL_KEYS.has(key)))) throw new TypeError("operator session has unknown fields");
  if (![...REQUIRED_KEYS].every((key) => Object.hasOwn(record, key)) || keys.length < REQUIRED_KEYS.size || keys.length > REQUIRED_KEYS.size + OPTIONAL_KEYS.size) throw new TypeError("operator session shape is incomplete");
  if (record.v !== "reelier.operator-session/v1") throw new TypeError("operator session version is invalid");
  const sessionId = bounded(record.sessionId, "sessionId", 128);
  if (!SESSION_ID.test(sessionId)) throw new TypeError("operator session id is invalid");
  const harness = record.harness;
  if (harness !== "codex" && harness !== "claude-code" && harness !== "grok-build") throw new TypeError("operator session harness is invalid");
  const promptDigest = bounded(record.promptDigest, "promptDigest", 71);
  if (!DIGEST.test(promptDigest)) throw new TypeError("operator session prompt digest is invalid");
  const harnessLifecycle = record.harnessLifecycle;
  if (harnessLifecycle !== "running" && harnessLifecycle !== "stopped" && harnessLifecycle !== "completed" && harnessLifecycle !== "failed") throw new TypeError("operator session harness lifecycle is invalid");
  const cellVerdict = record.cellVerdict;
  if (cellVerdict !== "accepted" && cellVerdict !== "refused" && cellVerdict !== "unchecked") throw new TypeError("operator session Cell verdict is invalid");
  const cellLifecycle = bounded(record.cellLifecycle, "cellLifecycle", 256);
  const updatedAt = bounded(record.updatedAt, "updatedAt", 64);
  if (Number.isNaN(Date.parse(updatedAt))) throw new TypeError("operator session timestamp is invalid");
  const receiptRef = record.receiptRef === undefined ? undefined : bounded(record.receiptRef, "receiptRef", 256);
  return Object.freeze({
    v: "reelier.operator-session/v1",
    sessionId,
    harness: harness as OperatorHarnessIdV1,
    requestId: bounded(record.requestId, "requestId", 256),
    promptDigest,
    harnessLifecycle,
    cellVerdict,
    cellLifecycle,
    updatedAt,
    ...(receiptRef ? { receiptRef } : {}),
  });
}

async function canonicalRoot(root: string): Promise<string> {
  const resolved = path.resolve(root);
  const actual = await realpath(resolved);
  if (actual !== resolved) throw new Error("operator session root is symlinked");
  return actual;
}

function sessionPath(root: string, sessionId: string): string {
  if (!SESSION_ID.test(sessionId)) throw new TypeError("operator session id is invalid");
  return path.join(root, ".reelier", "operator-sessions", `${sessionId}.json`);
}

async function atomicWrite(target: string, text: string): Promise<void> {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

export function createOperatorSessionStoreV1(input: { readonly root: string; readonly now?: () => string }): {
  readonly load: (sessionId: string) => Promise<OperatorPersistedSessionV1 | null>;
  readonly save: (state: OperatorPersistedSessionV1) => Promise<OperatorPersistedSessionV1>;
} {
  const now = input.now ?? (() => new Date().toISOString());
  return Object.freeze({
    async load(sessionId: string): Promise<OperatorPersistedSessionV1 | null> {
      const root = await canonicalRoot(input.root);
      try {
        return parse(JSON.parse(await readFile(sessionPath(root, sessionId), "utf8")));
      } catch (error: unknown) {
        if ((error as { code?: string }).code === "ENOENT") return null;
        throw error;
      }
    },
    async save(state: OperatorPersistedSessionV1): Promise<OperatorPersistedSessionV1> {
      const root = await canonicalRoot(input.root);
      const parsed = parse(state);
      const target = sessionPath(root, parsed.sessionId);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const next = parse({ ...parsed, updatedAt: now() });
      await atomicWrite(target, `${JSON.stringify(next)}\n`);
      return next;
    },
  });
}

