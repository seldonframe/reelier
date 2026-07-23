import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTimeStampReq, requestTimestamp, imprintMatches, DEFAULT_TSA_URL } from "../src/tsa.js";

// B1 — RFC-3161 timestamps (trust-ladder spec §2).

// SHA-256("hello") — a well-known test vector, used as the golden-bytes
// fixture's digest so the expected DER below is independently checkable.
const HELLO_SHA256_HEX = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

test("buildTimeStampReq: golden DER bytes for a known SHA-256 digest", () => {
  const der = buildTimeStampReq(HELLO_SHA256_HEX);

  // Hand-assembled per RFC 3161's TimeStampReq ASN.1, byte range documented
  // inline so a reviewer can check this against the spec without re-running
  // the implementation under test:
  //   SEQUENCE (TimeStampReq)                         30 39
  //     INTEGER version=1                              02 01 01
  //     SEQUENCE (MessageImprint)                       30 31
  //       SEQUENCE (AlgorithmIdentifier)                  30 0d
  //         OID 2.16.840.1.101.3.4.2.1 (id-sha256)          06 09 60 86 48 01 65 03 04 02 01
  //         NULL parameters                                 05 00
  //       OCTET STRING hashedMessage (32 bytes)            04 20 <32 bytes of HELLO_SHA256_HEX>
  //     BOOLEAN certReq=TRUE                             01 01 ff
  const expectedHex =
    "3039" + // SEQUENCE, len 57
    "020101" + // INTEGER version 1
    "3031" + // SEQUENCE MessageImprint, len 49
    "300d" + // SEQUENCE AlgorithmIdentifier, len 13
    "0609608648016503040201" + // OID id-sha256
    "0500" + // NULL
    "0420" + // OCTET STRING, len 32
    HELLO_SHA256_HEX +
    "0101ff"; // BOOLEAN certReq TRUE

  assert.equal(der.toString("hex"), expectedHex);
  assert.equal(der.length, 59);
});

test("buildTimeStampReq: rejects a malformed digest (wrong length) rather than silently timestamping garbage", () => {
  assert.throws(() => buildTimeStampReq("deadbeef"), /64-char hex/);
});

test("buildTimeStampReq: rejects a non-hex digest of the right length", () => {
  assert.throws(() => buildTimeStampReq("z".repeat(64)), /64-char hex/);
});

test("buildTimeStampReq: accepts uppercase hex, lowercasing internally", () => {
  const derLower = buildTimeStampReq(HELLO_SHA256_HEX);
  const derUpper = buildTimeStampReq(HELLO_SHA256_HEX.toUpperCase());
  assert.deepEqual(derLower, derUpper);
});

