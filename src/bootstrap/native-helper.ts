import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, open, readFile, realpath } from "node:fs/promises";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MANIFEST_VERSION = "reelier.bootstrap-native-artifacts/v1" as const;
const PROTOCOL = "reelier.bootstrap-native-helper/v2" as const;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const TOKEN = /^[0-9a-f]{64}$/;
const COMMAND_ID = /^[0-9a-f]{16}$/;
const HEX_BYTES = /^(?:[0-9a-f]{2})*$/;
const MAX_BYTES = 1024 * 1024;

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

export interface BootstrapNativeSessionFactoryInput {
  readonly root: string;
  readonly lockName: ".reelier-bootstrap.lock";
  readonly lockBytes: Buffer;
}

export interface BootstrapNativeSession {
  readonly acquisition: Readonly<{ status: "created" } | { status: "recovered"; priorBytes: Buffer }>;
  replaceLock(bytes: Buffer): Promise<void>;
  mkdir(relative: string): Promise<void>;
  writeExclusive(relative: string, bytes: Buffer): Promise<void>;
  writeAtomic(relative: string, bytes: Buffer): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(relative: string, options: Readonly<{ recursive: boolean; missingOk: boolean }>): Promise<void>;
  close(options: Readonly<{ removeLock: boolean }>): Promise<void>;
}

export type BootstrapNativeSessionFactory = (input: BootstrapNativeSessionFactoryInput) => Promise<BootstrapNativeSession>;

export type BootstrapNativeSessionErrorCode = "artifact-unavailable" | "busy" | "protocol-invalid" | "operation-refused" | "process-failed";

export class BootstrapNativeSessionError extends Error {
  readonly code: BootstrapNativeSessionErrorCode;
  readonly artifactReason?: BootstrapNativeArtifactRefusalReason;

  constructor(code: BootstrapNativeSessionErrorCode, message: string, artifactReason?: BootstrapNativeArtifactRefusalReason) {
    super(message);
    this.name = "BootstrapNativeSessionError";
    this.code = code;
    this.artifactReason = artifactReason;
  }
}

export function createBootstrapNativeSessionFactory(options: LoadBootstrapNativeArtifactOptions = {}): BootstrapNativeSessionFactory {
  return input => openBootstrapNativeSession(input, options);
}

