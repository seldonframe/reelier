import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { authorityCanonicalBytes, authorityDigest } from "../wire.js";
import type { DispatchPublication, DispatchRequestState, DispatchOutcome, DurableDispatchPublicationHeadV1, DurableDispatchPublicationIdentityV1, DurableDispatchPublicationQueryV1 } from "./dispatch.js";
import { governedDurableDispatchPublicationQueryV1 } from "./dispatch.js";
import type { ReservationSnapshot } from "../ledger.js";
import { assertLinuxAuthorityCellHost } from "./platform.js";
import { noteDurableEntryCreated, syncDirectory } from "./durability.js";
import { normalizeReservationPublicationId } from "./reservation-identity.js";

export { __testSetReceiptsDurabilityProbe, type ReceiptsDurabilityProbeEventV1 } from "./durability.js";

/**
 * Minimal local publication used by the host before a terminal ledger transition.
 *
 * This is deliberately an internal, digest-bound publication rather than a claim
 * that the portable signed AuthorityReceipt bundle is complete. The full bundle
 * still requires the signed contract, delegation, source bundle, capability,
 * gate event, pack manifest, and provider reconciliation evidence.
 */
export interface LocalAuthorityPublication {
  readonly v: "reelier.authority-publication/internal-v1";
  readonly receiptRef: string;
  readonly evidenceDigest: string;
  readonly reservationId: string;
  readonly phase: "dispatch" | "cancelled" | "ambiguous" | "reconcile";
  readonly lifecycle: DispatchOutcome["kind"];
  readonly effectDigest: string;
  readonly dispatchedRequestDigest: string | null;
  readonly providerResultDigest: string;
  readonly reconciliationStatus: string | null;
  readonly normalizedProjectionDigest: string | null;
  readonly priorReceiptDigest: string | null;
}

export interface FileReceiptPublicationOptions {
  readonly rootDir: string;
}

declare const fileReceiptPublicationReadbackBrand: unique symbol;
export interface FileReceiptPublicationReadbackV1 { readonly [fileReceiptPublicationReadbackBrand]: true }
type FileReceiptPublicationReadbackStateV1 = Readonly<{ publication: DispatchPublication; query: DurableDispatchPublicationQueryV1; reservationId: string; effectDigest: string }>;
const genuineFilePublications = new WeakSet<object>(), filePublicationReadbacks = new WeakMap<object, FileReceiptPublicationReadbackStateV1>();
export function assertGenuineFileReceiptPublicationV1(publication: DispatchPublication): void { if (!publication || typeof publication !== "object" || !genuineFilePublications.has(publication as object)) throw new TypeError("genuine file receipt publication is required"); }

/** @internal Opaque resolver/query pair minted only by the genuine file publication. */
export function bindFileReceiptPublicationReadbackV1(publication: DispatchPublication, reservation: ReservationSnapshot): FileReceiptPublicationReadbackV1 {
  assertGenuineFileReceiptPublicationV1(publication);
  const query = governedDurableDispatchPublicationQueryV1(reservation), readback = Object.freeze(Object.create(null)) as FileReceiptPublicationReadbackV1;
  filePublicationReadbacks.set(readback as object, Object.freeze({ publication, query, reservationId: reservation.reservationId, effectDigest: reservation.intent.effectDigest }));
  return readback;
}
export function describeFileReceiptPublicationReadbackV1(readback: FileReceiptPublicationReadbackV1): Readonly<{ reservationId: string; effectDigest: string }> { const state = filePublicationReadbacks.get(readback as object); if (!state) throw new TypeError("file receipt publication readback is not genuine"); return Object.freeze({ reservationId: state.reservationId, effectDigest: state.effectDigest }); }
export async function loadFileReceiptPublicationReadbackV1(readback: FileReceiptPublicationReadbackV1, expect: "terminal" | "root-or-terminal" = "terminal"): Promise<DurableDispatchPublicationHeadV1 | null> { const state = filePublicationReadbacks.get(readback as object); if (!state) throw new TypeError("file receipt publication readback is not genuine"); return state.publication.loadDurableHead!(state.query, expect); }

