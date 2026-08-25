import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { authorityDigest } from "../wire.js";
import { parseGovernedReceiptV1, parseMissionClaimV1, type GovernedReceiptV1 } from "../tool-effect-contract.js";
import type { OutcomeKernelStorage, StoredEffectLifecycleV1 } from "./outcome-kernel.js";
import type { SignedJournal, SignedJournalEventV1 } from "./signed-journal.js";

type Stored<T> = Readonly<{ digest: string; value: T }>;

export async function createFileOutcomeKernelStorage(input: Readonly<{ rootDir: string }>): Promise<OutcomeKernelStorage> {
  if (!input || typeof input.rootDir !== "string" || !path.isAbsolute(input.rootDir)) throw new TypeError("Outcome kernel storage root must be absolute");
  const root = path.resolve(input.rootDir);
  await Promise.all(["missions", "effects", "receipts", "locks"].map(name => mkdir(path.join(root, name), { recursive: true })));
  const storage: OutcomeKernelStorage = {
    durable: true,
    async claimMission(claim, claimDigest) {
      const parsed = parseMissionClaimV1(claim);
      if (authorityDigest(parsed) !== claimDigest) throw new TypeError("mission claim digest is invalid");
      return withLock(root, `mission:${parsed.missionId}`, async () => {
        const file = recordPath(root, "missions", parsed.missionId), prior = await readStored<unknown>(file);
        if (prior) return prior.digest === claimDigest ? Object.freeze({ status: "exact-existing" as const, claim: parseMissionClaimV1(prior.value) }) : Object.freeze({ status: "conflict" as const });
        await atomicWrite(file, { digest: claimDigest, value: parsed });
        return Object.freeze({ status: "claimed" as const, claim: parsed });
      });
    },
    async loadMission(missionId) { const stored = await readStored<unknown>(recordPath(root, "missions", boundedId(missionId))); return stored ? parseMissionClaimV1(stored.value) : null; },
    async loadEffect(missionId, reservationId) { const stored = await readStored<StoredEffectLifecycleV1>(recordPath(root, "effects", `${boundedId(missionId)}:${boundedId(reservationId)}`)); return stored?.value ?? null; },
    async storeEffect(value, expectedRevision) {
      const key = `${boundedId(value.missionId)}:${boundedId(value.reservation.reservationId)}`;
      return withLock(root, `effect:${key}`, async () => {
        const file = recordPath(root, "effects", key), prior = await readStored<StoredEffectLifecycleV1>(file);
        if ((prior?.value.revision ?? 0) !== expectedRevision) return Object.freeze({ status: "conflict" as const });
        const stored = Object.freeze({ ...value, revision: expectedRevision + 1 });
        await atomicWrite(file, { digest: authorityDigest(stored), value: stored });
        return Object.freeze({ status: "stored" as const, value: stored });
      });
    },
    async compareAndPublishReceipt(receipt, receiptDigest) {
      const parsed = parseGovernedReceiptV1(receipt);
      if (authorityDigest(parsed) !== receiptDigest) throw new TypeError("receipt digest is invalid");
      return withLock(root, `receipt:${parsed.receiptId}`, async () => {
        const file = recordPath(root, "receipts", parsed.receiptId), prior = await readStored<GovernedReceiptV1>(file);
        if (prior) return prior.digest === receiptDigest ? Object.freeze({ status: "exact-existing" as const, receiptDigest, receiptRef: receiptRef(parsed.receiptId, receiptDigest) }) : Object.freeze({ status: "conflict" as const });
        await atomicWrite(file, { digest: receiptDigest, value: parsed });
        return Object.freeze({ status: "published" as const, receiptDigest, receiptRef: receiptRef(parsed.receiptId, receiptDigest) });
      });
    },
    async loadReceipt(receiptId) { const id = boundedId(receiptId), stored = await readStored<GovernedReceiptV1>(recordPath(root, "receipts", id)); return stored ? Object.freeze({ receiptId: id, receiptDigest: stored.digest, receiptRef: receiptRef(id, stored.digest) }) : null; },
  };
  return Object.freeze(storage);
}

