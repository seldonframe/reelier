import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { authorityDigest } from "../authority/wire.js";

const semanticVersion = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/;
const ignoredSegments = new Set(["node_modules", ".git", ".cache", ".npm", "dist-test", ".reelier"]);

export async function computeInstalledBuildDigest(packageRoot: string): Promise<string> {
  if (typeof packageRoot !== "string" || packageRoot.length === 0) throw new TypeError("installed package root is invalid");
  const root = resolve(packageRoot);
  const manifestPath = join(root, "package.json");
  const manifestBytes = await readFile(manifestPath);
  let manifest: unknown;
  try { manifest = JSON.parse(manifestBytes.toString("utf8")); } catch { throw new TypeError("installed package manifest is invalid JSON"); }
  if (!isPlainRecord(manifest) || typeof manifest.version !== "string" || !semanticVersion.test(manifest.version) || !Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.some(entry => typeof entry !== "string")) throw new TypeError("installed package manifest contract is invalid");
  const fileRules = manifest.files as string[];
  validateFileRules(fileRules);
  const positive = fileRules.filter(rule => !rule.startsWith("!"));
  const negative = fileRules.filter(rule => rule.startsWith("!")).map(rule => rule.slice(1));
  const selected = new Map<string, string>();
  for (const rule of positive) {
    const absolute = join(root, ...rule.split("/"));
    await collectRegularFiles(root, absolute, selected);
  }
  for (const rule of ["package.json", "README.md", "LICENSE"]) {
    if (selected.has(rule)) continue;
    try { await collectRegularFiles(root, join(root, rule), selected); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT" || rule === "package.json") throw error; }
  }
  for (const [path] of selected) {
    if (negative.some(rule => path === rule || path.startsWith(`${rule}/`)) || basename(path) === "installed-build-digest.json") selected.delete(path);
  }
  const paths = [...selected.keys()].sort(compareUtf8);
  assertNoCaseCollisions(paths, "selected installed package paths");
  const files = await Promise.all(paths.map(async path => ({
    path,
    digest: `sha256:${createHash("sha256").update(await readFile(selected.get(path)!)).digest("hex")}`,
  })));
  return authorityDigest({ v: "reelier.installed-build-identity/v1", packageVersion: manifest.version, files });
}

async function collectRegularFiles(root: string, target: string, selected: Map<string, string>): Promise<void> {
  const stat = await lstat(target);
  if (stat.isSymbolicLink()) throw new TypeError(`installed package symbolic link is forbidden: ${portable(root, target)}`);
  const path = portable(root, target);
  if (path.split("/").some(segment => ignoredSegments.has(segment)) || isTemporaryPath(path)) return;
  if (stat.isFile()) {
    if (selected.has(path)) throw new TypeError(`installed package duplicate path: ${path}`);
    selected.set(path, target);
    return;
  }
  if (!stat.isDirectory()) throw new TypeError(`installed package entry is not a regular file or directory: ${path}`);
  const entries = await readdir(target);
  entries.sort(compareUtf8);
  for (const entry of entries) await collectRegularFiles(root, join(target, entry), selected);
}

function validateFileRules(rules: readonly string[]): void {
  const normalized = rules.map(rule => {
    const negated = rule.startsWith("!");
    const path = negated ? rule.slice(1) : rule;
    if (path.length === 0 || path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.split("/").some(part => part === "" || part === "." || part === "..") || /[*?\[\]{};&|`<>$()\r\n]/.test(path)) throw new TypeError("installed package files rule is invalid");
    return `${negated ? "!" : "+"}${path}`;
  });
  if (new Set(normalized).size !== normalized.length) throw new TypeError("installed package files rules contain duplicates");
  assertNoCaseCollisions(normalized, "installed package files rules");
}

function assertNoCaseCollisions(paths: readonly string[], label: string): void {
  const folded = new Map<string, string>();
  for (const path of paths) {
    const key = path.toLocaleLowerCase("en-US");
    const prior = folded.get(key);
    if (prior !== undefined && prior !== path) throw new TypeError(`${label} contain a case collision: ${prior} / ${path}`);
    folded.set(key, path);
  }
}

function portable(root: string, target: string): string {
  const path = relative(root, target).split(sep).join("/");
  if (path === "" || path === ".." || path.startsWith("../")) throw new TypeError("installed package path escapes package root");
  return path;
}

function compareUtf8(left: string, right: string): number { return Buffer.from(left).compare(Buffer.from(right)); }
function isTemporaryPath(path: string): boolean { const name = basename(path); return name === ".DS_Store" || name === "Thumbs.db" || name.endsWith(".tmp") || name.endsWith(".swp") || name.endsWith("~"); }
function isPlainRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype; }
