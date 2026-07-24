// Deterministic JSON serialization for hashing: recursive key sort,
// array order preserved. Plain JSON.stringify is insertion-ordered and
// therefore unstable across producers — never hash it directly.
// Spec: docs/specs/flight-recorder-v2.md §1.
import { createHash } from "node:crypto";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      // Explicitly drop undefined-valued keys so the canonical form is our
      // stated contract, not an accident of JSON.stringify (which also omits
      // them). Mutating this guard to `true` is a *provably equivalent*
      // mutant — stringify drops the undefined value either way — so it is
      // excluded from mutation scoring rather than chased with a test that
      // cannot distinguish it. The undefined-exclusion contract is pinned by
      // tests in test/canonical-json.test.ts regardless.
      // Stryker disable next-line ConditionalExpression: equivalent — JSON.stringify already omits undefined-valued keys
      if (v !== undefined) out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function digestSha256(value: unknown): string {
  return "sha256:" + createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
