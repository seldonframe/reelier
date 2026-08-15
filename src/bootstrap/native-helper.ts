import { createHash } from "node:crypto";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MANIFEST_VERSION = "reelier.bootstrap-native-artifacts/v1" as const;
const PROTOCOL = "reelier.bootstrap-native-helper/v1" as const;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

const ARTIFACTS = Object.freeze([
  Object.freeze({
    platform: "linux" as const,
    architecture: "x64" as const,
    target: "x86_64-unknown-linux-gnu",
    path: "native/bootstrap-helper/linux-x64/reelier-bootstrap-helper",
  }),
  Object.freeze({
    platform: "win32" as const,
    architecture: "x64" as const,
    target: "x86_64-pc-windows-msvc",
    path: "native/bootstrap-helper/win32-x64/reelier-bootstrap-helper.exe",
  }),
] as const);

type SupportedPlatform = (typeof ARTIFACTS)[number]["platform"];

export type BootstrapNativeArtifactRefusalReason =
  | "unsupported-platform"
  | "unsupported-architecture"
  | "manifest-invalid"
  | "artifact-missing"
  | "artifact-unsafe"
  | "artifact-format-mismatch"
  | "artifact-digest-mismatch";

export type BootstrapNativeArtifactSelection =
  | Readonly<{
      status: "verified";
      protocol: typeof PROTOCOL;
      platform: SupportedPlatform;
      architecture: "x64";
      target: string;
      absolutePath: string;
      sha256: string;
    }>
  | Readonly<{ status: "refused"; reason: BootstrapNativeArtifactRefusalReason }>;

export interface LoadBootstrapNativeArtifactOptions {
  readonly packageRoot?: string;
  readonly platform?: NodeJS.Platform;
  readonly architecture?: string;
}

interface ManifestArtifact {
  readonly platform: SupportedPlatform;
  readonly architecture: "x64";
  readonly target: string;
  readonly path: string;
  readonly sha256: string;
}

interface NativeArtifactManifest {
  readonly v: typeof MANIFEST_VERSION;
  readonly protocol: typeof PROTOCOL;
  readonly artifacts: readonly [ManifestArtifact, ManifestArtifact];
}

/**
 * Selects a package-carried helper only after its closed manifest, host,
 * native executable header, file identity, and SHA-256 commitment agree.
 * It never compiles, downloads, executes, or falls back to JavaScript.
 */
export async function loadBootstrapNativeArtifact(options: LoadBootstrapNativeArtifactOptions = {}): Promise<BootstrapNativeArtifactSelection> {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  if (platform !== "linux" && platform !== "win32") return refusal("unsupported-platform");
  if (architecture !== "x64") return refusal("unsupported-architecture");

  const packageRoot = path.resolve(options.packageRoot ?? defaultPackageRoot());
  const manifestPath = path.join(packageRoot, "native", "bootstrap-helper", "manifest.json");
  let manifest: NativeArtifactManifest;
  try { manifest = parseManifest(JSON.parse(await readFile(manifestPath, "utf8"))); }
  catch { return refusal("manifest-invalid"); }

  const artifact = manifest.artifacts.find(entry => entry.platform === platform && entry.architecture === architecture);
  if (artifact === undefined) return refusal("manifest-invalid");
  const absolutePath = path.join(packageRoot, ...artifact.path.split("/"));

  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    let before;
    try { before = await lstat(absolutePath); }
    catch (error) { return refusal((error as NodeJS.ErrnoException).code === "ENOENT" ? "artifact-missing" : "artifact-unsafe"); }
    if (!before.isFile() || before.isSymbolicLink()) return refusal("artifact-unsafe");
    const resolved = await realpath(absolutePath);
    if (resolved !== absolutePath) return refusal("artifact-unsafe");
    handle = await open(absolutePath, "r");
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(before, opened)) return refusal("artifact-unsafe");
    const bytes = await handle.readFile();
    const after = await lstat(absolutePath);
    if (!after.isFile() || after.isSymbolicLink() || !sameIdentity(opened, after)) return refusal("artifact-unsafe");
    if (!matchesNativeFormat(platform, bytes)) return refusal("artifact-format-mismatch");
    if (sha256(bytes) !== artifact.sha256) return refusal("artifact-digest-mismatch");
  } catch { return refusal("artifact-unsafe"); }
  finally { await handle?.close().catch(() => {}); }

  return Object.freeze({
    status: "verified" as const,
    protocol: manifest.protocol,
    platform,
    architecture: "x64" as const,
    target: artifact.target,
    absolutePath,
    sha256: artifact.sha256,
  });
}

function parseManifest(value: unknown): NativeArtifactManifest {
  if (!isRecord(value) || !hasExactKeys(value, ["v", "protocol", "artifacts"]) || value.v !== MANIFEST_VERSION || value.protocol !== PROTOCOL || !Array.isArray(value.artifacts) || value.artifacts.length !== ARTIFACTS.length) throw new TypeError("invalid native artifact manifest");
  const artifacts = value.artifacts.map((entry, index) => parseArtifact(entry, ARTIFACTS[index]!));
  return Object.freeze({ v: MANIFEST_VERSION, protocol: PROTOCOL, artifacts: Object.freeze(artifacts) as unknown as readonly [ManifestArtifact, ManifestArtifact] });
}

function parseArtifact(value: unknown, expected: (typeof ARTIFACTS)[number]): ManifestArtifact {
  if (!isRecord(value) || !hasExactKeys(value, ["platform", "architecture", "target", "path", "sha256"]) || value.platform !== expected.platform || value.architecture !== expected.architecture || value.target !== expected.target || value.path !== expected.path || typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) throw new TypeError("invalid native artifact entry");
  return Object.freeze({ ...expected, sha256: value.sha256 });
}

function matchesNativeFormat(platform: SupportedPlatform, bytes: Buffer): boolean {
  if (platform === "linux") return bytes.length >= 20 && bytes.subarray(0, 7).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])) && bytes.readUInt16LE(18) === 62;
  if (bytes.length < 154 || bytes.subarray(0, 2).toString("ascii") !== "MZ") return false;
  const peOffset = bytes.readUInt32LE(0x3c);
  return peOffset <= bytes.length - 26 && bytes.subarray(peOffset, peOffset + 4).equals(Buffer.from([0x50, 0x45, 0, 0])) && bytes.readUInt16LE(peOffset + 4) === 0x8664 && bytes.readUInt16LE(peOffset + 24) === 0x20b;
}

function sameIdentity(left: { dev: number | bigint; ino: number | bigint; size: number | bigint }, right: { dev: number | bigint; ino: number | bigint; size: number | bigint }): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size;
}

function defaultPackageRoot(): string { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."); }
function sha256(bytes: Buffer): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function refusal(reason: BootstrapNativeArtifactRefusalReason): Readonly<{ status: "refused"; reason: BootstrapNativeArtifactRefusalReason }> { return Object.freeze({ status: "refused", reason }); }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype; }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value); return actual.length === keys.length && actual.every(key => keys.includes(key)); }

