import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  createSignedAutonomyBenchmarkBundleV1,
  parseAutonomyBenchmarkRunV1,
  type AutonomyBenchmarkRunV1,
} from "./autonomy-benchmark.js";

type SignedBundleV1 = ReturnType<typeof createSignedAutonomyBenchmarkBundleV1>;

export type AutonomyBenchmarkStoreV1 = Readonly<{
  record(value: AutonomyBenchmarkRunV1): Promise<AutonomyBenchmarkRunV1>;
  load(benchmarkId: string): Promise<AutonomyBenchmarkRunV1 | null>;
  exportMatched(input: Readonly<{ nativeBenchmarkId: string; reelierBenchmarkId: string }>): Promise<SignedBundleV1>;
}>;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function fileName(benchmarkId: string): string {
  if (!ID.test(benchmarkId)) throw new TypeError("benchmark id is invalid");
  return `${createHash("sha256").update(benchmarkId, "utf8").digest("hex")}.json`;
}

async function canonicalRoot(root: string): Promise<string> {
  const resolved = path.resolve(root);
  const canonical = await realpath(resolved);
  if (resolved !== canonical || !(await stat(canonical)).isDirectory()) throw new Error("benchmark root is linked or invalid");
  return canonical;
}

async function signingKey(root: string): Promise<ReturnType<typeof createPrivateKey>> {
  const directory = path.join(root, ".reelier", "operator", "keys");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (await realpath(directory) !== path.resolve(directory)) throw new Error("benchmark key directory is linked or symlinked");
  const target = path.join(directory, "benchmark-ed25519.pem");
  let pem: string;
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || await realpath(target) !== path.resolve(target)) throw new Error("benchmark signing key is linked or invalid");
    pem = await readFile(target, "utf8");
  } catch (error: unknown) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
    pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const handle = await open(target, "wx", 0o600);
    try { await handle.writeFile(pem, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
  }
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("benchmark signing key is invalid");
  return key;
}

export async function createAutonomyBenchmarkStoreV1(input: Readonly<{ root: string }>): Promise<AutonomyBenchmarkStoreV1> {
  const root = await canonicalRoot(input.root);
  const directory = path.join(root, ".reelier", "operator", "benchmarks");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (await realpath(directory) !== path.resolve(directory)) throw new Error("benchmark directory is linked or symlinked");

  const target = (benchmarkId: string): string => path.join(directory, fileName(benchmarkId));
  const load = async (benchmarkId: string): Promise<AutonomyBenchmarkRunV1 | null> => {
    const file = target(benchmarkId);
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 16 * 1024 * 1024 || await realpath(file) !== path.resolve(file)) throw new Error("benchmark record is linked, oversized, or invalid");
      const parsed = parseAutonomyBenchmarkRunV1(JSON.parse(await readFile(file, "utf8")));
      if (parsed.benchmarkId !== benchmarkId) throw new Error("benchmark record identity mismatch");
      return parsed;
    } catch (error: unknown) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw error;
    }
  };

  return Object.freeze({
    load,
    async record(value: AutonomyBenchmarkRunV1): Promise<AutonomyBenchmarkRunV1> {
      const parsed = parseAutonomyBenchmarkRunV1(value);
      const bytes = `${JSON.stringify(parsed)}\n`;
      try {
        const handle = await open(target(parsed.benchmarkId), "wx", 0o600);
        try { await handle.writeFile(bytes, "utf8"); await handle.sync(); }
        finally { await handle.close(); }
      } catch (error: unknown) {
        if ((error as { code?: string }).code !== "EEXIST") throw error;
        const existing = await load(parsed.benchmarkId);
        if (!existing || JSON.stringify(existing) !== JSON.stringify(parsed)) throw new Error("benchmark identity conflict");
      }
      return parsed;
    },
    async exportMatched({ nativeBenchmarkId, reelierBenchmarkId }): Promise<SignedBundleV1> {
      const native = await load(nativeBenchmarkId);
      const reelier = await load(reelierBenchmarkId);
      if (!native || !reelier) throw new Error("matched benchmark run is unavailable");
      const key = await signingKey(root);
      return createSignedAutonomyBenchmarkBundleV1({
        native,
        reelier,
        sign: (payloadDigest) => sign(null, Buffer.from(payloadDigest, "utf8"), key).toString("base64url"),
      });
    },
  });
}
