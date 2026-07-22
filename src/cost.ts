// The $ meter (flight-recorder-v1 spec §2): turn a run record's LLM token
// usage into a dollar figure, using a price table that's ALWAYS explicit —
// never auto-fetched, never guessed for an unknown model. See
// src/prices.ts for the bundled default table and its sources; this module
// merges that with an optional `~/.reelier/prices.yml` user override (the
// user's file always wins, per-model) and does the actual cost math.
//
// Honesty rules (mirror the runner's honest-success rule):
//  - A model with no price entry never gets a guessed number — the step
//    (and, transitively, the run) reports "unknown model", not a $0 or an
//    average.
//  - A run whose steps carry zero LLM tokens (pure deterministic replay,
//    the common case) costs exactly $0.00 — and IS reported that way,
//    since that's the honest "replay would have cost $0.00" headline.

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BUNDLED_PRICES, BUNDLED_PRICES_RETRIEVED_AT, type PriceEntry } from "./prices.js";
import type { RunRecord, StepRecord } from "./runner.js";

export type { PriceEntry };

export interface PriceTable {
  /** Bundled table's retrieval date, always present regardless of overrides — this is what `reelier prices` and `reelier prices update` print. */
  bundledRetrievedAt: string;
  /** model id -> price entry, after merging user overrides on top of the bundled defaults (user wins per-model). */
  models: Record<string, PriceEntry>;
  /** model ids whose price came from the user's ~/.reelier/prices.yml rather than the bundled table. */
  overriddenModels: string[];
  /** Absolute path to the user override file this table looked for (whether or not it existed). */
  userFilePath: string;
  /** True iff the user override file existed and parsed successfully. */
  userFileLoaded: boolean;
}

export class PricesFileParseError extends Error {}

/**
 * A hand-rolled parser for the ONE shape `~/.reelier/prices.yml` supports —
 * no new YAML dependency for a two-level mapping (matches this repo's
 * "zero new dependencies" convention, e.g. src/cli.ts's hand-rolled argv
 * parser). Expected shape:
 *
 *   version: 1
 *   models:
 *     my-custom-model:
 *       inputPerMtok: 1.5
 *       outputPerMtok: 6
 *
 * Anything outside this shape is rejected loudly (PricesFileParseError) —
 * a silently-misparsed price file would be exactly the "wrong silent
 * price" this feature exists to prevent.
 */
export function parsePricesYaml(source: string): Record<string, PriceEntry> {
  const lines = source.split(/\r\n|\n/);
  const models: Record<string, PriceEntry> = {};

  let i = 0;
  // Skip blank lines and comments, find `models:` at column 0.
  let sawModels = false;
  let currentModel: string | undefined;
  let currentEntry: Partial<PriceEntry> | undefined;

  function flush(): void {
    if (currentModel === undefined) return;
    if (currentEntry?.inputPerMtok === undefined || currentEntry?.outputPerMtok === undefined) {
      throw new PricesFileParseError(
        `prices.yml: model '${currentModel}' is missing inputPerMtok and/or outputPerMtok`
      );
    }
    models[currentModel] = { inputPerMtok: currentEntry.inputPerMtok, outputPerMtok: currentEntry.outputPerMtok };
    currentModel = undefined;
    currentEntry = undefined;
  }

  for (i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/#.*$/, "").replace(/\s+$/, "");
    if (line.trim() === "") continue;

    const indent = line.length - line.trimStart().length;

    if (indent === 0) {
      const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)$/);
      if (!m) {
        throw new PricesFileParseError(`prices.yml: could not parse top-level line: ${JSON.stringify(raw)}`);
      }
      flush();
      const [, key, rest] = m;
      if (key === "version") {
        continue; // recorded for humans only; not currently load-bearing
      }
      if (key === "models") {
        if (rest.trim() !== "") {
          throw new PricesFileParseError(`prices.yml: 'models:' must have no trailing value, got: ${JSON.stringify(rest)}`);
        }
        sawModels = true;
        continue;
      }
      throw new PricesFileParseError(`prices.yml: unrecognized top-level key '${key}' (expected 'version' or 'models')`);
    }

    if (!sawModels) {
      throw new PricesFileParseError(`prices.yml: indented content before a 'models:' block: ${JSON.stringify(raw)}`);
    }

    if (indent === 2) {
      const m = line.match(/^\s{2}([^\s:][^:]*):\s*(.*)$/);
      if (!m || m[2].trim() !== "") {
        throw new PricesFileParseError(`prices.yml: expected a model id line ("  <model-id>:"), got: ${JSON.stringify(raw)}`);
      }
      flush();
      currentModel = m[1].trim();
      currentEntry = {};
      continue;
    }

    if (indent === 4) {
      if (currentModel === undefined || currentEntry === undefined) {
        throw new PricesFileParseError(`prices.yml: price field outside of a model block: ${JSON.stringify(raw)}`);
      }
      const m = line.match(/^\s{4}(inputPerMtok|outputPerMtok):\s*([0-9.]+)\s*$/);
      if (!m) {
        throw new PricesFileParseError(
          `prices.yml: expected "inputPerMtok: <number>" or "outputPerMtok: <number>" under model '${currentModel}', got: ${JSON.stringify(raw)}`
        );
      }
      const value = Number(m[2]);
      if (!Number.isFinite(value) || value < 0) {
        throw new PricesFileParseError(`prices.yml: '${m[1]}' for model '${currentModel}' must be a non-negative number, got: ${m[2]}`);
      }
      currentEntry[m[1] as "inputPerMtok" | "outputPerMtok"] = value;
      continue;
    }

    throw new PricesFileParseError(`prices.yml: unexpected indentation (${indent} spaces; only 2 or 4 are valid): ${JSON.stringify(raw)}`);
  }
  flush();

  return models;
}

