export type DeadlineStage = "credential" | "identity" | "source" | "prepare" | "authority" | "budget" | "ledger" | "dns" | "connect" | "tls" | "upload" | "headers" | "body";

export interface TotalDeadline {
  readonly startedAtMs: number;
  readonly expiresAtMs: number;
  readonly absoluteDeadlineMs: number;
  remainingMs(stage: DeadlineStage): number;
}

export function createTotalDeadline(input: Readonly<{ timeoutMs: number; monotonicNow?: () => number }>): TotalDeadline {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 120_000) throw new TypeError("invalid total deadline timeout");
  const monotonicNow = input.monotonicNow ?? performance.now.bind(performance);
  const startedAtMs = monotonicNow();
  if (!Number.isFinite(startedAtMs)) throw new TypeError("invalid monotonic clock");
  const expiresAtMs = startedAtMs + input.timeoutMs;
  return Object.freeze({
    startedAtMs,
    expiresAtMs,
    absoluteDeadlineMs: expiresAtMs,
    remainingMs(stage: DeadlineStage) {
      const remaining = expiresAtMs - monotonicNow();
      if (!Number.isFinite(remaining) || remaining <= 0) throw new Error(`total deadline expired before ${stage}`);
      return remaining;
    },
  });
}
