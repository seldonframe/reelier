import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
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
  const directory = path.join(homedir, ".reelier", "workloads", agentName);
  let publicPem: string | undefined;
  try {
    const files = (await readdir(directory)).filter(file => /^[0-9a-f]{16}\.pub\.pem$/.test(file)).sort();
    if (files.length > 0) publicPem = await readFile(path.join(directory, files[0]), "utf8");
  } catch {}
  if (publicPem === undefined) publicPem = (await generateSigningKeypair(directory)).publicPem;
  return Object.freeze({ v: "reelier.workload-registration-request/v1", agentName, publicKeyCommitment: `sha256:${createHash("sha256").update(publicPem, "utf8").digest("hex")}`, certification: "unsigned", activation: "absent", privateKeyIsolation: "posix-mode-0600-or-windows-acl-unchecked" });
}
