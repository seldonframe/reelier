import { test } from "node:test";
import assert from "node:assert/strict";
import { redact } from "../src/redact.js";

test("redact: masks an env-named var's value wherever it appears in a string", () => {
  process.env.REELIER_REDACT = "MY_TOKEN";
  process.env.MY_TOKEN = "abcdef123456";
  try {
    const out = redact({ header: `Authorization: ${process.env.MY_TOKEN}` });
    assert.deepEqual(out, { header: "Authorization: «redacted:MY_TOKEN»" });
  } finally {
    delete process.env.REELIER_REDACT;
    delete process.env.MY_TOKEN;
  }
});

test("redact: does not mask env values shorter than 6 chars", () => {
  process.env.REELIER_REDACT = "SHORT";
  process.env.SHORT = "abc12";
  try {
    const out = redact({ v: "prefix-abc12-suffix" });
    assert.deepEqual(out, { v: "prefix-abc12-suffix" });
  } finally {
    delete process.env.REELIER_REDACT;
    delete process.env.SHORT;
  }
});

test("redact: default sk- pattern is always redacted, no env config needed", () => {
  const out = redact({ apiKey: "here is sk-abcdefghijklmnop in text" });
  assert.deepEqual(out, { apiKey: "here is «redacted» in text" });
});

test("redact: default Bearer pattern is always redacted", () => {
  const out = redact({ header: "Authorization: Bearer abcdefgh12345" });
  assert.deepEqual(out, { header: "Authorization: «redacted»" });
});

test("redact: 32+-char hex string in a key-position field name is redacted", () => {
  const hex = "a".repeat(32);
  const out = redact({ apiKey: hex, secret_key: hex, password: hex, authorization: hex });
  assert.deepEqual(out, {
    apiKey: "«redacted»",
    secret_key: "«redacted»",
    password: "«redacted»",
    authorization: "«redacted»",
  });
});

test("redact: 32+-char hex string in a non-key-position field name is left alone", () => {
  const hex = "a".repeat(32);
  const out = redact({ id: hex, checksum: hex });
  assert.deepEqual(out, { id: hex, checksum: hex });
});

test("redact: non-secret strings and values pass through untouched", () => {
  const input = { name: "acme", count: 3, ok: true, nested: { note: "hello world" } };
  assert.deepEqual(redact(input), input);
});

test("redact: deep-walks arrays and nested objects", () => {
  const out = redact({
    items: [{ token: "1234567890abcdef" }, "sk-deadbeefdeadbeef", { nested: { secret: "sk-nestedsecret123" } }],
  });
  assert.deepEqual(out, {
    items: [{ token: "1234567890abcdef" }, "«redacted»", { nested: { secret: "«redacted»" } }],
  });
});

test("redact: primitives and null pass through", () => {
  assert.equal(redact(42), 42);
  assert.equal(redact(true), true);
  assert.equal(redact(null), null);
  assert.equal(redact(undefined), undefined);
});