export function defaultPricesFilePath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".reelier", "prices.yml");
}

/**
 * Merge the bundled default table with `~/.reelier/prices.yml` (or a
 * caller-supplied path — tests pass one directly so they never touch the
 * real user's home directory). A missing override file is normal (no
 * warning) — the bundled table alone is a perfectly good default. A
 * present-but-malformed file throws `PricesFileParseError` rather than
 * silently falling back to bundled-only, since the user clearly meant to
 * change something and a swallowed error would leave them thinking their
 * override took effect when it didn't.
 */
export async function loadPriceTable(opts: { filePath?: string; homeDir?: string } = {}): Promise<PriceTable> {
  const userFilePath = opts.filePath ?? defaultPricesFilePath(opts.homeDir);
  let overrideModels: Record<string, PriceEntry> = {};
  let userFileLoaded = false;

  try {
    const source = await readFile(userFilePath, "utf8");
    overrideModels = parsePricesYaml(source);
    userFileLoaded = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // No override file — bundled-only, the normal case.
    } else if (err instanceof PricesFileParseError) {
      throw err;
    } else {
      throw err;
    }
  }

  return {
    bundledRetrievedAt: BUNDLED_PRICES_RETRIEVED_AT,
    models: { ...BUNDLED_PRICES, ...overrideModels },
    overriddenModels: Object.keys(overrideModels),
    userFilePath,
    userFileLoaded,
  };
}

// ---------------------------------------------------------------------------
// Cost math
// ---------------------------------------------------------------------------

export interface StepCost {
  n: number;
  title: string;
  inputTokens: number;
  outputTokens: number;
  model?: string;
  /** Present iff this step had tokens AND a priced model. */
  usd?: number;
  /** Present iff this step had tokens but no known price for its model — never guessed. */
  unknownModel?: string;
}

export interface RunCost {
  startedAt: string;
  totalSteps: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  steps: StepCost[];
  /** Sum of every priceable step's usd. Present even when some steps are unpriceable (it's a PARTIAL total in that case — see unpriceableModels). */
  pricedUsd: number;
  /** Distinct model ids that had tokens but no price entry. Empty means the run's cost is complete, not partial. */
  unpriceableModels: string[];
  /** True iff the run used zero LLM tokens across every step — the honest "replay would have cost $0.00" case. */
  isZeroTokenReplay: boolean;
}

/** Cost one step's recorded LLM usage against `table`. Absent `llm` (0 attempts) costs nothing and reports no tokens — distinct from a $0.00 model with usage. */
export function costStep(step: StepRecord, table: PriceTable): StepCost {
  const inputTokens = step.llm?.inputTokens ?? 0;
  const outputTokens = step.llm?.outputTokens ?? 0;
  const model = step.llm?.model;

  if (inputTokens === 0 && outputTokens === 0) {
    return { n: step.n, title: step.title, inputTokens, outputTokens, model };
  }

  const price = model !== undefined ? table.models[model] : undefined;
  if (!price) {
    return {
      n: step.n,
      title: step.title,
      inputTokens,
      outputTokens,
      model,
      unknownModel: model ?? "(model not recorded)",
    };
  }

  const usd = (inputTokens / 1_000_000) * price.inputPerMtok + (outputTokens / 1_000_000) * price.outputPerMtok;
  return { n: step.n, title: step.title, inputTokens, outputTokens, model, usd };
}

/** Cost every step of a run and roll it up. Never fabricates a number for an unpriceable step — see `unpriceableModels`. */
export function costRun(record: RunRecord, table: PriceTable): RunCost {
  const steps = record.steps.map((s) => costStep(s, table));
  const totalInputTokens = steps.reduce((sum, s) => sum + s.inputTokens, 0);
  const totalOutputTokens = steps.reduce((sum, s) => sum + s.outputTokens, 0);
  const pricedUsd = steps.reduce((sum, s) => sum + (s.usd ?? 0), 0);
  const unpriceableModels = [...new Set(steps.filter((s) => s.unknownModel !== undefined).map((s) => s.unknownModel!))];

  return {
    startedAt: record.startedAt,
    totalSteps: record.steps.length,
    totalInputTokens,
    totalOutputTokens,
    steps,
    pricedUsd,
    unpriceableModels,
    isZeroTokenReplay: totalInputTokens === 0 && totalOutputTokens === 0,
  };
}

/** `$1.2345` -> `$1.2345`-style fixed display; always at least 2 decimals, up to 4 for sub-cent precision (a single escalation call is often well under a cent). */
export function formatUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  const fixed4 = usd.toFixed(4);
  // Trim trailing zeros beyond 2 decimals, but never below 2.
  const trimmed = fixed4.replace(/(\.\d\d)0+$/, "$1").replace(/(\.\d\d\d)0$/, "$1");
  return `$${trimmed}`;
}

// ---------------------------------------------------------------------------
// --since parsing
// ---------------------------------------------------------------------------

export type SinceFilter = "7d" | "30d" | "all";

export function parseSinceFlag(raw: string | undefined): SinceFilter {
  if (raw === undefined || raw === "all") return "all";
  if (raw === "7d" || raw === "30d") return raw;
  throw new Error(`--since must be one of: 7d, 30d, all — got: ${JSON.stringify(raw)}`);
}

/** True iff `startedAt` (ISO) falls within `since`, evaluated against `now` (default Date.now(), injectable for tests). */
export function withinSince(startedAt: string, since: SinceFilter, now: number = Date.now()): boolean {
  if (since === "all") return true;
  const days = since === "7d" ? 7 : 30;
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return new Date(startedAt).getTime() >= cutoff;
}
