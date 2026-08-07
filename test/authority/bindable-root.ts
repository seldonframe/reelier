// Chooses temp roots whose derived K1 operation-fence port is actually bindable on this host.
//
// WHY THIS EXISTS. The fence's mutual exclusion is one exclusively bound loopback port derived from
// the root, `20000 + (u32be(sha256(canonical-root NUL dev NUL ino)) mod 30000)`
// (docs/specs/compiled-authority-v1.md:339-341). A host may reserve part of that range — Windows
// does, for Hyper-V/WSL/Docker — and `listen` on a reserved port returns **EACCES permanently**.
// The fence retries it as if it were contention, so the operation burns its entire `lockTimeoutMs`
// and returns `busy`, which a gate honestly reports as `unavailable`.
//
// Measured 2026-08-07 on one ordinary developer machine: 501 of the 30000 derivable ports are
// reserved (~1.67% of roots). Because `mkdtemp` redraws the root every run, that made 1–5 tests per
// `gate.test.ts` run fail nondeterministically — a different set each time, and a different set per
// platform. Full method, seven refuted hypotheses, and the reproduction:
// docs/superpowers/plans/2026-08-07-gate-rotator-rootcause.md
//
// WHAT THIS DOES AND DOES NOT DO. It selects *around* a host defect so that suites measure the
// behaviour they are about instead of the host's port table. It does **not** fix the defect: an
// operator whose ledger root lands on a reserved port still gets a ledger where every operation
// stalls for the full budget and then returns `busy`, with no recovery but moving the root. That
// limit is recorded against the spec rule itself, and selecting here must never be read as closing
// it.
//
// PRIOR ART, AND WHY THIS IS NOT THE FIRST COPY. `ledger.test.ts:146` already had an equivalent
// private `bindableTempRoot` (with `derivedFenceBinding`/`bindFenceEndpoint`, retrying the same two
// codes over 64 attempts). That is precisely why the ledger suite's rotators turned out NOT to be
// this defect while `gate.test.ts`, which never had the protection, rotated on it every run.
// This module is the shared form; `gate.test.ts` uses it. `ledger.test.ts` keeps its local copy for
// now — converging it means editing a file carrying 18 committed reds and an open D2 question, and
// that risk buys no behaviour. Converge them in a slice of its own.
//
// WHY THE DERIVATION IS MIRRORED RATHER THAN IMPORTED. `deriveK1OperationFenceBinding` is
// module-private in `src/authority/host/fs-ledger.ts`, and exporting it to reach here would add
// public ABI surface to buy a test convenience. The formula is pinned verbatim by the spec line
// above, and `fence-port.test.ts` pins this mirror against that text. If the two ever diverge this
// helper silently stops selecting and the rotation returns, so the pin is the thing that keeps it
// honest.

import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

/** The arithmetic alone, separated so `fence-port.test.ts` can pin it against a golden value. */
export function fencePortFromMaterial(canonicalRoot: string, dev: bigint, ino: bigint): number {
  const material = Buffer.from(`${canonicalRoot}\0${dev}\0${ino}`, "utf8");
  return 20_000 + (createHash("sha256").update(material).digest().readUInt32BE(0) % 30_000);
}

/** The canonical root string the fence hashes. Mirrors `normalizedK1OperationFenceRoot`. */
export function canonicalFenceRoot(realRoot: string): string {
  const normalized = path.normalize(realRoot);
  return process.platform === "win32" ? normalized.replaceAll("\\", "/").toLowerCase() : normalized;
}

/** The port `FsAuthorityLedger` will derive for this root. Mirrors `deriveK1OperationFenceBinding`. */
export function fencePortForRoot(root: string): number {
  const resolved = path.resolve(root);
  // dev/ino come from the resolved path's lstat, the canonical string from its native realpath —
  // matching `fs-ledger.ts:437-453`, where both name the same directory.
  const identity = lstatSync(resolved, { bigint: true });
  return fencePortFromMaterial(canonicalFenceRoot(realpathSync.native(resolved)), identity.dev, identity.ino);
}

/**
 * True when this host will let the fence bind that port at all.
 *
 * Only the two codes that mean "not this port" answer `false`. Anything else — `EPERM` in a
 * sandbox, `ENETDOWN`, `EAFNOSUPPORT` — is not a statement about the port and is rethrown, matching
 * `ledger.test.ts:152`. Swallowing it would exhaust `attempts` and fail every gate test with a
 * message naming two causes, neither of which is the real one.
 */
export async function fencePortIsBindable(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    const probe = createServer(socket => socket.destroy());
    probe.once("error", error => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE" || code === "EACCES") { resolve(false); return; }
      reject(error);
    });
    probe.listen({ host: "127.0.0.1", port, exclusive: true, reusePort: false }, () => probe.close(() => resolve(true)));
  });
}

/**
 * `mkdtemp` under the system temp dir, redrawn until the root's derived fence port binds.
 *
 * A rejected root is removed rather than left behind. `attempts` is a loud bound: at the measured
 * ~1.67% reservation rate the probability of 40 consecutive rejections is about 1 in 10^71, so
 * exhausting it means the derivation drifted or the host reserved most of the range — either way a
 * thrown error is the honest outcome, never a silent fallback to an unusable root.
 */
export async function bindableTempRoot(prefix: string, attempts = 40): Promise<string> {
  const rejected: number[] = [];
  for (let attempt = 0; attempt < attempts; attempt++) {
    const root = await mkdtemp(path.join(tmpdir(), prefix));
    const port = fencePortForRoot(root);
    if (await fencePortIsBindable(port)) return root;
    await rm(root, { recursive: true, force: true });
    rejected.push(port);
  }
  throw new Error(
    `no temp root with a bindable K1 fence port after ${attempts} attempts; rejected ports ${rejected.join(",")}. ` +
    "Either the fence port derivation drifted from test/authority/bindable-root.ts, or this host reserves most of 20000-49999.",
  );
}
