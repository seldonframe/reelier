import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { authorityCanonicalBytes, authorityDigest } from "../../src/authority/wire.js";
import {
  compareWindowsK1FifoTickets,
  createWindowsK1FifoHost,
  parseWindowsK1FifoName,
  parseWindowsK1FifoTicketRecord,
  type WindowsK1FifoBinding,
  type WindowsK1FifoPermit,
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
    `.ticket-000000000000000A-${canonical.hostDigest}-${canonical.pid.toString(10).padStart(10, "0")}-${canonical.nonce}`,
    `.ticket-${canonical.ticket}-${"A".repeat(64)}-${canonical.pid.toString(10).padStart(10, "0")}-${canonical.nonce}`,
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

const fifoRoot = async () => mkdtemp(path.join(tmpdir(), "reelier-windows-k1-fifo-"));

const fifoBinding = async (root: string): Promise<WindowsK1FifoBinding> => {
  const identity = await lstat(root, { bigint: true });
  const canonicalRoot = process.platform === "win32"
    ? path.normalize(root).replaceAll("\\", "/").toLowerCase()
    : path.normalize(root);
  const materialDigest = `sha256:${createHash("sha256").update(`${canonicalRoot}\0${identity.dev}\0${identity.ino}`, "utf8").digest("hex")}` as const;
  return {
    canonicalRoot,
    rootIdentity: { dev: String(identity.dev), ino: String(identity.ino), mode: String(identity.mode) },
    materialDigest,
  };
};

const runPublicationCrash = async (root: string, binding: WindowsK1FifoBinding, point: string): Promise<number | null> => {
  const moduleUrl = pathToFileURL(path.resolve("dist-test/src/authority/host/windows-k1-fifo.js")).href;
  const source = `import{createWindowsK1FifoHost}from ${JSON.stringify(moduleUrl)};const host=createWindowsK1FifoHost({root:process.argv[1],binding:JSON.parse(process.argv[2]),runtime:{monotonicNow:()=>0,delay:async()=>{}},faultInjector(point){if(point===process.argv[3])process.exit(91);}});await host.enter({ticket:1n,pid:process.pid,nonce:${JSON.stringify("3".repeat(64))},deadline:100});process.exit(92);`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source, root, JSON.stringify(binding), point], { stdio: "ignore" });
    child.once("error", reject);
    child.once("close", resolve);
  });
};

test("Windows K1 FIFO publication leaves one typed recoverable artifact at every crash boundary", { timeout: 60_000 }, async t => {
  const boundaries = [
    { point: "after-fifo-queue-create", artifact: "none", bytes: "none" },
    { point: "after-fifo-preparation-create", artifact: "preparation", bytes: "none" },
    { point: "after-fifo-ticket-file-create", artifact: "preparation", bytes: "zero" },
    { point: "after-fifo-ticket-one-byte-prefix", artifact: "preparation", bytes: "prefix" },
    { point: "after-fifo-ticket-complete-write", artifact: "preparation", bytes: "complete" },
    { point: "after-fifo-ticket-file-sync", artifact: "preparation", bytes: "complete" },
    { point: "after-fifo-preparation-directory-sync", artifact: "preparation", bytes: "complete" },
    { point: "after-fifo-ticket-rename", artifact: "ticket", bytes: "complete" },
    { point: "after-fifo-queue-directory-sync", artifact: "ticket", bytes: "complete" },
    { point: "after-fifo-ticket-final-validation", artifact: "ticket", bytes: "complete" },
  ] as const;

  for (const boundary of boundaries) await t.test(boundary.point, async () => {
    const root = await fifoRoot();
    try {
      const binding = await fifoBinding(root);
      assert.equal(await runPublicationCrash(root, binding, boundary.point), 91);
      const queue = path.join(root, ".authority-ledger-k1-fifo");
      const names = await readdir(queue);
      if (boundary.artifact === "none") {
        assert.deepEqual(names, []);
        return;
      }
      assert.equal(names.length, 1);
      const parsed = parseWindowsK1FifoName(names[0]);
      assert.equal(parsed?.kind, boundary.artifact);
      const artifact = path.join(queue, names[0]);
      const children = await readdir(artifact);
      if (boundary.bytes === "none") assert.deepEqual(children, []);
      else {
        assert.deepEqual(children, ["ticket.json"]);
        const bytes = await readFile(path.join(artifact, "ticket.json"));
        if (boundary.bytes === "zero") assert.equal(bytes.length, 0);
        if (boundary.bytes === "prefix") assert.equal(bytes.length, 1);
        if (boundary.bytes === "complete") {
          const record = parseWindowsK1FifoTicketRecord(bytes);
          assert.equal(record.rootMaterialDigest, binding.materialDigest);
          assert.equal(record.ticket, "0000000000000001");
          assert.equal(record.hostDigest, createHash("sha256").update(hostname(), "utf8").digest("hex"));
          assert.equal(record.nonce, "3".repeat(64));
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

test("Windows K1 FIFO confinement refuses substituted roots and linked queue targets without external writes", async () => {
  const parent = await fifoRoot();
  const root = path.join(parent, "root");
  const external = path.join(parent, "external");
  await mkdir(root);
  await mkdir(external);
  const canary = path.join(external, "canary.txt");
  const canaryBytes = Buffer.from("external-canary-must-not-change\n");
  await writeFile(canary, canaryBytes);
  try {
    const binding = await fifoBinding(root);
    const runtime = { monotonicNow: () => 0, delay: async () => {} };
    assert.throws(() => createWindowsK1FifoHost({ root, binding: { ...binding, materialDigest: `sha256:${"9".repeat(64)}` }, runtime }));

    const host = createWindowsK1FifoHost({ root, binding, runtime });
    await symlink(external, path.join(root, ".authority-ledger-k1-fifo"), process.platform === "win32" ? "junction" : "dir");
    assert.deepEqual(await host.enter({ ticket: 1n, pid: process.pid, nonce: "3".repeat(64), deadline: 100 }), { ok: false, reason: "corruption" });
    assert.deepEqual(await readFile(canary), canaryBytes);

    const linkedRoot = path.join(parent, "linked-root");
    await symlink(external, linkedRoot, process.platform === "win32" ? "junction" : "dir");
    const externalBinding = await fifoBinding(external);
    assert.throws(() => createWindowsK1FifoHost({ root: linkedRoot, binding: externalBinding, runtime }), /link|reparse|confined/i);
    assert.deepEqual(await readFile(canary), canaryBytes);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("opaque FIFO permit has no serializable state and rejects unrelated hosts", async () => {
  const parent = await fifoRoot();
  const root = path.join(parent, "root");
  const otherRoot = path.join(parent, "other");
  await mkdir(root);
  await mkdir(otherRoot);
  try {
    const runtime = { monotonicNow: () => 0, delay: async () => {} };
    const host = createWindowsK1FifoHost({ root, binding: await fifoBinding(root), runtime });
    const result = await host.enter({ ticket: 1n, pid: process.pid, nonce: "3".repeat(64), deadline: 100 });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const permit: WindowsK1FifoPermit = result.permit;
    assert.equal(Object.isFrozen(permit), true);
    assert.deepEqual(Object.keys(permit), []);
    assert.equal(JSON.stringify(permit), "{}");

    const unrelatedHost = createWindowsK1FifoHost({ root: otherRoot, binding: await fifoBinding(otherRoot), runtime });
    await assert.rejects(() => unrelatedHost.withdraw(permit));
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
