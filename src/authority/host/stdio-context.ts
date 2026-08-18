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
export function validatePrivateStdioCredentialFileMetadata(metadata: Readonly<{ uid: number; mode: number }>, effectiveUid: number): void {
  if (!Number.isSafeInteger(effectiveUid) || effectiveUid < 0 || !Number.isSafeInteger(metadata.uid) || metadata.uid !== effectiveUid) throw new TypeError("stdio principal credential file owner is not the effective host UID");
  if (!Number.isSafeInteger(metadata.mode) || (metadata.mode & 0o077) !== 0) throw new TypeError("stdio principal credential file permissions are not private");
}
async function readStableCredential(file: string): Promise<string> {
  const resolved = path.resolve(file), canonical = await realpath(resolved);
  const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  if (normalize(canonical) !== normalize(resolved)) throw new Error("credential indirection is prohibited");
  const handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > 4096) throw new Error("credential file is invalid");
    const effectiveUid = process.platform === "linux" ? effectiveHostUid() : undefined;
    if (effectiveUid !== undefined) validatePrivateStdioCredentialFileMetadata(before, effectiveUid);
    const bytes = await handle.readFile(); const after = await handle.stat(); const current = await lstat(resolved);
    if (effectiveUid !== undefined) { validatePrivateStdioCredentialFileMetadata(after, effectiveUid); validatePrivateStdioCredentialFileMetadata(current, effectiveUid); }
    if (current.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.uid !== after.uid || before.mode !== after.mode || before.dev !== current.dev || before.ino !== current.ino || before.uid !== current.uid || before.mode !== current.mode) throw new Error("credential file changed");
    const value = bytes.toString("utf8").trim(); if (!value || value.includes("\0") || /[\r\n]/.test(value)) throw new Error("credential file is invalid"); return value;
  } finally { await handle.close(); }
}
function effectiveHostUid(): number { if (typeof process.geteuid !== "function") throw new Error("effective host UID is unavailable"); return process.geteuid(); }
