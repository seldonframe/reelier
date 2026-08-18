import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import type { AuthorityExecutionContextV1 } from "../types.js";
import type { AuthorityHostConfig } from "./config.js";
import type { PrincipalRegistry } from "./principal-registry.js";

export interface AuthorityServeStdioContextRuntime { readonly env?: Readonly<Record<string, string | undefined>>; }

export async function composeAuthorityServeStdioRuntime<T extends Readonly<{ requiresAuthenticatedExecutionContext?: boolean }>>(config: AuthorityHostConfig, registry: PrincipalRegistry | undefined, createRuntime: (context: AuthorityExecutionContextV1 | undefined) => Promise<T>, runtime: AuthorityServeStdioContextRuntime = {}): Promise<Readonly<{ executionContext: AuthorityExecutionContextV1 | undefined; runtime: T }>> {
  const executionContext = await resolveAuthorityServeStdioExecutionContext(config, registry, runtime);
  const authorityRuntime = await createRuntime(executionContext);
  if (authorityRuntime.requiresAuthenticatedExecutionContext && !executionContext) throw new TypeError("signed multi-definition stdio requires an authenticated principal credential reference");
  return Object.freeze({ executionContext, runtime: authorityRuntime });
}

/** Resolve one host-owned short-lived principal credential before stdio MCP construction. */
export async function resolveAuthorityServeStdioExecutionContext(config: AuthorityHostConfig, registry: PrincipalRegistry | undefined, runtime: AuthorityServeStdioContextRuntime = {}): Promise<AuthorityExecutionContextV1 | undefined> {
  const reference = config.ingress?.stdioPrincipalCredentialRef;
  if (!reference) return undefined;
  if (!registry || !config.ingress?.principalRegistryFile) throw new TypeError("stdio principal registry is unavailable");
  let token: string;
  try { token = reference.startsWith("env:") ? resolveEnvironment(reference, runtime.env ?? process.env) : await readStableCredential(reference.slice(5)); }
  catch { throw new TypeError("stdio principal credential is unavailable"); }
  let principal;
  try { principal = await registry.resolve(token); }
  catch { throw new TypeError("stdio principal credential is invalid, expired, or revoked"); }
  if (!config.authorityCellId || principal.tenant !== config.tenant || principal.principalId !== config.requester || principal.authorityCellId !== config.authorityCellId) throw new TypeError("stdio principal identity does not match host tenant, requester, or Authority Cell");
  return Object.freeze({ v: "reelier.authority-execution-context/v1", taskId: principal.taskId, principalId: principal.principalId, grantId: principal.grantId, grantDigest: principal.grantDigest, allocationId: principal.allocationId, runtimeSessionId: principal.runtimeSessionId, jobId: principal.jobId, authorityCellId: principal.authorityCellId });
}

function resolveEnvironment(reference: string, env: Readonly<Record<string, string | undefined>>): string { const value = env[reference.slice(4)]; if (!value || value.includes("\0") || /[\r\n]/.test(value)) throw new Error("unavailable"); return value; }
async function readStableCredential(file: string): Promise<string> {
  const resolved = path.resolve(file), canonical = await realpath(resolved);
  const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  if (normalize(canonical) !== normalize(resolved)) throw new Error("credential indirection is prohibited");
  const handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 4096) throw new Error("credential file is invalid");
    const bytes = await handle.readFile(); const after = await handle.stat(); const current = await lstat(resolved);
    if (current.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.dev !== current.dev || before.ino !== current.ino) throw new Error("credential file changed");
    const value = bytes.toString("utf8").trim(); if (!value || value.includes("\0") || /[\r\n]/.test(value)) throw new Error("credential file is invalid"); return value;
  } finally { await handle.close(); }
}
