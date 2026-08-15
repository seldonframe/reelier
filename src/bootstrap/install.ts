import { planInstall, type InstallPlan } from "../wrap.js";

export async function planBootstrapInstall(configPath: string, exactVersion: string, cwd?: string): Promise<InstallPlan> {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(exactVersion)) throw new TypeError("bootstrap exact version is invalid");
  const plan = await planInstall(configPath, cwd);
  if (!plan.changed) return plan;
  const after = JSON.parse(plan.after) as Record<string, unknown>;
  replaceLegacyProxyPackage(after, exactVersion);
  return { ...plan, after: `${JSON.stringify(after, null, 2)}\n` };
}

function replaceLegacyProxyPackage(value: unknown, exactVersion: string): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const child of value) replaceLegacyProxyPackage(child, exactVersion); return; }
  const record = value as Record<string, unknown>;
  if (record.command === "npx" && Array.isArray(record.args) && record.args[0] === "-y" && record.args[1] === "reelier" && record.args[2] === "mcp" && record.args[3] === "--wrap") record.args[1] = `reelier@${exactVersion}`;
  for (const child of Object.values(record)) replaceLegacyProxyPackage(child, exactVersion);
}
