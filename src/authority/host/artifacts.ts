import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

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

export interface ArtifactDeletionEvidence { readonly reference: string; readonly digest: string; readonly deletedAt: string; readonly reason: "terminal" | "expired"; }
export interface ArtifactStore {
  readonly stage: (input: Readonly<{ mediaType: string; bytes: Uint8Array; creatorPrincipal?: string; sourceBinding?: string; expiresAt?: Date }>) => Promise<Readonly<{ commitment: StagedArtifactCommitmentV1 }>>;
  readonly read: (reference: string) => Promise<Buffer>;
  readonly deleteAfterTerminal: (reference: string) => Promise<void>;
  readonly deletionEvidence?: (reference: string) => Promise<ArtifactDeletionEvidence | undefined>;
}

interface Stored { readonly commitment: StagedArtifactCommitmentV1; readonly iv: Buffer; readonly tag: Buffer; readonly ciphertext: Buffer; readonly wrappedKey?: WrappedKey; }
interface WrappedKey { readonly iv: string; readonly tag: string; readonly ciphertext: string; }
const MAX_ARTIFACT_BYTES = 262_144;
const REFERENCE = /^artifact_[A-Za-z0-9_-]{1,64}$/;

export function createArtifactStore(input: Readonly<{ tenant: string; key: Uint8Array; masterKey?: Uint8Array; rootDir?: string; now?: () => Date }>): ArtifactStore {
  if (!/^[A-Za-z0-9._~-]{1,128}$/.test(input.tenant) || input.key.byteLength !== 32) throw new TypeError("artifact tenant/key invalid");
  if (input.masterKey && input.masterKey.byteLength !== 32) throw new TypeError("artifact master key invalid");
  const now = input.now ?? (() => new Date());
  const records = new Map<string, Stored>();
  const root = input.rootDir ? path.resolve(input.rootDir) : null;
  const dataKey = Buffer.from(input.key);
  const fileFor = (reference: string, suffix: string) => { if (!REFERENCE.test(reference)) throw new TypeError("invalid artifact reference"); return path.join(root!, `${reference}.${suffix}`); };
  const wrappedKey = (key: Buffer): WrappedKey | undefined => {
    if (!input.masterKey) return undefined;
    const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", Buffer.from(input.masterKey), iv); const ciphertext = Buffer.concat([cipher.update(key), cipher.final()]);
    return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
  };
  const unwrapKey = (wrapped: WrappedKey | undefined): Buffer => {
    if (!wrapped) return dataKey;
    if (!input.masterKey) throw new Error("artifact key wrapper unavailable");
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(input.masterKey), Buffer.from(wrapped.iv, "base64")); decipher.setAuthTag(Buffer.from(wrapped.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(wrapped.ciphertext, "base64")), decipher.final()]);
  };
  const persist = async (reference: string, stored: Stored): Promise<void> => {
    if (!root) { records.set(reference, stored); return; }
    await mkdir(root, { recursive: true });
    await writeFile(fileFor(reference, "json"), JSON.stringify({ commitment: stored.commitment, iv: stored.iv.toString("base64"), tag: stored.tag.toString("base64"), wrappedKey: stored.wrappedKey ?? null }), { encoding: "utf8", flag: "wx" });
    await writeFile(fileFor(reference, "bin"), stored.ciphertext, { flag: "wx" });
  };
  const load = async (reference: string): Promise<Stored | undefined> => {
    const memory = records.get(reference); if (memory) return memory;
    if (!root) return undefined;
    try {
      const metadata = JSON.parse(await readFile(fileFor(reference, "json"), "utf8")) as { commitment: StagedArtifactCommitmentV1; iv: string; tag: string; wrappedKey: WrappedKey | null };
      const ciphertext = await readFile(fileFor(reference, "bin"));
      const stored = { commitment: metadata.commitment, iv: Buffer.from(metadata.iv, "base64"), tag: Buffer.from(metadata.tag, "base64"), ciphertext, ...(metadata.wrappedKey ? { wrappedKey: metadata.wrappedKey } : {}) };
      records.set(reference, stored); return stored;
    } catch { return undefined; }
  };
  const evidence = new Map<string, ArtifactDeletionEvidence>();
  const deletionEvidence = async (reference: string) => {
    const memory = evidence.get(reference); if (memory || !root) return memory;
    try {
      const parsed = JSON.parse(await readFile(fileFor(reference, "deleted"), "utf8")) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid deletion evidence");
      const value = parsed as Record<string, unknown>;
      if (Object.keys(value).length !== 4 || value.reference !== reference || typeof value.digest !== "string" || !/^sha256:(?!0{64}$)[0-9a-f]{64}$/.test(value.digest) || typeof value.deletedAt !== "string" || !Number.isFinite(Date.parse(value.deletedAt)) || (value.reason !== "terminal" && value.reason !== "expired")) throw new Error("invalid deletion evidence");
      return Object.freeze(value as unknown as ArtifactDeletionEvidence);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw new Error("invalid artifact deletion evidence", { cause: error }); }
  };
  return Object.freeze({
    async stage(value: Parameters<ArtifactStore["stage"]>[0]) {
      if (!value || typeof value.mediaType !== "string" || !value.mediaType || !(value.bytes instanceof Uint8Array) || value.bytes.byteLength > MAX_ARTIFACT_BYTES) throw new TypeError("artifact input invalid or too large");
      const created = now(); const expires = value.expiresAt ?? new Date(created.getTime() + 7 * 24 * 60 * 60 * 1000);
      if (!Number.isFinite(expires.getTime()) || expires.getTime() <= created.getTime() || expires.getTime() > created.getTime() + 30 * 24 * 60 * 60 * 1000) throw new RangeError("artifact expiry must be within thirty days");
      const digest = `sha256:${createHash("sha256").update(value.bytes).digest("hex")}`;
      const reference = `artifact_${randomBytes(18).toString("base64url")}`;
      const commitment: StagedArtifactCommitmentV1 = Object.freeze({ v: "reelier.staged-artifact-commitment/v1", reference, digest, mediaType: value.mediaType, byteCount: value.bytes.byteLength, creatorPrincipal: value.creatorPrincipal ?? "host", sourceBinding: value.sourceBinding ?? "unbound", expiresAt: expires.toISOString(), deletionState: "retained" });
      const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", dataKey, iv); cipher.setAAD(Buffer.from(JSON.stringify(commitment), "utf8")); const ciphertext = Buffer.concat([cipher.update(Buffer.from(value.bytes)), cipher.final()]);
      await persist(reference, { commitment, iv, tag: cipher.getAuthTag(), ciphertext, wrappedKey: wrappedKey(dataKey) });
      return Object.freeze({ commitment });
    },
    async read(reference: string) {
      if (await deletionEvidence(reference)) throw new Error("artifact unavailable");
      const stored = await load(reference); if (!stored || stored.commitment.deletionState === "deleted") throw new Error("artifact unavailable");
      if (now().getTime() >= Date.parse(stored.commitment.expiresAt)) { await remove(reference, stored, "expired"); throw new Error("artifact expired"); }
      const decipher = createDecipheriv("aes-256-gcm", unwrapKey(stored.wrappedKey), stored.iv); decipher.setAAD(Buffer.from(JSON.stringify(stored.commitment), "utf8")); decipher.setAuthTag(stored.tag); const plaintext = Buffer.concat([decipher.update(stored.ciphertext), decipher.final()]);
      if (plaintext.byteLength !== stored.commitment.byteCount || `sha256:${createHash("sha256").update(plaintext).digest("hex")}` !== stored.commitment.digest) throw new Error("artifact commitment mismatch");
      return plaintext;
    },
    async deleteAfterTerminal(reference: string) { if (await deletionEvidence(reference)) return; const stored = await load(reference); if (!stored) return; await remove(reference, stored, "terminal"); },
    deletionEvidence,
  });

  async function remove(reference: string, stored: Stored, reason: "terminal" | "expired"): Promise<void> {
    const deletedAt = now().toISOString(); evidence.set(reference, Object.freeze({ reference, digest: stored.commitment.digest, deletedAt, reason })); records.delete(reference);
    if (root) { try { await writeFile(fileFor(reference, "deleted"), JSON.stringify(evidence.get(reference)), { encoding: "utf8", flag: "wx" }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; } await Promise.all([rm(fileFor(reference, "json"), { force: true }), rm(fileFor(reference, "bin"), { force: true })]); }
  }
}