test("DEFAULT_TSA_URL is a plain https URL, and REELIER_TSA_URL is meant to override it (not this module's job to read env — push.ts's job)", () => {
  assert.match(DEFAULT_TSA_URL, /^https:\/\//);
});

// ---------------------------------------------------------------------------
// imprintMatches
// ---------------------------------------------------------------------------

/** Build a fake TimeStampResp-shaped buffer that embeds a MessageImprint the same way buildTimeStampReq does (imprintMatches only ever needs to find THIS shape inside whatever larger structure surrounds it). */
function fakeTsaResponseWithImprint(digestHex: string): Buffer {
  const messageImprintDer = buildTimeStampReqMessageImprintOnly(digestHex);
  // Wrap it with some unrelated leading/trailing bytes to prove the search
  // isn't just "the whole buffer is one" — a real TSA response has a lot
  // of CMS structure around the TSTInfo.
  return Buffer.concat([Buffer.from([0xde, 0xad, 0xbe, 0xef]), messageImprintDer, Buffer.from([0xca, 0xfe])]);
}

// Re-derive just the MessageImprint TLV the same way buildTimeStampReq does
// internally, for fixture construction only (not re-exported from tsa.ts —
// this test file builds its own fixture bytes rather than reaching into the
// module's internals).
function buildTimeStampReqMessageImprintOnly(digestHex: string): Buffer {
  const full = buildTimeStampReq(digestHex);
  // The MessageImprint is everything after the outer SEQUENCE header (2
  // bytes) + the version INTEGER (3 bytes), up to (but not including) the
  // trailing certReq BOOLEAN (3 bytes) — a fixed layout for this specific
  // digest length, verified by the golden-bytes test above.
  return full.subarray(5, full.length - 3);
}

test("imprintMatches: a genuine imprint (embedded inside a larger buffer, like a real TSA response) matches its digest", () => {
  const response = fakeTsaResponseWithImprint(HELLO_SHA256_HEX);
  assert.equal(imprintMatches(response.toString("base64"), HELLO_SHA256_HEX), true);
});

test("imprintMatches: a mismatched digest (imprint was computed over something else) fails", () => {
  const response = fakeTsaResponseWithImprint(HELLO_SHA256_HEX);
  const otherDigest = "0".repeat(64);
  assert.equal(imprintMatches(response.toString("base64"), otherDigest), false);
});

test("imprintMatches: no SHA-256 OID anywhere in the token -> false, never throws", () => {
  const garbage = Buffer.from([1, 2, 3, 4, 5]).toString("base64");
  assert.equal(imprintMatches(garbage, HELLO_SHA256_HEX), false);
});

test("imprintMatches: malformed base64 -> false, never throws", () => {
  assert.equal(imprintMatches("not-valid-base64!!!", HELLO_SHA256_HEX), false);
});

test("imprintMatches: malformed digestHex argument -> false, never throws", () => {
  const response = fakeTsaResponseWithImprint(HELLO_SHA256_HEX);
  assert.equal(imprintMatches(response.toString("base64"), "short"), false);
});

// ---------------------------------------------------------------------------
// requestTimestamp — fail-open matrix.
// ---------------------------------------------------------------------------

async function withCapturedStderr<T>(run: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = ((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  }) as typeof console.error;
  try {
    const result = await run();
    return { result, lines };
  } finally {
    console.error = original;
  }
}

test("requestTimestamp: success -> {tsa,token} with token = base64 of the raw response bytes", async () => {
  const responseBytes = fakeTsaResponseWithImprint(HELLO_SHA256_HEX);
  let sawContentType: string | undefined;
  let sawBody: unknown;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    sawContentType = (init?.headers as Record<string, string>)["content-type"];
    sawBody = init?.body;
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => responseBytes.buffer.slice(responseBytes.byteOffset, responseBytes.byteOffset + responseBytes.byteLength),
    } as unknown as Response;
  }) as typeof fetch;

  const result = await requestTimestamp("https://tsa.example/tsr", HELLO_SHA256_HEX, fetchImpl);
  assert.deepEqual(result, { tsa: "https://tsa.example/tsr", token: responseBytes.toString("base64") });
  assert.equal(sawContentType, "application/timestamp-query");
  assert.ok(Buffer.isBuffer(sawBody));
});

test("requestTimestamp: TSA down (network error) -> null + one stderr line, never throws", async () => {
  const fetchImpl = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  const { result, lines } = await withCapturedStderr(() =>
    requestTimestamp("https://tsa.example/tsr", HELLO_SHA256_HEX, fetchImpl)
  );
  assert.equal(result, null);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /ECONNREFUSED/);
});

test("requestTimestamp: non-2xx response -> null + one stderr line", async () => {
  const fetchImpl = (async () => {
    return { ok: false, status: 503 } as unknown as Response;
  }) as typeof fetch;
  const { result, lines } = await withCapturedStderr(() =>
    requestTimestamp("https://tsa.example/tsr", HELLO_SHA256_HEX, fetchImpl)
  );
  assert.equal(result, null);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /503/);
});

test("requestTimestamp: empty response body -> null + one stderr line", async () => {
  const fetchImpl = (async () => {
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response;
  }) as typeof fetch;
  const { result, lines } = await withCapturedStderr(() =>
    requestTimestamp("https://tsa.example/tsr", HELLO_SHA256_HEX, fetchImpl)
  );
  assert.equal(result, null);
  assert.equal(lines.length, 1);
});

test("requestTimestamp: a malformed digest never reaches the network — null + one stderr line, fetch not called", async () => {
  let fetchCalled = false;
  const fetchImpl = (async () => {
    fetchCalled = true;
    throw new Error("should never be called");
  }) as typeof fetch;
  const { result, lines } = await withCapturedStderr(() => requestTimestamp("https://tsa.example/tsr", "not-hex", fetchImpl));
  assert.equal(result, null);
  assert.equal(fetchCalled, false);
  assert.equal(lines.length, 1);
});
