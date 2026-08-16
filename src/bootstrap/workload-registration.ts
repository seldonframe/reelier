import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateSigningKeypair } from "../signing.js";

export interface WorkloadRegistrationRequest {
  readonly v: "reelier.workload-registration-request/v1";
  readonly agentName: string;
  readonly publicKeyCommitment: string;
  readonly certification: "unsigned";
  readonly activation: "absent";
  readonly privateKeyIsolation: "posix-mode-0600-or-windows-acl-unchecked";
}

export async function prepareWorkloadRegistration(homedir: string, agentName: string, projectScope = "default"): Promise<WorkloadRegistrationRequest> {
  const workloadRoot = await claimWorkloadAgentName(homedir, agentName);
  const directory = path.join(workloadRoot, agentName);
  await ensureRealDirectory(directory);
  const scope = createHash("sha256").update(projectScope, "utf8").digest("hex").slice(0, 16);
  const scopeFile = path.join(directory, `.scope-${scope}.json`);
  let publicPem: string | undefined;
  try {
    const keyId = JSON.parse(await readFile(scopeFile, "utf8")) as { keyId?: unknown };
    if (typeof keyId.keyId === "string" && /^[0-9a-f]{16}$/.test(keyId.keyId)) publicPem = await readFile(path.join(directory, `${keyId.keyId}.pub.pem`), "utf8");
  } catch {}
  if (publicPem === undefined) { const generated = await generateSigningKeypair(directory); publicPem = generated.publicPem; await writeFile(scopeFile, JSON.stringify({ keyId: generated.keyId }), { encoding: "utf8", flag: "wx" }).catch(async error => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; publicPem = await readFile(path.join(directory, `${(JSON.parse(await readFile(scopeFile, "utf8")) as { keyId: string }).keyId}.pub.pem`), "utf8"); }); }
  return Object.freeze({ v: "reelier.workload-registration-request/v1", agentName, publicKeyCommitment: `sha256:${createHash("sha256").update(publicPem, "utf8").digest("hex")}`, certification: "unsigned", activation: "absent", privateKeyIsolation: "posix-mode-0600-or-windows-acl-unchecked" });
}

export async function claimWorkloadAgentName(homedir: string, agentName: string): Promise<string> {
  const reelierRoot = path.join(homedir, ".reelier");
  const workloadRoot = path.join(reelierRoot, "workloads");
  await ensureRealDirectory(reelierRoot);
  await ensureRealDirectory(workloadRoot);
  for (const existing of await readdir(workloadRoot)) {
    if (existing !== agentName && existing.toLocaleLowerCase("en-US") === agentName.toLocaleLowerCase("en-US")) throw new TypeError("workload agent name case collision");
  }
  const foldedName = agentName.toLocaleLowerCase("en-US");
  const claimPath = path.join(workloadRoot, `.agent-name-${createHash("sha256").update(foldedName, "utf8").digest("hex")}.json`);
  const claim = JSON.stringify({ v: "reelier.workload-agent-name/v1", agentName });
  try {
    await writeFile(claimPath, claim, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let existing: unknown;
    try { existing = JSON.parse(await readFile(claimPath, "utf8")); } catch { throw new TypeError("workload agent name case collision"); }
    if (existing === null || typeof existing !== "object" || (existing as { v?: unknown }).v !== "reelier.workload-agent-name/v1" || (existing as { agentName?: unknown }).agentName !== agentName) throw new TypeError("workload agent name case collision");
  }
  return workloadRoot;
}

async function ensureRealDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError("workload key directory is unsafe or linked");
}
