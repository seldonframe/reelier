import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface StagedArtifactCommitmentV1 {
  readonly v: "reelier.staged-artifact-commitment/v1";
  readonly reference: string;
  readonly digest: string;
  readonly mediaType: string;
  readonly byteCount: number;
  readonly creatorPrincipal: string;
  readonly sourceBinding: string;
  readonly expiresAt: string;
  readonly deletionState: "retained" | "deleted";
}

export interface ArtifactStore {
  readonly stage: (input: Readonly<{ mediaType: string; bytes: Uint8Array; creatorPrincipal?: string; sourceBinding?: string; expiresAt?: Date }>) => Promise<Readonly<{ commitment: StagedArtifactCommitmentV1 }>>;
  readonly read: (reference: string) => Promise<Buffer>;
  readonly deleteAfterTerminal: (reference: string) => Promise<void>;
}

interface Stored { readonly commitment: StagedArtifactCommitmentV1; readonly iv: Buffer; readonly tag: Buffer; readonly ciphertext: Buffer; }

export function createArtifactStore(input: Readonly<{ tenant: string; key: Uint8Array; now?: () => Date }>): ArtifactStore {
  if (!/^[A-Za-z0-9._~-]{1,128}$/.test(input.tenant) || input.key.byteLength !== 32) throw new TypeError("artifact tenant/key invalid");
  const now = input.now ?? (() => new Date());
  const records = new Map<string, Stored>();
  return Object.freeze({
    async stage(value: Parameters<ArtifactStore["stage"]>[0]) {
      if (!value || typeof value.mediaType !== "string" || !value.mediaType || !(value.bytes instanceof Uint8Array)) throw new TypeError("artifact input invalid");
      const created = now();
      const expires = value.expiresAt ?? new Date(created.getTime() + 7 * 24 * 60 * 60 * 1000);
      if (!Number.isFinite(expires.getTime()) || expires.getTime() <= created.getTime() || expires.getTime() > created.getTime() + 30 * 24 * 60 * 60 * 1000) throw new RangeError("artifact expiry must be within thirty days");
      const reference = `artifact_${randomBytes(18).toString("base64url")}`;
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", Buffer.from(input.key), iv);
      const ciphertext = Buffer.concat([cipher.update(Buffer.from(value.bytes)), cipher.final()]);
      const digest = `sha256:${createHash("sha256").update(value.bytes).digest("hex")}`;
      const commitment: StagedArtifactCommitmentV1 = Object.freeze({ v: "reelier.staged-artifact-commitment/v1", reference, digest, mediaType: value.mediaType, byteCount: value.bytes.byteLength, creatorPrincipal: value.creatorPrincipal ?? "host", sourceBinding: value.sourceBinding ?? "unbound", expiresAt: expires.toISOString(), deletionState: "retained" });
      records.set(reference, { commitment, iv, tag: cipher.getAuthTag(), ciphertext });
      return Object.freeze({ commitment });
    },
    async read(reference: string) {
      const stored = records.get(reference);
      if (!stored || stored.commitment.deletionState === "deleted") throw new Error("artifact unavailable");
      if (now().getTime() > Date.parse(stored.commitment.expiresAt)) { records.delete(reference); throw new Error("artifact expired"); }
      const decipher = createDecipheriv("aes-256-gcm", Buffer.from(input.key), stored.iv); decipher.setAuthTag(stored.tag);
      return Buffer.concat([decipher.update(stored.ciphertext), decipher.final()]);
    },
    async deleteAfterTerminal(reference: string) { const stored = records.get(reference); if (!stored) return; records.set(reference, { ...stored, commitment: Object.freeze({ ...stored.commitment, deletionState: "deleted" }) }); records.delete(reference); },
  });
}
