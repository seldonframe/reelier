import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import {
  type FileHandle,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
} from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { authorityCanonicalBytes, authorityDigest } from "../wire.js";
import { coordinationHostDigest } from "./fs-ledger-coordination.js";

const TICKET_VERSION = "reelier.windows-k1-fifo-ticket/internal-v1";
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const HEX = /^[0-9a-f]{64}$/;
const TICKET = /^[0-9a-f]{16}$/;
const PID = /^[0-9]+$/;
const NAME = /^(?:\.ticket-prep-(.+)\.tmp|\.ticket-retired-(.+)|\.ticket-withdrawal-(.+)|\.ticket-(.+))$/;

export interface WindowsK1FifoBinding {
  readonly canonicalRoot: string;
  readonly rootIdentity: Readonly<{ dev: string; ino: string; mode: string }>;
  readonly materialDigest: `sha256:${string}`;
}

export interface WindowsK1FifoTicketRecord {
  readonly v: "reelier.windows-k1-fifo-ticket/internal-v1";
  readonly rootMaterialDigest: `sha256:${string}`;
  readonly ticket: string;
  readonly hostDigest: string;
  readonly pid: number;
  readonly nonce: string;
  readonly livenessDigest: `sha256:${string}`;
}

export interface WindowsK1FifoRuntime {
  readonly monotonicNow: () => number;
  readonly delay: (milliseconds: number) => Promise<void>;
}

declare const windowsK1FifoPermitBrand: unique symbol;
export interface WindowsK1FifoPermit {
  readonly [windowsK1FifoPermitBrand]: never;
}

export type WindowsK1FifoEnterResult =
  | Readonly<{ ok: false; reason: "busy" | "corruption" }>
  | Readonly<{ ok: true; permit: WindowsK1FifoPermit }>;

export interface WindowsK1FifoHost {
  enter(input: Readonly<{ ticket: bigint; pid: number; nonce: string; deadline: number }>): Promise<WindowsK1FifoEnterResult>;
  withdraw(permit: WindowsK1FifoPermit): Promise<"withdrawn" | "busy" | "corruption">;
  close(permit: WindowsK1FifoPermit): Promise<void>;
}

interface FileIdentity {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly mode: bigint;
  readonly nlink: bigint;
}

interface PermitBinding {
  readonly owner: object;
  status: "queued";
  readonly ticketName: string;
  readonly ticketIdentity: WindowsK1FifoTicketRecord;
  readonly ticketFileIdentity: FileIdentity;
  readonly ticketBytes: Buffer;
  readonly livenessServer: null;
}

const permitBindings = new WeakMap<WindowsK1FifoPermit, PermitBinding>();

export type ParsedWindowsK1FifoName =
  | Readonly<{ kind: "preparation"; orderKey: string; name: string }>
  | Readonly<{ kind: "ticket"; orderKey: string; name: string }>
  | Readonly<{ kind: "retired"; orderKey: string; name: string }>
  | Readonly<{ kind: "withdrawal"; orderKey: string; name: string }>;

export function parseWindowsK1FifoTicketRecord(bytes: Buffer): WindowsK1FifoTicketRecord {
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new TypeError("invalid Windows K1 FIFO ticket record JSON"); }
  if (authorityCanonicalBytes(value).compare(bytes) !== 0) throw new TypeError("Windows K1 FIFO ticket record is not canonical");
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("invalid Windows K1 FIFO ticket record");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join("\0") !== ["hostDigest", "livenessDigest", "nonce", "pid", "rootMaterialDigest", "ticket", "v"].join("\0")) throw new TypeError("Windows K1 FIFO ticket record keys are not closed");
  if (record.v !== TICKET_VERSION || typeof record.rootMaterialDigest !== "string" || typeof record.ticket !== "string" || typeof record.hostDigest !== "string" || typeof record.pid !== "number" || typeof record.nonce !== "string" || typeof record.livenessDigest !== "string") throw new TypeError("invalid Windows K1 FIFO ticket record");
  if (!SHA256.test(record.rootMaterialDigest) || record.rootMaterialDigest === `sha256:${"0".repeat(64)}` || !TICKET.test(record.ticket) || record.ticket === "0000000000000000" || !HEX.test(record.hostDigest) || record.hostDigest === "0".repeat(64) || !Number.isSafeInteger(record.pid) || record.pid <= 0 || !HEX.test(record.nonce) || record.nonce === "0".repeat(64) || !SHA256.test(record.livenessDigest) || record.livenessDigest === `sha256:${"0".repeat(64)}`) throw new TypeError("invalid Windows K1 FIFO ticket record fields");
  const expectedLivenessDigest = authorityDigest({ v: "reelier.windows-k1-fifo-liveness-material/internal-v1", rootMaterialDigest: record.rootMaterialDigest, ticket: record.ticket, hostDigest: record.hostDigest, pid: record.pid, nonce: record.nonce });
  if (record.livenessDigest !== expectedLivenessDigest) throw new TypeError("Windows K1 FIFO ticket liveness digest mismatch");
  return Object.freeze({ v: TICKET_VERSION, rootMaterialDigest: record.rootMaterialDigest as `sha256:${string}`, ticket: record.ticket, hostDigest: record.hostDigest, pid: record.pid, nonce: record.nonce, livenessDigest: record.livenessDigest as `sha256:${string}` });
}

