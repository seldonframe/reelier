import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { authorityDigest } from "../../src/authority/wire.js";
import { signAuthorityDigest } from "../../src/authority/crypto.js";
import { createDispatchCoordinator, type DispatchRequestState } from "../../src/authority/host/dispatch.js";
import { createPreparedDispatch, createDispatchCommitLease } from "../../src/authority/host/prepared-dispatch.js";
import { createReservedDispatchHandle } from "../../src/authority/gate.js";
import { __testSetAuthorityCellHostPlatform } from "../../src/authority/host/platform.js";
import { createAuthorityLatencyRecorder } from "../../src/authority/host/latency.js";
import type { RouteAuthoritySnapshotV1 } from "../../src/authority/ledger.js";
import { profileGovernanceFixture } from "./profile-governance-fixture.js";

const sha = (c: string) => `sha256:${c.repeat(64)}`;
const routeAuthority = (): RouteAuthoritySnapshotV1 => ({
  v: "reelier.route-authority-snapshot/v1", connectorRegistrationDigest: sha("a"), operatorConfigurationDigest: sha("b"), routeDigest: sha("c"),
  providerId: "github", connectorId: "github", accountId: "42", providerAccountIdentity: "github:octocat", endpointId: "github_labels", credentialSlotId: "slot", slotInstanceId: "instance", slotVersion: "1", authenticatedProviderIdentityDigest: authorityDigest({ v: "reelier.authenticated-provider-identity/v1", providerId: "github", credentialSlotId: "slot", slotInstanceId: "instance", slotVersion: "1", slotExpiresAt: "2027-01-01T00:00:00.000Z", providerAccountId: "42", providerLogin: "octocat", routeDigest: sha("c"), observedAt: "2026-01-01T00:00:00.000Z" }),
  sourceReadRouteDigest: sha("e"), projectionSchemaDigest: sha("f"), expectedMaterializedRequestDigest: sha("1"), authorityGeneration: sha("2"), authorityExpiresAt: "2027-01-01T00:00:00.000Z",
});
const identityKeys = generateKeyPairSync("ed25519");
const identityFor = (route: RouteAuthoritySnapshotV1, overrides: Partial<{ providerAccountId: string; providerLogin: string; signerId: string; signature: unknown }> = {}) => {
  const unsigned = { v: "reelier.authenticated-provider-identity/v1" as const, providerId: "github" as const, credentialSlotId: route.credentialSlotId, slotInstanceId: route.slotInstanceId, slotVersion: route.slotVersion, slotExpiresAt: route.authorityExpiresAt, providerAccountId: overrides.providerAccountId ?? route.accountId, providerLogin: overrides.providerLogin ?? "octocat", routeDigest: route.routeDigest, observedAt: "2026-01-01T00:00:00.000Z" };
  const signerId = overrides.signerId ?? "github-identity-signer";
  const signature = overrides.signature ?? signAuthorityDigest(identityKeys.privateKey, "authority-evidence", authorityDigest(unsigned));
  return { ...unsigned, signerId, signature };
};
const verifier = { purpose: "authority-evidence" as const, signerId: "github-identity-signer", publicKey: identityKeys.publicKey, verify: async () => true };

