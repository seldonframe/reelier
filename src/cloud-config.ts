import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { homedir as osHomedir } from "node:os";
import path from "node:path";

export const DEFAULT_CLOUD_URL = "https://www.reelier.com";

export interface CliConfig {
  cloudUrl?: string;
  apiKey?: string;
  tenantName?: string;
  githubLogin?: string;
}

export function cliConfigPath(homedir: string = osHomedir()): string {
  return path.join(homedir, ".reelier", "config.json");
}

export async function readCliConfig(homedir: string = osHomedir()): Promise<CliConfig> {
  try {
    const raw = await readFile(cliConfigPath(homedir), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as CliConfig;
    }
    return {};
  } catch {
    return {};
  }
}

export async function writeCliConfig(
  config: CliConfig,
  homedir: string = osHomedir(),
): Promise<void> {
  const configPath = cliConfigPath(homedir);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  try {
    await chmod(configPath, 0o600);
  } catch {
    // best-effort — no-op on platforms (e.g. Windows) that don't support POSIX chmod
  }
}

export async function clearCliCredentials(homedir: string = osHomedir()): Promise<boolean> {
  const config = await readCliConfig(homedir);
  const hadCredentials = Boolean(config.apiKey || config.tenantName || config.githubLogin);
  if (!hadCredentials) {
    return false;
  }

  const remaining: CliConfig = {};
  if (config.cloudUrl) {
    remaining.cloudUrl = config.cloudUrl;
  }
  await writeCliConfig(remaining, homedir);
  return true;
}
