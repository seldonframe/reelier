import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  authorityCanonicalBytes,
  authorityDigest,
  parseCanonicalAuthorityJson,
  parseAuthorityWire,
} from "../../src/authority/wire.js";
import type { AuthorityKind } from "../../src/authority/types.js";

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
  assert.throws(() => parseAuthorityWire("outcome-request", { ...request, tenant: "forbidden" }), /additional properties/i);
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

test("every frozen wire kind has a valid, deterministic golden vector", () => {
  const vectors = JSON.parse(readFileSync(path.join(process.cwd(), "contract/authority/v1/golden-vectors.json"), "utf8")) as Record<
    AuthorityKind,
    { canonical: string; digest: string; value: unknown }
  >;
  for (const [kind, vector] of Object.entries(vectors) as [AuthorityKind, { canonical: string; digest: string; value: unknown }][]) {
    assert.deepEqual(parseAuthorityWire(kind, vector.value), vector.value, kind);
    assert.equal(authorityCanonicalBytes(vector.value).toString("utf8"), vector.canonical, kind);
    assert.equal(authorityDigest(vector.value), vector.digest, kind);
  }
  assert.throws(() => parseCanonicalAuthorityJson("outcome-request", JSON.stringify(request)), /not RFC 8785\/JCS canonical/);
});
