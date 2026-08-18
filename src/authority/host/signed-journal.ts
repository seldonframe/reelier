import type { KeyObject } from "node:crypto";
import { open, mkdir, readdir, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { authorityCanonicalBytes, authorityDigest } from "../wire.js";
import { signAuthorityDigest, verifyAuthoritySignature } from "../crypto.js";
import type { AuthoritySignature } from "../types.js";

export interface SignedJournalEventV1 {
  readonly v: "reelier.signed-journal-event/v1";
  readonly data: Readonly<Record<string, unknown>>;
  readonly digest: string;
  readonly phase: string;
  readonly priorDigest: string | null;
  readonly requestId: string;
  readonly semanticsDigest: string;
  readonly sequence: number;
  readonly signature: AuthoritySignature;
  readonly signerId: string;
}

export interface SignedJournal {
  append(requestId: string, semanticsDigest: string, phase: string, data: Readonly<Record<string, unknown>>): Promise<SignedJournalEventV1>;
  load(requestId: string): Promise<readonly SignedJournalEventV1[]>;
  listRequestIds(): Promise<readonly string[]>;
  withLease<T>(scope: string, operation: () => Promise<T>): Promise<T>;
}

export async function createSignedJournal(input: Readonly<{ rootDir: string; journalId: string; signerId: string; privateKey: KeyObject; publicKey: KeyObject }>): Promise<SignedJournal> {
  if (!path.isAbsolute(input.rootDir) || !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(input.journalId) || !/^[a-z0-9][a-z0-9._:-]{7,127}$/.test(input.signerId)) throw new TypeError("signed journal identity is invalid");
  await mkdir(input.rootDir, { recursive: true });
  const directoryFor = (requestId: string) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(requestId)) throw new TypeError("journal request identity is invalid");
    return path.join(input.rootDir, authorityDigest({ journalId: input.journalId, requestId }).slice(7));
  };
  const load = async (requestId: string): Promise<readonly SignedJournalEventV1[]> => {
    const directory = directoryFor(requestId);
    let names: string[];
    try { names = await readdir(directory); } catch (error: any) { if (error?.code === "ENOENT") return Object.freeze([]); throw error; }
    const eventNames = names.filter(name => /^event-\d{8}\.json$/.test(name)).sort();
    const events: SignedJournalEventV1[] = [];
    let priorDigest: string | null = null;
    let semanticsDigest: string | null = null;
    for (let sequence = 0; sequence < eventNames.length; sequence += 1) {
      if (eventNames[sequence] !== `event-${String(sequence).padStart(8, "0")}.json`) throw new TypeError("signed journal fork or sequence gap detected");
      const parsed = JSON.parse(await readFile(path.join(directory, eventNames[sequence]), "utf8")) as SignedJournalEventV1;
      const unsigned = parseEvent(parsed, requestId, sequence, priorDigest, semanticsDigest);
      const digest = authorityDigest(unsigned);
      if (parsed.digest !== digest || parsed.signerId !== input.signerId || !verifyAuthoritySignature(input.publicKey, "authority-journal", digest, parsed.signature)) throw new TypeError("signed journal digest, signature, or tamper check failed");
      semanticsDigest ??= parsed.semanticsDigest;
      priorDigest = parsed.digest;
      events.push(Object.freeze(parsed));
    }
    await reconcileHead(directory, events);
    return Object.freeze(events);
  };
  const append = async (requestId: string, semanticsDigest: string, phase: string, data: Readonly<Record<string, unknown>>): Promise<SignedJournalEventV1> => {
    if (!/^sha256:[0-9a-f]{64}$/.test(semanticsDigest) || typeof phase !== "string" || phase.length === 0 || phase.length > 64 || !data || typeof data !== "object" || Array.isArray(data)) throw new TypeError("signed journal append is invalid");
    const directory = directoryFor(requestId);
    await mkdir(directory, { recursive: true });
    return withExclusiveLock(directory, async () => {
      const events = await load(requestId);
      if (events.length > 0 && events[0].semanticsDigest !== semanticsDigest) throw new TypeError("journal request semantic reuse is forbidden");
      const sequence = events.length;
      const unsigned = Object.freeze({ v: "reelier.signed-journal-event/v1" as const, data, phase, priorDigest: events.at(-1)?.digest ?? null, requestId, semanticsDigest, sequence });
      const digest = authorityDigest(unsigned);
      const event: SignedJournalEventV1 = Object.freeze({ ...unsigned, digest, signature: signAuthorityDigest(input.privateKey, "authority-journal", digest), signerId: input.signerId });
      const head = Object.freeze({ digest, sequence });
      const pendingPath = path.join(directory, "head.pending");
      await writeExclusiveFsync(pendingPath, authorityCanonicalBytes(head));
      await writeExclusiveFsync(path.join(directory, `event-${String(sequence).padStart(8, "0")}.json`), authorityCanonicalBytes(event));
      await rename(pendingPath, path.join(directory, "head.json"));
      await fsyncDirectory(directory);
      return event;
    });
  };
  const listRequestIds = async (): Promise<readonly string[]> => {
    const requestIds: string[] = [];
    for (const name of await readdir(input.rootDir)) {
      if (!/^[0-9a-f]{64}$/.test(name)) continue;
      try {
        const first = JSON.parse(await readFile(path.join(input.rootDir, name, "event-00000000.json"), "utf8")) as SignedJournalEventV1;
        await load(first.requestId);
        requestIds.push(first.requestId);
      } catch (error: any) { if (error?.code !== "ENOENT") throw error; }
    }
    return Object.freeze(requestIds.sort());
  };
  const withLease = async <T>(scope: string, operation: () => Promise<T>): Promise<T> => {
    if (!/^[a-z0-9][a-z0-9._-]{7,127}$/.test(scope)) throw new TypeError("signed journal lease scope is invalid");
    const leasePath = path.join(input.rootDir, `${authorityDigest({ journalId: input.journalId, scope }).slice(7)}.lease`);
    const started = Date.now();
    for (;;) {
      let handle;
      try {
        handle = await open(leasePath, "wx", 0o600);
        await handle.writeFile(authorityCanonicalBytes({ pid: process.pid, acquiredAt: new Date().toISOString(), scope }));
        await handle.sync();
        try { return await operation(); }
        finally { await handle.close(); await unlink(leasePath).catch(() => undefined); await fsyncDirectory(input.rootDir); }
      } catch (error: any) {
        if (handle) await handle.close().catch(() => undefined);
        if (error?.code !== "EEXIST") throw error;
        if (await retireDeadLease(leasePath)) continue;
        if (Date.now() - started > 10_000) throw new TypeError("signed journal saga lease is busy");
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    }
  };
  return Object.freeze({ append, listRequestIds, load, withLease });
}

