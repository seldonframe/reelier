import { access, realpath } from "node:fs/promises";
import path from "node:path";

export interface ResolvedOperatorHarnessCommandV1 {
  readonly executable: string;
  readonly argsPrefix: readonly string[];
}

async function existingFile(candidate: string): Promise<string | null> {
  try {
    await access(candidate);
    return await realpath(candidate);
  } catch {
    return null;
  }
}

/**
 * Resolve only known, direct harness entrypoints. Windows npm `.cmd` shims are
 * deliberately never interpreted and callers never enable a command shell.
 */
export async function resolveOperatorHarnessCommandV1(input: {
  readonly executable: string;
  readonly platform?: NodeJS.Platform;
  readonly pathValue?: string;
}): Promise<ResolvedOperatorHarnessCommandV1> {
  const platform = input.platform ?? process.platform;
  if (platform !== "win32") {
    return Object.freeze({ executable: input.executable, argsPrefix: Object.freeze([]) });
  }

  const segments = (input.pathValue ?? process.env.PATH ?? "")
    .split(path.delimiter)
    .map((segment) => segment.trim().replace(/^"|"$/gu, ""))
    .filter((segment) => segment.length > 0);

  for (const segment of segments) {
    if (input.executable === "claude") {
      const native = await existingFile(path.join(segment, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe"));
      if (native) return Object.freeze({ executable: native, argsPrefix: Object.freeze([]) });
    } else if (input.executable === "codex") {
      const entrypoint = await existingFile(path.join(segment, "node_modules", "@openai", "codex", "bin", "codex.js"));
      if (entrypoint) return Object.freeze({ executable: process.execPath, argsPrefix: Object.freeze([entrypoint]) });
    } else {
      const native = await existingFile(path.join(segment, `${input.executable}.exe`));
      if (native) return Object.freeze({ executable: native, argsPrefix: Object.freeze([]) });
    }
  }

  throw new Error(`operator harness executable is unavailable: ${input.executable}`);
}
