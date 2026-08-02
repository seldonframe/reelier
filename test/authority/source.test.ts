import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { authorityDigest } from "../../src/authority/wire.js";
import { createSourceRegistry, planSourceReads, validateSourceBundle, isValidatedSourceBundle, materializeSourceBundle } from "../../src/authority/source.js";

const definitionDigest = "sha256:" + "b".repeat(64);
const authority = { tenant: "tenant_1", definitionDigest, resolverId: "resolver_1", projectionSchemaId: "projection/v1", allowedReadEndpointIds: ["read_1"], authorizedProjectionPointers: ["/a~0b/c~1d", "/message"], requiredGroundedPointers: ["/a~0b/c~1d"] };
const registry = createSourceRegistry([{ tenant: "tenant_1", resolverId: "resolver_1", definitionDigest, projectionSchemaId: "projection/v1", readEndpointIds: ["read_1"], plan: (refs) => [{ endpointId: "read_1", opaqueHandle: refs.item }] }]);
const raw = Buffer.from('{"provider":"response"}', "utf8");
const bundle = { v: "reelier.source-bundle/v1" as const, tenant: "tenant_1", definitionDigest, projectionSchemaId: "projection/v1", sourceIdentity: "source_1", triggerIdentity: "trigger_1", observedAt: "2026-01-15T00:00:00.000Z", rawDigest: "sha256:" + createHash("sha256").update(raw).digest("hex"), freshUntil: "2026-01-15T00:01:00.000Z", provenance: { resolverId: "resolver_1", endpointId: "read_1" }, claims: { grounded: [{ claimId: "escaped", projectionPointer: "/a~0b/c~1d" }, { claimId: "message", projectionPointer: "/message" }], authored: [], unresolved: [] }, projection: { "a~b": { "c/d": true }, message: "hello" } };

test("registered source planning accepts only tenant-scoped opaque handles and registered read endpoints", () => {
  assert.deepEqual(planSourceReads(registry, { tenant: "tenant_1", resolverId: "resolver_1", definitionDigest, sourceRefs: { item: "opaque_1" }, allowedReadEndpointIds: ["read_1"] }), [{ endpointId: "read_1", opaqueHandle: "opaque_1" }]);
  for (const item of ["https://example.test/x", "C:\\secret", "../secret", "/absolute"]) assert.throws(() => planSourceReads(registry, { tenant: "tenant_1", resolverId: "resolver_1", definitionDigest, sourceRefs: { item }, allowedReadEndpointIds: ["read_1"] }), /opaque handle/i, item);
  assert.throws(() => planSourceReads(registry, { tenant: "tenant_2", resolverId: "resolver_1", definitionDigest, sourceRefs: { item: "opaque_1" }, allowedReadEndpointIds: ["read_1"] }), /tenant|unknown resolver/i);
  assert.throws(() => planSourceReads(registry, { tenant: "tenant_1", resolverId: "unknown", definitionDigest, sourceRefs: { item: "opaque_1" }, allowedReadEndpointIds: ["read_1"] }), /unknown resolver/i);
  const badRegistry = createSourceRegistry([{ tenant: "tenant_1", resolverId: "bad", definitionDigest, projectionSchemaId: "projection/v1", readEndpointIds: ["read_1"], plan: () => [{ endpointId: "read_2", opaqueHandle: "opaque_1" }] }]);
  assert.throws(() => planSourceReads(badRegistry, { tenant: "tenant_1", resolverId: "bad", definitionDigest, sourceRefs: { item: "opaque_1" }, allowedReadEndpointIds: ["read_1"] }), /unknown|unauthorized.*endpoint/i);
});

