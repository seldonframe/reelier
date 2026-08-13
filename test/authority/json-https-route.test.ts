import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  canonicalizeJsonHttpsRoute,
  createJsonHttpsRouteRegistry,
  jsonHttpsRouteDigest,
  lookupJsonHttpsRoute,
  parseJsonHttpsRouteV1,
} from "../../src/authority/host/json-https-route.js";

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const routeInput = () => ({
  v: "reelier.json-https-route/v1" as const,
  providerId: "github",
  connectorId: "github",
  accountId: "github-disposable-tracer",
  providerAccountIdentity: "github:disposable-tracer",
  endpointId: "github.issue.labels.replace",
  origin: "https://api.github.com",
  allowedMethods: ["PUT"] as const,
  allowedPathPrefixes: ["/repos/example/tracer/issues/1/labels"],
  credentialSlotId: "github.tracer",
  responseSemanticsProfileId: "github.issue-labels.v1",
  reconciliationRecipeId: "github.issue-labels.readback.v1",
  readEndpointId: "github.issue.labels.readback",
  egressPolicyDigest: sha("github-egress"),
});

test("canonical HTTPS routes freeze the GitHub labels write and independent read routes", () => {
  const write = parseJsonHttpsRouteV1(routeInput());
  const read = parseJsonHttpsRouteV1({ ...routeInput(), endpointId: "github.issue.labels.readback", allowedMethods: ["GET"], readEndpointId: "github.issue.labels.readback" });
  const registry = createJsonHttpsRouteRegistry([write, read]);

  assert.match(jsonHttpsRouteDigest(write), /^sha256:[0-9a-f]{64}$/);
  assert.equal(lookupJsonHttpsRoute(registry, "github.issue.labels.replace")?.readEndpointId, "github.issue.labels.readback");
  assert.equal(lookupJsonHttpsRoute(registry, "github.issue.labels.readback")?.allowedMethods[0], "GET");
  assert.equal(lookupJsonHttpsRoute(registry, "github.issue.get"), undefined);
  assert.equal(jsonHttpsRouteDigest(write), jsonHttpsRouteDigest(structuredClone(write)));
  for (const differingRoute of [
    { ...write, providerId: "gitlab" }, { ...write, connectorId: "gitlab" }, { ...write, accountId: "other-account" },
    { ...write, providerAccountIdentity: "github:other" }, { ...write, endpointId: "github.issue.labels.other" },
    { ...write, origin: "https://uploads.github.com" }, { ...write, allowedMethods: ["PATCH"] as const },
    { ...write, allowedPathPrefixes: ["/repos/example/tracer/issues/2/labels"] }, { ...write, credentialSlotId: "github.other" },
    { ...write, responseSemanticsProfileId: "github.issue-labels.v2" }, { ...write, reconciliationRecipeId: "github.issue-labels.readback.v2" },
    { ...write, readEndpointId: "github.issue.labels.readback.other" }, { ...write, egressPolicyDigest: sha("other-egress") },
  ]) assert.notEqual(jsonHttpsRouteDigest(write), jsonHttpsRouteDigest(differingRoute));
});

test("canonical HTTPS route parsing is closed and inert", () => {
  const route = routeInput();
  const invalid = [
    { ...route, secretRef: "env:TOKEN" },
    { ...route, origin: "http://api.github.com" },
    { ...route, origin: "https://token@api.github.com" },
    { ...route, origin: "https://*.github.com" },
    { ...route, allowedMethods: ["TRACE"] },
    { ...route, allowedMethods: ["PUT", "PUT"] },
    { ...route, allowedPathPrefixes: ["/repos/example/../tracer"] },
    { ...route, allowedPathPrefixes: ["/repos\\example"] },
    { ...route, allowedPathPrefixes: ["/repos/example?x=1"] },
    { ...route, allowedPathPrefixes: ["/repos/example#part"] },
    { ...route, allowedPathPrefixes: ["/repos/example", "/repos/example/"] },
    Object.create({ ...route }),
  ];
  for (const value of invalid) assert.throws(() => parseJsonHttpsRouteV1(value), /unknown|invalid|HTTPS|closed|duplicate/i);

  const accessor = { ...route } as Record<string, unknown>;
  Object.defineProperty(accessor, "origin", { enumerable: true, get() { throw new Error("getter invoked"); } });
  assert.throws(() => parseJsonHttpsRouteV1(accessor), /closed|accessor/i);

  const nestedAccessor = { ...route, allowedMethods: ["PUT"] } as Record<string, unknown>;
  Object.defineProperty(nestedAccessor.allowedMethods as unknown as object, "0", { enumerable: true, get() { throw new Error("getter invoked"); } });
  assert.throws(() => parseJsonHttpsRouteV1(nestedAccessor), /closed|accessor|inert/i);
});

test("canonicalization sorts methods and path prefixes while rejecting duplicate normalized entries", () => {
  const route = parseJsonHttpsRouteV1({ ...routeInput(), allowedMethods: ["PUT", "GET"], allowedPathPrefixes: ["/z", "/a"] });
  assert.deepEqual(canonicalizeJsonHttpsRoute(route).allowedMethods, ["GET", "PUT"]);
  assert.deepEqual(canonicalizeJsonHttpsRoute(route).allowedPathPrefixes, ["/a", "/z"]);
  assert.throws(() => parseJsonHttpsRouteV1({ ...routeInput(), allowedPathPrefixes: ["/a/", "/a"] }), /duplicate/i);
});
