import type { TransportEffect } from "../authority/types.js";

export type PackReconciliationStatus = "matched" | "not-applied" | "conflict" | "unavailable";

export interface PackReconciliationResult {
  readonly status: PackReconciliationStatus;
  readonly recipeId: string;
  readonly projectionDigest: string | null;
  readonly reasonCode: string;
}

export interface ProviderResponse {
  readonly status?: number;
  readonly body: unknown;
}

export interface PackReconciler<TProjection extends Record<string, unknown> = Record<string, unknown>> {
  readonly recipeId: string;
  readonly reconcile: (input: Readonly<{ expected: TProjection; response: ProviderResponse | unknown; effect?: TransportEffect }>) => PackReconciliationResult;
}
