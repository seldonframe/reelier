/** Closed, aggregate-only phases for one governed dispatch critical path. */
export const AUTHORITY_LATENCY_PHASES = [
  "authority-load", "identity-probe", "source-pre-read", "compile", "reserve",
  "route-reread", "authority-validation-before-prepare", "prepare", "credential",
  "authority-validation-after-prepare", "dispatch-commit-cas", "authority-send-boundary",
  "dns", "connect", "tls", "upload", "response-headers", "response-body",
  "reconcile-read", "receipt-publish", "terminal-transition",
] as const;

export type AuthorityLatencyPhase = typeof AUTHORITY_LATENCY_PHASES[number];
export interface AuthorityLatencyTraceV1 {
  readonly v: "reelier.authority-latency-trace/v1";
  readonly phases: readonly Readonly<{ name: AuthorityLatencyPhase; durationMs: number }>[];
  readonly totalMs: number;
  readonly modelCalls: 0;
  readonly reviewerCalls: 0;
  readonly graphExportsOnCriticalPath: 0;
}
export interface AuthorityLatencyRecorder {
  measure<T>(phase: AuthorityLatencyPhase, operation: () => T | Promise<T>): Promise<T>;
  finish(): AuthorityLatencyTraceV1;
}

export function createAuthorityLatencyRecorder(input: Readonly<{ monotonicNow: () => number }>): AuthorityLatencyRecorder {
  if (!input || typeof input.monotonicNow !== "function") throw new TypeError("monotonic clock is required");
  const totals = new Map<AuthorityLatencyPhase, number>(AUTHORITY_LATENCY_PHASES.map(phase => [phase, 0]));
  let previous = readNow(input.monotonicNow, -Infinity);
  const now = () => {
    const value = readNow(input.monotonicNow, previous);
    previous = value;
    return value;
  };
  return Object.freeze({
    async measure<T>(phase: AuthorityLatencyPhase, operation: () => T | Promise<T>): Promise<T> {
      if (!totals.has(phase) || typeof operation !== "function") throw new TypeError("latency phase is invalid");
      const started = now();
      try { return await operation(); }
      finally { totals.set(phase, totals.get(phase)! + Math.max(0, now() - started)); }
    },
    finish(): AuthorityLatencyTraceV1 {
      const phases = Object.freeze(AUTHORITY_LATENCY_PHASES.map(name => Object.freeze({ name, durationMs: totals.get(name)! })));
      return Object.freeze({ v: "reelier.authority-latency-trace/v1", phases, totalMs: phases.reduce((total, phase) => total + phase.durationMs, 0), modelCalls: 0, reviewerCalls: 0, graphExportsOnCriticalPath: 0 });
    },
  });
}

function readNow(clock: () => number, minimum: number): number {
  const value = clock();
  if (!Number.isFinite(value) || value < minimum) throw new RangeError("monotonic clock moved backwards");
  return value;
}
