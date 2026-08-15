import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface LocalGateSigner {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  readonly keyFile: string;
}

/**
 * Load the local gate identity, creating it once when the authority workspace
 * is first activated. The file is intentionally private-key-only: the public
 * key is derived on every start and is placed into the in-memory trust roots.
 * Existing malformed material is never replaced.
 */
export async function loadOrCreateLocalGateSigner(file: string): Promise<LocalGateSigner> {
  const resolved = path.resolve(file);
  try {
    const privateKey = parsePrivateKey(await readFile(resolved));
    return Object.freeze({ privateKey, publicKey: createPublicKey(privateKey), keyFile: resolved });
  } catch (error) {
    if (!isMissing(error)) {
      throw new TypeError(`local gate key is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await mkdir(path.dirname(resolved), { recursive: true });
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const temporary = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, pem, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      await rename(temporary, resolved);
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      await rm(temporary, { force: true });
      const existing = parsePrivateKey(await readFile(resolved));
      return Object.freeze({ privateKey: existing, publicKey: createPublicKey(existing), keyFile: resolved });
    }
  } catch (error) {
    await rm(temporary, { force: true });
    if (isAlreadyExists(error)) {
      const existing = parsePrivateKey(await readFile(resolved));
      return Object.freeze({ privateKey: existing, publicKey: createPublicKey(existing), keyFile: resolved });
    }
    throw new TypeError(`local gate key could not be created: ${error instanceof Error ? error.message : String(error)}`);
  }
  return Object.freeze({ privateKey, publicKey: createPublicKey(privateKey), keyFile: resolved });
}

/** Package-internal governed loader: read-only, non-creating, and stable-handle pinned. */
export async function loadExistingLocalGateSigner(file: string): Promise<LocalGateSigner> {
  if (typeof file !== "string" || file.length === 0) throw new TypeError("local gate key file is invalid");
  const resolved = path.resolve(file);
  let handle;
  try {
    handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile()) throw new TypeError("local gate key must be a regular file");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new TypeError("local gate key changed during read");
    const privateKey = parsePrivateKey(bytes);
    return Object.freeze({ privateKey, publicKey: createPublicKey(privateKey), keyFile: resolved });
  } catch (error) {
    if (isMissing(error)) throw error;
    throw new TypeError(`local gate key is invalid: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await handle?.close();
  }
}

function parsePrivateKey(bytes: Uint8Array): KeyObject {
  const privateKey = createPrivateKey(Buffer.from(bytes));
  if (privateKey.asymmetricKeyType !== "ed25519" || privateKey.type !== "private") throw new TypeError("local gate key must be an Ed25519 private key");
  return privateKey;
}

function isMissing(error: unknown): boolean { return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT"); }
function isAlreadyExists(error: unknown): boolean { return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "EEXIST"); }
