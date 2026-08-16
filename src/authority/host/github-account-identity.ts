import { authorityDigest } from "../wire.js";
import type { JsonHttpsRouteV1 } from "./json-https-route.js";

export interface AuthenticatedProviderIdentityV1 {
  readonly v: "reelier.authenticated-provider-identity/v1";
  readonly providerId: "github";
  readonly credentialSlotId: string;
  readonly slotInstanceId: string;
  readonly slotVersion: string;
  readonly slotExpiresAt: string;
  readonly providerAccountId: string;
  readonly providerLogin: string;
  readonly routeDigest: string;
  readonly observedAt: string;
  readonly signerId?: string;
  readonly signature?: unknown;
}
export interface GitHubIdentitySecretLease { readonly credentialSlotId?: string; readonly slotId?: string; readonly slotInstanceId: string; readonly slotVersion: string; readonly slotExpiresAt: string; readonly readOnce: () => string; }
export interface GitHubIdentityTransport { request(input: Readonly<{ route: JsonHttpsRouteV1; path: string; headers: Readonly<Record<string, string>>; token: string }>): Promise<Readonly<{ status: number; body: Uint8Array | string | unknown }>>; }
export interface IdentitySigner { sign(input: Readonly<{ purpose: "authority-evidence"; digest: string }>): Promise<Readonly<{ signerId: string; signature: unknown }>> | Readonly<{ signerId: string; signature: unknown }>; }

export async function probeGitHubAccountIdentity(input: Readonly<{ route: JsonHttpsRouteV1; secretLease: GitHubIdentitySecretLease; transport: GitHubIdentityTransport; signer?: IdentitySigner; now?: () => Date }>): Promise<AuthenticatedProviderIdentityV1> {
  if (!input?.route || input.route.providerId !== "github" || !input.secretLease || typeof input.secretLease.readOnce !== "function" || !input.transport || typeof input.transport.request !== "function") throw new TypeError("GitHub identity probe configuration is invalid");
  const leaseSlotId = input.secretLease.credentialSlotId ?? input.secretLease.slotId;
  if (leaseSlotId !== undefined && leaseSlotId !== input.route.credentialSlotId) throw new Error("credential slot lease does not match route");
  if (!input.secretLease.slotInstanceId || !input.secretLease.slotVersion) throw new Error("credential slot lease descriptor is invalid");
  const now = input.now?.() ?? new Date();
  if (!Number.isFinite(Date.parse(input.secretLease.slotExpiresAt)) || Date.parse(input.secretLease.slotExpiresAt) <= now.getTime()) throw new Error("credential slot lease expired");
  const token = input.secretLease.readOnce();
  if (!token) throw new Error("credential slot lease is empty");
  const response = await input.transport.request({ route: input.route, path: "/user", headers: { accept: "application/vnd.github+json" }, token });
  if (!response || response.status < 200 || response.status >= 300) throw new Error("GitHub identity probe refused");
  let body: unknown = response.body;
  if (body instanceof Uint8Array || typeof body === "string") { try { body = JSON.parse(Buffer.from(body as Uint8Array | string).toString("utf8")); } catch { throw new Error("GitHub identity response is invalid"); } }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("GitHub identity response is invalid");
  const raw = body as Record<string, unknown>;
  const providerAccountId = typeof raw.id === "number" && Number.isSafeInteger(raw.id) ? String(raw.id) : typeof raw.id === "string" ? raw.id : "";
  const providerLogin = typeof raw.login === "string" ? raw.login : "";
  if (!providerAccountId || !providerLogin) throw new Error("GitHub identity response lacks account identity");
  const identityMatches = input.route.providerAccountIdentity === providerLogin || input.route.providerAccountIdentity.endsWith(`:${providerLogin}`) || input.route.providerAccountIdentity === providerAccountId;
  if (input.route.accountId !== providerAccountId || !identityMatches) throw new Error("GitHub account identity mismatch");
  const identity = Object.freeze({ v: "reelier.authenticated-provider-identity/v1" as const, providerId: "github" as const, credentialSlotId: leaseSlotId ?? input.route.credentialSlotId, slotInstanceId: input.secretLease.slotInstanceId, slotVersion: input.secretLease.slotVersion, slotExpiresAt: input.secretLease.slotExpiresAt, providerAccountId, providerLogin, routeDigest: authorityDigest(input.route), observedAt: now.toISOString() });
  if (!input.signer) return identity;
  const signed = await input.signer.sign({ purpose: "authority-evidence", digest: authorityDigest(identity) });
  return Object.freeze({ ...identity, signerId: signed.signerId, signature: signed.signature });
}
