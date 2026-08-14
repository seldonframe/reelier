import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const tarballPath = process.argv[2];
assert.ok(tarballPath && path.isAbsolute(tarballPath), "an absolute packed tarball path is required");
assert.ok(existsSync(tarballPath), "packed tarball must exist");
const tarballDigest = `sha256:${createHash("sha256").update(readFileSync(tarballPath)).digest("hex")}`;
assert.match(tarballDigest, /^sha256:[0-9a-f]{64}$/);
console.log(JSON.stringify({ v: "reelier.native-github-labels-packed/v1", tarballDigest, liveProviderStatus: "absent", namedHostConformance: "unchecked" }));
