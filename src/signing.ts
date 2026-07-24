// Ed25519 signing core — trust-ladder spec §1 ("Signing — Ed25519 over the
// record"). node:crypto only, zero new deps: generateKeyPairSync("ed25519")
// covers keygen, sign/verify cover the round trip. Keys never leave the
// caller's machine except as the PUBLIC half, printed for registration.
//
// A signature over a record proves exactly one thing: "produced by the
// holder of this key, unaltered since signing" — never "the run wasn't
// fabricated before it was recorded" (spec's governing honesty rule). This
// module makes no claim beyond the cryptographic one; wording the claim for
// a human lives at the call sites (cli.ts's `reelier verify` output).

import {
  generateKeyPairSync,
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";
import { readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

/** Where `reelier init --signing` generates/looks for keys by default: `<homedir>/.reelier/signing`. Never inside a repo, never uploaded whole. */
export function signingKeyDir(homedir: string): string {
  return path.join(homedir, ".reelier", "signing");
}

const KEY_ID_RE = /^[0-9a-f]{16}$/;
const PRIVATE_KEY_FILENAME_RE = /^([0-9a-f]{16})\.pem$/;

/** First 16 hex chars of sha256(public key DER, SPKI-encoded) — spec §1's exact derivation. Stable for a given keypair; used to name both PEM files and to reference the key on the wire (`signature.keyId`). */
function computeKeyId(publicKey: KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  return createHash("sha256").update(der).digest("hex").slice(0, 16);
}

export interface GeneratedSigningKey {
  keyId: string;
  privatePath: string;
  publicPath: string;
  publicPem: string;
}

/**
 * Generate a new Ed25519 keypair and write it into `dir` as
 * `<keyId>.pem` (private, PKCS8 PEM) and `<keyId>.pub.pem` (public, SPKI
 * PEM). Never overwrites an existing key for the caller — idempotency
 * (never regenerate when one already exists) is `reelier init --signing`'s
 * job in cli.ts, not this function's; this always generates a fresh key.
 */
export async function generateSigningKeypair(dir: string): Promise<GeneratedSigningKey> {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyId = computeKeyId(publicKey);
  const publicPem = publicKey.export({ type: "spki", format: "pem" }) as string;
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

  await mkdir(dir, { recursive: true });
  const privatePath = path.join(dir, `${keyId}.pem`);
  const publicPath = path.join(dir, `${keyId}.pub.pem`);
  // Private key: restricted permissions where the platform honors them
  // (no-op on Windows, which has no POSIX mode bits — NTFS ACLs are a
  // separate mechanism this doesn't attempt to manage).
  await writeFile(privatePath, privatePem, { mode: 0o600 });
  await writeFile(publicPath, publicPem, { mode: 0o644 });

  return { keyId, privatePath, publicPath, publicPem };
}

export interface LoadedSigningKey {
  keyId: string;
  privateKey: KeyObject;
}

/**
 * Load the signing key from `dir` — the newest `<16-hex>.pem` file by
 * mtime, if more than one exists (a fresh `reelier init --signing` never
 * creates a second one when a valid key is already present, but a user
 * could hand-place extra keys). A missing directory or a directory with no
 * matching files is the normal "no key configured yet" case: returns
 * `null`, no warning. A key file that exists but fails to parse is
 * DIFFERENT — that's an unexpected malformed-key state — so it warns to
 * stderr and returns `null` rather than throwing; a broken signing key must
 * never crash an unrelated `reelier push`.
 */
export async function loadSigningKey(dir: string): Promise<LoadedSigningKey | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }

  const candidates = entries
    .map((name) => name.match(PRIVATE_KEY_FILENAME_RE))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ fileName: m[0], keyId: m[1] }));
  if (candidates.length === 0) return null;

  const withStats = await Promise.all(
    candidates.map(async (c) => {
      const filePath = path.join(dir, c.fileName);
      const st = await stat(filePath);
      return { ...c, filePath, mtimeMs: st.mtimeMs };
    })
  );
  // Sort newest-first. mtimeMs alone is not a total order — on
  // coarse-resolution filesystems two keys written close together can land
  // on the identical millisecond, leaving the comparator's outcome for that
  // pair dependent on `readdir`'s (unspecified) input order. Break ties by
  // fileName so the result is deterministic regardless of directory order.
  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs || a.fileName.localeCompare(b.fileName));

  // Walk newest-first and skip any candidate that fails to read or parse —
  // a malformed newest key must not hide an otherwise-valid older one.
  // Return null only once every candidate has been tried and failed.
  for (const candidate of withStats) {
    let pem: string;
    try {
      pem = await readFile(candidate.filePath, "utf8");
    } catch (err) {
      console.error(`WARNING: signing key ${candidate.filePath} could not be read (${(err as Error).message}) — skipping.`);
      continue;
    }
    try {
      const privateKey = createPrivateKey(pem);
      return { keyId: candidate.keyId, privateKey };
    } catch (err) {
      console.error(
        `WARNING: signing key ${candidate.filePath} is malformed and could not be loaded (${
          (err as Error).message
        }) — pushes will go out unsigned until this is fixed or a new key is generated.`
      );
      continue;
    }
  }
  return null;
}

/** Sign a canonical-JSON digest string (e.g. `digestSha256(record)`) with an Ed25519 private key. Returns base64 — the exact `signature.sig` wire value (wire contract: `sig = base64(ed25519-sign(sha256hex-digest-string))`). */
export function signRecordDigest(privateKey: KeyObject, digest: string): string {
  const sig = cryptoSign(null, Buffer.from(digest, "utf8"), privateKey);
  return sig.toString("base64");
}

/**
 * Verify a base64 Ed25519 signature over a canonical-JSON digest string
 * against a public key (SPKI PEM). Never throws — any malformed input
 * (bad PEM, bad base64, wrong-length signature) is a verification FAILURE,
 * not an exception; callers (the CLI's `verify` command, cloud ingest) must
 * be able to treat "did not verify" uniformly regardless of why.
 */
export function verifyRecordSignature(publicPem: string, digest: string, sigB64: string): boolean {
  try {
    const publicKey = createPublicKey(publicPem);
    const sigBuf = Buffer.from(sigB64, "base64");
    return cryptoVerify(null, Buffer.from(digest, "utf8"), publicKey, sigBuf);
  } catch {
    return false;
  }
}

/** keyId validity check shared by A4's verify command (a malformed --key/keyId argument should error cleanly, not crash deep in crypto internals). */
export function isValidKeyId(keyId: string): boolean {
  return KEY_ID_RE.test(keyId);
}