test("source registry is an opaque immutable snapshot of resolver definitions", () => {
  const resolver = { tenant: "tenant_1", resolverId: "mutable", definitionDigest, projectionSchemaId: "projection/v1", readEndpointIds: ["read_1"], plan: (refs: Readonly<Record<string, string>>) => [{ endpointId: "read_1", opaqueHandle: refs.item }] };
  const local = createSourceRegistry([resolver]);
  assert.deepEqual(Object.keys(local), []);
  assert.equal("resolvers" in local, false);
  resolver.readEndpointIds.push("attacker");
  resolver.plan = () => [{ endpointId: "attacker", opaqueHandle: "changed" }];
  assert.deepEqual(planSourceReads(local, { tenant: "tenant_1", resolverId: "mutable", definitionDigest, sourceRefs: { item: "opaque_1" }, allowedReadEndpointIds: ["read_1"] }), [{ endpointId: "read_1", opaqueHandle: "opaque_1" }]);
});

test("source validation binds raw bytes, provenance, freshness, schemas, projection, and grounded own paths", () => {
  const validated = validateSourceBundle(registry, { bundle, rawResponse: raw, authority, now: new Date("2026-01-15T00:00:30.000Z") });
  assert.equal(isValidatedSourceBundle(validated), true);
  assert.equal(validated.digest, authorityDigest(bundle));
  assert.equal(Object.isFrozen(validated.bundle), true);

  const rejects: [string, unknown][] = [
    ["raw", { ...bundle, rawDigest: "sha256:" + "0".repeat(64) }],
    ["stale", { ...bundle, freshUntil: "2026-01-14T00:00:00.000Z" }],
    ["observed", { ...bundle, observedAt: "2026-01-16T00:00:00.000Z" }],
    ["tenant", { ...bundle, tenant: "tenant_2" }],
    ["resolver", { ...bundle, provenance: { ...bundle.provenance, resolverId: "unknown" } }],
    ["endpoint", { ...bundle, provenance: { ...bundle.provenance, endpointId: "read_2" } }],
    ["definition", { ...bundle, definitionDigest: "sha256:" + "c".repeat(64) }],
    ["schema", { ...bundle, projectionSchemaId: "projection/v2" }],
    ["extra", { ...bundle, claims: { ...bundle.claims, grounded: [...bundle.claims.grounded, { claimId: "extra", projectionPointer: "/extra" }] }, projection: { ...bundle.projection, extra: true } }],
    ["authored", { ...bundle, claims: { grounded: [bundle.claims.grounded[1]], authored: [bundle.claims.grounded[0]], unresolved: [] } }],
    ["unresolved", { ...bundle, claims: { grounded: [bundle.claims.grounded[1]], authored: [], unresolved: [bundle.claims.grounded[0]] } }],
    ["missing required", { ...bundle, claims: { grounded: [bundle.claims.grounded[1]], authored: [], unresolved: [] } }],
  ];
  for (const [label, candidate] of rejects) assert.throws(() => validateSourceBundle(registry, { bundle: candidate, rawResponse: raw, authority, now: new Date("2026-01-15T00:00:30.000Z") }), /raw digest|stale|observed|tenant|resolver|endpoint|definition|schema|unauthorized|grounded|required/i, label);
  assert.throws(() => validateSourceBundle(registry, { bundle, rawResponse: raw, authority, now: new Date(bundle.freshUntil) }), /stale/i, "freshUntil is exclusive");
  assert.throws(() => validateSourceBundle(registry, { bundle: { ...bundle, claims: { grounded: [{ claimId: "escaped", projectionPointer: "/a~0b/missing" }], authored: [], unresolved: [] } }, rawResponse: raw, authority, now: new Date("2026-01-15T00:00:30.000Z") }), /own path|required/i);
  assert.throws(() => validateSourceBundle(registry, { bundle: { ...bundle, claims: { grounded: bundle.claims.grounded, authored: [{ claimId: "copy", projectionPointer: "/message" }], unresolved: [] } }, rawResponse: raw, authority, now: new Date("2026-01-15T00:00:30.000Z") }), /more than one class/i);
  assert.throws(() => validateSourceBundle(registry, { bundle: { ...bundle, claims: { grounded: bundle.claims.grounded, authored: [{ claimId: "message", projectionPointer: "/authored" }], unresolved: [] } }, rawResponse: raw, authority: { ...authority, authorizedProjectionPointers: [...authority.authorizedProjectionPointers, "/authored"] }, now: new Date("2026-01-15T00:00:30.000Z") }), /claim id.*unique/i);
});

