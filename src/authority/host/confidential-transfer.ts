import type { ConfidentialTransferCommitmentV1 } from "../types.js";
import { authorityDigest } from "../wire.js";
import { createSecretHandle, type SecretHandle } from "./secret-handle.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface ConfidentialTransferCapture {
  readonly transferId: string;
  readonly sourceOutcome: string;
  readonly destinationOutcome: string;
  readonly destination: string;
  readonly secretSlot: string;
  readonly expiresAt: string;
  readonly value: Uint8Array;
}
export interface CapturedConfidentialTransfer { readonly commitment: ConfidentialTransferCommitmentV1; readonly commitmentDigest: string; readonly handle: SecretHandle }
export interface ConfidentialTransferStatus { readonly commitment: ConfidentialTransferCommitmentV1; readonly commitmentDigest: string }
export interface ConfidentialTransferStore {
  capture(input: ConfidentialTransferCapture): Promise<ConfidentialTransferStatus>;
  take(transferId: string): Promise<CapturedConfidentialTransfer>;
  status(transferId: string): Promise<ConfidentialTransferStatus | undefined>;
}

/** Process-local, one-use handoff store. It deliberately has no serialization API. */
export function createMemoryConfidentialTransferStore(): ConfidentialTransferStore {
  const entries = new Map<string, Readonly<{ transfer: CapturedConfidentialTransfer; timer: NodeJS.Timeout }>>();
  return Object.freeze({
    async capture(input: ConfidentialTransferCapture) {
      assertId(input.transferId, "transferId"); assertId(input.sourceOutcome, "sourceOutcome"); assertId(input.destinationOutcome, "destinationOutcome"); assertId(input.secretSlot, "secretSlot");
      if (typeof input.destination !== "string" || !input.destination || input.destination.length > 1024 || /[\0\r\n]/.test(input.destination)) throw new TypeError("confidential transfer destination is invalid");
      if (entries.has(input.transferId)) throw new TypeError("confidential transfer already exists");
      const handle = createSecretHandle(input.value, { expiresAt: input.expiresAt });
      const commitment: ConfidentialTransferCommitmentV1 = Object.freeze({ v: "reelier.confidential-transfer/v1", sourceOutcome: input.sourceOutcome, destinationOutcome: input.destinationOutcome, secretSlot: input.secretSlot, valueDigest: handle.digest, destination: input.destination, retention: Object.freeze({ expiresAt: handle.expiresAt, deleteAfterTerminalHours: 0 }), deletion: "pending" });
      const entry = Object.freeze({ commitment, commitmentDigest: authorityDigest(commitment), handle });
      const timer = scheduleExpiry(input.transferId, entry);
      entries.set(input.transferId, Object.freeze({ transfer: entry, timer }));
      return Object.freeze({ commitment, commitmentDigest: entry.commitmentDigest });
    },
    async take(transferId: string) {
      assertId(transferId, "transferId");
      const stored = entries.get(transferId);
      if (!stored) throw new Error("confidential transfer is unavailable");
      entries.delete(transferId);
      clearTimeout(stored.timer);
      if (Date.now() >= Date.parse(stored.transfer.commitment.retention.expiresAt)) { stored.transfer.handle.destroy(); throw new Error("confidential transfer is unavailable"); }
      return stored.transfer;
    },
    async status(transferId: string) { assertId(transferId, "transferId"); const stored = entries.get(transferId); if (!stored) return undefined; if (Date.now() >= Date.parse(stored.transfer.commitment.retention.expiresAt)) { clearTimeout(stored.timer); stored.transfer.handle.destroy(); entries.delete(transferId); return undefined; } return Object.freeze({ commitment: stored.transfer.commitment, commitmentDigest: stored.transfer.commitmentDigest }); },
  });

  function scheduleExpiry(transferId: string, entry: CapturedConfidentialTransfer): NodeJS.Timeout {
    const remaining = Math.max(1, Date.parse(entry.commitment.retention.expiresAt) - Date.now());
    const timer = setTimeout(() => {
      const stored = entries.get(transferId);
      if (!stored || stored.transfer !== entry) return;
      if (Date.now() < Date.parse(entry.commitment.retention.expiresAt)) { const replacement = scheduleExpiry(transferId, entry); entries.set(transferId, Object.freeze({ transfer: entry, timer: replacement })); return; }
      entry.handle.destroy(); entries.delete(transferId);
    }, Math.min(remaining, 2_147_000_000));
    timer.unref();
    return timer;
  }
}

function assertId(value: string, label: string): void { if (typeof value !== "string" || !ID.test(value)) throw new TypeError(`confidential transfer ${label} is invalid`); }