/** Signed lifecycle index. Receipt authority remains exclusively with receiptPublication. */
export async function createSignedJournalOutcomeKernelStorage(input: Readonly<{ journal: SignedJournal; receiptPublication: Pick<OutcomeKernelStorage, "compareAndPublishReceipt" | "loadReceipt"> }>): Promise<OutcomeKernelStorage> {
  if (!input?.journal || typeof input.journal.append !== "function" || typeof input.journal.load !== "function" || typeof input.journal.withLease !== "function" || !input.receiptPublication || typeof input.receiptPublication.compareAndPublishReceipt !== "function" || typeof input.receiptPublication.loadReceipt !== "function") throw new TypeError("signed journal Outcome storage options are invalid");
  const missionKey = (missionId: string) => normalizedJournalId("mission", boundedId(missionId));
  const effectKey = (missionId: string, reservationId: string) => normalizedJournalId("effect", `${boundedId(missionId)}\0${boundedId(reservationId)}`);
  const receiptKey = (receiptId: string) => normalizedJournalId("receipt", boundedId(receiptId));
  const storage: OutcomeKernelStorage = {
    durable: true,
    async claimMission(claim, claimDigest) {
      const parsed = parseMissionClaimV1(claim);
      if (authorityDigest(parsed) !== claimDigest) throw new TypeError("mission claim digest is invalid");
      const key = missionKey(parsed.missionId);
      return input.journal.withLease(`mission_${key.slice(-64)}`, async () => {
        const events = await input.journal.load(key), prior = foldSingle(events, "mission-claim");
        if (prior) return prior.semanticsDigest === claimDigest && authorityDigest(prior.data.value) === claimDigest ? Object.freeze({ status: "exact-existing" as const, claim: parseMissionClaimV1(prior.data.value) }) : Object.freeze({ status: "conflict" as const });
        await input.journal.append(key, claimDigest, "mission-claim", Object.freeze({ kind: "mission", digest: claimDigest, value: parsed }));
        return Object.freeze({ status: "claimed" as const, claim: parsed });
      });
    },
    async loadMission(missionId) { const event = foldSingle(await input.journal.load(missionKey(missionId)), "mission-claim"); return event ? parseMissionClaimV1(event.data.value) : null; },
    async loadEffect(missionId, reservationId) { return foldEffect(await input.journal.load(effectKey(missionId, reservationId)), missionId, reservationId); },
    async storeEffect(value, expectedRevision) {
      const missionId = boundedId(value.missionId), reservationId = boundedId(value.reservation.reservationId), key = effectKey(missionId, reservationId), semantics = authorityDigest({ v: "reelier.outcome-lifecycle-index/v1", missionId, reservationId, missionDigest: value.missionDigest, contractDigest: value.contractDigest });
      return input.journal.withLease(`effect_${key.slice(-64)}`, async () => {
        const events = await input.journal.load(key), prior = foldEffect(events, missionId, reservationId);
        if ((prior?.revision ?? 0) !== expectedRevision) return Object.freeze({ status: "conflict" as const });
        const stored = Object.freeze({ ...value, revision: expectedRevision + 1 });
        await input.journal.append(key, semantics, "effect", Object.freeze({ kind: "effect", digest: authorityDigest(stored), revision: stored.revision, value: stored }));
        return Object.freeze({ status: "stored" as const, value: stored });
      });
    },
    async compareAndPublishReceipt(receipt, receiptDigest) {
      const parsed = parseGovernedReceiptV1(receipt);
      if (authorityDigest(parsed) !== receiptDigest) throw new TypeError("receipt digest is invalid");
      const published = await input.receiptPublication.compareAndPublishReceipt(parsed, receiptDigest);
      if (published.status === "conflict") return published;
      await indexReceipt(input.journal, receiptKey(parsed.receiptId), parsed.receiptId, published.receiptDigest, published.receiptRef);
      return published;
    },
    async loadReceipt(receiptId) {
      const id = boundedId(receiptId), head = await input.receiptPublication.loadReceipt(id);
      if (!head) return null;
      await indexReceipt(input.journal, receiptKey(id), id, head.receiptDigest, head.receiptRef);
      return head;
    },
  };
  return Object.freeze(storage);
}

