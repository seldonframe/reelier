import { mkdir, readFile, rename, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { OperatorHarnessIdV1 } from "./harness.js";

export interface OperatorWorkspaceStateV1 {
  readonly v: "reelier.operator-workspace/v1";
  readonly workspaceId: string;
  readonly root: string;
  readonly mode: "local-cell" | "managed-cell";
  readonly selectedHarnesses: readonly OperatorHarnessIdV1[];
  readonly authorityCell: "local" | "managed" | "unconfigured";
  readonly createdAt: string;
  readonly updatedAt: string;
}

const HARNESSES = new Set<OperatorHarnessIdV1>(["codex", "claude-code", "grok-build"]);
const KEYS = new Set(["v", "workspaceId", "root", "mode", "selectedHarnesses", "authorityCell", "createdAt", "updatedAt"]);

function assertString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) throw new Error(`invalid ${name}`);
}

function parseState(value: unknown): OperatorWorkspaceStateV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid workspace state");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) if (!KEYS.has(key)) throw new Error(`unknown key: ${key}`);
  if (Object.keys(record).length !== KEYS.size) throw new Error("workspace state keys are incomplete");
  if (record.v !== "reelier.operator-workspace/v1") throw new Error("invalid workspace state version");
  assertString(record.workspaceId, "workspaceId");
  assertString(record.root, "root");
  assertString(record.createdAt, "createdAt");
  assertString(record.updatedAt, "updatedAt");
  if (record.mode !== "local-cell" && record.mode !== "managed-cell") throw new Error("invalid workspace mode");
  if (record.authorityCell !== "local" && record.authorityCell !== "managed" && record.authorityCell !== "unconfigured") {
    throw new Error("invalid authority cell");
  }
  if (!Array.isArray(record.selectedHarnesses) || record.selectedHarnesses.length > 3) throw new Error("invalid selected harnesses");
  const selected = [...record.selectedHarnesses] as unknown[];
  const normalized = selected.map((item) => {
    if (typeof item !== "string" || !HARNESSES.has(item as OperatorHarnessIdV1)) throw new Error("unknown harness");
    return item as OperatorHarnessIdV1;
  });
  if (new Set(normalized).size !== normalized.length) throw new Error("duplicate harness");
  normalized.sort();
  const result: OperatorWorkspaceStateV1 = {
    v: "reelier.operator-workspace/v1",
    workspaceId: record.workspaceId,
    root: record.root,
    mode: record.mode,
    selectedHarnesses: Object.freeze(normalized),
    authorityCell: record.authorityCell,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  return Object.freeze(result);
}

async function canonicalRoot(root: string): Promise<string> {
  const resolved = path.resolve(root);
  const actual = await realpath(resolved);
  if (actual !== resolved) throw new Error("symlinked workspace root is refused");
  return actual;
}

function statePath(root: string): string {
  return path.join(root, ".reelier", "operator.json");
}

async function atomicWrite(target: string, value: string): Promise<void> {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, value, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

export async function readOperatorWorkspaceV1(root: string): Promise<OperatorWorkspaceStateV1 | null> {
  const canonical = await canonicalRoot(root);
  try {
    return parseState(JSON.parse(await readFile(statePath(canonical), "utf8")));
  } catch (error: unknown) {
    const candidate = error as { code?: string };
    if (candidate.code === "ENOENT") return null;
    throw error;
  }
}

export async function initializeOperatorWorkspaceV1(input: {
  readonly root: string;
  readonly selectedHarnesses: readonly OperatorHarnessIdV1[];
  readonly now?: string;
}): Promise<OperatorWorkspaceStateV1> {
  const root = await canonicalRoot(input.root);
  const selected = [...input.selectedHarnesses];
  const candidate = parseState({
    v: "reelier.operator-workspace/v1",
    workspaceId: randomUUID(),
    root,
    mode: "local-cell",
    selectedHarnesses: selected,
    authorityCell: "local",
    createdAt: input.now ?? new Date().toISOString(),
    updatedAt: input.now ?? new Date().toISOString(),
  });
  const existing = await readOperatorWorkspaceV1(root);
  if (existing) {
    if (existing.root !== root) throw new Error("workspace root mismatch");
    if (existing.selectedHarnesses.join(",") === candidate.selectedHarnesses.join(",")) return existing;
  }
  const next: OperatorWorkspaceStateV1 = existing
    ? parseState({ ...existing, selectedHarnesses: candidate.selectedHarnesses, updatedAt: candidate.updatedAt })
    : candidate;
  const directory = path.dirname(statePath(root));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await atomicWrite(statePath(root), `${JSON.stringify(next)}\n`);
  return next;
}
