import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROTOCOL, TARGETS, expectedProbe, readClosedArtifact } from "./bootstrap-native-artifacts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const index = process.argv.indexOf("--target");
const name = index >= 0 ? process.argv[index + 1] : undefined;
const entry = TARGETS.find(candidate => `${candidate.platform}-${candidate.architecture}` === name);
if (entry === undefined) fail(`unsupported target ${name ?? "<missing>"}`);
if (process.platform !== entry.platform || process.arch !== entry.architecture) fail(`target ${name} requires matching host ${entry.platform}-${entry.architecture}`);

try {
  execFileSync("cargo", ["test", "--locked", "--manifest-path", "native/bootstrap-helper/Cargo.toml", "--target", entry.target], { cwd: root, stdio: "inherit" });
  execFileSync("cargo", ["clippy", "--locked", "--manifest-path", "native/bootstrap-helper/Cargo.toml", "--target", entry.target, "--", "-D", "warnings"], { cwd: root, stdio: "inherit" });
  execFileSync("cargo", ["build", "--release", "--locked", "--manifest-path", "native/bootstrap-helper/Cargo.toml", "--target", entry.target], { cwd: root, stdio: "inherit" });
  const sourceName = entry.platform === "win32" ? "reelier-bootstrap-helper.exe" : "reelier-bootstrap-helper";
  const source = path.join(root, "native", "bootstrap-helper", "target", entry.target, "release", sourceName);
  const destination = path.join(root, ...entry.path.split("/"));
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  if (entry.platform === "linux") chmodSync(destination, 0o755);
  const artifact = readClosedArtifact(root, entry);
  const probe = JSON.parse(execFileSync(artifact.absolute, ["probe"], { encoding: "utf8", timeout: 10_000 }).trim());
  if (JSON.stringify(probe) !== JSON.stringify(expectedProbe(entry))) throw new Error("probe contract mismatch");
  const evidenceRoot = path.join(root, "native", "bootstrap-helper", "evidence");
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(path.join(evidenceRoot, `${name}.json`), `${JSON.stringify({ v: "reelier.bootstrap-native-build/v1", protocol: PROTOCOL, ...entry, sha256: artifact.digest, probe }, null, 2)}\n`);
  process.stdout.write(`native bootstrap artifact built: ${name} ${artifact.digest}\n`);
} catch (error) { fail(error instanceof Error ? error.message : "unknown build failure"); }

function fail(message) { process.stderr.write(`native bootstrap build refused: ${message}\n`); process.exit(1); }
