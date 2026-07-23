// RFC-3161 trusted timestamps (trust-ladder spec §2) — kill backdating by
// carrying third-party proof a record existed by time T. Zero new deps: a
// minimal, hand-rolled DER writer scoped EXACTLY to the one message this
// CLI ever needs to build (TimeStampReq over a SHA-256 digest, certReq
// true) — the same "scoped subset, not a general library" discipline as
// policy.ts's hand-rolled YAML reader. If a future TSA ever needs more than
// this, that need is the signal to reach for a real ASN.1 library, not to
// grow this file.
//
// Fail-open, everywhere (spec's prime directive at the push seam): a push
// must never hang or fail because a third-party TSA is slow or down. Every
// failure path here returns null/false and prints exactly one stderr line;
// nothing throws out of `requestTimestamp`.

// ---------------------------------------------------------------------------
// Minimal DER writer — only what TimeStampReq needs.
// ---------------------------------------------------------------------------

/** DER length octets (short form under 128, long form above — TimeStampReq's fields never exceed a couple hundred bytes, but this is written correctly for any size rather than assuming). */
function derLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const bytes: number[] = [];
  let n = len;
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n = Math.floor(n / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function derTlv(tag: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLength(value.length), value]);
}

const DER_TAG_INTEGER = 0x02;
const DER_TAG_OCTET_STRING = 0x04;
const DER_TAG_NULL = 0x05;
const DER_TAG_BOOLEAN = 0x01;
const DER_TAG_SEQUENCE = 0x30;

/**
 * DER encoding of the OBJECT IDENTIFIER 2.16.840.1.101.3.4.2.1
 * (id-sha256, NIST algorithm registry) — the well-known constant byte
 * sequence `06 09 60 86 48 01 65 03 04 02 01` (tag 0x06, length 9, then the
 * 9 base-128 body octets). Hardcoded rather than computed by a general OID
 * encoder — this is the ONLY OID this file ever emits.
 */
const SHA256_OID_DER = Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
const NULL_DER = Buffer.from([DER_TAG_NULL, 0x00]);

const HEX64_RE = /^[0-9a-f]{64}$/i;

/**
 * Build the DER bytes of a RFC-3161 `TimeStampReq` (v1) over a SHA-256
 * digest (given as a 64-char lowercase/uppercase hex string, no `sha256:`
 * prefix — strip that at the call site, e.g. `digestSha256(record).slice(7)`):
 *
 *   TimeStampReq ::= SEQUENCE {
 *     version         INTEGER { v1(1) },
 *     messageImprint  MessageImprint,     -- { hashAlgorithm, hashedMessage }
 *     certReq         BOOLEAN DEFAULT FALSE  -- explicitly TRUE here
 *   }
 *   (reqPolicy/nonce/extensions are all omitted — optional, and this CLI
 *   asks nothing more specific than "timestamp this digest".)
 *
 * `hashAlgorithm` is always `{ id-sha256, NULL }` — the only digest this
 * CLI ever asks a TSA to timestamp is `canonicalJson`'s own sha256.
 * `certReq: true` asks the TSA to include its signing certificate in the
 * response, which `openssl ts -verify` (the CLI's documented manual-verify
 * path) needs.
 *
 * Throws on a malformed digestHex — never silently timestamps garbage.
 */
export function buildTimeStampReq(digestHex: string): Buffer {
  if (!HEX64_RE.test(digestHex)) {
    throw new Error(`buildTimeStampReq expects a 64-char hex SHA-256 digest (no 'sha256:' prefix), got: ${JSON.stringify(digestHex)}`);
  }
  const hashedMessage = Buffer.from(digestHex.toLowerCase(), "hex");

  const algorithmIdentifier = derTlv(DER_TAG_SEQUENCE, Buffer.concat([SHA256_OID_DER, NULL_DER]));
  const hashedMessageOctets = derTlv(DER_TAG_OCTET_STRING, hashedMessage);
  const messageImprint = derTlv(DER_TAG_SEQUENCE, Buffer.concat([algorithmIdentifier, hashedMessageOctets]));

  const version = derTlv(DER_TAG_INTEGER, Buffer.from([0x01]));
  const certReq = derTlv(DER_TAG_BOOLEAN, Buffer.from([0xff]));

  return derTlv(DER_TAG_SEQUENCE, Buffer.concat([version, messageImprint, certReq]));
}

// ---------------------------------------------------------------------------
// Request a timestamp — fail-open.
// ---------------------------------------------------------------------------

/** Bundled default RFC-3161 TSA (freetsa.org — a public, no-signup timestamp authority). Override via REELIER_TSA_URL; this CLI never silently switches TSAs on its own, same explicit-update discipline as the bundled prices table (src/prices.ts). */
export const DEFAULT_TSA_URL = "https://freetsa.org/tsr";

