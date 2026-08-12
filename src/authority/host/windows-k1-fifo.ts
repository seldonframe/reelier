import { authorityCanonicalBytes, authorityDigest } from "../wire.js";

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