export function parseWindowsK1FifoName(name: string): ParsedWindowsK1FifoName | null {
  const match = NAME.exec(name);
  if (match === null) return null;
  const kinds = ["preparation", "retired", "withdrawal", "ticket"] as const;
  for (let index = 0; index < kinds.length; index++) {
    const orderKey = match[1 + index];
    if (orderKey !== undefined && parseOrderKey(orderKey)) return Object.freeze({ kind: kinds[index], orderKey, name });
  }
  return null;
}

function parseOrderKey(orderKey: string): boolean {
  const [ticket, hostDigest, pidText, nonce, ...extra] = orderKey.split("-");
  if (extra.length > 0 || ticket === undefined || hostDigest === undefined || pidText === undefined || nonce === undefined) return false;
  if (!TICKET.test(ticket) || ticket === "0000000000000000" || !HEX.test(hostDigest) || hostDigest === "0".repeat(64) || !HEX.test(nonce) || nonce === "0".repeat(64) || !PID.test(pidText)) return false;
  const pid = Number(pidText);
  return Number.isSafeInteger(pid) && pid > 0 && pid.toString(10).padStart(10, "0") === pidText;
}

export function compareWindowsK1FifoTickets(left: WindowsK1FifoTicketRecord, right: WindowsK1FifoTicketRecord): number {
  const leftTicket = BigInt(`0x${left.ticket}`);
  const rightTicket = BigInt(`0x${right.ticket}`);
  if (leftTicket !== rightTicket) return leftTicket < rightTicket ? -1 : 1;
  for (const [leftValue, rightValue] of [[left.hostDigest, right.hostDigest], [left.pid.toString(10).padStart(10, "0"), right.pid.toString(10).padStart(10, "0")], [left.nonce, right.nonce]] as const) {
    if (leftValue !== rightValue) return leftValue < rightValue ? -1 : 1;
  }
  return 0;
}

