export type DeadlineStage = "credential" | "identity" | "source" | "prepare" | "authority" | "budget" | "ledger" | "dns" | "connect" | "tls" | "upload" | "headers" | "body";

export interface TotalDeadline {
  readonly startedAtMs: number;
  readonly expiresAtMs: number;
  readonly absoluteDeadlineMs: number;
  readonly signal: AbortSignal;
  remainingMs(stage: DeadlineStage): number;
}

type DeadlineTimer = Readonly<{ unref?: () => void }>;
type DeadlineTimers = Readonly<{
  setTimeout: (callback: () => void, delayMs: number) => DeadlineTimer;
  clearTimeout: (timer: DeadlineTimer) => void;
}>;
const deadlineTimers = new WeakMap<TotalDeadline, DeadlineTimers>();
const nativeDeadlineTimers: DeadlineTimers = { setTimeout: (callback, delayMs) => setTimeout(callback, delayMs), clearTimeout: timer => clearTimeout(timer as NodeJS.Timeout) };
let activeDeadlineTimers = nativeDeadlineTimers;

/** Test-only clock primitive seam; not part of any authority or serialized configuration surface. */
export function __testSetTotalDeadlineTimers(override: Partial<DeadlineTimers>): () => void {
  const previous = activeDeadlineTimers;
  activeDeadlineTimers = { ...nativeDeadlineTimers, ...override };
  return () => { activeDeadlineTimers = previous; };
}

export function createTotalDeadline(input: Readonly<{ timeoutMs: number; monotonicNow?: () => number }>): TotalDeadline {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 120_000) throw new TypeError("invalid total deadline timeout");
  const monotonicNow = input.monotonicNow ?? performance.now.bind(performance);
  const startedAtMs = monotonicNow();
  if (!Number.isFinite(startedAtMs)) throw new TypeError("invalid monotonic clock");
  const expiresAtMs = startedAtMs + input.timeoutMs;
  const controller = new AbortController();
  const timers = activeDeadlineTimers;
  const timer = timers.setTimeout(() => controller.abort(new Error("total deadline expired")), input.timeoutMs);
  timer.unref?.();
  const deadline = Object.freeze({
    startedAtMs,
    expiresAtMs,
    absoluteDeadlineMs: expiresAtMs,
    signal: controller.signal,
    remainingMs(stage: DeadlineStage) {
      const remaining = expiresAtMs - monotonicNow();
      if (!Number.isFinite(remaining) || remaining <= 0) throw new Error(`total deadline expired before ${stage}`);
      return remaining;
    },
  });
  deadlineTimers.set(deadline, timers);
  return deadline;
}

export async function raceTotalDeadline<T>(deadline: TotalDeadline, stage: DeadlineStage, operation: Promise<T>): Promise<T> {
  const remaining = deadline.remainingMs(stage);
  const timers = deadlineTimers.get(deadline) ?? nativeDeadlineTimers;
  return new Promise<T>((resolve, reject) => {
    const timer = timers.setTimeout(() => reject(new Error(`total deadline expired before ${stage}`)), remaining);
    timer.unref?.();
    operation.then(value => { timers.clearTimeout(timer); resolve(value); }, error => { timers.clearTimeout(timer); reject(error); });
  });
}