test("certified dispatch enforces route reread, double authority validation, commit, and send ordering", async () => {
  profileGovernanceFixture();
  const restore = __testSetAuthorityCellHostPlatform("linux");
  try {
    const events: string[] = [];
    let reservation: any = { reservationId: "r1", state: "reserved", intent: { effectDigest: sha("3"), routeAuthority: routeAuthority(), executionContext: { allocationId: "a1" } } };
    const projection: any = { v: "reelier.materialized-http-request/v1", method: "PUT", origin: "https://api.github.com", normalizedPath: "/x", normalizedQuery: "", reviewedHeaders: {}, bodyDigest: sha("4") };
    const digest = authorityDigest(projection);
    let ticks = 0;
    const latencyRecorder = createAuthorityLatencyRecorder({ monotonicNow: () => ++ticks });
    const durableRoute = { ...routeAuthority(), expectedMaterializedRequestDigest: digest };
    reservation = { ...reservation, intent: { ...reservation.intent, routeAuthority: durableRoute } };
    const ledger: any = {
      async getReservation() { return reservation; },
      async commitPreparedDispatch(input: any) { events.push("dispatch-commit-cas"); reservation = { ...reservation, state: "dispatched" }; return createDispatchCommitLease({ reservationId: "r1", allocationId: "a1", preparedDigest: digest, authorityGeneration: input.expectedAuthorityGeneration, authorityExpiresAt: input.preparedDescription.authorityExpiresAt, absoluteDeadlineMs: input.absoluteDeadlineMs, commitGeneration: "g", commit: async () => { events.push("send-started"); } }); },
      async transition(_id: string, _expected: string, event: any) { reservation = { ...reservation, state: event.to }; return { ok: true, status: "transitioned", reservation }; },
    };
    const adapter: any = { async prepare() { events.push("prepare"); return createPreparedDispatch({ description: { v: "reelier.prepared-dispatch-description/v1", routeDigest: durableRoute.routeDigest, materializedRequestDigest: digest, projection, authorityGeneration: durableRoute.authorityGeneration, authorityExpiresAt: durableRoute.authorityExpiresAt, absoluteDeadlineMs: performance.now() + 60_000, reservationId: "r1", allocationId: "a1" }, send: async () => { events.push("send"); return { kind: "acknowledged", resultDigest: sha("5") }; } }); } };
    const coordinator = createDispatchCoordinator(ledger, adapter, undefined, undefined, undefined, { latencyRecorder, identityProbe: async () => identityFor(durableRoute), verifyIdentity: verifier, revalidator: { async routeReread() { events.push("route-reread"); return durableRoute; }, async revalidate() { events.push(events.includes("prepare") ? "authority-validation-after-prepare" : "authority-validation-before-prepare"); return { authorityGeneration: durableRoute.authorityGeneration, authorityExpiresAt: durableRoute.authorityExpiresAt, routeAuthorityDigest: authorityDigest(durableRoute) }; } } });
    await coordinator.dispatch(createReservedDispatchHandle({ reservation, effect: {}, effectCanonicalBase64: "e30=", effectDigest: sha("3") }));
    assert.deepEqual(events, ["route-reread", "authority-validation-before-prepare", "prepare", "authority-validation-after-prepare", "dispatch-commit-cas", "send-started", "send"]);
    assert.deepEqual(latencyRecorder.finish().phases.map(item => item.name), ["identity-probe", "route-reread", "authority-validation-before-prepare", "prepare", "authority-validation-after-prepare", "dispatch-commit-cas", "authority-send-boundary", "terminal-transition"]);
  } finally { restore(); }
});

test("certified mode refuses legacy dispatch and prepared route substitution", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  try {
    const reservation: any = { reservationId: "r1", state: "reserved", intent: { effectDigest: sha("3"), routeAuthority: routeAuthority() } };
    const ledger: any = { async getReservation() { return reservation; }, async transition() { throw new Error("must not transition"); } };
    const coordinator = createDispatchCoordinator(ledger, { async dispatch() { throw new Error("legacy send"); } }, undefined, undefined, undefined, { identityProbe: async () => identityFor(routeAuthority()), verifyIdentity: verifier, revalidator: { async routeReread() { return routeAuthority(); }, async revalidate() { return { authorityGeneration: sha("2"), authorityExpiresAt: routeAuthority().authorityExpiresAt, routeAuthorityDigest: authorityDigest(routeAuthority()) }; } } });
    await assert.rejects(() => coordinator.dispatch(createReservedDispatchHandle({ reservation, effect: {}, effectCanonicalBase64: "e30=", effectDigest: sha("3") })), /prepared commit boundary/i);
  } finally { restore(); }
});

test("certified dispatch refuses a route reread that differs from the durable snapshot", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  try {
    const reservation: any = { reservationId: "r1", state: "reserved", intent: { effectDigest: sha("3"), routeAuthority: routeAuthority() } };
    const ledger: any = { async getReservation() { return reservation; }, async commitPreparedDispatch() { throw new Error("must not commit"); } };
    let prepared = false;
    const adapter: any = { async prepare() { prepared = true; throw new Error("must refuse before prepare"); } };
    const coordinator = createDispatchCoordinator(ledger, adapter, undefined, undefined, undefined, { identityProbe: async () => identityFor(routeAuthority()), verifyIdentity: verifier, revalidator: { async routeReread() { return { ...routeAuthority(), routeDigest: sha("z") }; }, async revalidate() { return { authorityGeneration: sha("2"), authorityExpiresAt: routeAuthority().authorityExpiresAt, routeAuthorityDigest: sha("z") }; } } });
    await assert.rejects(() => coordinator.dispatch(createReservedDispatchHandle({ reservation, effect: {}, effectCanonicalBase64: "e30=", effectDigest: sha("3") })), /route authority snapshot mismatch/i);
    assert.equal(prepared, false);
  } finally { restore(); }
});