export interface RequestedTimestamp {
  tsa: string;
  /** base64 of the raw DER TimeStampResp bytes returned by the TSA. */
  token: string;
}

/**
 * POST a TimeStampReq to `tsaUrl` over `digestHex` (a 64-char hex SHA-256
 * digest, no prefix) and return the response, base64-encoded, or `null` on
 * ANY failure (malformed digest, network error, non-2xx, empty body) —
 * exactly one stderr line per failure, never a thrown error. A push must
 * never hang or fail because a third-party TSA is slow or unreachable
 * (spec §2's fail-open rule).
 */
export async function requestTimestamp(
  tsaUrl: string,
  digestHex: string,
  fetchImpl: typeof fetch = fetch
): Promise<RequestedTimestamp | null> {
  let reqDer: Buffer;
  try {
    reqDer = buildTimeStampReq(digestHex);
  } catch (err) {
    console.error(
      `WARNING: could not build the RFC-3161 timestamp request (${(err as Error).message}) — pushing without a timestamp.`
    );
    return null;
  }

  let res: Response;
  try {
    res = await fetchImpl(tsaUrl, {
      method: "POST",
      headers: { "content-type": "application/timestamp-query" },
      body: reqDer,
    });
  } catch (err) {
    console.error(
      `WARNING: RFC-3161 timestamp request to ${tsaUrl} failed (${(err as Error).message}) — pushing without a timestamp.`
    );
    return null;
  }
  if (!res.ok) {
    console.error(`WARNING: RFC-3161 TSA ${tsaUrl} returned HTTP ${res.status} — pushing without a timestamp.`);
    return null;
  }

  let bodyBuf: Buffer;
  try {
    bodyBuf = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error(
      `WARNING: could not read the RFC-3161 TSA response body from ${tsaUrl} (${(err as Error).message}) — pushing without a timestamp.`
    );
    return null;
  }
  if (bodyBuf.length === 0) {
    console.error(`WARNING: RFC-3161 TSA ${tsaUrl} returned an empty response — pushing without a timestamp.`);
    return null;
  }

  return { tsa: tsaUrl, token: bodyBuf.toString("base64") };
}

// ---------------------------------------------------------------------------
// Imprint match — the honest shortcut (spec §2: "we verify the imprint
// matches; full chain verification is a printed openssl command, not this
// CLI's job in v1").
// ---------------------------------------------------------------------------

/**
 * Check that a TimeStampResp's messageImprint hash equals `digestHex`.
 *
 * HONEST SHORTCUT, documented here rather than papered over: this does NOT
 * parse the full CMS/TSTInfo structure. It searches the raw response bytes
 * for the SHA-256 AlgorithmIdentifier DER (`SHA256_OID_DER`, optionally
 * followed by NULL parameters) and reads the OCTET STRING immediately
 * after it as the imprint hash. In a genuine RFC-3161 response, the TSTInfo
 * (which carries the ONE messageImprint that matters) is encoded as the
 * CMS SignedData's `eContent`, which precedes the `certificates`/
 * `signerInfos` fields in DER byte order — so in every real TSA response,
 * the FIRST match of this OID is the messageImprint's own hash algorithm,
 * not some unrelated SHA-256 AlgorithmIdentifier elsewhere in the
 * structure (e.g. inside a certificate). This proves the response's
 * claimed imprint matches the digest we asked to be timestamped — nothing
 * about the TSA's certificate chain, signature, or trust. Full chain
 * verification is `openssl ts -verify` (printed alongside this at the
 * CLI's `verify` command), not reimplemented here.
 */
export function imprintMatches(tokenB64: string, digestHex: string): boolean {
  if (!HEX64_RE.test(digestHex)) return false;
  const expected = Buffer.from(digestHex.toLowerCase(), "hex");

  let token: Buffer;
  try {
    token = Buffer.from(tokenB64, "base64");
  } catch {
    return false;
  }
  if (token.length === 0) return false;

  const oidIndex = token.indexOf(SHA256_OID_DER);
  if (oidIndex === -1) return false;

  let cursor = oidIndex + SHA256_OID_DER.length;
  if (token[cursor] === DER_TAG_NULL && token[cursor + 1] === 0x00) cursor += 2;

  if (token[cursor] !== DER_TAG_OCTET_STRING) return false;
  const len = token[cursor + 1];
  if (len !== 32) return false; // a SHA-256 imprint is always exactly 32 bytes
  if (cursor + 2 + 32 > token.length) return false;
  const imprint = token.subarray(cursor + 2, cursor + 2 + 32);
  return imprint.equals(expected);
}
