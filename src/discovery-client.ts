export type DiscoveryUploadBundle = object;

export interface DiscoveryUploadConfig {
  baseUrl: string;
  apiKey: string;
}

export interface DiscoveryUploadResponse {
  id: string;
  importUrl: string;
}

export async function uploadDiscoveryBundle(
  bundle: DiscoveryUploadBundle,
  config: DiscoveryUploadConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<DiscoveryUploadResponse> {
  const response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, "")}/api/arena/discoveries`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(bundle),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Discovery upload failed (HTTP ${response.status}): ${text}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Discovery upload returned invalid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || typeof (parsed as { id?: unknown }).id !== "string" || typeof (parsed as { importUrl?: unknown }).importUrl !== "string") {
    throw new Error("Discovery upload returned an invalid response");
  }
  return parsed as DiscoveryUploadResponse;
}
