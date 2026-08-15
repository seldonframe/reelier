import { applyInstall, planInstall, type InstallPlan, type InstallResult } from "../wrap.js";

export async function planBootstrapInstall(configPath: string, exactVersion: string, cwd?: string): Promise<InstallPlan> {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(exactVersion)) throw new TypeError("bootstrap exact version is invalid");
  const plan = await planInstall(configPath, cwd);
  if (!plan.changed) return plan;
  const after = JSON.parse(plan.after) as Record<string, unknown>;
  pinNewProxyPackages(after, exactVersion, plan.entries);
  return { ...plan, after: `${JSON.stringify(after, null, 2)}\n` };
}

export async function applyBootstrapInstall(plan: InstallPlan, options: Readonly<{ consent: boolean }>): Promise<InstallResult> {
  if (options.consent !== true) throw new TypeError("named bootstrap installation requires explicit consent");
  return applyInstall(plan);
}

function pinNewProxyPackages(config: Record<string, unknown>, exactVersion: string, entries: InstallPlan["entries"]): void {
  for (const planned of entries) {
    if (planned.action !== "wrap") continue;
    const servers = planned.projectPath === undefined
      ? asRecord(config.mcpServers)
      : asRecord(asRecord(asRecord(config.projects)?.[planned.projectPath])?.mcpServers);
    const entry = asRecord(servers?.[planned.name]);
    if (entry?.command === "npx" && Array.isArray(entry.args) && entry.args[0] === "-y" && entry.args[1] === "reelier" && entry.args[2] === "mcp" && entry.args[3] === "--wrap") {
      entry.args[1] = `reelier@${exactVersion}`;
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
