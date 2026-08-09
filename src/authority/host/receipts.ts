import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { authorityDigest } from "../wire.js";
import type { DispatchPublication, DispatchRequestState, DispatchOutcome } from "./dispatch.js";

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
  readonly phase: "dispatch" | "cancelled" | "ambiguous";
  readonly lifecycle: DispatchOutcome["kind"];
  readonly effectDigest: string;
  readonly dispatchedRequestDigest: string | null;
  readonly providerResultDigest: string;
}

export interface FileReceiptPublicationOptions {
  readonly rootDir: string;
  readonly now?: () => Date;
}

function fileName(receiptRef: string): string {
  return `receipt-${receiptRef.replace(/[^A-Za-z0-9_-]/g, "_")}.json`;
}

/** Creates an immutable, restart-safe local receipt/evidence publication. */
export function createFileReceiptPublication(options: FileReceiptPublicationOptions): DispatchPublication {
  const root = path.resolve(options.rootDir);
  const now = options.now ?? (() => new Date());
  return Object.freeze({
    async publish(input: Readonly<{ phase: "dispatch" | "cancelled" | "ambiguous"; state: DispatchRequestState; outcome: DispatchOutcome; dispatchedRequestDigest: string | null }>) {
      const reservationId = input.state.reservation.reservationId;
      const stable = {
        v: "reelier.authority-publication-preimage/internal-v1",
        reservationId,
        phase: input.phase,
        lifecycle: input.outcome.kind,
        effectDigest: input.state.effectDigest,
        dispatchedRequestDigest: input.dispatchedRequestDigest,
        providerResultDigest: input.outcome.resultDigest,
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
      });
      const file = path.join(root, fileName(receiptRef));
      await mkdir(root, { recursive: true });
      const serialized = `${JSON.stringify({ ...record, publishedAt: now().toISOString() })}\n`;
      try {
        await writeFile(file, serialized, { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = JSON.parse(await readFile(file, "utf8")) as Partial<LocalAuthorityPublication>;
        if (existing.receiptRef !== receiptRef || existing.evidenceDigest !== evidenceDigest || existing.reservationId !== reservationId || existing.phase !== input.phase) {
          throw new Error("conflicting immutable authority publication");
        }
      }
      return Object.freeze({ receiptRef, evidenceDigest });
    },
  });
}
