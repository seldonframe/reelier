import test from "node:test";
import assert from "node:assert/strict";
import { compileCloudflareDnsRecordSet, parseCloudflareDnsRecordPolicy, reconcileCloudflareDnsRecordSet, validateCloudflareDnsRecordChoices, type CloudflareDnsRecordProjection } from "reelier/packs";

const source: CloudflareDnsRecordProjection = { accountId: "acct_demo", zoneId: "zone_demo", recordId: "record_demo", name: "app.example.com", type: "A", content: "203.0.113.10", ttl: 300, proxied: false };

test("Cloudflare DNS state compiles an exact record replacement", () => {
  assert.throws(() => validateCloudflareDnsRecordChoices({ content: "attacker" }));
  const policy = parseCloudflareDnsRecordPolicy({ accountId: "acct_demo", zoneId: "zone_demo", name: "app.example.com", type: "A", desiredContent: "203.0.113.20", desiredTtl: 300, desiredProxied: false });
  const effect = compileCloudflareDnsRecordSet({ source, policy });
  assert.equal(effect.endpointId, "cloudflare.dns.record.set");
  assert.equal(effect.method, "PUT");
  assert.equal(effect.path, "/client/v4/zones/zone_demo/dns_records/record_demo");
  assert.deepEqual(JSON.parse(Buffer.from(effect.bodyBase64, "base64").toString("utf8")), { type: "A", name: "app.example.com", content: "203.0.113.20", ttl: 300, proxied: false });
  assert.equal(effect.reconciliation.recipeId, "cloudflare_dns_record_set_readback_v1");
});

test("Cloudflare DNS state refuses account drift and reconciles read-back honestly", () => {
  const policy = parseCloudflareDnsRecordPolicy({ accountId: "acct_demo", zoneId: "zone_demo", name: "app.example.com", type: "A", desiredContent: "203.0.113.20", desiredTtl: 300, desiredProxied: false });
  assert.throws(() => compileCloudflareDnsRecordSet({ source: { ...source, accountId: "attacker" }, policy }));
  assert.equal(reconcileCloudflareDnsRecordSet({ expected: source, desired: { content: "203.0.113.20", ttl: 300, proxied: false }, response: { body: { result: { id: "record_demo", accountId: "acct_demo", zoneId: "zone_demo", name: "app.example.com", type: "A", content: "203.0.113.20", ttl: 300, proxied: false } } } }).status, "matched");
  assert.equal(reconcileCloudflareDnsRecordSet({ expected: source, desired: { content: "203.0.113.20", ttl: 300, proxied: false }, response: { status: 200, body: { result: { id: "record_demo", accountId: "acct_demo", zoneId: "zone_demo", name: "app.example.com", type: "A", content: "203.0.113.10", ttl: 300, proxied: false } } } }).status, "conflict");
  assert.equal(reconcileCloudflareDnsRecordSet({ expected: source, desired: { content: "203.0.113.20", ttl: 300, proxied: false }, response: { status: 404, body: {} } }).status, "not-applied");
});