/** Opens one verified helper process which owns the lock until `close`. */
export async function openBootstrapNativeSession(input: BootstrapNativeSessionFactoryInput, options: LoadBootstrapNativeArtifactOptions = {}): Promise<BootstrapNativeSession> {
  if (!path.isAbsolute(input.root) || input.lockName !== ".reelier-bootstrap.lock" || input.lockBytes.length > MAX_BYTES) throw new TypeError("native bootstrap session input is invalid");
  const ownerToken = parseOwnerToken(input.lockBytes);
  const artifact = await loadBootstrapNativeArtifact(options);
  if (artifact.status === "refused") throw new BootstrapNativeSessionError("artifact-unavailable", `verified native bootstrap helper unavailable: ${artifact.reason}`, artifact.reason);

  const child = spawn(artifact.absolutePath, ["serve"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })[Symbol.asyncIterator]();
  let stderr = "";
  let closed = false;
  let counter = 0n;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { if (stderr.length < 4096) stderr += String(chunk).slice(0, 4096 - stderr.length); });
  const processFailure = new Promise<never>((_resolve, reject) => {
    child.once("error", error => reject(new BootstrapNativeSessionError("process-failed", `verified native bootstrap helper failed to start: ${error.message}`)));
    child.once("exit", (code, signal) => {
      if (!closed || code !== 0) reject(new BootstrapNativeSessionError("process-failed", `verified native bootstrap helper exited unexpectedly (${code ?? signal ?? "unknown"})${stderr === "" ? "" : `: ${stderr.trim()}`}`));
    });
  });

  const writeLine = (value: Readonly<Record<string, unknown>>): void => {
    if (closed || child.stdin.destroyed || !child.stdin.write(`${JSON.stringify(value)}\n`)) throw new BootstrapNativeSessionError("process-failed", "verified native bootstrap helper input is unavailable");
  };
  const readLine = async (): Promise<unknown> => {
    const result = await Promise.race([lines.next(), processFailure, commandTimeout()]);
    if (result.done) throw new BootstrapNativeSessionError("process-failed", "verified native bootstrap helper closed its output");
    try { return JSON.parse(result.value); }
    catch { throw new BootstrapNativeSessionError("protocol-invalid", "verified native bootstrap helper returned malformed JSON"); }
  };

  try {
    writeLine({ v: PROTOCOL, root: input.root, lock_name: input.lockName, lock_bytes_hex: input.lockBytes.toString("hex"), owner_token: ownerToken });
    const acquisition = parseAcquisition(await readLine());
    if (acquisition.status === "busy") throw new BootstrapNativeSessionError("busy", "named bootstrap is busy: native lock is held");
    if (acquisition.status === "refused") throw new BootstrapNativeSessionError("operation-refused", "verified native bootstrap helper refused the session");

    let pending = Promise.resolve();
    const execute = (command: Readonly<Record<string, unknown>>, accepted: readonly string[] = ["ok"]): Promise<void> => {
      const operation = pending.then(async () => {
        if (closed) throw new BootstrapNativeSessionError("process-failed", "verified native bootstrap session is closed");
        const id = nextCommandId(++counter);
        writeLine({ ...command, id, owner_token: ownerToken });
        const response = parseCommandResponse(await readLine(), id);
        if (!accepted.includes(response.status)) throw new BootstrapNativeSessionError("operation-refused", `verified native bootstrap helper refused ${String(command.op)}: ${response.status}`);
      });
      pending = operation.catch(() => {});
      return operation;
    };
    if (acquisition.status !== "created" && acquisition.status !== "recovered") throw new BootstrapNativeSessionError("protocol-invalid", "verified native bootstrap helper returned an invalid acquisition state");
    const session: BootstrapNativeSession = {
      acquisition: acquisition.status === "created" ? Object.freeze({ status: "created" }) : Object.freeze({ status: "recovered", priorBytes: Buffer.from(acquisition.priorBytesHex, "hex") }),
      replaceLock: bytes => execute(bytesCommand("replace-lock", bytes)),
      mkdir: relative => execute({ op: "mkdir", path: checkedRelative(relative) }, ["ok", "exists"]),
      writeExclusive: (relative, bytes) => execute({ ...bytesCommand("write-exclusive", bytes), path: checkedRelative(relative) }),
      writeAtomic: (relative, bytes) => execute({ ...bytesCommand("write-atomic", bytes), path: checkedRelative(relative) }),
      rename: (from, to) => execute({ op: "rename", from: checkedRelative(from), to: checkedRelative(to) }),
      remove: (relative, removeOptions) => execute({ op: "remove", path: checkedRelative(relative), recursive: removeOptions.recursive, missing_ok: removeOptions.missingOk }),
      close: async closeOptions => {
        await pending;
        if (closed) return;
        const id = nextCommandId(++counter);
        writeLine({ op: "close", id, owner_token: ownerToken, remove_lock: closeOptions.removeLock });
        const response = parseCommandResponse(await readLine(), id);
        closed = true;
        child.stdin.end();
        lines.return?.();
        if (response.status !== "ok") throw new BootstrapNativeSessionError("operation-refused", `verified native bootstrap helper refused close: ${response.status}`);
      },
    };
    return Object.freeze(session);
  } catch (error) {
    closed = true;
    child.stdin.destroy();
    child.kill();
    lines.return?.();
    throw error;
  }
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
  try { manifest = parseManifest(JSON.parse(await readVerifiedRegularFile(manifestPath, packageRoot, "utf8") as string)); }
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

async function readVerifiedRegularFile(file: string, confinedRoot: string, encoding?: BufferEncoding): Promise<string | Buffer> {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) throw new TypeError("unsafe regular file");
  const resolved = await realpath(file);
  const relative = path.relative(confinedRoot, resolved);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || resolved !== file) throw new TypeError("unconfined regular file");
  const handle = await open(file, "r");
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(before, opened)) throw new TypeError("regular file identity changed");
    const bytes = await handle.readFile();
    const after = await lstat(file);
    if (!after.isFile() || after.isSymbolicLink() || !sameIdentity(opened, after) || await realpath(file) !== resolved) throw new TypeError("regular file identity changed");
    return encoding === undefined ? bytes : bytes.toString(encoding);
  } finally { await handle.close(); }
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

