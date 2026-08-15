import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeInstalledBuildDigest } from "../src/bootstrap/build-identity.js";
import { authorityDigest } from "../src/authority/wire.js";

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

test("installed build digest membership equals npm shipping semantics for nested ignores and mandatory roots", async () => {
  const root = await packageRoot(["dist"]);
  await writeFile(join(root, "dist", ".npmignore"), "secret.js\n");
  await writeFile(join(root, "dist", "visible.js"), "export const visible = true;\n");
  await writeFile(join(root, "dist", "secret.js"), "first excluded bytes\n");
  const expected = await npmShippedDigest(root);
  assert.equal(await computeInstalledBuildDigest(root), expected.digest);
  assert.deepEqual(expected.paths, ["LICENSE", "README.md", "dist/index.js", "dist/visible.js", "package.json"]);
  await writeFile(join(root, "dist", "secret.js"), "different excluded bytes\n");
  assert.equal(await computeInstalledBuildDigest(root), expected.digest);
});

async function npmShippedDigest(root: string): Promise<{ readonly digest: string; readonly paths: readonly string[] }> {
  const npmCli = [
    process.env.npm_execpath,
    join(process.execPath, "..", "node_modules", "npm", "bin", "npm-cli.js"),
    join(process.execPath, "..", "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].find(value => value && existsSync(value));
  assert.ok(npmCli, "npm CLI is available for the package-membership oracle");
  const packed = JSON.parse(execFileSync(process.execPath, [npmCli, "pack", "--ignore-scripts", "--dry-run", "--json"], { cwd: root, encoding: "utf8" })) as [{ files: { path: string }[] }];
  const paths = packed[0].files.map(file => file.path).sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
  const files = await Promise.all(paths.map(async path => ({ path, digest: `sha256:${(await import("node:crypto")).createHash("sha256").update(await readFile(join(root, ...path.split("/")))).digest("hex")}` })));
  return { digest: authorityDigest({ v: "reelier.installed-build-identity/v1", packageVersion: "1.2.3", files }), paths };
}