export function createWindowsK1FifoHost(input: Readonly<{
  root: string;
  binding: WindowsK1FifoBinding;
  runtime: WindowsK1FifoRuntime;
  faultInjector?: (point: string) => void;
}>): WindowsK1FifoHost {
  if (typeof input.runtime?.monotonicNow !== "function" || typeof input.runtime?.delay !== "function" || input.faultInjector !== undefined && typeof input.faultInjector !== "function") throw new TypeError("invalid Windows K1 FIFO runtime");
  const root = validateBoundRoot(input.root, input.binding);
  const owner = Object.freeze({});
  const fault = (point: string): void => input.faultInjector?.(point);

  return Object.freeze({
    async enter(attempt: Readonly<{ ticket: bigint; pid: number; nonce: string; deadline: number }>): Promise<WindowsK1FifoEnterResult> {
      let now: number;
      try { now = input.runtime.monotonicNow(); }
      catch { return Object.freeze({ ok: false, reason: "corruption" }); }
      if (!Number.isFinite(now) || !Number.isFinite(attempt.deadline)) return Object.freeze({ ok: false, reason: "corruption" });
      if (now >= attempt.deadline) return Object.freeze({ ok: false, reason: "busy" });
      if (attempt.ticket <= 0n || attempt.ticket > 0xffffffffffffffffn || !Number.isSafeInteger(attempt.pid) || attempt.pid <= 0 || !HEX.test(attempt.nonce) || attempt.nonce === "0".repeat(64)) return Object.freeze({ ok: false, reason: "corruption" });

      try {
        validateBoundRoot(root, input.binding);
        const ticket = attempt.ticket.toString(16).padStart(16, "0");
        const hostDigest = coordinationHostDigest(hostname());
        const recordWithoutLiveness = {
          rootMaterialDigest: input.binding.materialDigest,
          ticket,
          hostDigest,
          pid: attempt.pid,
          nonce: attempt.nonce,
        };
        const ticketIdentity: WindowsK1FifoTicketRecord = Object.freeze({
          v: TICKET_VERSION,
          ...recordWithoutLiveness,
          livenessDigest: authorityDigest({ v: "reelier.windows-k1-fifo-liveness-material/internal-v1", ...recordWithoutLiveness }) as `sha256:${string}`,
        });
        const ticketBytes = authorityCanonicalBytes(ticketIdentity);
        const orderKey = `${ticket}-${hostDigest}-${attempt.pid.toString(10).padStart(10, "0")}-${attempt.nonce}`;
        const ticketName = `.ticket-${orderKey}`;
        const preparationName = `.ticket-prep-${orderKey}.tmp`;
        const queue = path.join(root, ".authority-ledger-k1-fifo");
        const queueIdentity = await ensureQueue(root, queue, input.binding, fault);
        const preparation = path.join(queue, preparationName);
        const committed = path.join(queue, ticketName);

        await mkdir(preparation, { mode: 0o700 });
        const preparationStat = await lstat(preparation, { bigint: true });
        if (preparationStat.isSymbolicLink() || !preparationStat.isDirectory() || (await readdir(preparation)).length !== 0) throw new Error("invalid Windows K1 FIFO preparation");
        const preparationIdentity = fileIdentity(preparationStat);
        fault("after-fifo-preparation-create");

        const ticketPath = path.join(preparation, "ticket.json");
        let handle: FileHandle | undefined;
        let ticketFileIdentity: FileIdentity;
        try {
          handle = await open(ticketPath, "wx", 0o600);
          const created = await handle.stat({ bigint: true });
          if (!created.isFile() || created.isSymbolicLink() || created.nlink !== 1n) throw new Error("invalid Windows K1 FIFO ticket file");
          ticketFileIdentity = fileIdentity(created);
          fault("after-fifo-ticket-file-create");
          await writeAll(handle, ticketBytes.subarray(0, 1), 0);
          fault("after-fifo-ticket-one-byte-prefix");
          await writeAll(handle, ticketBytes.subarray(1), 1);
          fault("after-fifo-ticket-complete-write");
          await handle.sync();
          fault("after-fifo-ticket-file-sync");
        } finally {
          await handle?.close();
        }

        await validateTicketArtifact(preparation, preparationIdentity, ticketFileIdentity!, ticketBytes, ticketIdentity);
        await syncDirectory(preparation);
        fault("after-fifo-preparation-directory-sync");
        await validateTicketArtifact(preparation, preparationIdentity, ticketFileIdentity!, ticketBytes, ticketIdentity);
        try { await lstat(committed); throw new Error("Windows K1 FIFO ticket destination already exists"); }
        catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
        await rename(preparation, committed);
        fault("after-fifo-ticket-rename");
        await validateQueue(root, queue, queueIdentity, input.binding);
        await syncDirectory(queue);
        fault("after-fifo-queue-directory-sync");
        await validateQueue(root, queue, queueIdentity, input.binding);
        await validateTicketArtifact(committed, preparationIdentity, ticketFileIdentity!, ticketBytes, ticketIdentity);
        validateBoundRoot(root, input.binding);
        fault("after-fifo-ticket-final-validation");

        const permit = Object.freeze({}) as WindowsK1FifoPermit;
        permitBindings.set(permit, {
          owner,
          status: "queued",
          ticketName,
          ticketIdentity,
          ticketFileIdentity: ticketFileIdentity!,
          ticketBytes,
          livenessServer: null,
        });
        return Object.freeze({ ok: true, permit });
      } catch {
        return Object.freeze({ ok: false, reason: "corruption" });
      }
    },

    async withdraw(permit: WindowsK1FifoPermit): Promise<"withdrawn" | "busy" | "corruption"> {
      const state = permitBindings.get(permit);
      if (state === undefined || state.owner !== owner) throw new TypeError("Windows K1 FIFO permit belongs to another host");
      return "busy";
    },

    async close(permit: WindowsK1FifoPermit): Promise<void> {
      const state = permitBindings.get(permit);
      if (state === undefined || state.owner !== owner) throw new TypeError("Windows K1 FIFO permit belongs to another host");
    },
  });
}

function validateBoundRoot(requested: string, binding: WindowsK1FifoBinding): string {
  const resolved = path.resolve(requested);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  let currentStat = lstatSync(current, { bigint: true });
  if (currentStat.isSymbolicLink()) throw new TypeError("Windows K1 FIFO root ancestry is linked or reparse-pointed");
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    currentStat = lstatSync(current, { bigint: true });
    if (currentStat.isSymbolicLink()) throw new TypeError("Windows K1 FIFO root ancestry is linked or reparse-pointed");
  }
  if (!currentStat.isDirectory()) throw new TypeError("Windows K1 FIFO root must be a real directory");
  const canonical = realpathSync.native(resolved);
  const canonicalStat = lstatSync(canonical, { bigint: true });
  if (!sameFileIdentity(fileIdentity(currentStat), fileIdentity(canonicalStat))) throw new TypeError("Windows K1 FIFO root is not confined");
  if (process.platform !== "win32" && canonical !== resolved) throw new TypeError("Windows K1 FIFO root is linked or reparse-pointed");
  const canonicalRoot = normalizeRoot(canonical);
  const observedIdentity = { dev: String(canonicalStat.dev), ino: String(canonicalStat.ino), mode: String(canonicalStat.mode) };
  const materialDigest = `sha256:${createHash("sha256").update(`${canonicalRoot}\0${canonicalStat.dev}\0${canonicalStat.ino}`, "utf8").digest("hex")}`;
  if (binding.canonicalRoot !== canonicalRoot || binding.materialDigest !== materialDigest || binding.rootIdentity.dev !== observedIdentity.dev || binding.rootIdentity.ino !== observedIdentity.ino || binding.rootIdentity.mode !== observedIdentity.mode) throw new TypeError("Windows K1 FIFO root binding mismatch");
  return canonical;
}

