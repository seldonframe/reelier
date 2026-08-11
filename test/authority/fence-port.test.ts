// Pins the K1 fence port derivation that `bindable-root.ts` mirrors.
//
// `bindable-root.ts` reproduces a module-private derivation so suites can select temp roots the
// host will let the PRIMARY fence bind (see that file's header for why primary selection remains).
// A silent divergence between the mirror and `src/` would not fail anything — it would quietly stop
// selecting and bring back a rotating, nondeterministic failing set, which is the exact failure
// this whole exercise was spent diagnosing. These pins make that divergence loud.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { FsAuthorityLedger } from "../../src/authority/host/fs-ledger.js";
import { bindableTempRoot, canonicalFenceRoot, fencePortForRoot, fencePortFromMaterial, fencePortIsBindable } from "./bindable-root.js";

test("the mirrored fence port derivation matches its golden values and stated range", () => {
  // Golden values, computed once from the spec formula
  // `20000 + ((u32be of the first four bytes of SHA-256 over <root> NUL <dev> NUL <ino>) mod 30000)`.
  // If these move, the mirror's arithmetic changed and every selected root is being chosen wrong.
  assert.equal(fencePortFromMaterial("/x", 1n, 2n), 20_110);
  assert.equal(fencePortFromMaterial("c:/tmp/root", 3n, 4n), 35_646);

  // The range is not decoration: `parseK1OperationFenceRuntime` refuses a binding outside it.
  for (const [root, dev, ino] of [["/a", 0n, 0n], ["/b", 1n << 40n, 99n], ["c:/x/y/z", 7n, 1n << 50n]] as const) {
    const port = fencePortFromMaterial(root, dev, ino);
    assert.ok(port >= 20_000 && port <= 49_999, `${root} derived ${port}, outside 20000-49999`);
  }

  // Windows folds separators and case; elsewhere the path is taken verbatim. Asserted per platform
  // because a single cross-platform assertion here is vacuous on Linux, where `path.join` never
  // produces a backslash in the first place.
  if (process.platform === "win32") {
    assert.equal(canonicalFenceRoot("C:\\Temp\\Root"), "c:/temp/root", "win32 folds separators and case");
  } else {
    assert.equal(canonicalFenceRoot("/Tmp/Root"), "/Tmp/Root", "off win32 the path is verbatim — case is significant");
  }
});

