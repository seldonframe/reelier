import { readFile } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../wire.js";
import type { JsonHttpsEndpoint } from "../drivers/json-https.js";

export interface AuthorityHostConfig {
  readonly version: 1;
  readonly tenant: string;
  readonly requester: string;
  readonly definitions: readonly string[];
  readonly ingress?: { readonly bearerRef?: string; readonly allowedRequester?: string };
  readonly topology?: "isolated" | "same-user" | "unknown";
  readonly ledgerDir: string;
  readonly decisionDir: string;
  readonly receiptDir: string;
  readonly endpoints: readonly JsonHttpsEndpoint[];
  readonly cloud?: { readonly baseUrl: string; readonly tokenRef: string };
}

export async function loadAuthorityHostConfig(file = "authority/authority.yml"): Promise<Readonly<{ config: AuthorityHostConfig; digest: string; file: string }>> {
  const resolved = path.resolve(file);
  const raw = await readFile(resolved, "utf8");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = parseSimpleYaml(raw); }
  const config = validateConfig(parsed, path.dirname(resolved));
  return Object.freeze({ config, digest: authorityDigest(config), file: resolved });
}

export function validateAuthorityHostConfig(value: unknown, baseDir = process.cwd()): AuthorityHostConfig { return validateConfig(value, baseDir); }

function validateConfig(value: unknown, baseDir: string): AuthorityHostConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("authority config must be an object");
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || typeof raw.tenant !== "string" || !raw.tenant || typeof raw.requester !== "string" || !raw.requester) throw new TypeError("authority config requires version, tenant, and requester");
  const definitions = list(raw.definitions, "definitions");
  const endpoints = Array.isArray(raw.endpoints) ? raw.endpoints.map(item => validateEndpoint(item)) : [];
  const resolvePath = (item: unknown, fallback: string) => path.resolve(baseDir, typeof item === "string" && item ? item : fallback);
  const ingress = raw.ingress === undefined ? undefined : validateIngress(raw.ingress);
  const topology = raw.topology === undefined ? "unknown" : raw.topology;
  if (topology !== "isolated" && topology !== "same-user" && topology !== "unknown") throw new TypeError("invalid authority topology");
  const cloud = raw.cloud === undefined ? undefined : validateCloud(raw.cloud);
  return Object.freeze({ version: 1, tenant: raw.tenant, requester: raw.requester, definitions, ingress, topology, ledgerDir: resolvePath(raw.ledgerDir, ".authority/ledger"), decisionDir: resolvePath(raw.decisionDir, ".authority/decisions"), receiptDir: resolvePath(raw.receiptDir, ".authority/receipts"), endpoints, cloud });
}

function validateEndpoint(value: unknown): JsonHttpsEndpoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("endpoint must be an object");
  const raw = value as Record<string, unknown>;
  if (typeof raw.endpointId !== "string" || !raw.endpointId || typeof raw.baseUrl !== "string" || !raw.baseUrl || typeof raw.accountIdentity !== "string" || !raw.accountIdentity) throw new TypeError("endpoint requires endpointId, baseUrl, and accountIdentity");
  const methods = list(raw.allowedMethods, "allowedMethods") as JsonHttpsEndpoint["allowedMethods"];
  const prefixes = list(raw.allowedPathPrefixes, "allowedPathPrefixes");
  if (!methods.length || !prefixes.length) throw new TypeError("endpoint methods and path prefixes are required");
  for (const method of methods) if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) throw new TypeError("invalid endpoint method");
  return Object.freeze({ endpointId: raw.endpointId, baseUrl: raw.baseUrl, allowedMethods: Object.freeze([...methods]), allowedPathPrefixes: Object.freeze([...prefixes]), accountIdentity: raw.accountIdentity, ...(typeof raw.secretRef === "string" ? { secretRef: raw.secretRef } : {}) });
}
function validateIngress(value: unknown): AuthorityHostConfig["ingress"] { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("ingress must be an object"); const raw = value as Record<string, unknown>; if (raw.bearerRef !== undefined && typeof raw.bearerRef !== "string") throw new TypeError("invalid ingress bearer reference"); if (raw.allowedRequester !== undefined && typeof raw.allowedRequester !== "string") throw new TypeError("invalid ingress requester"); return Object.freeze({ ...(raw.bearerRef ? { bearerRef: raw.bearerRef } : {}), ...(raw.allowedRequester ? { allowedRequester: raw.allowedRequester } : {}) }); }
function validateCloud(value: unknown): NonNullable<AuthorityHostConfig["cloud"]> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("cloud must be an object"); const raw = value as Record<string, unknown>; if (typeof raw.baseUrl !== "string" || !raw.baseUrl || typeof raw.tokenRef !== "string" || !raw.tokenRef) throw new TypeError("cloud requires baseUrl and tokenRef"); return Object.freeze({ baseUrl: raw.baseUrl, tokenRef: raw.tokenRef }); }
function list(value: unknown, label: string): string[] { if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item) || new Set(value).size !== value.length) throw new TypeError(`${label} must be a unique string array`); return [...value]; }

/** Small dependency-free YAML subset for the conventional authority.yml file. JSON remains the canonical emitted form. */
function parseSimpleYaml(raw: string): unknown {
  const lines = raw.split(/\r?\n/).map(line => line.replace(/\s+#.*$/, "")).filter(line => line.trim().length > 0);
  if (!lines.length) throw new TypeError("authority.yml is empty");
  const root: Record<string, unknown> = {};
  const stack: Array<{ indent: number; value: Record<string, unknown> | unknown[] }> = [{ indent: -1, value: root }];
  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    const text = line.trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;
    if (text.startsWith("- ")) {
      if (!Array.isArray(parent)) throw new TypeError("invalid authority.yml list indentation");
      parent.push(parseYamlScalar(text.slice(2).trim()));
      continue;
    }
    const colon = text.indexOf(":");
    if (colon <= 0 || Array.isArray(parent)) throw new TypeError("invalid authority.yml mapping");
    const key = text.slice(0, colon).trim();
    const rest = text.slice(colon + 1).trim();
    if (rest) { parent[key] = parseYamlScalar(rest); continue; }
    const next = lines.find(candidate => candidate !== line && (candidate.length - candidate.trimStart().length) > indent && candidate.trim().length > 0);
    const childIsList = !!next && next.trimStart().startsWith("-");
    const child: Record<string, unknown> | unknown[] = childIsList ? [] : {};
    parent[key] = child;
    stack.push({ indent, value: child });
  }
  return root;
}
function parseYamlScalar(value: string): unknown {
  if (value === "true") return true; if (value === "false") return false; if (value === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if ((value.startsWith("[") && value.endsWith("]")) || (value.startsWith("{") && value.endsWith("}"))) { try { return JSON.parse(value); } catch { /* fall through */ } }
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) return value.slice(1, -1);
  return value;
}
