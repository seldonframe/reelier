import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeInstalledBuildDigest } from "../src/bootstrap/build-identity.js";

async function packageRoot(files: readonly string[] = ["dist", "contract"], reverseCreation = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "reelier-build-identity-"));
  await mkdir(join(root, "dist"), { recursive: true });
  await mkdir(join(root, "contract"), { recursive: true });
  await writeFile(join(root, "package.json"), `${JSON.stringify({ name: "reelier", version: "1.2.3", files })}\n`);
  await writeFile(join(root, "README.md"), "readme\n");
  await writeFile(join(root, "LICENSE"), "license\n");
  const writes = [
    [join(root, "dist", "index.js"), "export const value = 1;\n"],
    [join(root, "contract", "schema.json"), "{}\n"],
  ] as const;
  for (const [path, contents] of reverseCreation ? [...writes].reverse() : writes) await writeFile(path, contents);
  return root;
}

test("installed build digest is stable across creation order and changes with shipped bytes or version", async () => {
  const first = await packageRoot();
  const second = await packageRoot(undefined, true);
  assert.equal(await computeInstalledBuildDigest(first), await computeInstalledBuildDigest(second));
  await writeFile(join(second, "dist", "index.js"), "export const value = 2;\n");
  assert.notEqual(await computeInstalledBuildDigest(first), await computeInstalledBuildDigest(second));
  await writeFile(join(second, "dist", "index.js"), "export const value = 1;\n");
  await writeFile(join(second, "package.json"), `${JSON.stringify({ name: "reelier", version: "1.2.4", files: ["dist", "contract"] })}\n`);
  assert.notEqual(await computeInstalledBuildDigest(first), await computeInstalledBuildDigest(second));
});

test("installed build digest follows package files exclusions and ignores unshipped caches and its own project record", async () => {
  const root = await packageRoot(["dist", "!dist/private.js", "contract"]);
  const before = await computeInstalledBuildDigest(root);
  await writeFile(join(root, "dist", "private.js"), "secret\n");
  await writeFile(join(root, "dist", "build.tmp"), "temporary\n");
  await mkdir(join(root, "node_modules", "x"), { recursive: true });
  await writeFile(join(root, "node_modules", "x", "index.js"), "changed\n");
  await mkdir(join(root, ".reelier", "bootstrap"), { recursive: true });
  await writeFile(join(root, ".reelier", "bootstrap", "installed-build-digest.json"), "changed\n");
  assert.equal(await computeInstalledBuildDigest(root), before);
});

test("installed build digest refuses symlinks and case-colliding package paths", async () => {
  const linked = await packageRoot();
  await symlink(join(linked, "contract"), join(linked, "dist", "alias"), "junction");
  await assert.rejects(() => computeInstalledBuildDigest(linked), /symbolic link/i);

  const collided = await packageRoot(["dist/Foo.js", "dist/foo.js", "contract"]);
  await writeFile(join(collided, "dist", "Foo.js"), "x\n");
  await assert.rejects(() => computeInstalledBuildDigest(collided), /case|collision|duplicate/i);
});

test("installed build digest refuses malformed, floating, and traversal package contracts", async () => {
  for (const manifest of [
    { name: "reelier", version: "latest", files: ["dist"] },
    { name: "reelier", version: "1.2.3", files: ["../outside"] },
    { name: "reelier", version: "1.2.3", files: ["dist", "dist"] },
    { name: "reelier", version: "1.2.3", files: ["dist", "dist/index.js"] },
    { name: "reelier", version: "1.2.3", files: ["dist && whoami"] },
  ]) {
    const root = await packageRoot();
    await writeFile(join(root, "package.json"), JSON.stringify(manifest));
    await assert.rejects(() => computeInstalledBuildDigest(root), TypeError);
  }
});

test("installed build digest covers this package's shipped files contract", async () => {
  const first = await computeInstalledBuildDigest(process.cwd());
  const second = await computeInstalledBuildDigest(process.cwd());
  assert.match(first, /^sha256:[0-9a-f]{64}$/);
  assert.equal(second, first);
});