async function retireDeadLease(leasePath: string): Promise<boolean> {
  let value: unknown;
  try { value = JSON.parse(await readFile(leasePath, "utf8")); } catch { return false; }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\0") !== ["acquiredAt", "pid", "scope"].sort().join("\0")) return false;
  const pid = Number((value as Record<string, unknown>).pid);
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return false; }
  catch (error: any) { if (error?.code !== "ESRCH") return false; }
  try { await unlink(leasePath); return true; } catch (error: any) { return error?.code === "ENOENT"; }
}

function parseEvent(value: SignedJournalEventV1, requestId: string, sequence: number, priorDigest: string | null, semanticsDigest: string | null): Omit<SignedJournalEventV1, "digest" | "signature" | "signerId"> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join("\0") !== ["data", "digest", "phase", "priorDigest", "requestId", "semanticsDigest", "sequence", "signature", "signerId", "v"].sort().join("\0")) throw new TypeError("signed journal event is not closed");
  if (value.v !== "reelier.signed-journal-event/v1" || value.requestId !== requestId || value.sequence !== sequence || value.priorDigest !== priorDigest || (semanticsDigest !== null && value.semanticsDigest !== semanticsDigest)) throw new TypeError("signed journal rollback, fork, or semantic mismatch detected");
  return { v: value.v, data: value.data, phase: value.phase, priorDigest: value.priorDigest, requestId: value.requestId, semanticsDigest: value.semanticsDigest, sequence: value.sequence };
}

async function reconcileHead(directory: string, events: readonly SignedJournalEventV1[]): Promise<void> {
  const expected = events.length === 0 ? null : { digest: events.at(-1)!.digest, sequence: events.length - 1 };
  const pendingPath = path.join(directory, "head.pending");
  let pending: any = null;
  try { pending = JSON.parse(await readFile(pendingPath, "utf8")); } catch (error: any) { if (error?.code !== "ENOENT") throw new TypeError("signed journal pending head is invalid"); }
  if (pending !== null) {
    if (expected && pending.digest === expected.digest && pending.sequence === expected.sequence) { await rename(pendingPath, path.join(directory, "head.json")); await fsyncDirectory(directory); }
    else await unlink(pendingPath);
  }
  let head: any = null;
  try { head = JSON.parse(await readFile(path.join(directory, "head.json"), "utf8")); } catch (error: any) { if (error?.code !== "ENOENT") throw new TypeError("signed journal head is invalid"); }
  if ((expected === null) !== (head === null) || (expected && (head.digest !== expected.digest || head.sequence !== expected.sequence))) throw new TypeError("signed journal atomic head rollback or fork detected");
}

async function withExclusiveLock<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = path.join(directory, "request.lock");
  let handle;
  try { handle = await open(lockPath, "wx", 0o600); } catch (error: any) { if (error?.code === "EEXIST") throw new TypeError("signed journal request is already locked"); throw error; }
  try { await handle.sync(); return await operation(); } finally { await handle.close(); await unlink(lockPath).catch(() => undefined); }
}
async function writeExclusiveFsync(file: string, bytes: Uint8Array): Promise<void> { const handle = await open(file, "wx", 0o600); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); } }
async function fsyncDirectory(directory: string): Promise<void> { try { const handle = await open(directory, "r"); try { await handle.sync(); } finally { await handle.close(); } } catch (error: any) { if (process.platform !== "win32") throw error; } }
