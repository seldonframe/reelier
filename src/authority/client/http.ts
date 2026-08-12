import { lstat, readFile } from "node:fs/promises";
import { parseAuthorityCellConnectionV1, type AuthorityCellConnectionV1 } from "./config.js";

export type AuthorityCellLiveResult = Readonly<{ state: "verified" | "failed" | "unchecked" | "absent"; reasonCode: string; cellId?: string; adapterContractDigest?: string }>;
export interface AuthorityCellClientDependencies { readonly resolveToken?: (reference: AuthorityCellConnectionV1["bearerTokenRef"]) => Promise<string>; readonly request?: (url: string, init: RequestInit) => Promise<Response>; }

/** Client-only live identity check. The token is resolved only here and never returned or logged. */
export async function checkAuthorityCellLive(value: unknown, dependencies: AuthorityCellClientDependencies = {}): Promise<AuthorityCellLiveResult> {
  let connection: AuthorityCellConnectionV1;
  try { connection = parseAuthorityCellConnectionV1(value); } catch { return { state: "failed", reasonCode: "connection-invalid" }; }
  try {
    const token = await (dependencies.resolveToken ?? resolveToken)(connection.bearerTokenRef);
    const response = await (dependencies.request ?? fetch)(`${connection.endpoint}/v1/identity`, { method: "GET", headers: { authorization: `Bearer ${token}`, accept: "application/json" }, redirect: "error" });
    if (!response.ok) return { state: "failed", reasonCode: response.status === 401 ? "authentication-failed" : "identity-unavailable" };
    const identity = await response.json() as Record<string, unknown>;
    if (identity.v !== "reelier.authority-cell-identity/v1" || typeof identity.cellId !== "string" || typeof identity.adapterContractDigest !== "string") return { state: "failed", reasonCode: "identity-invalid" };
    if (identity.cellId !== connection.expectedCellId) return { state: "failed", reasonCode: "cell-id-mismatch", cellId: identity.cellId };
    if (identity.adapterContractDigest !== connection.adapterContractDigest) return { state: "failed", reasonCode: "adapter-contract-mismatch", cellId: identity.cellId, adapterContractDigest: identity.adapterContractDigest };
    return { state: "verified", reasonCode: "identity-verified", cellId: identity.cellId, adapterContractDigest: identity.adapterContractDigest };
  } catch { return { state: "failed", reasonCode: "identity-unavailable" }; }
}

async function resolveToken(reference: AuthorityCellConnectionV1["bearerTokenRef"]): Promise<string> {
  if (reference.startsWith("env:")) { const value = process.env[reference.slice(4)]; if (!value) throw new Error("unavailable"); return value; }
  const file = reference.slice(5); const stat = await lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("unavailable");
  const value = (await readFile(file, "utf8")).trim(); if (!value) throw new Error("unavailable"); return value;
}
