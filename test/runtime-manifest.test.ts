import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRuntimeDescriptorV1 } from "../src/runtime/manifest.js";

const digest = (char: string) => `sha256:${char.repeat(64)}`;
const local = () => ({
  v: "reelier.runtime-descriptor/v1", adapterId: "eve", adapterVersion: "1.2.3", adapterDigest: digest("1"),
  launchMode: "local-process", command: "bin/eve", args: ["--serve", "agent.json"], cwd: ".",
  connectionRef: null, environmentAllowlist: ["EVE_LOG_LEVEL"], authenticatedBinding: "bearer-file",
  shutdown: "signal-owned-child",
});

test("runtime manifest accepts a path-confined argv descriptor without environment values", () => {
  const parsed = parseRuntimeDescriptorV1(local());
  assert.deepEqual(parsed, local());
  assert.ok(Object.isFrozen(parsed) && Object.isFrozen(parsed.args) && Object.isFrozen(parsed.environmentAllowlist));
});

test("runtime manifest refuses getters and hostile object structure before executing accessors", () => {
  let reads = 0;
  const accessor = local();
  Object.defineProperty(accessor, "command", { enumerable: true, get() { reads++; return "bin/eve"; } });
  assert.throws(() => parseRuntimeDescriptorV1(accessor), TypeError);
  assert.equal(reads, 0);
  const symbol = local() as Record<PropertyKey, unknown>; symbol[Symbol("x")] = true;
  for (const value of [symbol, Object.assign(Object.create(null), local()), { ...local(), secret: "value" }]) {
    assert.throws(() => parseRuntimeDescriptorV1(value), TypeError);
  }
});

test("runtime manifest refuses floating versions, shell strings, traversal, and raw environment values", () => {
  for (const value of [
    { ...local(), adapterVersion: "latest" }, { ...local(), command: "bin/eve && whoami" },
    { ...local(), command: "../eve" }, { ...local(), args: ["--serve; whoami"] }, { ...local(), args: ["$(whoami)"] },
    { ...local(), cwd: "C:\\outside" }, { ...local(), cwd: "../outside" },
    { ...local(), environmentAllowlist: ["TOKEN=secret"] }, { ...local(), environmentAllowlist: ["API_TOKEN"] },
    { ...local(), authenticatedBinding: "none" }, { ...local(), shutdown: "kill-any" },
  ]) assert.throws(() => parseRuntimeDescriptorV1(value), TypeError);
});

test("local and externally managed descriptor fields cannot be mixed", () => {
  assert.throws(() => parseRuntimeDescriptorV1({ ...local(), launchMode: "externally-managed" }), TypeError);
  const external = { ...local(), launchMode: "externally-managed", command: null, args: [], cwd: null, connectionRef: "runtime_1", environmentAllowlist: [], authenticatedBinding: "host-private", shutdown: "external" };
  assert.deepEqual(parseRuntimeDescriptorV1(external), external);
  assert.throws(() => parseRuntimeDescriptorV1({ ...external, connectionRef: "https://example.com/token" }), TypeError);
});
