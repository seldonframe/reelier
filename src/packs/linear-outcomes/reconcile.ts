import { authorityDigest } from "../../authority/wire.js";
import { isStaticPackProxy } from "../../authority/pack.js";
import type { PackReconciliationResult, ProviderResponse } from "../types.js";
import { linearOutcomeRecipeId } from "./manifest.js";

export function reconcileLinearOutcome(input: Readonly<{ response: ProviderResponse | unknown }>): PackReconciliationResult {
  const wrapped = inertRecord(input.response, [["body"], ["body", "status"]]);
  const response = wrapped ? { body: wrapped.body, ...(wrapped.status === undefined ? {} : { status: wrapped.status as number }) } : { body: input.response };
  if (response.status !== undefined && response.status >= 500) return result("unavailable", null, "provider-error");
  if (response.status !== undefined && response.status >= 400) return result("not-applied", null, "provider-refused");
  const state = inertRecord(response.body, [["evidenceDigest", "phase", "status"]]);
  if (!state) return result("unavailable", null, "malformed-provider-state");
  if (state.status === "verified" && /^sha256:[0-9a-f]{64}$/.test(String(state.evidenceDigest)) && ["comment-verified", "status-verified"].includes(String(state.phase))) return result("matched", authorityDigest(state), "linear-readback-match");
  return result("unavailable", null, "linear-readback-unverified");
}
function result(status: PackReconciliationResult["status"], projectionDigest: string | null, reasonCode: string): PackReconciliationResult { return Object.freeze({ status, recipeId: linearOutcomeRecipeId, projectionDigest, reasonCode }); }
function inertRecord(value: unknown, shapes: readonly (readonly string[])[]): Readonly<Record<string, unknown>> | null {
  if (!value || typeof value !== "object" || isStaticPackProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Reflect.ownKeys(value).some(key => typeof key !== "string")) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Object.keys(descriptors).sort();
  if (!shapes.some(shape => [...shape].sort().join("\0") === keys.join("\0")) || Object.values(descriptors).some(descriptor => !("value" in descriptor) || !descriptor.enumerable)) return null;
  return Object.freeze(Object.fromEntries(keys.map(key => [key, descriptors[key]!.value])));
}
