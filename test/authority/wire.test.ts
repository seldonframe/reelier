import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorityCanonicalBytes,
  authorityDigest,
  parseAuthorityWire,
} from "../../src/authority/wire.js";

const request = {
  v: "reelier.outcome-request/v1",
  requestId: "req_01HZY3Y7V6K8M4Q2P9N5R1T0X",
  sourceRefs: { appointment: "ref_01HZY3Y7V6K8M4Q2P9N5R1T0X" },
  choices: {},
};

test("OutcomeRequest parses only the closed v1 request boundary", () => {
  const parsed = parseAuthorityWire("outcome-request", request);
  assert.deepEqual(parsed, request);
  assert.notEqual(parsed, request, "parse result must not retain caller object identity");
  assert.throws(() => parseAuthorityWire("outcome-request", { ...request, tenant: "forbidden" }), /additional property/i);
  assert.throws(() => parseAuthorityWire("outcome-request", { ...request, v: "reelier.outcome-request/v2" }), /must be equal/i);
  assert.throws(
    () => parseAuthorityWire("outcome-request", { ...request, sourceRefs: { appointment: "https://example.test/write" } }),
    /pattern/i,
  );
});

test("authority canonical bytes are JCS and digests are sha256-prefixed", () => {
  assert.equal(authorityCanonicalBytes({ z: 1, a: "\u2028" }).toString("utf8"), '{"a":"\u2028","z":1}');
  assert.match(authorityDigest(request), /^sha256:[0-9a-f]{64}$/);
});
