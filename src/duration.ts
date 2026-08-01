// Duration parsing for approval TTLs (`reelier approve --expires <duration>`).
//
// The FIRST duration parser in this codebase — nothing else here has ever
// needed one, and this exists for exactly one caller, so the grammar is kept
// as small as the job: a single positive integer followed by one unit from
// {m, h, d}. Combinations (`1d12h`), fractions (`1.5h`), seconds, and weeks
// are deliberately out of scope. An approval cadence a human can say out loud
// is the whole point; a grammar that can express "90000s" invites a TTL nobody
// can read off the file.
//
// Pure, no IO, and it NEVER throws. There is exactly one caller today —
// `cmdApprove`, which turns `null` into a clean usage error and approves
// nothing. Returning a value rather than throwing is what keeps a typo in a
// duration a usage error instead of a stack trace out of the approval
// command. (The runner does not import this: it reads the already-resolved
// absolute instant from the file, never a duration.)

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * The documented ceiling on an approval TTL: one year. An approval valid for
 * a century is not an approval, and a cap keeps `--expires 99999999d` from
 * stamping an instant that overflows into nonsense. Inclusive — `365d` parses,
 * `366d` does not.
 */
export const MAX_APPROVAL_TTL_MS = 365 * MS_PER_DAY;

const UNITS: Record<string, number> = { d: MS_PER_DAY, h: MS_PER_HOUR, m: MS_PER_MINUTE };

/**
 * Anchored, no whitespace tolerance, no sign, no decimal point, no exponent:
 * every one of those is a rejection rather than a silent coercion, because a
 * duration that parses to something OTHER than what the operator typed is the
 * one failure mode a TTL cannot afford.
 */
const DURATION_RE = /^(\d+)([mhd])$/;

/**
 * Parse `<positive integer><m|h|d>` into milliseconds.
 *
 * Returns `null` — never throws — on anything else, including zero
 * (`0h` is a usage error, not a TTL) and anything above
 * {@link MAX_APPROVAL_TTL_MS}.
 */
export function parseDuration(input: string): number | null {
  if (typeof input !== "string") return null;
  const m = DURATION_RE.exec(input);
  if (m === null) return null;
  // Leading zeros ("024h") would parse fine but read ambiguously in a
  // committed file; the exact-echo rule above is what keeps the grammar one
  // shape per duration.
  if (m[1].length > 1 && m[1].startsWith("0")) return null;
  const n = Number(m[1]);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  const ms = n * UNITS[m[2]];
  if (!Number.isSafeInteger(ms) || ms <= 0 || ms > MAX_APPROVAL_TTL_MS) return null;
  return ms;
}
