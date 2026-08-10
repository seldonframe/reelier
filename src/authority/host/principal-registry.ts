import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_PREFIX = "rat_";
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export interface PrincipalSessionContext {
  readonly tenant: string;
  readonly principalId: string;
  readonly taskId: string;
  readonly grantId: string;
  readonly grantDigest: string;
  readonly allocationId: string;
  readonly runtimeSessionId: string;
  readonly jobId: string;
  readonly authorityCellId: string;
  readonly expiresAt: string;
  readonly sessionTokenDigest: string;
}

export interface PrincipalCredentialIssue {
  readonly principalId: string;
  readonly taskId: string;
  readonly grantId: string;
  readonly grantDigest: string;
  readonly allocationId: string;
  readonly runtimeSessionId: string;
  readonly jobId: string;
  readonly authorityCellId: string;
  readonly expiresAt: string;
}

export interface PrincipalCredential {
  readonly token: string;
  readonly context: PrincipalSessionContext;
}

export interface PrincipalRegistry {
  issue(input: PrincipalCredentialIssue): Promise<PrincipalCredential>;
  resolve(token: string, now?: Date): Promise<PrincipalSessionContext>;
  revoke(sessionTokenDigest: string): Promise<void>;
  revokeTask(taskId: string): Promise<void>;
}

/**
 * Resolves short-lived ingress credentials to a task-scoped principal.
 *
 * The current implementation is deliberately process-local; the managed
 * Authority Cell replaces the backing map with its durable encrypted session
 * store. The public behavior is already fail-closed and never stores the raw
 * bearer token.
 */
export function createPrincipalRegistry(options: Readonly<{ tenant: string }>): PrincipalRegistry {
  assertId(options.tenant, "tenant");
  const sessions = new Map<string, PrincipalSessionContext & { revoked: boolean }>();

  return Object.freeze({
    async issue(input: PrincipalCredentialIssue): Promise<PrincipalCredential> {
      assertId(input.principalId, "principalId");
      assertId(input.taskId, "taskId");
      assertId(input.grantId, "grantId");
      assertDigest(input.grantDigest, "grantDigest");
      assertId(input.allocationId, "allocationId");
      assertId(input.runtimeSessionId, "runtimeSessionId");
      assertId(input.jobId, "jobId");
      assertId(input.authorityCellId, "authorityCellId");
      const expiresAt = parseExpiry(input.expiresAt);
      const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
      const sessionTokenDigest = digestToken(token);
      const context: PrincipalSessionContext = Object.freeze({
        tenant: options.tenant,
        principalId: input.principalId,
        taskId: input.taskId,
        grantId: input.grantId,
        grantDigest: input.grantDigest,
        allocationId: input.allocationId,
        runtimeSessionId: input.runtimeSessionId,
        jobId: input.jobId,
        authorityCellId: input.authorityCellId,
        expiresAt: expiresAt.toISOString(),
        sessionTokenDigest,
      });
      sessions.set(sessionTokenDigest, { ...context, revoked: false });
      return Object.freeze({ token, context });
    },

    async resolve(token: string, now = new Date()): Promise<PrincipalSessionContext> {
      if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX)) throw new TypeError("invalid principal credential");
      const digest = digestToken(token);
      const stored = sessions.get(digest);
      if (!stored || !constantTimeDigestEqual(digest, stored.sessionTokenDigest)) throw new TypeError("invalid principal credential");
      if (stored.revoked) throw new TypeError("principal credential revoked");
      if (now.getTime() >= Date.parse(stored.expiresAt)) throw new TypeError("principal credential expired");
      const { revoked: _revoked, ...context } = stored;
      return Object.freeze(context);
    },

    async revoke(sessionTokenDigest: string): Promise<void> {
      if (!DIGEST.test(sessionTokenDigest)) throw new TypeError("invalid principal credential digest");
      const stored = sessions.get(sessionTokenDigest);
      if (!stored) return;
      stored.revoked = true;
    },

    async revokeTask(taskId: string): Promise<void> {
      assertId(taskId, "taskId");
      for (const stored of sessions.values()) if (stored.taskId === taskId) stored.revoked = true;
    },
  });
}

function digestToken(token: string): string {
  return `sha256:${createHash("sha256").update(token, "utf8").digest("hex")}`;
}

function constantTimeDigestEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function assertId(value: string, label: string): void {
  if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`${label} is invalid`);
}

function assertDigest(value: string, label: string): void {
  if (typeof value !== "string" || !DIGEST.test(value)) throw new TypeError(`${label} is invalid`);
}

function parseExpiry(value: string): Date {
  if (typeof value !== "string") throw new TypeError("expiresAt is invalid");
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || epoch <= 0) throw new TypeError("expiresAt is invalid");
  return new Date(epoch);
}
