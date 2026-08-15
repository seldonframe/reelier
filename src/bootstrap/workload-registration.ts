import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir } from "node:fs/promises";
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

export async function prepareWorkloadRegistration(homedir: string, agentName: string): Promise<WorkloadRegistrationRequest> {
  const reelierRoot = path.join(homedir, ".reelier");
  const workloadRoot = path.join(reelierRoot, "workloads");
  await ensureRealDirectory(reelierRoot);
  await ensureRealDirectory(workloadRoot);
  for (const existing of await readdir(workloadRoot)) {
    if (existing !== agentName && existing.toLocaleLowerCase("en-US") === agentName.toLocaleLowerCase("en-US")) throw new TypeError("workload agent name case collision");
  }
  const directory = path.join(workloadRoot, agentName);
  await ensureRealDirectory(directory);
  let publicPem: string | undefined;
  try {
    const files = (await readdir(directory)).filter(file => /^[0-9a-f]{16}\.pub\.pem$/.test(file)).sort();
    if (files.length > 0) publicPem = await readFile(path.join(directory, files[0]), "utf8");
  } catch {}
  if (publicPem === undefined) publicPem = (await generateSigningKeypair(directory)).publicPem;
  return Object.freeze({ v: "reelier.workload-registration-request/v1", agentName, publicKeyCommitment: `sha256:${createHash("sha256").update(publicPem, "utf8").digest("hex")}`, certification: "unsigned", activation: "absent", privateKeyIsolation: "posix-mode-0600-or-windows-acl-unchecked" });
}

async function ensureRealDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError("workload key directory is unsafe or linked");
}
