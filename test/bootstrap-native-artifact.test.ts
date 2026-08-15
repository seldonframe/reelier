import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

type Platform = "linux" | "win32";
type RefusalReason = "unsupported-platform" | "unsupported-architecture" | "manifest-invalid" | "artifact-missing" | "artifact-unsafe" | "artifact-format-mismatch" | "artifact-digest-mismatch";
type Selection =
  | Readonly<{ status: "verified"; protocol: "reelier.bootstrap-native-helper/v1"; platform: Platform; architecture: "x64"; target: string; absolutePath: string; sha256: string }>
  | Readonly<{ status: "refused"; reason: RefusalReason }>;
type Loader = (options?: Readonly<{ packageRoot?: string; platform?: NodeJS.Platform; architecture?: string }>) => Promise<Selection>;

async function loadProductionLoader(): Promise<Loader> {
  const compiled = fileURLToPath(new URL("../src/bootstrap/native-helper.js", import.meta.url));
  assert.ok(existsSync(compiled), "bootstrap native artifact loader is missing");
  const module = await import(pathToFileURL(compiled).href) as { loadBootstrapNativeArtifact?: Loader };
  assert.equal(typeof module.loadBootstrapNativeArtifact, "function");
  return module.loadBootstrapNativeArtifact!;
}

function sha256(bytes: Buffer): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

function nativeHeader(platform: Platform): Buffer {
  if (platform === "linux") {
    const bytes = Buffer.alloc(64);
    bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]);
    bytes.writeUInt16LE(62, 18);
    return bytes;
  }
  const bytes = Buffer.alloc(256);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(128, 0x3c);
  bytes.write("PE\0\0", 128, "binary");
  bytes.writeUInt16LE(0x8664, 132);
  bytes.writeUInt16LE(0x20b, 152);
  return bytes;
}

async function fixture(mutator?: (manifest: Record<string, unknown>, files: Map<string, Buffer>) => void): Promise<{ root: string; dispose(): Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-native-artifact-"));
  const files = new Map<string, Buffer>([
    ["native/bootstrap-helper/linux-x64/reelier-bootstrap-helper", nativeHeader("linux")],
    ["native/bootstrap-helper/win32-x64/reelier-bootstrap-helper.exe", nativeHeader("win32")],
  ]);
  const artifacts = [
    { platform: "linux", architecture: "x64", target: "x86_64-unknown-linux-gnu", path: "native/bootstrap-helper/linux-x64/reelier-bootstrap-helper", sha256: sha256(files.get("native/bootstrap-helper/linux-x64/reelier-bootstrap-helper")!) },
    { platform: "win32", architecture: "x64", target: "x86_64-pc-windows-msvc", path: "native/bootstrap-helper/win32-x64/reelier-bootstrap-helper.exe", sha256: sha256(files.get("native/bootstrap-helper/win32-x64/reelier-bootstrap-helper.exe")!) },
  ];
  const manifest: Record<string, unknown> = { v: "reelier.bootstrap-native-artifacts/v1", protocol: "reelier.bootstrap-native-helper/v1", artifacts };
  mutator?.(manifest, files);
  for (const [relative, bytes] of files) { const absolute = path.join(root, ...relative.split("/")); await mkdir(path.dirname(absolute), { recursive: true }); await writeFile(absolute, bytes); }
  const manifestPath = path.join(root, "native", "bootstrap-helper", "manifest.json");
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { root, dispose: () => rm(root, { recursive: true, force: true }) };
}

test("loader selects only the exact digest- and format-verified host artifact", async () => {
  const load = await loadProductionLoader();
  const fx = await fixture();
  try {
    const linux = await load({ packageRoot: fx.root, platform: "linux", architecture: "x64" });
    assert.deepEqual(linux, { status: "verified", protocol: "reelier.bootstrap-native-helper/v1", platform: "linux", architecture: "x64", target: "x86_64-unknown-linux-gnu", absolutePath: path.join(fx.root, "native", "bootstrap-helper", "linux-x64", "reelier-bootstrap-helper"), sha256: sha256(nativeHeader("linux")) });
    const windows = await load({ packageRoot: fx.root, platform: "win32", architecture: "x64" });
    assert.equal(windows.status, "verified");
    if (windows.status === "verified") assert.match(windows.absolutePath, /win32-x64[\\/]reelier-bootstrap-helper\.exe$/);
  } finally { await fx.dispose(); }
});

test("loader returns pathless typed refusals for unsupported hosts and unverified bytes", async () => {
  const load = await loadProductionLoader();
  const cases: readonly [string, Parameters<Loader>[0], ((manifest: Record<string, unknown>, files: Map<string, Buffer>) => void) | undefined, RefusalReason][] = [
    ["platform", { platform: "darwin", architecture: "x64" }, undefined, "unsupported-platform"],
    ["architecture", { platform: "linux", architecture: "arm64" }, undefined, "unsupported-architecture"],
    ["digest", { platform: "linux", architecture: "x64" }, (manifest) => { const artifacts = manifest.artifacts as Record<string, unknown>[]; artifacts[0] = { ...artifacts[0], sha256: `sha256:${"0".repeat(64)}` }; }, "artifact-digest-mismatch"],
    ["format", { platform: "linux", architecture: "x64" }, (_manifest, files) => { const original = files.get("native/bootstrap-helper/linux-x64/reelier-bootstrap-helper")!; const wrong = Buffer.from(original); wrong.writeUInt16LE(183, 18); files.set("native/bootstrap-helper/linux-x64/reelier-bootstrap-helper", wrong); }, "artifact-format-mismatch"],
    ["manifest", { platform: "linux", architecture: "x64" }, (manifest) => { (manifest as { extra?: boolean }).extra = true; }, "manifest-invalid"],
  ];
  for (const [label, options, mutate, reason] of cases) {
    const fx = await fixture(mutate);
    try {
      const result = await load({ packageRoot: fx.root, ...options });
      assert.deepEqual(result, { status: "refused", reason }, label);
      assert.equal("absolutePath" in result, false, label);
    } finally { await fx.dispose(); }
  }
});

test("loader refuses linked artifacts even when the linked bytes match the digest", async (context) => {
  const load = await loadProductionLoader();
  const fx = await fixture();
  try {
    const artifact = path.join(fx.root, "native", "bootstrap-helper", "linux-x64", "reelier-bootstrap-helper");
    const outside = path.join(fx.root, "outside-helper");
    await writeFile(outside, await readFile(artifact));
    await rm(artifact);
    try { await symlink(outside, artifact, "file"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "EPERM") { context.skip("symlink privilege unavailable"); return; } throw error; }
    assert.deepEqual(await load({ packageRoot: fx.root, platform: "linux", architecture: "x64" }), { status: "refused", reason: "artifact-unsafe" });
  } finally { await fx.dispose(); }
});

