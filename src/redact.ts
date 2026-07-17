// Redaction applied only to what gets WRITTEN to a trace file (args/results
// passed to reelier_start_recording's captured calls). Never applied to the
// live passthrough path — the caller always gets the real, unredacted result.
//
// Deliberately conservative: a false positive (over-redacting) corrupts a
// trace silently; a false negative (missing a secret) is a known, documented
// limit. See README's "Redaction" section for what this does and doesn't catch.

const SK_PATTERN = /sk-[A-Za-z0-9_-]{10,}/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g;
const HEX32_RE = /^[A-Fa-f0-9]{32,}$/;
const KEY_POSITION_RE = /token|secret|key|password|authorization/i;

function envMasks(): Array<[string, string]> {
  const names = (process.env.REELIER_REDACT ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const masks: Array<[string, string]> = [];
  for (const name of names) {
    const value = process.env[name];
    if (value && value.length >= 6) {
      masks.push([name, value]);
    }
  }
  return masks;
}

function redactString(str: string, masks: Array<[string, string]>): string {
  let out = str;
  for (const [name, value] of masks) {
    if (out.includes(value)) {
      out = out.split(value).join(`«redacted:${name}»`);
    }
  }
  out = out.replace(SK_PATTERN, "«redacted»");
  out = out.replace(BEARER_PATTERN, "«redacted»");
  return out;
}

function redactValue(value: unknown, masks: Array<[string, string]>, keyName: string | undefined): unknown {
  if (typeof value === "string") {
    if (keyName && KEY_POSITION_RE.test(keyName) && HEX32_RE.test(value)) {
      return "«redacted»";
    }
    return redactString(value, masks);
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, masks, keyName));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v, masks, k);
    }
    return out;
  }
  return value;
}

/**
 * Deep-walk `value`, redacting:
 *  - occurrences of any REELIER_REDACT-named env var's value (len >= 6) inside strings
 *  - sk-... and Bearer ... shaped secrets, always
 *  - 32+-char hex strings sitting in a key named like /token|secret|key|password|authorization/i
 *
 * Applied only at trace-write time — never on the live passthrough.
 */
export function redact(value: unknown): unknown {
  return redactValue(value, envMasks(), undefined);
}