async function ensureQueue(root: string, queue: string, binding: WindowsK1FifoBinding, fault: (point: string) => void): Promise<FileIdentity> {
  let created = false;
  try { await mkdir(queue, { mode: 0o700 }); created = true; }
  catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
  const observed = await validateQueue(root, queue, undefined, binding);
  if (created) {
    fault("after-fifo-queue-create");
    await syncDirectory(root);
  }
  return observed;
}

async function validateQueue(root: string, queue: string, expected: FileIdentity | undefined, binding: WindowsK1FifoBinding): Promise<FileIdentity> {
  validateBoundRoot(root, binding);
  const info = await lstat(queue, { bigint: true });
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Windows K1 FIFO queue is linked, reparse-pointed, or not a directory");
  const identity = fileIdentity(info);
  if (expected !== undefined && !sameFileIdentity(expected, identity)) throw new Error("Windows K1 FIFO queue identity changed");
  const canonicalQueue = await realpath(queue);
  const canonicalInfo = await lstat(canonicalQueue, { bigint: true });
  if (!sameFileIdentity(identity, fileIdentity(canonicalInfo))) throw new Error("Windows K1 FIFO queue is not confined");
  const canonicalParent = await realpath(path.dirname(canonicalQueue));
  const parentInfo = await lstat(canonicalParent, { bigint: true });
  const bound = binding.rootIdentity;
  if (String(parentInfo.dev) !== bound.dev || String(parentInfo.ino) !== bound.ino || String(parentInfo.mode) !== bound.mode || path.basename(canonicalQueue) !== ".authority-ledger-k1-fifo") throw new Error("Windows K1 FIFO queue escaped its exact root");
  return identity;
}

async function validateTicketArtifact(directory: string, expectedDirectory: FileIdentity, expectedFile: FileIdentity, expectedBytes: Buffer, expectedRecord: WindowsK1FifoTicketRecord): Promise<void> {
  const directoryStat = await lstat(directory, { bigint: true });
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory() || !sameFileIdentity(expectedDirectory, fileIdentity(directoryStat))) throw new Error("Windows K1 FIFO ticket directory changed");
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length !== 1 || entries[0].name !== "ticket.json" || entries[0].isSymbolicLink() || !entries[0].isFile()) throw new Error("invalid Windows K1 FIFO ticket contents");
  const ticketPath = path.join(directory, "ticket.json");
  const ticketStat = await lstat(ticketPath, { bigint: true });
  if (ticketStat.isSymbolicLink() || !ticketStat.isFile() || ticketStat.nlink !== 1n || !sameFileIdentity(expectedFile, fileIdentity(ticketStat))) throw new Error("Windows K1 FIFO ticket file changed");
  const observedBytes = await readFile(ticketPath);
  if (!observedBytes.equals(expectedBytes)) throw new Error("Windows K1 FIFO ticket bytes changed");
  const observedRecord = parseWindowsK1FifoTicketRecord(observedBytes);
  if (compareWindowsK1FifoTickets(observedRecord, expectedRecord) !== 0 || observedRecord.rootMaterialDigest !== expectedRecord.rootMaterialDigest || observedRecord.livenessDigest !== expectedRecord.livenessDigest) throw new Error("Windows K1 FIFO ticket record changed");
}

async function writeAll(handle: FileHandle, bytes: Buffer, position: number): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const result = await handle.write(bytes, offset, bytes.length - offset, position + offset);
    if (!Number.isSafeInteger(result.bytesWritten) || result.bytesWritten <= 0 || result.bytesWritten > bytes.length - offset) throw new Error("invalid Windows K1 FIFO write progress");
    offset += result.bytesWritten;
  }
}

async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  try { await handle.sync(); }
  finally { await handle.close(); }
}

function normalizeRoot(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.replaceAll("\\", "/").toLowerCase() : normalized;
}

function fileIdentity(info: Readonly<{ dev: bigint; ino: bigint; mode: bigint; nlink: bigint }>): FileIdentity {
  return { dev: info.dev, ino: info.ino, mode: info.mode, nlink: info.nlink };
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.nlink === right.nlink;
}

function hasCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException)?.code === code;
}
