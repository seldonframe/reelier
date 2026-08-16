import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TARGETS, expectedProbe, parseClosedManifest, readClosedArtifact } from "./bootstrap-native-artifacts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "native", "bootstrap-helper", "manifest.json");
try {
  let raw;
  try { raw = readFileSync(manifestPath, "utf8"); } catch { throw new Error("manifest.json is missing"); }
  const manifest = parseClosedManifest(JSON.parse(raw));
  for (const [index, entry] of TARGETS.entries()) {
    const artifact = readClosedArtifact(root, entry);
    if (artifact.digest !== manifest.artifacts[index].sha256) throw new Error(`digest mismatch: ${entry.platform}-${entry.architecture}`);
    if (process.platform === entry.platform && process.arch === entry.architecture) {
      const probe = JSON.parse(execFileSync(artifact.absolute, ["probe"], { encoding: "utf8", timeout: 10_000 }).trim());
      if (JSON.stringify(probe) !== JSON.stringify(expectedProbe(entry))) throw new Error(`probe mismatch: ${entry.platform}-${entry.architecture}`);
    }
  }
  const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  for (const key of ["install", "postinstall"]) if (packageJson.scripts?.[key] !== undefined) throw new Error(`${key} hook is forbidden`);
  for (const entry of ["native/bootstrap-helper/manifest.json", ...TARGETS.map(target => target.path)]) if (!packageJson.files?.includes(entry)) throw new Error(`package files omit ${entry}`);
  process.stdout.write("native bootstrap artifacts verified\n");
} catch (error) {
  process.stderr.write(`native bootstrap artifacts unavailable: ${error instanceof Error ? error.message : "unknown verification failure"}\n`);
  process.exit(1);
}

