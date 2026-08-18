import { authorityDigest } from "../../authority/wire.js";
import type { PackReconciliationResult, ProviderResponse } from "../types.js";
import { githubReleaseRecipeId } from "./manifest.js";

export function reconcileGitHubRelease(input: Readonly<{ response: ProviderResponse | unknown }>): PackReconciliationResult {
  const response = input.response && typeof input.response === "object" && "body" in input.response ? input.response as ProviderResponse : { body: input.response };
  if (response.status !== undefined && response.status >= 500) return result("unavailable", null, "provider-error");
  if (response.status !== undefined && response.status >= 400) return result("not-applied", null, "provider-refused");
  const body = response.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return result("unavailable", null, "malformed-provider-state");
  const state = body as Record<string, unknown>;
  if (state.status === "verified") return result("matched", authorityDigest(state), "release-readback-match");
  if (state.status === "conflict") return result("conflict", authorityDigest(state), "release-readback-conflict");
  return result("unavailable", null, "release-readback-unverified");
}
function result(status: PackReconciliationResult["status"], projectionDigest: string | null, reasonCode: string): PackReconciliationResult { return Object.freeze({ status, recipeId: githubReleaseRecipeId, projectionDigest, reasonCode }); }
