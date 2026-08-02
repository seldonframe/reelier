import canonicalize from "canonicalize";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const digest = "sha256:" + "0".repeat(64);
const at = "2026-01-01T00:00:00.000Z";
const vectors = {
  principal: { v: "reelier.principal/v1", id: "operator_1", kind: "operator" },
  "delegation-grant": { v: "reelier.delegation-grant/v1", tenant: "tenant_1", grantId: "grant_1", parentDigest: digest, grantor: "operator_1", grantee: "gate_1", issuedAt: at, expiresAt: "2026-02-01T00:00:00.000Z", scope: ["definition_1"] },
  "source-bundle": { v: "reelier.source-bundle/v1", tenant: "tenant_1", sourceIdentity: "source_1", triggerIdentity: "trigger_1", observedAt: at, rawDigest: digest, freshUntil: "2026-01-01T00:01:00.000Z", projection: {} },
  "outcome-contract": { v: "reelier.outcome-contract/v1", tenant: "tenant_1", alias: "definition_1", contractId: "contract_1", validFrom: at, validUntil: "2026-02-01T00:00:00.000Z", packDigest: digest, definitionDigest: digest },
  "outcome-request": { v: "reelier.outcome-request/v1", requestId: "request_1", sourceRefs: { appointment: "ref_1" }, choices: {} },
  "transport-effect": { v: "reelier.transport-effect/v1", endpointId: "connector_1", method: "POST", path: "/v1/messages", headers: { "Content-Type": "application/json" }, bodyBase64: "e30=", riskClass: "message", idempotency: "native" },
  "compiled-capability": { v: "reelier.compiled-capability/v1", capabilityId: "capability_1", requestKey: digest, outcomeKey: digest, effectDigest: digest, issuedAt: at, expiresAt: "2026-01-01T00:01:00.000Z" },
  "gate-event": { v: "reelier.gate-event/v1", eventId: "event_1", at, verdict: "accepted", reasonCode: "accepted" },
  "authority-receipt": { v: "reelier.authority-receipt/v1", receiptId: "receipt_1", gateEventDigest: digest, claims: { authorization: "verified", topology: "unchecked" } },
  "pack-manifest": { v: "reelier.outcome-pack-manifest/v1", packId: "first_party", packDigest: digest, definitions: ["definition_1"] },
};
const rendered = JSON.stringify(Object.fromEntries(Object.entries(vectors).map(([kind, value]) => {
  const canonical = canonicalize(value);
  return [kind, { canonical, digest: "sha256:" + createHash("sha256").update(canonical, "utf8").digest("hex"), value }];
})), null, 2) + "\n";
const target = new URL("../contract/authority/v1/golden-vectors.json", import.meta.url);
if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")) !== rendered) throw new Error("authority golden vectors drift; run node scripts/build-authority-contract.mjs");
} else await writeFile(target, rendered, "utf8");
