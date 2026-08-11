import { chmod, constants, link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

export async function certificationWorkspaceRoot(workspace: string): Promise<string> {
  const resolved = path.resolve(workspace);
  const info = await lstat(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError("certification workspace must be a confined real directory");
  return realpath(resolved);
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
  try {
    await link(temporary, output);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  await chmod(output, 0o600);
  return output;
}

function assertSegment(value: string): void { if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\\") || value.includes("\0")) throw new TypeError("certification path segment is invalid"); }
function assertContained(root: string, candidate: string): void { const relative = path.relative(root, candidate); if (relative.startsWith("..") || path.isAbsolute(relative)) throw new TypeError("certification path escapes its confined workspace"); }
