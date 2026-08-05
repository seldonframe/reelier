import assert from "node:assert/strict";
import test from "node:test";
import { parseArenaAdapterCommand, sanitizeArenaBundleValue } from "../src/arena-cli.js";

test("Arena CLI parses adapter commands as argv without shell interpolation", () => {
  assert.deepEqual(parseArenaAdapterCommand('{"command":"eve","args":["arena-run","--fixture","marketing"]}'), { command: "eve", args: ["arena-run", "--fixture", "marketing"] });
  assert.throws(() => parseArenaAdapterCommand("eve arena-run"), /JSON/);
});

test("Arena CLI sanitizer removes credentials and private execution fields", () => {
  assert.deepEqual(sanitizeArenaBundleValue({ artifact: { headline: "safe" }, token: "secret", rawPrompt: "private", nested: { value: "keep" } }), { artifact: { headline: "safe" }, nested: { value: "keep" } });
});