test("certified budget consumption is rolled back exactly once when commit CAS refuses", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  try {
    const reservation: any = { reservationId: "r1", state: "reserved", intent: { effectDigest: sha("3"), routeAuthority: routeAuthority(), executionContext: { allocationId: "a1" } } };
    const projection: any = { v: "reelier.materialized-http-request/v1", method: "PUT", origin: "https://api.github.com", normalizedPath: "/x", normalizedQuery: "", reviewedHeaders: {}, bodyDigest: sha("4") };
    const route = { ...routeAuthority(), expectedMaterializedRequestDigest: authorityDigest(projection) };
    reservation.intent.routeAuthority = route;
    const events: string[] = [];
    const ledger: any = { async getReservation() { return reservation; }, async commitPreparedDispatch() { events.push("cas"); throw new Error("stale generation"); } };
    const adapter: any = { async prepare() { return createPreparedDispatch({ description: { v: "reelier.prepared-dispatch-description/v1", routeDigest: route.routeDigest, materializedRequestDigest: route.expectedMaterializedRequestDigest, projection, authorityGeneration: route.authorityGeneration, authorityExpiresAt: route.authorityExpiresAt, absoluteDeadlineMs: performance.now() + 60_000, reservationId: "r1", allocationId: "a1" }, send: async () => { throw new Error("must not send"); } }); } };
    const budget = { async consumeOnce() { events.push("consume"); }, async returnOnce() { events.push("return"); } };
    const coordinator = createDispatchCoordinator(ledger, adapter, undefined, undefined, budget, { identityProbe: async () => identityFor(route), verifyIdentity: verifier, revalidator: { async routeReread() { return route; }, async revalidate() { return { authorityGeneration: route.authorityGeneration, authorityExpiresAt: route.authorityExpiresAt, routeAuthorityDigest: authorityDigest(route) }; } } });
    await assert.rejects(() => coordinator.dispatch(createReservedDispatchHandle({ reservation, effect: {}, effectCanonicalBase64: "e30=", effectDigest: sha("3") })), /stale generation/i);
    assert.deepEqual(events, ["consume", "cas", "return"]);
  } finally { restore(); }
});

test("certified budget remains consumed when commit reports a post-transition fault", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  try {
    const reservation: any = { reservationId: "r1", state: "reserved", intent: { effectDigest: sha("3"), routeAuthority: routeAuthority(), executionContext: { allocationId: "a1" } } };
    const route = reservation.intent.routeAuthority;
    const projection: any = { v: "reelier.materialized-http-request/v1", method: "PUT", origin: "https://api.github.com", normalizedPath: "/x", normalizedQuery: "", reviewedHeaders: {}, bodyDigest: sha("4") };
    reservation.intent.routeAuthority = { ...route, expectedMaterializedRequestDigest: authorityDigest(projection) };
    const events: string[] = [];
    const ledger: any = { async getReservation() { return { ...reservation, state: "dispatched" }; }, async commitPreparedDispatch() { events.push("cas"); throw new Error("fault after transition"); } };
    const adapter: any = { async prepare() { return createPreparedDispatch({ description: { v: "reelier.prepared-dispatch-description/v1", routeDigest: route.routeDigest, materializedRequestDigest: reservation.intent.routeAuthority.expectedMaterializedRequestDigest, projection, authorityGeneration: route.authorityGeneration, authorityExpiresAt: route.authorityExpiresAt, absoluteDeadlineMs: performance.now() + 60_000, reservationId: "r1", allocationId: "a1" }, send: async () => { throw new Error("must not send"); } }); } };
    const budget = { async consumeOnce() { events.push("consume"); }, async returnOnce() { events.push("return"); } };
    const coordinator = createDispatchCoordinator(ledger, adapter, undefined, undefined, budget, { identityProbe: async () => identityFor(reservation.intent.routeAuthority), verifyIdentity: verifier, revalidator: { async routeReread() { return reservation.intent.routeAuthority; }, async revalidate() { return { authorityGeneration: route.authorityGeneration, authorityExpiresAt: route.authorityExpiresAt, routeAuthorityDigest: authorityDigest(reservation.intent.routeAuthority) }; } } });
    await assert.rejects(() => coordinator.dispatch(createReservedDispatchHandle({ reservation, effect: {}, effectCanonicalBase64: "e30=", effectDigest: sha("3") })), /fault after transition/i);
    assert.deepEqual(events, ["consume", "cas"]);
  } finally { restore(); }
});

