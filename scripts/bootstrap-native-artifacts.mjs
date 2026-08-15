import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

export const PROTOCOL = "reelier.bootstrap-native-helper/v1";
export const MANIFEST_VERSION = "reelier.bootstrap-native-artifacts/v1";
export const TARGETS = Object.freeze([
  Object.freeze({ platform: "linux", architecture: "x64", target: "x86_64-unknown-linux-gnu", path: "native/bootstrap-helper/linux-x64/reelier-bootstrap-helper" }),
  Object.freeze({ platform: "win32", architecture: "x64", target: "x86_64-pc-windows-msvc", path: "native/bootstrap-helper/win32-x64/reelier-bootstrap-helper.exe" }),
]);

export function sha256(bytes) { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

export function validateNativeHeader(entry, bytes) {
  if (entry.platform === "linux") return bytes.length >= 20 && bytes.subarray(0, 7).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1])) && bytes.readUInt16LE(18) === 62;
  if (bytes.length < 154 || bytes.subarray(0, 2).toString("ascii") !== "MZ") return false;
  const pe = bytes.readUInt32LE(0x3c);
  return pe <= bytes.length - 26 && bytes.subarray(pe, pe + 4).equals(Buffer.from([0x50, 0x45, 0, 0])) && bytes.readUInt16LE(pe + 4) === 0x8664 && bytes.readUInt16LE(pe + 24) === 0x20b;
}

export function readClosedArtifact(root, entry) {
  const absolute = path.join(root, ...entry.path.split("/"));
  let info;
  try { info = lstatSync(absolute); } catch { throw new Error(`artifact missing: ${entry.platform}-${entry.architecture}`); }
  if (!info.isFile() || info.isSymbolicLink() || realpathSync(absolute) !== absolute) throw new Error(`artifact unsafe: ${entry.platform}-${entry.architecture}`);
  const bytes = readFileSync(absolute);
  if (!validateNativeHeader(entry, bytes)) throw new Error(`artifact format mismatch: ${entry.platform}-${entry.architecture}`);
  return { absolute, bytes, digest: sha256(bytes) };
}

export function parseClosedManifest(value) {
  if (!plain(value) || !keys(value, ["v", "protocol", "artifacts"]) || value.v !== MANIFEST_VERSION || value.protocol !== PROTOCOL || !Array.isArray(value.artifacts) || value.artifacts.length !== 2) throw new Error("manifest shape is invalid");
  const artifacts = value.artifacts.map((candidate, index) => {
    const expected = TARGETS[index];
    if (!plain(candidate) || !keys(candidate, ["platform", "architecture", "target", "path", "sha256"]) || candidate.platform !== expected.platform || candidate.architecture !== expected.architecture || candidate.target !== expected.target || candidate.path !== expected.path || !/^sha256:[0-9a-f]{64}$/.test(candidate.sha256)) throw new Error("manifest artifact is invalid");
    return Object.freeze({ ...expected, sha256: candidate.sha256 });
  });
  return Object.freeze({ v: MANIFEST_VERSION, protocol: PROTOCOL, artifacts: Object.freeze(artifacts) });
}

export function expectedProbe(entry) { return { v: PROTOCOL, status: "ready", platform: entry.platform, architecture: "x64", operations: ["create-lock", "remove-owned-relative"] }; }
function plain(value) { return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype; }
function keys(value, expected) { const actual = Object.keys(value); return actual.length === expected.length && actual.every(key => expected.includes(key)); }

