import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

test("public production export parses a frozen object against packaged schemas", async () => {
  execFileSync(process.execPath, ["./dist/authority/wire.js"], { cwd: process.cwd() });
  const authority = await import("reelier/authority");
  const request = { v: "reelier.outcome-request/v1", requestId: "request_1", sourceRefs: { appointment: "ref_1" }, choices: {} };
  assert.deepEqual(authority.parseAuthorityWire("outcome-request", request), request);
  assert.ok(existsSync(path.join(process.cwd(), "dist", "authority", "schemas", "outcome-request.schema.json")));
});
