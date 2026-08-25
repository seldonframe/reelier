/** Closed, aggregate-only phases for one governed dispatch critical path. */
export const AUTHORITY_LATENCY_PHASES = [
  "authority-load", "identity-probe", "source-pre-read", "compile", "reserve",
  "route-reread", "authority-validation-before-prepare", "prepare", "credential",
  "authority-validation-after-prepare", "authority-validation-before-cas", "dispatch-commit-cas", "authority-validation-before-send", "authority-send-boundary",
  "dns", "connect", "tls", "upload", "response-headers", "response-body",
  "reconcile-read", "receipt-publish", "terminal-transition",
] as const;

export type AuthorityLatencyPhase = typeof AUTHORITY_LATENCY_PHASES[number];
export interface AuthorityLatencyTraceV1 {
  readonly v: "reelier.authority-latency-trace/v1";
  /** Only production hooks that actually ran, in critical-path order. */
  readonly phases: readonly Readonly<{ name: AuthorityLatencyPhase; durationMs: number }>[];
  readonly totalMs: number;
  /** Recorder-owned invariants: this recorder has no model/reviewer/graph API. */
  readonly modelCalls: 0;
  readonly reviewerCalls: 0;
  readonly graphExportsOnCriticalPath: 0;
}
export interface AuthorityLatencyRecorder {
  measure<T>(phase: AuthorityLatencyPhase, operation: () => T | Promise<T>): Promise<T>;
  /** In-memory inspection for the active dispatch; it exposes no timing payload. */
  observedPhases(): readonly AuthorityLatencyPhase[];
  finish(): AuthorityLatencyTraceV1;
}

export function createAuthorityLatencyRecorder(input: Readonly<{ monotonicNow: () => number }>): AuthorityLatencyRecorder {
  if (!input || typeof input.monotonicNow !== "function") throw new TypeError("monotonic clock is required");
  const phases: Array<Readonly<{ name: AuthorityLatencyPhase; durationMs: number }>> = [];
  let previous = readNow(input.monotonicNow, -Infinity), lastPhase = -1, active = false, finished = false;
  const now = () => { const value = readNow(input.monotonicNow, previous); previous = value; return value; };
  return Object.freeze({
    async measure<T>(phase: AuthorityLatencyPhase, operation: () => T | Promise<T>): Promise<T> {
      const index = AUTHORITY_LATENCY_PHASES.indexOf(phase);
      if (index < 0 || typeof operation !== "function") throw new TypeError("latency phase is invalid");
      if (finished || lastPhase === AUTHORITY_LATENCY_PHASES.length - 1) throw new Error("terminal transition already recorded");
      if (active) throw new Error("nested latency phase instrumentation is forbidden");
      if (index <= lastPhase) throw new Error("latency phases must be chronological");
      active = true;
      const started = now();
      try { return await operation(); }
      finally {
        const durationMs = now() - started;
        active = false;
        phases.push(Object.freeze({ name: phase, durationMs }));
        lastPhase = index;
      }
    },
    observedPhases(): readonly AuthorityLatencyPhase[] { return Object.freeze(phases.map(phase => phase.name)); },
    finish(): AuthorityLatencyTraceV1 {
      if (active) throw new Error("cannot finish an active latency phase");
      if (lastPhase !== AUTHORITY_LATENCY_PHASES.length - 1) throw new Error("terminal transition must be recorded before publishing latency evidence");
      finished = true;
      const observed = Object.freeze([...phases]);
      return Object.freeze({ v: "reelier.authority-latency-trace/v1", phases: observed, totalMs: observed.reduce((total, phase) => total + phase.durationMs, 0), modelCalls: 0, reviewerCalls: 0, graphExportsOnCriticalPath: 0 });
    },
  });
}

function readNow(clock: () => number, minimum: number): number {
  const value = clock();
  if (!Number.isFinite(value) || value < minimum) throw new RangeError("monotonic clock moved backwards");
  return value;
}