test("certified identity rejects unsigned verifier bypass", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  try {
    const route = { ...routeAuthority(), providerAccountIdentity: "github:octocat" };
    const reservation: any = { reservationId: "r1", state: "reserved", intent: { effectDigest: sha("3"), routeAuthority: route } };
    const ledger: any = { async getReservation() { return reservation; }, async commitPreparedDispatch() { throw new Error("must not commit"); } };
    const signed = identityFor(route);
    const { signerId: _signerId, signature: _signature, ...unsigned } = signed;
    const coordinator = createDispatchCoordinator(ledger, { async dispatch() { throw new Error("must not send"); }, async prepare() { throw new Error("must not prepare"); } }, undefined, undefined, undefined, { identityProbe: async () => unsigned, verifyIdentity: (() => true) as never, revalidator: { async routeReread() { return route; }, async revalidate() { return { authorityGeneration: route.authorityGeneration, authorityExpiresAt: route.authorityExpiresAt, routeAuthorityDigest: authorityDigest(route) }; } } });
    await assert.rejects(() => coordinator.dispatch(createReservedDispatchHandle({ reservation, effect: {}, effectCanonicalBase64: "e30=", effectDigest: sha("3") })), /identity/i);
  } finally { restore(); }
});

test("certified identity rejects fake signatures, wrong purpose, and evil namespaces", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  try {
    const route = { ...routeAuthority(), providerAccountIdentity: "evil:octocat" };
    const reservation: any = { reservationId: "r1", state: "reserved", intent: { effectDigest: sha("3"), routeAuthority: route } };
    const ledger: any = { async getReservation() { return reservation; } };
    const coordinator = createDispatchCoordinator(ledger, { async dispatch() { throw new Error("must not send"); } }, undefined, undefined, undefined, { identityProbe: async () => identityFor(route, { signerId: "fake", signature: { alg: "ed25519", sig: Buffer.alloc(64, 7).toString("base64") } }), verifyIdentity: { purpose: "wrong-purpose", signerId: "fake", publicKey: identityKeys.publicKey } as never, revalidator: { async routeReread() { return route; }, async revalidate() { return { authorityGeneration: route.authorityGeneration, authorityExpiresAt: route.authorityExpiresAt, routeAuthorityDigest: authorityDigest(route) }; } } });
    await assert.rejects(() => coordinator.dispatch(createReservedDispatchHandle({ reservation, effect: {}, effectCanonicalBase64: "e30=", effectDigest: sha("3") })), /identity|purpose|namespace/i);
  } finally { restore(); }
});

test("certified identity rejects a signed account-id mismatch", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  try {
    const route = { ...routeAuthority(), providerAccountIdentity: "github:octocat" };
    const reservation: any = { reservationId: "r1", state: "reserved", intent: { effectDigest: sha("3"), routeAuthority: route } };
    const ledger: any = { async getReservation() { return reservation; } };
    const coordinator = createDispatchCoordinator(ledger, { async dispatch() { throw new Error("must not send"); } }, undefined, undefined, undefined, { identityProbe: async () => identityFor(route, { providerAccountId: "99" }), verifyIdentity: verifier, revalidator: { async routeReread() { return route; }, async revalidate() { return { authorityGeneration: route.authorityGeneration, authorityExpiresAt: route.authorityExpiresAt, routeAuthorityDigest: authorityDigest(route) }; } } });
    await assert.rejects(() => coordinator.dispatch(createReservedDispatchHandle({ reservation, effect: {}, effectCanonicalBase64: "e30=", effectDigest: sha("3") })), /identity/i);
  } finally { restore(); }
});

test("certified identity rejects a bogus signature with an otherwise valid namespaced identity", async () => {
  const restore = __testSetAuthorityCellHostPlatform("linux");
  try {
    const route = { ...routeAuthority(), providerAccountIdentity: "github:octocat" };
    const reservation: any = { reservationId: "r1", state: "reserved", intent: { effectDigest: sha("3"), routeAuthority: route } };
    const ledger: any = { async getReservation() { return reservation; }, async commitPreparedDispatch() { throw new Error("must not commit"); } };
    let prepared = false;
    const coordinator = createDispatchCoordinator(ledger, { async dispatch() { throw new Error("must not send"); }, async prepare() { prepared = true; throw new Error("must not prepare"); } }, undefined, undefined, undefined, { identityProbe: async () => identityFor(route, { signature: { alg: "ed25519", sig: Buffer.alloc(64, 7).toString("base64") } }), verifyIdentity: verifier, revalidator: { async routeReread() { return route; }, async revalidate() { return { authorityGeneration: route.authorityGeneration, authorityExpiresAt: route.authorityExpiresAt, routeAuthorityDigest: authorityDigest(route) }; } } });
    await assert.rejects(() => coordinator.dispatch(createReservedDispatchHandle({ reservation, effect: {}, effectCanonicalBase64: "e30=", effectDigest: sha("3") })), /identity/i);
    assert.equal(prepared, false);
  } finally { restore(); }
});
