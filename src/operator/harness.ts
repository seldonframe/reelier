import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveOperatorHarnessCommandV1 } from "./harness-executable.js";

const execFileAsync = promisify(execFile);

export type OperatorHarnessIdV1 = "codex" | "claude-code" | "grok-build";

export interface OperatorHarnessDescriptorV1 {
  readonly v: "reelier.operator-harness/v1";
  readonly id: OperatorHarnessIdV1;
  readonly displayName: string;
  readonly executable: string;
  readonly resumeSupported: boolean;
  readonly jsonEventsSupported: boolean;
}

export interface OperatorHarnessProbeV1 {
  readonly descriptor: OperatorHarnessDescriptorV1;
  readonly installed: boolean;
  readonly version: string | null;
  readonly authMode: "installed-session" | "unavailable";
  readonly reason: string | null;
}

export interface OperatorHarnessRegistryV1 {
  probeAll(): Promise<readonly OperatorHarnessProbeV1[]>;
  probe(id: OperatorHarnessIdV1): Promise<OperatorHarnessProbeV1>;
}

type ProbeDependencies = {
  readonly commandExists?: (executable: string) => Promise<boolean>;
  readonly runVersion?: (executable: string) => Promise<string>;
};

const DESCRIPTORS: readonly OperatorHarnessDescriptorV1[] = Object.freeze([
  Object.freeze({
    v: "reelier.operator-harness/v1" as const,
    id: "codex" as const,
    displayName: "Codex",
    executable: "codex",
    resumeSupported: true,
    jsonEventsSupported: true,
  }),
  Object.freeze({
    v: "reelier.operator-harness/v1" as const,
    id: "claude-code" as const,
    displayName: "Claude Code",
    executable: "claude",
    resumeSupported: true,
    jsonEventsSupported: true,
  }),
  Object.freeze({
    v: "reelier.operator-harness/v1" as const,
    id: "grok-build" as const,
    displayName: "Grok Build",
    executable: "grok",
    resumeSupported: true,
    jsonEventsSupported: true,
  }),
]);

function descriptorFor(id: OperatorHarnessIdV1): OperatorHarnessDescriptorV1 {
  const descriptor = DESCRIPTORS.find((candidate) => candidate.id === id);
  if (!descriptor) throw new Error(`unknown harness: ${String(id)}`);
  return descriptor;
}

async function defaultCommandExists(executable: string): Promise<boolean> {
  try {
    const resolved = await resolveOperatorHarnessCommandV1({ executable });
    await execFileAsync(resolved.executable, [...resolved.argsPrefix, "--version"], { timeout: 3_000, maxBuffer: 16 * 1024 });
    return true;
  } catch {
    return false;
  }
}

async function defaultRunVersion(executable: string): Promise<string> {
  const resolved = await resolveOperatorHarnessCommandV1({ executable });
  const result = await execFileAsync(resolved.executable, [...resolved.argsPrefix, "--version"], { timeout: 3_000, maxBuffer: 16 * 1024 });
  return result.stdout;
}

function sanitizeVersion(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const firstLine = raw.split(/\r?\n/, 1)[0] ?? "";
  const cleaned = firstLine.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (cleaned.length === 0 || cleaned.length > 128) return null;
  return cleaned;
}

export function createOperatorHarnessRegistryV1(input: ProbeDependencies = {}): OperatorHarnessRegistryV1 {
  const commandExists = input.commandExists ?? defaultCommandExists;
  const runVersion = input.runVersion ?? defaultRunVersion;

  async function probe(id: OperatorHarnessIdV1): Promise<OperatorHarnessProbeV1> {
    const descriptor = descriptorFor(id);
    let installed = false;
    try {
      installed = await commandExists(descriptor.executable);
    } catch {
      installed = false;
    }
    if (!installed) {
      return Object.freeze({
        descriptor,
        installed: false,
        version: null,
        authMode: "unavailable" as const,
        reason: "executable-unavailable",
      });
    }

    let version: string | null = null;
    try {
      version = sanitizeVersion(await runVersion(descriptor.executable));
    } catch {
      version = null;
    }
    return Object.freeze({
      descriptor,
      installed: true,
      version,
      authMode: "installed-session" as const,
      reason: version === null ? "version-unavailable" : null,
    });
  }

  return Object.freeze({
    probe,
    async probeAll(): Promise<readonly OperatorHarnessProbeV1[]> {
      return Object.freeze(await Promise.all(DESCRIPTORS.map((descriptor) => probe(descriptor.id))));
    },
  });
}