test("validated source brands refuse copied lookalikes", () => {
  const validated = validateSourceBundle(registry, { bundle, rawResponse: raw, authority, now: new Date("2026-01-15T00:00:30.000Z") });
  assert.equal(isValidatedSourceBundle({ ...validated }), false);
  assert.equal(isValidatedSourceBundle(structuredClone(validated)), false);
});

test("kernel materializes deterministic plural source evidence from arbitrarily ordered raw observations", () => {
  const reads = [Buffer.from('{"appointment":"a1"}'), Buffer.from('{"contact":"c1"}')];
  const local = createSourceRegistry([{
    tenant: "tenant_1", resolverId: "multi", definitionDigest, projectionSchemaId: "projection/v1",
    readEndpointIds: ["appointment.read", "contact.read"], maxFreshnessSeconds: 120,
    plan: refs => [{ endpointId: "appointment.read", opaqueHandle: refs.appointment }, { endpointId: "contact.read", opaqueHandle: refs.contact }],
    project: ({ observations }) => ({ sourceIdentity: "appointment_a1", triggerIdentity: "trigger_t1", projection: { appointment: "a1", contact: "c1" }, claims: { grounded: observations.map((_, index) => ({ claimId: `claim_${index}`, projectionPointer: index ? "/contact" : "/appointment" })), authored: [], unresolved: [] } }),
  }]);
  const plans = planSourceReads(local, { tenant: "tenant_1", resolverId: "multi", definitionDigest, sourceRefs: { appointment: "a1", contact: "c1" }, allowedReadEndpointIds: ["appointment.read", "contact.read"] });
  assert.equal(plans.length, 2);
  assert.deepEqual(plans.map(plan => plan.index), [0, 1]);
  const first = materializeSourceBundle(local, { tenant: "tenant_1", resolverId: "multi", definitionDigest, projectionSchemaId: "projection/v1", sourceRefs: { appointment: "a1", contact: "c1" }, allowedReadEndpointIds: ["appointment.read", "contact.read"], authorizedProjectionPointers: ["/appointment", "/contact"], requiredGroundedPointers: ["/appointment", "/contact"], maxFreshnessSeconds: 60, observedAt: new Date("2026-01-15T00:00:00.000Z"), plans, observations: [{ planDigest: plans[1].planDigest, rawBytes: reads[1] }, { planDigest: plans[0].planDigest, rawBytes: reads[0] }] });
  reads[0].fill(0);
  const secondPlans = planSourceReads(local, { tenant: "tenant_1", resolverId: "multi", definitionDigest, sourceRefs: { appointment: "a1", contact: "c1" }, allowedReadEndpointIds: ["appointment.read", "contact.read"] });
  const second = materializeSourceBundle(local, { tenant: "tenant_1", resolverId: "multi", definitionDigest, projectionSchemaId: "projection/v1", sourceRefs: { appointment: "a1", contact: "c1" }, allowedReadEndpointIds: ["appointment.read", "contact.read"], authorizedProjectionPointers: ["/appointment", "/contact"], requiredGroundedPointers: ["/appointment", "/contact"], maxFreshnessSeconds: 60, observedAt: new Date("2026-01-15T00:00:00.000Z"), plans: secondPlans, observations: [{ planDigest: secondPlans[0].planDigest, rawBytes: Buffer.from('{"appointment":"a1"}') }, { planDigest: secondPlans[1].planDigest, rawBytes: Buffer.from('{"contact":"c1"}') }] });
  assert.equal(first.sourceSnapshotDigest, second.sourceSnapshotDigest);
  assert.equal(first.bundle.freshUntil, "2026-01-15T00:01:00.000Z");
  assert.deepEqual(first.bundle.provenance.observations.map(item => item.index), [0, 1]);
});
