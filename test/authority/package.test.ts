import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

test("public production build resolves authority schemas from its package", () => {
  execFileSync(process.execPath, ["./dist/authority/wire.js"], { cwd: process.cwd() });
  assert.ok(existsSync(path.join(process.cwd(), "dist", "authority", "schemas", "outcome-request.schema.json")));
});
