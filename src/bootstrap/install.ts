import { applyInstall, planInstall, type InstallPlan, type InstallResult } from "../wrap.js";

export async function planBootstrapInstall(configPath: string, exactVersion: string, cwd?: string): Promise<InstallPlan> {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(exactVersion)) throw new TypeError("bootstrap exact version is invalid");
  const plan = await planInstall(configPath, cwd);
  if (!plan.changed) return plan;
  const after = JSON.parse(plan.after) as Record<string, unknown>;
  pinNewProxyPackages(after, exactVersion, new Set(plan.entries.filter(entry => entry.action === "wrap").map(entry => entry.name)));
  return { ...plan, after: `${JSON.stringify(after, null, 2)}\n` };
}

export async function applyBootstrapInstall(plan: InstallPlan, options: Readonly<{ consent: boolean }>): Promise<InstallResult> {
  if (options.consent !== true) throw new TypeError("named bootstrap installation requires explicit consent");
  return applyInstall(plan);
}

function pinNewProxyPackages(value: unknown, exactVersion: string, names: ReadonlySet<string>): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const child of value) pinNewProxyPackages(child, exactVersion, names); return; }
  const record = value as Record<string, unknown>;
  for (const [name, child] of Object.entries(record)) {
    if (names.has(name) && child !== null && typeof child === "object") { const entry = child as Record<string, unknown>; if (entry.command === "npx" && Array.isArray(entry.args) && entry.args[0] === "-y" && entry.args[1] === "reelier" && entry.args[2] === "mcp" && entry.args[3] === "--wrap") entry.args[1] = `reelier@${exactVersion}`; }
    pinNewProxyPackages(child, exactVersion, names);
  }
}
