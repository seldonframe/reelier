import { constants, link, lstat, mkdir, open, realpath, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

interface DirectoryTrustHooks { readonly afterAncestry?: () => Promise<void> }

export async function certificationWorkspaceRoot(workspace: string, internalHooks: DirectoryTrustHooks = {}): Promise<string> {
  return trustExistingDirectory(path.resolve(workspace), "certification workspace must be a confined real directory", internalHooks);
}

export async function assertUnlinkedCreationParent(target: string, internalHooks: DirectoryTrustHooks = {}): Promise<string> {
  const parent = path.dirname(path.resolve(target));
  return trustExistingDirectory(parent, "certification creation parent is linked, reparse-pointed, or not a directory", internalHooks);
}

export async function readUnlinkedFile(file: string): Promise<Buffer> {
  const resolved = path.resolve(file);
  const before = await lstatUnlinkedAncestry(resolved);
  if (!before.isFile()) throw new TypeError("certification file is linked, reparse-pointed, or not a regular file");
  const actual = await realpath(resolved);
  const handle = await open(actual, constants.O_RDONLY);
  try { const after = await handle.stat(); if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino) throw new TypeError("certification file changed during confined read"); return await handle.readFile(); }
  finally { await handle.close(); }
}

export async function confinedExistingDirectory(root: string, relative: readonly string[]): Promise<string | undefined> {
  let current = root;
  for (const segment of relative) {
    assertSegment(segment);
    current = path.join(current, segment);
    let info;
    try { info = await lstat(current); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
    if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError("certification path is linked, reparse-pointed, or not confined");
    const actual = await realpath(current);
    assertContained(root, actual);
    current = actual;
  }
  return current;
}

export async function ensureConfinedDirectory(root: string, relative: readonly string[]): Promise<string> {
  let current = root;
  for (const segment of relative) {
    assertSegment(segment);
    const next = path.join(current, segment);
    try { await mkdir(next); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const info = await lstat(next);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError("certification output path is linked, reparse-pointed, or not confined");
    const actual = await realpath(next);
    assertContained(root, actual);
    current = actual;
  }
  return current;
}

export async function readConfinedFile(root: string, directory: string, name: string): Promise<Buffer> {
  assertSegment(name);
  assertContained(root, directory);
  const file = path.join(directory, name);
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) throw new TypeError("certification artifact is linked, reparse-pointed, or not a regular file");
  const actual = await realpath(file);
  assertContained(root, actual);
  const handle = await open(actual, constants.O_RDONLY);
  try {
    const after = await handle.stat();
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino) throw new TypeError("certification artifact changed during confined read");
    return await handle.readFile();
  } finally { await handle.close(); }
}

export async function publishPrivateContentAddressed(root: string, subdirectory: string, filename: string, content: string): Promise<string> {
  const directory = await ensureConfinedDirectory(root, [subdirectory]);
  assertSegment(filename);
  const output = path.join(directory, filename);
  const temporary = path.join(directory, `.${filename}.${randomBytes(12).toString("hex")}.tmp`);
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try { await handle.writeFile(content, "utf8"); await handle.sync(); } finally { await handle.close(); }
  let created = false;
  try {
    await link(temporary, output);
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return output;
}

function assertSegment(value: string): void { if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\") || value.includes("\0")) throw new TypeError("certification path segment is invalid"); }
function assertContained(root: string, candidate: string): void { const relative = path.relative(root, candidate); if (relative.startsWith("..") || path.isAbsolute(relative)) throw new TypeError("certification path escapes its confined workspace"); }

async function trustExistingDirectory(requested: string, invalidMessage: string, hooks: DirectoryTrustHooks): Promise<string> {
  const before = await lstat(requested);
  if (!before.isDirectory() || before.isSymbolicLink()) throw new TypeError(invalidMessage);
  const walkedBefore = await lstatUnlinkedAncestry(requested);
  assertSameDirectory(before, walkedBefore);
  await hooks.afterAncestry?.();
  const canonical = await realpath(requested);
  const canonicalWalkedAfter = await lstatUnlinkedAncestry(canonical);
  const requestedWalkedAfter = await lstatUnlinkedAncestry(requested);
  const [requestedLstatAfter, requestedStatAfter, canonicalLstatAfter, canonicalStatAfter] = await Promise.all([
    lstat(requested), stat(requested), lstat(canonical), stat(canonical),
  ]);
  for (const observed of [walkedBefore, canonicalWalkedAfter, requestedWalkedAfter, requestedLstatAfter, requestedStatAfter, canonicalLstatAfter, canonicalStatAfter]) assertSameDirectory(before, observed);
  return canonical;
}

function assertSameDirectory(expected: Awaited<ReturnType<typeof lstat>>, observed: Awaited<ReturnType<typeof lstat>>): void {
  if (!observed.isDirectory() || observed.isSymbolicLink() || expected.dev !== observed.dev || expected.ino !== observed.ino) throw new TypeError("certification trusted directory changed during confinement");
}

async function lstatUnlinkedAncestry(target: string): Promise<Awaited<ReturnType<typeof lstat>>> {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  let info = await lstat(current);
  if (info.isSymbolicLink()) throw new TypeError("certification path ancestry is linked or reparse-pointed");
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    info = await lstat(current);
    if (info.isSymbolicLink()) throw new TypeError("certification path ancestry is linked or reparse-pointed");
  }
  return info;
}
