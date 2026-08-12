import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

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

type PrincipalRegistryEvent =
  | Readonly<{ v: "reelier.principal-registry-event/v1"; kind: "issued"; context: PrincipalSessionContext }>
  | Readonly<{ v: "reelier.principal-registry-event/v1"; kind: "revoked"; sessionTokenDigest: string }>
  | Readonly<{ v: "reelier.principal-registry-event/v1"; kind: "task-revoked"; taskId: string }>;

/**
 * Append-only principal registry for an Authority Cell.
 *
 * Raw bearer values are returned once to the credential installer and are
 * never serialized. A malformed or partial event makes every subsequent
 * operation fail closed rather than silently dropping revocation history.
 */
export function createFilePrincipalRegistry(options: Readonly<{ tenant: string; file: string }>): PrincipalRegistry {
  assertId(options.tenant, "tenant");
  const file = path.resolve(options.file);
  const lock = `${file}.lock`;
  let writer = Promise.resolve();

  const append = async (event: PrincipalRegistryEvent): Promise<void> => {
    const operation = writer.then(async () => {
      const release = await acquireFileLock();
      try { await appendUnlocked(event); } finally { await release(); }
    });
    writer = operation.catch(() => {});
    await operation;
  };

  const appendUnlocked = async (event: PrincipalRegistryEvent): Promise<void> => {
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  };

  const load = async (): Promise<Readonly<{ sessions: Map<string, PrincipalSessionContext & { revoked: boolean }>; revokedTasks: Set<string> }>> => {
    await writer;
    let raw: string;
    try { raw = await readFile(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { sessions: new Map(), revokedTasks: new Set() }; throw error; }
    if (raw.length > 0 && !raw.endsWith("\n")) throw new TypeError("principal registry is corrupt");
    const sessions = new Map<string, PrincipalSessionContext & { revoked: boolean }>();
    const revokedTasks = new Set<string>();
    for (const line of raw.split("\n")) {
      if (!line) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { throw new TypeError("principal registry is corrupt"); }
      const event = parseRegistryEvent(parsed, options.tenant);
      if (event.kind === "issued") {
        if (sessions.has(event.context.sessionTokenDigest)) throw new TypeError("principal registry is corrupt");
        sessions.set(event.context.sessionTokenDigest, { ...event.context, revoked: revokedTasks.has(event.context.taskId) });
      } else if (event.kind === "revoked") {
        const existing = sessions.get(event.sessionTokenDigest);
        if (existing) existing.revoked = true;
      } else {
        revokedTasks.add(event.taskId);
        for (const existing of sessions.values()) if (existing.taskId === event.taskId) existing.revoked = true;
      }
    }
    return { sessions, revokedTasks };
  };

  return Object.freeze({
    async issue(input: PrincipalCredentialIssue): Promise<PrincipalCredential> {
      validateIssue(input);
      const operation = writer.then(async () => {
        const release = await acquireFileLock();
        try {
          const current = await loadUnlocked();
          if (current.revokedTasks.has(input.taskId)) throw new TypeError("principal task is revoked");
          if ([...current.sessions.values()].some(existing => existing.runtimeSessionId === input.runtimeSessionId && !existing.revoked)) throw new TypeError("active runtime session already has a principal credential");
          const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
          const context: PrincipalSessionContext = Object.freeze({ tenant: options.tenant, principalId: input.principalId, taskId: input.taskId, grantId: input.grantId, grantDigest: input.grantDigest, allocationId: input.allocationId, runtimeSessionId: input.runtimeSessionId, jobId: input.jobId, authorityCellId: input.authorityCellId, expiresAt: parseExpiry(input.expiresAt).toISOString(), sessionTokenDigest: digestToken(token) });
          await appendUnlocked({ v: "reelier.principal-registry-event/v1", kind: "issued", context });
          return Object.freeze({ token, context });
        } finally { await release(); }
      });
      writer = operation.then(() => undefined, () => undefined);
      return operation;
    },
    async resolve(token: string, now = new Date()): Promise<PrincipalSessionContext> {
      if (typeof token !== "string" || !token.startsWith(TOKEN_PREFIX)) throw new TypeError("invalid principal credential");
      const digest = digestToken(token);
      const stored = (await load()).sessions.get(digest);
      if (!stored || !constantTimeDigestEqual(digest, stored.sessionTokenDigest)) throw new TypeError("invalid principal credential");
      if (stored.revoked) throw new TypeError("principal credential revoked");
      if (now.getTime() >= Date.parse(stored.expiresAt)) throw new TypeError("principal credential expired");
      const { revoked: _revoked, ...context } = stored;
      return Object.freeze(context);
    },
    async revoke(sessionTokenDigest: string): Promise<void> { assertDigest(sessionTokenDigest, "sessionTokenDigest"); await load(); await append({ v: "reelier.principal-registry-event/v1", kind: "revoked", sessionTokenDigest }); },
    async revokeTask(taskId: string): Promise<void> { assertId(taskId, "taskId"); await load(); await append({ v: "reelier.principal-registry-event/v1", kind: "task-revoked", taskId }); },
  });

  async function loadUnlocked(): Promise<Readonly<{ sessions: Map<string, PrincipalSessionContext & { revoked: boolean }>; revokedTasks: Set<string> }>> {
    let raw: string;
    try { raw = await readFile(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { sessions: new Map(), revokedTasks: new Set() }; throw error; }
    return parseRegistry(raw, options.tenant);
  }

  async function acquireFileLock(): Promise<() => Promise<void>> {
    await mkdir(path.dirname(file), { recursive: true });
    const started = Date.now();
    for (;;) {
      try { await mkdir(lock); return async () => { await rm(lock, { recursive: true, force: true }); }; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try { if (Date.now() - (await stat(lock)).mtimeMs > 20_000) await rm(lock, { recursive: true, force: true }); } catch { /* another writer owns it */ }
        if (Date.now() - started > 10_000) throw new Error("principal registry busy");
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    }
  }
}

function parseRegistry(raw: string, tenant: string): Readonly<{ sessions: Map<string, PrincipalSessionContext & { revoked: boolean }>; revokedTasks: Set<string> }> {
  if (raw.length > 0 && !raw.endsWith("\n")) throw new TypeError("principal registry is corrupt");
  const sessions = new Map<string, PrincipalSessionContext & { revoked: boolean }>();
  const revokedTasks = new Set<string>();
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { throw new TypeError("principal registry is corrupt"); }
    const event = parseRegistryEvent(parsed, tenant);
    if (event.kind === "issued") { if (sessions.has(event.context.sessionTokenDigest)) throw new TypeError("principal registry is corrupt"); sessions.set(event.context.sessionTokenDigest, { ...event.context, revoked: revokedTasks.has(event.context.taskId) }); }
    else if (event.kind === "revoked") { const existing = sessions.get(event.sessionTokenDigest); if (existing) existing.revoked = true; }
    else { revokedTasks.add(event.taskId); for (const existing of sessions.values()) if (existing.taskId === event.taskId) existing.revoked = true; }
  }
  return { sessions, revokedTasks };
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

function validateIssue(input: PrincipalCredentialIssue): void {
  assertId(input.principalId, "principalId"); assertId(input.taskId, "taskId"); assertId(input.grantId, "grantId"); assertDigest(input.grantDigest, "grantDigest"); assertId(input.allocationId, "allocationId"); assertId(input.runtimeSessionId, "runtimeSessionId"); assertId(input.jobId, "jobId"); assertId(input.authorityCellId, "authorityCellId"); parseExpiry(input.expiresAt);
}

function parseRegistryEvent(value: unknown, tenant: string): PrincipalRegistryEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("principal registry is corrupt");
  const raw = value as Record<string, unknown>;
  if (raw.v !== "reelier.principal-registry-event/v1" || typeof raw.kind !== "string") throw new TypeError("principal registry is corrupt");
  if (raw.kind === "issued") {
    if (Object.keys(raw).length !== 3 || !raw.context || typeof raw.context !== "object" || Array.isArray(raw.context)) throw new TypeError("principal registry is corrupt");
    const context = raw.context as Record<string, unknown>;
    const keys = ["tenant", "principalId", "taskId", "grantId", "grantDigest", "allocationId", "runtimeSessionId", "jobId", "authorityCellId", "expiresAt", "sessionTokenDigest"];
    if (Object.keys(context).length !== keys.length || Object.keys(context).some(key => !keys.includes(key)) || context.tenant !== tenant) throw new TypeError("principal registry is corrupt");
    validateIssue(context as unknown as PrincipalCredentialIssue); assertDigest(String(context.sessionTokenDigest), "sessionTokenDigest");
    return Object.freeze({ v: "reelier.principal-registry-event/v1", kind: "issued", context: Object.freeze(context as unknown as PrincipalSessionContext) });
  }
  if (raw.kind === "revoked") { if (Object.keys(raw).length !== 3 || typeof raw.sessionTokenDigest !== "string") throw new TypeError("principal registry is corrupt"); assertDigest(raw.sessionTokenDigest, "sessionTokenDigest"); return Object.freeze({ v: "reelier.principal-registry-event/v1", kind: "revoked", sessionTokenDigest: raw.sessionTokenDigest }); }
  if (raw.kind === "task-revoked") { if (Object.keys(raw).length !== 3 || typeof raw.taskId !== "string") throw new TypeError("principal registry is corrupt"); assertId(raw.taskId, "taskId"); return Object.freeze({ v: "reelier.principal-registry-event/v1", kind: "task-revoked", taskId: raw.taskId }); }
  throw new TypeError("principal registry is corrupt");
}
