import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { authorityCanonicalBytes, authorityDigest } from "../wire.js";
import type { DispatchPublication, DispatchRequestState, DispatchOutcome } from "./dispatch.js";
import { assertLinuxAuthorityCellHost } from "./platform.js";

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

function fileName(receiptRef: string): string {
  return `receipt-${receiptRef.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
}

/** Creates an immutable, restart-safe local receipt/evidence publication. */
export function createFileReceiptPublication(options: FileReceiptPublicationOptions): DispatchPublication {
  assertLinuxAuthorityCellHost();
  const root = path.resolve(options.rootDir);
  return Object.freeze({
    async publish(input: Readonly<{ phase: "dispatch" | "cancelled" | "ambiguous" | "reconcile"; state: DispatchRequestState; outcome: DispatchOutcome; dispatchedRequestDigest: string | null; priorReceiptDigest?: string | null }>) {
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
    },
  });
}