function parseOwnerToken(lockBytes: Buffer): string {
  let value: unknown;
  try { value = JSON.parse(lockBytes.toString("utf8")); }
  catch { throw new TypeError("native bootstrap lock bytes are malformed"); }
  if (!isRecord(value) || typeof value.ownerToken !== "string" || !TOKEN.test(value.ownerToken)) throw new TypeError("native bootstrap lock owner token is malformed");
  return value.ownerToken;
}

function parseAcquisition(value: unknown): Readonly<{ status: "created" } | { status: "recovered"; priorBytesHex: string } | { status: "busy" | "refused" }> {
  if (!isRecord(value) || value.v !== PROTOCOL || typeof value.status !== "string") throw new BootstrapNativeSessionError("protocol-invalid", "verified native bootstrap helper returned an invalid acquisition");
  if ((value.status === "created" || value.status === "busy" || value.status === "refused") && hasExactKeys(value, ["v", "status"])) return Object.freeze({ status: value.status });
  if (value.status === "recovered" && hasExactKeys(value, ["v", "status", "prior_bytes_hex"]) && typeof value.prior_bytes_hex === "string" && HEX_BYTES.test(value.prior_bytes_hex) && value.prior_bytes_hex.length <= MAX_BYTES * 2 && value.prior_bytes_hex.length > 0) return Object.freeze({ status: "recovered", priorBytesHex: value.prior_bytes_hex });
  throw new BootstrapNativeSessionError("protocol-invalid", "verified native bootstrap helper returned an invalid acquisition");
}

function parseCommandResponse(value: unknown, id: string): Readonly<{ status: string }> {
  if (!isRecord(value) || !hasExactKeys(value, ["v", "id", "status"]) || value.v !== PROTOCOL || value.id !== id || typeof value.status !== "string") throw new BootstrapNativeSessionError("protocol-invalid", "verified native bootstrap helper returned an invalid command response");
  return Object.freeze({ status: value.status });
}

function bytesCommand(op: "replace-lock" | "write-exclusive" | "write-atomic", bytes: Buffer): Readonly<{ op: typeof op; bytes_hex: string }> {
  if (bytes.length > MAX_BYTES) throw new TypeError("native bootstrap operation is too large");
  return Object.freeze({ op, bytes_hex: bytes.toString("hex") });
}

function checkedRelative(value: string): string {
  if (value.length === 0 || value.includes("\\") || value.includes(":") || path.isAbsolute(value) || value.split("/").some(part => part.length === 0 || part === "." || part === ".." || !/^[A-Za-z0-9._~-]+$/.test(part))) throw new TypeError("native bootstrap path is not a closed relative path");
  return value;
}

function nextCommandId(value: bigint): string {
  const id = value.toString(16).padStart(16, "0");
  if (!COMMAND_ID.test(id)) throw new BootstrapNativeSessionError("protocol-invalid", "native bootstrap command sequence is exhausted");
  return id;
}

function commandTimeout(): Promise<never> {
  return new Promise((_resolve, reject) => {
    const timer = setTimeout(() => reject(new BootstrapNativeSessionError("process-failed", "verified native bootstrap helper timed out")), 10_000);
    timer.unref();
  });
}

function sameIdentity(left: { dev: number | bigint; ino: number | bigint; size: number | bigint }, right: { dev: number | bigint; ino: number | bigint; size: number | bigint }): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size;
}

function defaultPackageRoot(): string { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.."); }
function sha256(bytes: Buffer): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function refusal(reason: BootstrapNativeArtifactRefusalReason): Readonly<{ status: "refused"; reason: BootstrapNativeArtifactRefusalReason }> { return Object.freeze({ status: "refused", reason }); }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype; }
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value); return actual.length === keys.length && actual.every(key => keys.includes(key)); }