function normalizedJournalId(kind: string, identity: string): string { return `${kind}_${authorityDigest({ kind, identity }).slice(7)}`; }
function foldSingle(events: readonly SignedJournalEventV1[], phase: string): SignedJournalEventV1 | null { if (events.length === 0) return null; if (events.length !== 1 || events[0].phase !== phase) throw new TypeError("signed Outcome lifecycle index phase conflict"); return events[0]; }
function foldEffect(events: readonly SignedJournalEventV1[], missionId: string, reservationId: string): StoredEffectLifecycleV1 | null {
  let current: StoredEffectLifecycleV1 | null = null;
  for (const event of events) {
    if (event.phase !== "effect" || event.data.kind !== "effect" || !Number.isSafeInteger(event.data.revision) || event.data.revision !== (current?.revision ?? 0) + 1 || !event.data.value || typeof event.data.value !== "object" || authorityDigest(event.data.value) !== event.data.digest) throw new TypeError("signed Outcome effect index is conflicting or non-monotonic");
    const value = event.data.value as StoredEffectLifecycleV1;
    if (value.missionId !== missionId || value.reservation.reservationId !== reservationId || value.revision !== event.data.revision) throw new TypeError("signed Outcome effect index identity conflict");
    current = value;
  }
  return current;
}
async function indexReceipt(journal: SignedJournal, key: string, receiptId: string, receiptDigest: string, receiptRefValue: string): Promise<void> {
  const semantics = authorityDigest({ v: "reelier.outcome-receipt-index/v1", receiptId, receiptDigest, receiptRef: receiptRefValue });
  await journal.withLease(`receipt_${key.slice(-64)}`, async () => {
    const prior = foldSingle(await journal.load(key), "receipt");
    if (prior) { if (prior.semanticsDigest !== semantics || prior.data.receiptDigest !== receiptDigest || prior.data.receiptRef !== receiptRefValue) throw new TypeError("signed Outcome receipt index conflicts with durable publication"); return; }
    await journal.append(key, semantics, "receipt", Object.freeze({ kind: "receipt-index", receiptDigest, receiptRef: receiptRefValue }));
  });
}

function boundedId(value: unknown): string { if (typeof value !== "string" || value.length < 1 || value.length > 256) throw new TypeError("durable record identity is invalid"); return value; }
function recordPath(root: string, kind: string, id: string): string { return path.join(root, kind, `${authorityDigest({ kind, id }).slice(7)}.json`); }
function receiptRef(receiptId: string, digest: string): string { return authorityDigest({ v: "reelier.outcome-receipt-head/v1", receiptId, digest }); }
async function readStored<T>(file: string): Promise<Stored<T> | null> { try { return JSON.parse(await readFile(file, "utf8")) as Stored<T>; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; } }
async function atomicWrite(file: string, value: unknown): Promise<void> { const temporary = `${file}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`; const handle = await open(temporary, "wx", 0o600); try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); } await rename(temporary, file); }
async function withLock<T>(root: string, key: string, run: () => Promise<T>): Promise<T> { const lock = recordPath(root, "locks", key); for (let attempt = 0; ; attempt += 1) { try { await mkdir(lock); break; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt >= 1000) throw error; await new Promise(resolve => setTimeout(resolve, 2)); } } try { return await run(); } finally { await rm(lock, { recursive: true, force: true }); } }