test("the mirror derives the SAME port the ledger actually uses", async () => {
  // The load-bearing pin. The source-text pin below catches a changed formula, but it cannot catch
  // a changed *input* — dropping the case fold, dropping the win32 separator fold, or feeding the
  // resolved path instead of the native realpath all leave that regex green while this mirror
  // silently starts choosing the wrong port and the rotation returns. This compares against the
  // binding the ledger itself computed, so any of those drifts fails here.
  for (const shape of ["", "/", "/."] as const) {
    const root = await bindableTempRoot("reelier-fence-agree-");
    try {
      const ledger = new FsAuthorityLedger(`${root}${shape}`, { now: () => 0 }) as unknown as {
        k1OperationFenceBinding: { endpoint: { port: number } } | null;
      };
      assert.notEqual(ledger.k1OperationFenceBinding, null, `${shape || "<plain>"}: the ledger derived a binding`);
      assert.equal(
        ledger.k1OperationFenceBinding?.endpoint.port, fencePortForRoot(root),
        `${shape || "<plain>"}: mirror and ledger must agree, or selection is choosing the wrong port`,
      );
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("src still derives the fence port by the formula this mirror reproduces", () => {
  // A source-text pin, deliberately. The derivation is module-private, so there is no symbol to
  // import; binding to the literal is the only available linkage. If this fails, do not "fix" it —
  // re-derive test/authority/bindable-root.ts against the new formula, then update these pins.
  const source = readFileSync(path.resolve("src/authority/host/fs-ledger.ts"), "utf8");
  assert.match(source, /port\s*=\s*20_000\s*\+\s*digest\.readUInt32BE\(0\)\s*%\s*30_000/,
    "fs-ledger.ts no longer derives the fence port the way bindable-root.ts mirrors");
  assert.match(source, /`\$\{canonicalRoot\}\\0\$\{identity\.dev\}\\0\$\{identity\.ino\}`/,
    "fs-ledger.ts no longer hashes canonicalRoot NUL dev NUL ino");
});

test("a selected temp root has a bindable fence port, and selection is deterministic per root", async () => {
  const root = await bindableTempRoot("reelier-fence-pin-");
  try {
    const port = fencePortForRoot(root);
    assert.ok(port >= 20_000 && port <= 49_999);
    assert.equal(fencePortForRoot(root), port, "the same root derives the same port");
    assert.equal(await fencePortIsBindable(port), true, "a selected root's port binds");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("selection actually discriminates — an unselected root can be unbindable, and the probe says so", async () => {
  // Proves the probe is not vacuously true: a port this process holds exclusively reads as
  // unbindable, so `bindableTempRoot` is testing something real rather than always returning true.
  const { createServer } = await import("node:net");
  const held = await new Promise<{ port: number; close: () => Promise<void> }>((resolve, reject) => {
    const server = createServer(socket => socket.destroy());
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      if (address === null || typeof address === "string") { reject(new Error("no port")); return; }
      resolve({ port: address.port, close: () => new Promise<void>(done => server.close(() => done())) });
    });
  });
  try {
    assert.equal(await fencePortIsBindable(held.port), false, "a held port must read as unbindable");
  } finally {
    await held.close();
  }
  // And a certainly-free port reads as bindable.
  assert.equal(await fencePortIsBindable(0), true, "port 0 is always bindable");
});

test("an unrelated listener on the primary fence port cannot disable a fresh ledger root", async () => {
  const { createServer } = await import("node:net");
  const root = await bindableTempRoot("reelier-fence-foreign-");
  const port = fencePortForRoot(root);
  const foreign = createServer(socket => socket.end("foreign-service\n"));
  await new Promise<void>((resolve, reject) => {
    foreign.once("error", reject);
    foreign.listen({ host: "127.0.0.1", port, exclusive: true, reusePort: false }, resolve);
  });
  try {
    const result = await new FsAuthorityLedger(root, { now: () => 1, lockTimeoutMs: 1_000 }).observeClock();
    assert.deepEqual(result, { ok: true, status: "advanced", observedAt: "1970-01-01T00:00:00.001Z" });
  } finally {
    await new Promise<void>(resolve => foreign.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("a fence identity response completes without resetting its probing client", async () => {
  const { createConnection, createServer } = await import("node:net");
  const hostModule = await import("../../src/authority/host/fs-ledger.js") as unknown as {
    __testServeK1OperationFenceIdentity?: (socket: import("node:net").Socket, materialDigest: string) => void;
  };
  const serve = hostModule.__testServeK1OperationFenceIdentity;
  assert.equal(typeof serve, "function", "the host-private identity responder is available to exercise its socket lifecycle");
  const materialDigest = `sha256:${"1".repeat(64)}`;
  const server = createServer(socket => serve!(socket, materialDigest));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, resolve);
  });
  try {
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string", "the test server reports its ephemeral port");
    const observed = await new Promise<{ text: string; error: NodeJS.ErrnoException | null }>(resolve => {
      let text = "";
      const client = createConnection({ host: "127.0.0.1", port: address.port });
      client.setEncoding("utf8");
      client.on("data", chunk => { text += chunk; });
      client.once("error", error => resolve({ text, error }));
      client.once("end", () => resolve({ text, error: null }));
    });
    assert.equal(observed.text, `reelier-k1-operation-fence/v1 ${materialDigest}\n`);
    assert.equal(observed.error, null, "a complete identity response ends cleanly instead of reporting ECONNRESET");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
