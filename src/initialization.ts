/** Closed, ordered checkpoints for the local inspection-only initializer. */
export const INIT_CHECKPOINT_IDS = Object.freeze([
  "config-surfaces",
  "path-a-coverage",
  "path-b-candidates",
  "path-c-candidates",
  "inspection-report",
] as const);

/** Public initializer entry point. The checkpoint engine is filled in by the next TDD slice. */
export async function initializeInspection(): Promise<void> {
  return;
}
