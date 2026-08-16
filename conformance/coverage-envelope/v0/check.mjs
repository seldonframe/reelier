import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const load = (name) => JSON.parse(readFileSync(here(name), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(load("../../../contract/bootstrap/v1/route-coverage.schema.json"));
const validateInput = ajv.compile(load("./input.schema.json"));
const validateReport = ajv.compile(load("./report.schema.json"));

const NON_CLAIMS = Object.freeze({
  governedExecution: "not-proved-by-discovery",
  trafficCompleteness: "not-proved-by-inventory",
  providerOutcome: "not-proved",
  safety: "not-proved",
});

const UNWRAPPED_REASONS = new Set(["route-unwrapped", "plugin-private", "direct-http-bypass", "writable-browser-bypass", "host-private"]);

export function validateCoverageEnvelopeReport(value) {
  return validateReport(value);
}

export function buildCoverageEnvelope(input) {
  if (!validateInput(input)) throw new TypeError(`coverage envelope input is invalid: ${ajv.errorsText(validateInput.errors)}`);
  validateSemantics(input);
  const inventory = input.routes
    .map((route) => Object.freeze({ ...route, routing: routingFor(route) }))
    .sort((left, right) => Buffer.from(left.routeId).compare(Buffer.from(right.routeId)));
  const wrappedRoutes = routeIds(inventory.filter((route) => route.routing === "wrapped"));
  const unwrappedRoutes = routeIds(inventory.filter((route) => route.routing === "unwrapped"));
  const directHttpRoutes = routeIds(inventory.filter((route) => route.discoverySource === "direct-http"));
  const privateHostRoutes = routeIds(inventory.filter((route) => route.discoverySource === "host-private" || route.reasonCodes.includes("plugin-private")));
  const freshness = freshnessFor(inventory, input.evaluatedAt);
  const reasonCodes = reasonsFor(input, inventory, freshness, { unwrappedRoutes, directHttpRoutes, privateHostRoutes });
  const eligible = reasonCodes.length === 0 && input.requestedMode === "enforced";
  if (!eligible && input.requestedMode === "enforced") reasonCodes.push("enforced-mode-refused");
  if (!eligible && input.requestedMode === "observed" && reasonCodes.length === 0) reasonCodes.push("observed-mode-non-authorizing");
  reasonCodes.sort();
  const report = Object.freeze({
    v: "reelier.coverage-envelope-report/v0",
    status: eligible ? "passed" : "failed",
    harness: Object.freeze({ ...input.harness }),
    adapter: Object.freeze({ ...input.adapter }),
    sources: Object.freeze(input.sources.map((source) => Object.freeze({ ...source, reasonCodes: Object.freeze([...source.reasonCodes].sort()) }))),
    inventory: Object.freeze(inventory), wrappedRoutes, unwrappedRoutes, directHttpRoutes, privateHostRoutes,
    mode: eligible ? "enforced" : "observed", freshness: Object.freeze(freshness),
    claims: Object.freeze({ topology: Object.freeze({ ...input.claims.topology }), completeness: Object.freeze({ ...input.claims.completeness }) }),
    reasonCodes: Object.freeze(reasonCodes), nonClaims: NON_CLAIMS,
  });
  if (!validateReport(report)) throw new TypeError(`coverage envelope report is invalid: ${ajv.errorsText(validateReport.errors)}`);
  return report;
}

function validateSemantics(input) {
  const routeIds = new Set();
  const sourceIdentities = new Set();
  for (const source of input.sources) {
    if (sourceIdentities.has(source.sourceInstanceIdentityDigest)) throw new TypeError("coverage source instance identities must be unique");
    sourceIdentities.add(source.sourceInstanceIdentityDigest);
  }
  for (const route of input.routes) {
    if (route.hostId !== input.harness.id) throw new TypeError("coverage route harness identity is invalid");
    if (routeIds.has(route.routeId)) throw new TypeError("coverage route inventory contains duplicate route IDs");
    routeIds.add(route.routeId);
    if (Date.parse(route.freshUntil) <= Date.parse(route.observedAt)) throw new TypeError("coverage route freshness interval is invalid");
    if (route.enforcement === "verified" && route.topologyEvidenceDigest === null) throw new TypeError("verified route enforcement requires topology evidence");
    if (route.enforcement !== "verified" && route.topologyEvidenceDigest !== null) throw new TypeError("unverified route cannot carry topology evidence");
  }
  if (input.routes.some((route) => route.discoverySource === "host-config") && !input.sources.some((source) => source.kind === "host-config")) throw new TypeError("host config routes require host config source evidence");
  if (input.routes.some((route) => route.discoverySource === "plugin-manifest") && !input.sources.some((source) => source.kind === "plugin-manifest")) throw new TypeError("plugin routes require plugin manifest source evidence");
}

function routingFor(route) {
  if (route.observation === "observed" && route.reasonCodes.includes("wrapped-route-observed")) return "wrapped";
  if (route.observation === "uncovered" || ["direct-http", "writable-browser", "host-private"].includes(route.discoverySource) || route.reasonCodes.some((reason) => UNWRAPPED_REASONS.has(reason))) return "unwrapped";
  return "unknown";
}

function routeIds(routes) {
  return Object.freeze(routes.map((route) => route.routeId).sort((left, right) => Buffer.from(left).compare(Buffer.from(right))));
}

function freshnessFor(inventory, evaluatedAt) {
  if (inventory.length === 0) return { status: "absent", evaluatedAt, oldestObservedAt: null, freshUntil: null };
  const oldestObservedAt = inventory.map((route) => route.observedAt).sort()[0];
  const freshUntil = inventory.map((route) => route.freshUntil).sort()[0];
  return { status: Date.parse(evaluatedAt) < Date.parse(freshUntil) ? "fresh" : "stale", evaluatedAt, oldestObservedAt, freshUntil };
}

function reasonsFor(input, inventory, freshness, subsets) {
  const reasons = new Set();
  if (inventory.length === 0) reasons.add("no-routes-discovered");
  if (freshness.status === "stale") reasons.add("evidence-stale");
  for (const source of input.sources) if (source.evidenceStatus !== "verified") reasons.add(`coverage-source-${source.evidenceStatus}`);
  for (const route of inventory) {
    if (route.reasonCodes.includes("catalog-is-non-authorizing")) reasons.add("catalog-only-evidence");
    if (route.observation === "unknown") reasons.add("route-observation-unknown");
    if (route.observation === "uncovered") reasons.add("route-uncovered");
    if (route.observation === "partially-observed") reasons.add("route-partially-observed");
    if (route.enforcement !== "verified") reasons.add(`route-enforcement-${route.enforcement}`);
    if (route.routing === "unknown") reasons.add("route-routing-unknown");
  }
  if (subsets.directHttpRoutes.length > 0) reasons.add("direct-http-unwrapped");
  if (subsets.privateHostRoutes.length > 0) reasons.add("private-host-unwrapped");
  for (const claimName of ["topology", "completeness"]) {
    const status = input.claims[claimName].status;
    if (status !== "verified") reasons.add(`${claimName}-${status}`);
  }
  const inventoryContradictsCompleteness = inventory.length === 0 || inventory.some((route) => route.routing !== "wrapped" || route.observation !== "observed");
  if (input.claims.completeness.status === "verified" && inventoryContradictsCompleteness) reasons.add("completeness-contradicted-by-inventory");
  return [...reasons].sort();
}

function failureReport() {
  return {
    v: "reelier.coverage-envelope-report/v0", status: "failed",
    harness: { id: "codex", instanceIdentityDigest: `sha256:${"1".repeat(64)}` },
    adapter: { id: "reelier-codex-coverage", digest: `sha256:${"2".repeat(64)}` }, sources: [], inventory: [],
    wrappedRoutes: [], unwrappedRoutes: [], directHttpRoutes: [], privateHostRoutes: [], mode: "observed",
    freshness: { status: "absent", evaluatedAt: "1970-01-01T00:00:00.000Z", oldestObservedAt: null, freshUntil: null },
    claims: { topology: { status: "absent", evidenceDigest: null }, completeness: { status: "absent", evidenceDigest: null } },
    reasonCodes: ["no-routes-discovered"], nonClaims: NON_CLAIMS,
  };
}

function main() {
  if (process.argv.length !== 3) { process.stdout.write(`${JSON.stringify(failureReport())}\n`); process.exitCode = 2; return; }
  try {
    const report = buildCoverageEnvelope(JSON.parse(readFileSync(process.argv[2], "utf8")));
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = report.status === "passed" ? 0 : 1;
  } catch {
    process.stdout.write(`${JSON.stringify(failureReport())}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
