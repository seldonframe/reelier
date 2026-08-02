import canonicalize from "canonicalize";
import { createHash, createPrivateKey, sign } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

const digest = "sha256:" + "0".repeat(64);
const at = "2026-01-01T00:00:00.000Z";
const vectorPrivateKey = createPrivateKey(`-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIO2e0HCVJ9AnRKWoiI+A2JXFNQeKOiEQDB7P8clr8OyJ
-----END PRIVATE KEY-----`);
const vectors = {
  principal: { v: "reelier.principal/v1", id: "operator_1", kind: "operator" },
  "delegation-grant": { v: "reelier.delegation-grant/v1", tenant: "tenant_1", grantId: "grant_1", parentDigest: digest, grantor: "operator_1", grantee: "gate_1", issuedAt: at, expiresAt: "2026-02-01T00:00:00.000Z", scope: ["definition_1"] },
  "source-bundle": { v: "reelier.source-bundle/v1", tenant: "tenant_1", sourceIdentity: "source_1", triggerIdentity: "trigger_1", observedAt: at, rawDigest: digest, freshUntil: "2026-01-01T00:01:00.000Z", provenance: { resolverId: "resolver_1", endpointId: "read_1" }, claims: { grounded: [], authored: [], unresolved: [] }, projection: {} },
  "outcome-contract": { v: "reelier.outcome-contract/v1", tenant: "tenant_1", alias: "definition_1", contractId: "contract_1", validFrom: at, validUntil: "2026-02-01T00:00:00.000Z", packDigest: digest, definitionDigest: digest },
  "outcome-request": { v: "reelier.outcome-request/v1", requestId: "request_1", sourceRefs: { appointment: "ref_1" }, choices: {} },
  "transport-effect": { v: "reelier.transport-effect/v1", endpointId: "connector_1", method: "POST", path: "/v1/messages", query: [], headers: { "Content-Type": "application/json" }, bodyBase64: "e30=", riskClass: "message", idempotency: "native", preconditions: [], reconciliation: { recipeId: "message-readback" } },
  "compiled-capability": { v: "reelier.compiled-capability/v1", capabilityId: "capability_1", requestKey: digest, outcomeKey: digest, effectDigest: digest, issuedAt: at, expiresAt: "2026-01-01T00:01:00.000Z" },
  "gate-event": { v: "reelier.gate-event/v1", eventId: "event_1", at, verdict: "accepted", reasonCode: "accepted" },
  "authority-receipt": { v: "reelier.authority-receipt/v1", receiptId: "receipt_1", gateEventDigest: digest, claims: { authorization: "verified", sourceCompleteness: "verified", dispatch: "verified", providerAcknowledgment: "unchecked", reconciliation: "absent", topology: "unchecked", completeness: "unchecked" } },
  "pack-manifest": { v: "reelier.outcome-pack-manifest/v1", packId: "first_party", packDigest: digest, definitions: ["definition_1"] },
};
const rendered = JSON.stringify(Object.fromEntries(Object.entries(vectors).map(([kind, value]) => {
  const canonical = canonicalize(value);
  const digest = "sha256:" + createHash("sha256").update(canonical, "utf8").digest("hex");
  const purposeDigest = "sha256:" + createHash("sha256").update(canonicalize({ digest, purpose: kind }), "utf8").digest("hex");
  const sig = sign(null, Buffer.from(`reelier-authority-v1\n${purposeDigest}`, "utf8"), vectorPrivateKey).toString("base64");
  return [kind, { canonical, digest, signature: { alg: "ed25519", sig }, value }];
})), null, 2) + "\n";
const target = new URL("../contract/authority/v1/golden-vectors.json", import.meta.url);
if (process.argv.includes("--copy-schemas")) {
  await mkdir(new URL("../dist/authority/schemas/", import.meta.url), { recursive: true });
  await cp(new URL("../contract/authority/v1/", import.meta.url), new URL("../dist/authority/schemas/", import.meta.url), { recursive: true });
  process.exit(0);
}
if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")) !== rendered) throw new Error("authority golden vectors drift; run node scripts/build-authority-contract.mjs");
} else await writeFile(target, rendered, "utf8");
