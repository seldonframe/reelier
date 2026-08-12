import { test } from "node:test";
import assert from "node:assert/strict";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";
import {
  compareWindowsK1FifoTickets,
  parseWindowsK1FifoName,
  parseWindowsK1FifoTicketRecord,
  type WindowsK1FifoTicketRecord,
} from "../../src/authority/host/windows-k1-fifo.js";

const livenessDigest = (record: Omit<WindowsK1FifoTicketRecord, "livenessDigest" | "v">) => authorityDigest({
  v: "reelier.windows-k1-fifo-liveness-material/internal-v1",
  rootMaterialDigest: record.rootMaterialDigest,
  ticket: record.ticket,
  hostDigest: record.hostDigest,
  pid: record.pid,
  nonce: record.nonce,
}) as `sha256:${string}`;
const canonicalIdentity: Omit<WindowsK1FifoTicketRecord, "v" | "livenessDigest"> = {
  rootMaterialDigest: `sha256:${"1".repeat(64)}`,
  ticket: "0000000000000001",
  hostDigest: "2".repeat(64),
  pid: 41001,
  nonce: "3".repeat(64),
};
const canonical: WindowsK1FifoTicketRecord = {
  v: "reelier.windows-k1-fifo-ticket/internal-v1",
  ...canonicalIdentity,
  livenessDigest: livenessDigest(canonicalIdentity),
};

const canonicalBytes = (value: unknown) => authorityCanonicalBytes(value);
const orderKey = `${canonical.ticket}-${canonical.hostDigest}-${canonical.pid.toString(10).padStart(10, "0")}-${canonical.nonce}`;

test("parses the closed canonical Windows K1 FIFO ticket record", () => {
  assert.deepEqual(parseWindowsK1FifoTicketRecord(canonicalBytes(canonical)), canonical);
});

test("refuses noncanonical and substituted ticket records", () => {
  for (const value of [
    { ...canonical, extra: true },
    (({ nonce: _nonce, ...record }) => record)(canonical),
    { ...canonical, ticket: "000000000000000A" },
    { ...canonical, ticket: "0000000000000000" },
    { ...canonical, ticket: "10000000000000000" },
    { ...canonical, pid: Number.MAX_SAFE_INTEGER + 1 },
    { ...canonical, hostDigest: "0".repeat(64) },
    { ...canonical, livenessDigest: `sha256:${"4".repeat(64)}` },
    { ...canonical, livenessDigest: `sha256:${"0".repeat(64)}` },
  ]) assert.throws(() => parseWindowsK1FifoTicketRecord(canonicalBytes(value)));

  assert.throws(() => parseWindowsK1FifoTicketRecord(Buffer.from(JSON.stringify(canonical))));
});

test("accepts a well-formed alternate root digest while binding remains external", () => {
  const alternateIdentity: Omit<WindowsK1FifoTicketRecord, "v" | "livenessDigest"> = { ...canonicalIdentity, rootMaterialDigest: `sha256:${"5".repeat(64)}` };
  const alternate = { v: canonical.v, ...alternateIdentity, livenessDigest: livenessDigest(alternateIdentity) } as WindowsK1FifoTicketRecord;
  assert.deepEqual(parseWindowsK1FifoTicketRecord(canonicalBytes(alternate)), alternate);
});

test("recognizes exactly the four closed ticket artifact names", () => {
  const names = [
    ["preparation", `.ticket-prep-${orderKey}.tmp`],
    ["ticket", `.ticket-${orderKey}`],
    ["retired", `.ticket-retired-${orderKey}`],
    ["withdrawal", `.ticket-withdrawal-${orderKey}`],
  ] as const;
  for (const [kind, name] of names) assert.deepEqual(parseWindowsK1FifoName(name), { kind, orderKey, name });

  for (const name of [
    `.ticket-${orderKey}.tmp`,
    `.ticket-${orderKey}-suffix`,
    `.ticket-foo-${orderKey}`,
    `prefix.ticket-${orderKey}`,
    `.ticket-${orderKey}/child`,
    `.ticket-${orderKey}\u0000`,
    `.ticket-${orderKey}\n`,
    `.ticket-0000000000000000-${canonical.hostDigest}-${canonical.pid.toString(10).padStart(10, "0")}-${canonical.nonce}`,
    `.ticket-${canonical.ticket}-${"0".repeat(64)}-${canonical.pid.toString(10).padStart(10, "0")}-${canonical.nonce}`,
    `.ticket-${canonical.ticket}-${canonical.hostDigest}-0000000000-${canonical.nonce}`,
    `.ticket-${canonical.ticket.toUpperCase()}-${canonical.hostDigest}-${canonical.pid.toString(10).padStart(10, "0")}-${canonical.nonce}`,
    `.ticket-${canonical.ticket}-${canonical.hostDigest.toUpperCase()}-${canonical.pid.toString(10).padStart(10, "0")}-${canonical.nonce}`,
    `.ticket-${canonical.ticket}-${canonical.hostDigest}-${canonical.pid.toString(10)}-${canonical.nonce}`,
    `.ticket-${canonical.ticket}-${canonical.hostDigest}-00000000000000041001-${canonical.nonce}`,
    `.ticket-${canonical.ticket}-${canonical.hostDigest}-${(Number.MAX_SAFE_INTEGER + 1).toString(10)}-${canonical.nonce}`,
  ]) assert.equal(parseWindowsK1FifoName(name), null);
});

test("accepts the canonical max-safe PID ticket name beyond ten digits", () => {
  const pid = Number.MAX_SAFE_INTEGER;
  const maxSafeOrderKey = `${canonical.ticket}-${canonical.hostDigest}-${pid.toString(10).padStart(10, "0")}-${canonical.nonce}`;
  const name = `.ticket-${maxSafeOrderKey}`;
  assert.deepEqual(parseWindowsK1FifoName(name), { kind: "ticket", orderKey: maxSafeOrderKey, name });
});

test("orders tickets by unsigned ticket then closed total-order identity", () => {
  const ticket = (overrides: Partial<WindowsK1FifoTicketRecord>): WindowsK1FifoTicketRecord => ({ ...canonical, ...overrides });
  assert.ok(compareWindowsK1FifoTickets(ticket({ ticket: "0000000000000001" }), ticket({ ticket: "ffffffffffffffff" })) < 0);
  assert.ok(compareWindowsK1FifoTickets(ticket({ hostDigest: "1".repeat(64) }), canonical) < 0);
  assert.ok(compareWindowsK1FifoTickets(ticket({ pid: 41000 }), canonical) < 0);
  assert.ok(compareWindowsK1FifoTickets(ticket({ nonce: "1".repeat(64) }), canonical) < 0);
  assert.equal(compareWindowsK1FifoTickets(canonical, ticket({})), 0);
  assert.notEqual(compareWindowsK1FifoTickets(canonical, ticket({ nonce: "5".repeat(64) })), 0);
});
