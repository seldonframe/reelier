// Pins the K1 fence port derivation that `bindable-root.ts` mirrors.
//
// `bindable-root.ts` reproduces a module-private derivation so suites can select temp roots the
// host will actually let the fence bind (see that file's header for why the host defect exists).
// A silent divergence between the mirror and `src/` would not fail anything — it would quietly stop
// selecting and bring back a rotating, nondeterministic failing set, which is the exact failure
// this whole exercise was spent diagnosing. These pins make that divergence loud.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
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

// The in-range TCP port exclusions this host publishes, intersected with the spec's fence range.
// Empty off win32 (netsh is the only interface that reports these) and empty on a win32 host that
// happens to reserve nothing in range — both of which make the pin below unrunnable, not passing.
function inRangeHostPortExclusions(): ReadonlyArray<readonly [number, number]> {
  if (process.platform !== "win32") return [];
  let output: string;
  try {
    output = execFileSync("netsh", ["interface", "ipv4", "show", "excludedportrange", "protocol=tcp"], { encoding: "utf8" });
  } catch { return []; }
  const ranges: Array<readonly [number, number]> = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(\d+)/);
    if (match === null) continue;
    const start = Math.max(Number(match[1]), 20_000), end = Math.min(Number(match[2]), 49_999);
    if (start <= end) ranges.push([start, end] as const);
  }
  return ranges;
}

test("an OS-excluded fence port refuses at once instead of burning the acquisition budget", async t => {
  // HOST-CONDITIONAL BY OWNER GRANT (2026-08-08). The defect this pins is a property of the HOST,
  // not of this repo: a port the OS reserves is permanently unbindable, `listen` returns EACCES,
  // and the fence used to retry that as if it were contention until the whole budget was gone.
  // It cannot be provoked portably — the fence validates the derived port into [20000,49999] so no
  // privileged port can be injected, exclusion tables differ per machine, and there is no seam to
  // inject a port (withK1OperationFence takes it from the DERIVED binding). So this pin runs only
  // where the host actually reserves a port in range, and SKIPS LOUDLY everywhere else rather than
  // passing vacuously. Linux CI skips it; a Windows dev machine running Hyper-V/WSL/Docker runs it.
  //
  // Measured 2026-08-08 on the authoring host, under the fence's exact listen options
  // ({host:"127.0.0.1",exclusive:true,reusePort:false}): a held port — same-process AND
  // cross-process — reports EADDRINUSE, while an OS-excluded port reports EACCES. That separation
  // is what makes failing fast on EACCES safe: it cannot swallow real cross-process contention.
  // Scope: one host. Re-measure before generalising.
  // The search below is a random sample: each temp root derives one port, and only reserved ports
  // provoke EACCES. So the attempt bound must be derived from how many ports this host actually
  // reserves, NEVER a fixed number. With N reserved of the 30000 derivable, P(miss in A draws) =
  // (1-N/30000)^A: a fixed 20000 draws is ~0 risk at this host's N=501 but a 51% COIN FLIP at N=1,
  // and a miss here is a hard red on a required check. So: size A for P(miss)~1e-6, and when that
  // is unaffordable (a host reserving only a handful in range), skip loudly instead of gambling.
  const excluded = inRangeHostPortExclusions();
  const reserved = excluded.reduce((total, [start, end]) => total + (end - start + 1), 0);
  const MAX_ATTEMPTS = 20_000;
  const attempts = reserved === 0 ? Infinity : Math.ceil(Math.log(1e-6) / Math.log(1 - reserved / 30_000));
  if (attempts > MAX_ATTEMPTS) {
    const why = reserved === 0
      ? (process.platform === "win32"
        ? "this win32 host reserves no TCP port inside 20000-49999"
        : `no port-exclusion interface on '${process.platform}' (netsh is win32-only)`)
      : `this host reserves only ${reserved} of the 30000 derivable ports, so finding one by sampling would need ~${attempts} roots (cap ${MAX_ATTEMPTS})`;
    t.diagnostic(`SKIPPED — ${why}. The EACCES fail-fast is UNPINNED on this host: this run is not evidence either way.`);
    t.skip(`host cannot cheaply provoke an EACCES fence bind — ${why}`);
    return;
  }
  const isExcluded = (port: number) => excluded.some(([start, end]) => port >= start && port <= end);

  // Non-matching roots are removed as we go: at this host's N=501 the search converges in ~838
  // attempts, but retaining every candidate would leave thousands of live temp directories.
  const created: string[] = [];
  let poisoned: string | null = null;
  try {
    for (let attempt = 0; attempt < attempts && poisoned === null; attempt++) {
      const root = await mkdtemp(path.join(tmpdir(), "reelier-fence-eacces-"));
      if (isExcluded(fencePortForRoot(root))) { created.push(root); poisoned = root; }
      else await rm(root, { recursive: true, force: true });
    }
    assert.notEqual(poisoned, null, `no temp root derived an excluded port in ${attempts} attempts, though the host reserves ${reserved} in range (${excluded.map(([s, e]) => `${s}-${e}`).join(", ")}) — if this fires, the mirror's derivation has drifted from the ledger's`);

    const budgetMs = 3_000;
    const ledger = new FsAuthorityLedger(poisoned as string, { now: () => 0, lockTimeoutMs: budgetMs });
    const started = process.hrtime.bigint();
    const result = await ledger.observeClock();
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    // The OUTCOME is unchanged by the fail-fast and must stay unchanged: an unbindable endpoint
    // still yields the refusal-only classification, never a pass. Four-state honesty, not latency,
    // is the load-bearing part here.
    assert.equal(result.ok, false, "an unbindable fence endpoint must never yield a pass");
    assert.ok(["busy", "corruption"].includes((result as { reason: string }).reason),
      `expected a refusal-only classification, got ${JSON.stringify(result)}`);

    // And the latency is the fix: before it, this consumed the entire budget at every budget size.
    assert.ok(elapsedMs < budgetMs / 3,
      `EACCES is permanent, so the fence must refuse at once: took ${elapsedMs.toFixed(0)}ms of the ${budgetMs}ms budget`);
  } finally {
    await Promise.all(created.map(root => rm(root, { recursive: true, force: true })));
  }
});