function fileName(receiptRef: string): string {
  return `receipt-${receiptRef.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
}

/** Creates an immutable, restart-safe local receipt/evidence publication. */
export function createFileReceiptPublication(options: FileReceiptPublicationOptions): DispatchPublication {
  assertLinuxAuthorityCellHost();
  const root = path.resolve(options.rootDir);
  const identities = new Map<string, DurableDispatchPublicationIdentityV1>();
  const legacyPublish = async (input: Readonly<{ phase: "dispatch" | "cancelled" | "ambiguous" | "reconcile"; state: DispatchRequestState; outcome: DispatchOutcome; dispatchedRequestDigest: string | null; priorReceiptDigest?: string | null }>) => {
      const reservationId = input.state.reservation.reservationId;
      const stable = {
        v: "reelier.authority-publication-preimage/internal-v1",
        reservationId,
        phase: input.phase,
        lifecycle: input.outcome.kind,
        effectDigest: input.state.effectDigest,
        dispatchedRequestDigest: input.dispatchedRequestDigest,
        providerResultDigest: input.outcome.resultDigest,
        reconciliationStatus: input.outcome.reconciliationStatus ?? null,
        normalizedProjectionDigest: input.outcome.normalizedProjectionDigest ?? null,
        priorReceiptDigest: input.priorReceiptDigest ?? null,
      } as const;
      const receiptRef = authorityDigest(stable);
      const evidence = {
        v: "reelier.authority-evidence/internal-v1",
        receiptRef,
        reservationId,
        phase: input.phase,
        effectDigest: input.state.effectDigest,
        dispatchedRequestDigest: input.dispatchedRequestDigest,
        providerResultDigest: input.outcome.resultDigest,
        reconciliationStatus: input.outcome.reconciliationStatus ?? null,
        normalizedProjectionDigest: input.outcome.normalizedProjectionDigest ?? null,
        priorReceiptDigest: input.priorReceiptDigest ?? null,
      } as const;
      const evidenceDigest = authorityDigest(evidence);
      const record: LocalAuthorityPublication = Object.freeze({
        v: "reelier.authority-publication/internal-v1",
        receiptRef,
        evidenceDigest,
        reservationId,
        phase: input.phase,
        lifecycle: input.outcome.kind,
        effectDigest: input.state.effectDigest,
        dispatchedRequestDigest: input.dispatchedRequestDigest,
        providerResultDigest: input.outcome.resultDigest,
        reconciliationStatus: input.outcome.reconciliationStatus ?? null,
        normalizedProjectionDigest: input.outcome.normalizedProjectionDigest ?? null,
        priorReceiptDigest: input.priorReceiptDigest ?? null,
      });
      const file = path.join(root, fileName(receiptRef));
      await mkdir(root, { recursive: true });
      const serialized = Buffer.concat([authorityCanonicalBytes(record), Buffer.from("\n", "utf8")]);
      const temporary = path.join(root, `.${fileName(receiptRef)}.${randomBytes(8).toString("hex")}.tmp`);
      try {
        const handle = await open(temporary, "wx", 0o600);
        try { await handle.writeFile(serialized); await handle.sync(); } finally { await handle.close(); }
        try { await rename(temporary, file); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST" && (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" && (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      } finally { await unlink(temporary).catch(() => {}); }
      noteDurableEntryCreated("legacy-rename", file);
      await syncDirectory(root, "legacy-rename");
      try {
        const existingBytes = await readFile(file);
        const existing = JSON.parse(existingBytes.toString("utf8")) as Partial<LocalAuthorityPublication>;
        if (authorityDigest(existing) !== authorityDigest(record) || existing.receiptRef !== receiptRef || existing.evidenceDigest !== evidenceDigest || existing.reservationId !== reservationId || existing.phase !== input.phase || existing.lifecycle !== input.outcome.kind || existing.effectDigest !== input.state.effectDigest || existing.dispatchedRequestDigest !== input.dispatchedRequestDigest || existing.providerResultDigest !== input.outcome.resultDigest || existing.reconciliationStatus !== (input.outcome.reconciliationStatus ?? null) || existing.normalizedProjectionDigest !== (input.outcome.normalizedProjectionDigest ?? null) || existing.priorReceiptDigest !== (input.priorReceiptDigest ?? null)) {
          throw new Error("conflicting immutable authority publication");
        }
      } catch (error) {
        if (error instanceof Error && error.message === "conflicting immutable authority publication") throw error;
        throw new Error("authority publication is missing or unreadable", { cause: error });
      }
      return Object.freeze({ receiptRef, evidenceDigest });
  };
  const publishDurable = async (identity: DurableDispatchPublicationIdentityV1, input: Readonly<{ phase: "reservation" | "dispatch" | "ambiguous" | "reconcile"; state: DispatchRequestState; outcome: DispatchOutcome; dispatchedRequestDigest: string | null; priorReceiptDigest: string | null }>) => {
    assertDurableIdentity(identity);
    if (identity.reservationId !== normalizeReservationPublicationId(input.state.reservation.reservationId) || identity.effectDigest !== input.state.effectDigest) throw new TypeError("durable publication state identity mismatch");
    const current = await loadDurableChain(root, identity, "root-or-terminal");
    const terminalKind = input.phase === "reservation" ? null : input.phase === "reconcile" ? "reconciled" : input.outcome.kind;
    if (input.phase === "reservation") {
      if (input.priorReceiptDigest !== null || input.dispatchedRequestDigest !== null) throw new TypeError("durable reservation root is malformed");
    } else {
      if (!current || input.priorReceiptDigest !== (current.phase === "reservation" || current.phase === "ambiguous" ? current.receiptRef : current.priorReceiptRef)) throw new TypeError("durable publication prior head mismatch");
      if (input.phase === "dispatch" && current.phase !== "reservation" || input.phase === "ambiguous" && current.phase !== "reservation" || input.phase === "reconcile" && current.phase !== "ambiguous") {
        const repeatPrior = current.priorReceiptRef === input.priorReceiptDigest && current.phase === input.phase;
        if (!repeatPrior) throw new TypeError("durable publication phase conflicts with the authoritative head");
      }
    }
    const reservationReceiptRef = input.phase === "reservation" ? null : current!.reservationReceiptRef;
    const publisherRootDigest = durablePublisherRootDigest(root);
    const preimage = Object.freeze({ v: "reelier.durable-file-publication-preimage/internal-v2", publisherRootDigest, identity, phase: input.phase, terminalKind, reservationReceiptRef, priorReceiptRef: input.priorReceiptDigest, lifecycle: input.outcome.kind, effectDigest: input.state.effectDigest, dispatchedRequestDigest: input.dispatchedRequestDigest, providerResultDigest: input.outcome.resultDigest, reconciliationStatus: input.outcome.reconciliationStatus ?? null, normalizedProjectionDigest: input.outcome.normalizedProjectionDigest ?? null });
    const receiptRef = authorityDigest(preimage), evidenceDigest = authorityDigest({ v: "reelier.durable-file-publication-evidence/internal-v2", publisherRootDigest, receiptRef, identity, phase: input.phase, terminalKind, providerResultDigest: input.outcome.resultDigest });
    const head = Object.freeze({ v: "reelier.durable-dispatch-publication-head/v1" as const, identity, receiptRef, evidenceDigest, reservationReceiptRef: input.phase === "reservation" ? receiptRef : current!.reservationReceiptRef, priorReceiptRef: input.priorReceiptDigest, phase: input.phase, terminalKind }) as DurableDispatchPublicationHeadV1;
    if (current) {
      if (current.receiptRef === receiptRef && authorityDigest(current) === authorityDigest(head)) return Object.freeze({ receiptRef, evidenceDigest });
      if (current.phase !== "reservation" && current.phase !== "ambiguous") throw new TypeError("conflicting immutable durable publication");
    }
    const directory = durableDirectory(root, identity);
    await mkdir(directory, { recursive: true });
    noteDurableEntryCreated("durable-mkdir", directory);
    await syncDirectory(root, "durable-mkdir");
    await writeImmutable(path.join(directory, `node-${receiptRef.slice(7)}.json`), Object.freeze({ v: "reelier.durable-file-publication-node/internal-v2", publisherRootDigest, preimage, head }));
    const reread = await loadDurableChain(root, identity, "root-or-terminal");
    if (!reread || reread.receiptRef !== receiptRef || authorityDigest(reread) !== authorityDigest(head)) throw new Error("durable publication authoritative readback mismatch");
    return Object.freeze({ receiptRef, evidenceDigest });
  };
  const publication = Object.freeze({
    async publishReservation(input: Parameters<NonNullable<DispatchPublication["publishReservation"]>>[0]) {
      const identity = snapshotDurableIdentity(input.identity);
      identities.set(normalizeReservationPublicationId(identity.reservationId), identity);
      return publishDurable(identity, { phase: input.phase, state: input.state, outcome: input.outcome, dispatchedRequestDigest: input.dispatchedRequestDigest, priorReceiptDigest: input.priorReceiptDigest });
    },
    async loadDurableHead(query: DurableDispatchPublicationQueryV1, expect: "terminal" | "root-or-terminal" = "terminal") {
      assertDurableQuery(query);
      const identity = snapshotDurableIdentity(query.identity);
      identities.set(normalizeReservationPublicationId(identity.reservationId), identity);
      return loadDurableChain(root, identity, expect);
    },
    async publish(input: Readonly<{ phase: "dispatch" | "cancelled" | "ambiguous" | "reconcile"; state: DispatchRequestState; outcome: DispatchOutcome; dispatchedRequestDigest: string | null; priorReceiptDigest?: string | null }>) {
      const identity = identities.get(normalizeReservationPublicationId(input.state.reservation.reservationId));
      if (!identity) return legacyPublish(input);
      if (input.phase === "cancelled") throw new TypeError("a durable send-started chain cannot publish cancellation");
      return publishDurable(identity, { phase: input.phase, state: input.state, outcome: input.outcome, dispatchedRequestDigest: input.dispatchedRequestDigest, priorReceiptDigest: input.priorReceiptDigest ?? null });
    },
  });
  genuineFilePublications.add(publication as object);
  return publication;
}

const DIGEST = /^sha256:(?!0{64}$)[0-9a-f]{64}$/;
const IDENTITY_FIELDS = ["v", "reservationId", "tenant", "requestDigest", "capabilityDigest", "effectDigest", "routeAuthorityDigest", "expectedDispatchedRequestDigest", "reservationIntentDigest"] as const;

function assertDurableIdentity(value: DurableDispatchPublicationIdentityV1): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("durable publication identity is not inert");
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(value);
  if (keys.length !== IDENTITY_FIELDS.length || keys.some(key => typeof key !== "string" || !IDENTITY_FIELDS.includes(key as typeof IDENTITY_FIELDS[number])) || Object.values(descriptors).some(descriptor => !("value" in descriptor) || !descriptor.enumerable)) throw new TypeError("durable publication identity is not closed");
  if (value.v !== "reelier.durable-dispatch-publication-identity/v1" || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(value.reservationId) || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(value.tenant) || [value.requestDigest, value.capabilityDigest, value.effectDigest, value.routeAuthorityDigest, value.expectedDispatchedRequestDigest, value.reservationIntentDigest].some(item => !DIGEST.test(item))) throw new TypeError("durable publication identity is invalid");
}

function snapshotDurableIdentity(value: DurableDispatchPublicationIdentityV1): DurableDispatchPublicationIdentityV1 {
  assertDurableIdentity(value);
  return Object.freeze(Object.fromEntries(IDENTITY_FIELDS.map(field => [field, value[field]]))) as unknown as DurableDispatchPublicationIdentityV1;
}

function assertDurableQuery(value: DurableDispatchPublicationQueryV1): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).length !== 4 || !Object.prototype.hasOwnProperty.call(value, "v") || !Object.prototype.hasOwnProperty.call(value, "identity") || !Object.prototype.hasOwnProperty.call(value, "ledgerState") || !Object.prototype.hasOwnProperty.call(value, "sendStarted")) throw new TypeError("durable publication query is not closed");
  if (value.v !== "reelier.durable-dispatch-publication-query/v1" || !["dispatched", "ambiguous"].includes(value.ledgerState) || value.sendStarted !== true) throw new TypeError("durable publication query is invalid");
  assertDurableIdentity(value.identity);
}

function durableDirectory(root: string, identity: DurableDispatchPublicationIdentityV1): string { return path.join(root, `durable-${authorityDigest(identity).slice(7)}`); }
function durablePublisherRootDigest(root: string): string { return authorityDigest({ v: "reelier.durable-file-publication-root/internal-v1", resolvedRoot: path.resolve(root) }); }

/**
 * Publishes a node through a temp file, so partial JSON can only ever exist under a dot-prefixed
 * `.tmp` name that the readdir filter excludes. A mid-write crash therefore cannot brick readback
 * nor poison the byte-compare below, which still carries the immutability CAS: node files are
 * content-addressed, so a rename over an existing node is byte-identical by construction.
 */
async function writeImmutable(file: string, value: unknown): Promise<void> {
  const bytes = Buffer.concat([authorityCanonicalBytes(value), Buffer.from("\n")]);
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.${path.basename(file)}.${randomBytes(8).toString("hex")}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try { await rename(temporary, file); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" && (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    }
  } finally { await unlink(temporary).catch(() => {}); }
  let existing: Buffer;
  try { existing = await readFile(file); } catch (error) { throw new Error("durable publication node is missing or unreadable", { cause: error }); }
  if (!existing.equals(bytes)) throw new Error("conflicting immutable durable publication");
  noteDurableEntryCreated("node-create", file);
  await syncDirectory(directory, "node-create");
}

async function loadDurableChain(root: string, identity: DurableDispatchPublicationIdentityV1, expect: "terminal" | "root-or-terminal"): Promise<DurableDispatchPublicationHeadV1 | null> {
  assertDurableIdentity(identity);
  if (expect !== "terminal" && expect !== "root-or-terminal") throw new TypeError("durable publication head expectation is invalid");
  const directory = durableDirectory(root, identity);
  let names: string[];
  try { names = (await readdir(directory)).filter(name => /^node-[0-9a-f]{64}\.json$/.test(name)).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (names.length === 0) return null;
  const nodes = await Promise.all(names.map(async name => JSON.parse(await readFile(path.join(directory, name), "utf8")) as any)), publisherRootDigest = durablePublisherRootDigest(root);
  for (const node of nodes) {
    if (!node || node.v !== "reelier.durable-file-publication-node/internal-v2" || node.publisherRootDigest !== publisherRootDigest || node.preimage?.v !== "reelier.durable-file-publication-preimage/internal-v2" || node.preimage.publisherRootDigest !== publisherRootDigest || authorityDigest(node.head.identity) !== authorityDigest(identity) || authorityDigest(node.preimage) !== node.head.receiptRef || !DIGEST.test(node.head.evidenceDigest)) throw new TypeError("durable publication publisher root binding, version, or node is invalid or conflicting");
    // The receiptRef binds the preimage only. Recompute the evidence digest and cross-check every
    // head field the preimage already determines, so a tampered head cannot ride a valid receiptRef.
    const expectedEvidenceDigest = authorityDigest({ v: "reelier.durable-file-publication-evidence/internal-v2", publisherRootDigest, receiptRef: node.head.receiptRef, identity: node.head.identity, phase: node.preimage.phase, terminalKind: node.preimage.terminalKind, providerResultDigest: node.preimage.providerResultDigest });
    if (node.head.evidenceDigest !== expectedEvidenceDigest || node.head.v !== "reelier.durable-dispatch-publication-head/v1" || node.head.phase !== node.preimage.phase || node.head.terminalKind !== node.preimage.terminalKind || node.head.priorReceiptRef !== node.preimage.priorReceiptRef || node.head.reservationReceiptRef !== (node.preimage.phase === "reservation" ? node.head.receiptRef : node.preimage.reservationReceiptRef)) throw new TypeError("durable publication node is invalid or conflicting");
  }
  const roots = nodes.filter(node => node.head.phase === "reservation" && node.head.priorReceiptRef === null && node.head.reservationReceiptRef === node.head.receiptRef);
  if (roots.length !== 1) throw new TypeError("durable publication reservation root is absent or conflicting");
  let current = roots[0], consumed = 1;
  for (;;) {
    const children = nodes.filter(node => node.head.priorReceiptRef === current.head.receiptRef);
    if (children.length > 1) throw new TypeError("durable publication chain fork conflicts");
    if (children.length === 0) break;
    const next = children[0];
    if (current.head.phase === "reservation" && !["dispatch", "ambiguous"].includes(next.head.phase) || current.head.phase === "ambiguous" && next.head.phase !== "reconcile" || !["reservation", "ambiguous"].includes(current.head.phase)) throw new TypeError("durable publication chain order conflicts");
    if (next.head.reservationReceiptRef !== roots[0].head.receiptRef) throw new TypeError("durable publication reservation root binding conflicts");
    current = next; consumed += 1;
  }
  if (consumed !== nodes.length) throw new TypeError("durable publication contains an unreachable node");
  if (expect === "terminal" && current.head.phase === "reservation") throw new TypeError("durable publication terminal receipt is absent for a send-started reservation");
  return Object.freeze(current.head) as DurableDispatchPublicationHeadV1;
}
