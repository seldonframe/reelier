// Bundled default $/Mtok price table for the $ meter (flight-recorder-v1
// spec §2). Pinned to a retrieval date, per the standing rule: prices are
// NEVER auto-fetched (a wrong silent price is a lie — see cost.ts and
// `reelier prices update`'s doc comment). This module is the maintained
// default; `~/.reelier/prices.yml` lets a user override or add entries
// on top of it (src/cost.ts's loadPriceTable merges the two, user wins
// per-model).
//
// To refresh: re-check each source URL below, update the numbers, and bump
// BUNDLED_PRICES_RETRIEVED_AT to today's date. Never guess a number that
// isn't verified against the cited source at update time.

export interface PriceEntry {
  inputPerMtok: number;
  outputPerMtok: number;
}

/** ISO date this table was last verified against the sources cited below. */
export const BUNDLED_PRICES_RETRIEVED_AT = "2026-07-22";

/**
 * Anthropic — https://platform.claude.com/docs/en/about-claude/pricing
 * (retrieved 2026-07-22). Standard (non-batch, non-cached) per-Mtok rates.
 *
 * "claude-sonnet-5" is priced at its CURRENT introductory rate ($2/$10),
 * in effect through 2026-08-31; standard pricing ($3/$15) takes over
 * 2026-09-01 — this table will need a refresh at that date (`reelier
 * prices update` surfaces the bundled retrieval date so that's visible).
 * "claude-haiku-4-5-20251001" is an alias for Haiku 4.5 matching the
 * literal default model id src/escalate.ts's Level-1 resolver falls back
 * to when the caller doesn't pass --llm-model.
 */
const ANTHROPIC_PRICES: Record<string, PriceEntry> = {
  "claude-fable-5": { inputPerMtok: 10, outputPerMtok: 50 },
  "claude-opus-4-8": { inputPerMtok: 5, outputPerMtok: 25 },
  "claude-sonnet-5": { inputPerMtok: 2, outputPerMtok: 10 },
  "claude-haiku-4-5": { inputPerMtok: 1, outputPerMtok: 5 },
  "claude-haiku-4-5-20251001": { inputPerMtok: 1, outputPerMtok: 5 },
};

/**
 * OpenAI — https://developers.openai.com/api/docs/pricing (retrieved
 * 2026-07-22). Standard (non-batch, non-cached) per-Mtok rates for the
 * current flagship/mini generation (the "5.6" family listed on the page
 * today; older 5.5/5.4 tiers remain live but aren't the "current" tier).
 */
const OPENAI_PRICES: Record<string, PriceEntry> = {
  "gpt-5.6-sol": { inputPerMtok: 5, outputPerMtok: 30 },
  "gpt-5.6-terra": { inputPerMtok: 2.5, outputPerMtok: 15 },
  "gpt-5.6-luna": { inputPerMtok: 1, outputPerMtok: 6 },
};

/**
 * Google Gemini — https://ai.google.dev/gemini-api/docs/pricing (retrieved
 * 2026-07-22). Standard per-Mtok rates. Gemini 3.1 Pro's price is tiered by
 * prompt size (<=200k vs >200k input tokens); this table ships the <=200k
 * rate only — the >200k tier is a documented v1 simplification (see
 * cost.ts), never silently applied.
 */
const GEMINI_PRICES: Record<string, PriceEntry> = {
  "gemini-3.1-pro-preview": { inputPerMtok: 2, outputPerMtok: 12 },
  "gemini-3.1-pro": { inputPerMtok: 2, outputPerMtok: 12 },
  "gemini-3.6-flash": { inputPerMtok: 1.5, outputPerMtok: 7.5 },
  "gemini-3.5-flash-lite": { inputPerMtok: 0.3, outputPerMtok: 2.5 },
};

export const BUNDLED_PRICES: Record<string, PriceEntry> = {
  ...ANTHROPIC_PRICES,
  ...OPENAI_PRICES,
  ...GEMINI_PRICES,
};
