import Ajv2020 from "ajv/dist/2020.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const load = (name) => JSON.parse(readFileSync(here(name), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(load("../../../contract/bootstrap/v1/route-coverage.schema.json"));
const validateInput = ajv.compile(load("./input.schema.json"));
const validateReport = ajv.compile(load("./report.schema.json"));
const MAX_FRESHNESS_MS = 24 * 60 * 60_000;
const BUILTIN_ADAPTERS = Object.freeze({
  codex: Object.freeze({ id: "reelier-codex-coverage", digest: "sha256:505974436216762ba42d59cd2be53a1bba01c1222bcd5c96ee218ec0fc585694" }),
  "claude-code": Object.freeze({ id: "reelier-claude-code-coverage", digest: "sha256:2c74152ded212870e3211de9cae509ac80487abab629168e7e4c0768e87423ec" }),
});

const NON_CLAIMS = Object.freeze({
  governedExecution: "not-proved-by-discovery",
  trafficCompleteness: "not-proved-by-inventory",
  providerOutcome: "not-proved",
  safety: "not-proved",
});

const UNWRAPPED_REASONS = new Set(["route-unwrapped", "plugin-private", "direct-http-bypass", "writable-browser-bypass", "host-private"]);

export function validateCoverageEnvelopeReport(value) {
  if (!validateReport(value)) return false;
  try { validateReportSemantics(value); return true; } catch { return false; }
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
  const sources = input.sources.map((source) => Object.freeze({
    ...source, observedAt: source.observedAt ?? null, freshUntil: source.freshUntil ?? null,
    reasonCodes: Object.freeze([...source.reasonCodes].sort()),
  }));
  const freshness = freshnessFor(inventory, sources, input.evaluatedAt);
  const reasonCodes = reasonsFor(input, inventory, freshness, { unwrappedRoutes, directHttpRoutes, privateHostRoutes });
  reasonCodes.sort();
  const report = Object.freeze({
    v: "reelier.coverage-envelope-report/v0",
    status: "failed",
    harness: Object.freeze({ ...input.harness }),
    adapter: Object.freeze({ ...input.adapter }),
    sources: Object.freeze(sources),
    inventory: Object.freeze(inventory), wrappedRoutes, unwrappedRoutes, directHttpRoutes, privateHostRoutes,
    mode: "observed", freshness: Object.freeze(freshness),
    claims: Object.freeze({ topology: Object.freeze({ ...input.claims.topology }), completeness: Object.freeze({ ...input.claims.completeness }) }),
    reasonCodes: Object.freeze(reasonCodes), nonClaims: NON_CLAIMS,
    provenance: Object.freeze({ status: "asserted", adapter: "asserted", sources: "asserted", routeEvidenceDigest: input.routeEvidenceDigest }),
  });
  const committedReport = Object.freeze({ ...report, integrityDigest: integrityDigest(report) });
  if (!validateCoverageEnvelopeReport(committedReport)) throw new TypeError(`coverage envelope report is invalid: ${ajv.errorsText(validateReport.errors)}`);
  return committedReport;
}

function validateSemantics(input) {
  assertBuiltinAdapter(input.harness, input.adapter);
  const evaluatedAt = parseCanonicalTimestamp(input.evaluatedAt, "coverage evaluation");
  if (input.routeEvidenceDigest !== routeEvidenceDigest(input.routes)) throw new TypeError("coverage route evidence commitment is invalid");
  const routeIds = new Set();
  const sourceIdentities = new Set();
  for (const source of input.sources) {
    if (sourceIdentities.has(source.sourceInstanceIdentityDigest)) throw new TypeError("coverage source instance identities must be unique");
    sourceIdentities.add(source.sourceInstanceIdentityDigest);
    assertFreshnessInterval(source.observedAt, source.freshUntil, evaluatedAt, "coverage source");
  }
  for (const route of input.routes) {
    if (route.hostId !== input.harness.id) throw new TypeError("coverage route harness identity is invalid");
    if (routeIds.has(route.routeId)) throw new TypeError("coverage route inventory contains duplicate route IDs");
    routeIds.add(route.routeId);
    assertFreshnessInterval(route.observedAt, route.freshUntil, evaluatedAt, "coverage route");
    if (route.enforcement === "verified" && route.topologyEvidenceDigest === null) throw new TypeError("verified route enforcement requires topology evidence");
    if (route.enforcement !== "verified" && route.topologyEvidenceDigest !== null) throw new TypeError("unverified route cannot carry topology evidence");
  }
  if (input.routes.some((route) => route.discoverySource === "host-config") && !input.sources.some((source) => source.kind === "host-config")) throw new TypeError("host config routes require host config source evidence");
  if (input.routes.some((route) => route.discoverySource === "plugin-manifest") && !input.sources.some((source) => source.kind === "plugin-manifest")) throw new TypeError("plugin routes require plugin manifest source evidence");
}

function routingFor(route) {
  if (route.observation === "uncovered" || ["direct-http", "writable-browser", "host-private"].includes(route.discoverySource) || route.reasonCodes.some((reason) => UNWRAPPED_REASONS.has(reason))) return "unwrapped";
  if (route.observation === "observed" && route.reasonCodes.includes("wrapped-route-observed")) return "wrapped";
  return "unknown";
}

function routeIds(routes) {
  return Object.freeze(routes.map((route) => route.routeId).sort((left, right) => Buffer.from(left).compare(Buffer.from(right))));
}

function freshnessFor(inventory, sources, evaluatedAt) {
  const observations = [...inventory.map((route) => route.observedAt), ...sources.flatMap((source) => source.observedAt === null ? [] : [source.observedAt])];
  const expiries = [...inventory.map((route) => route.freshUntil), ...sources.flatMap((source) => source.freshUntil === null ? [] : [source.freshUntil])];
  if (inventory.length === 0 || sources.some((source) => source.observedAt === null || source.freshUntil === null)) {
    return { status: "absent", evaluatedAt, oldestObservedAt: observations.sort()[0] ?? null, freshUntil: null };
  }
  const oldestObservedAt = observations.sort()[0];
  const freshUntil = expiries.sort()[0];
  return { status: Date.parse(evaluatedAt) < Date.parse(freshUntil) ? "fresh" : "stale", evaluatedAt, oldestObservedAt, freshUntil };
}

function reasonsFor(input, inventory, freshness, subsets) {
  const reasons = new Set();
  reasons.add("discovery-is-non-authorizing");
  reasons.add("provenance-asserted-only");
  if (inventory.length === 0) reasons.add("no-routes-discovered");
  if (freshness.status === "stale") reasons.add("evidence-stale");
  if (freshness.status === "absent" && inventory.length > 0) reasons.add("source-freshness-absent");
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

function assertBuiltinAdapter(harness, adapter) {
  const expected = BUILTIN_ADAPTERS[harness.id];
  if (!expected || adapter.id !== expected.id || adapter.digest !== expected.digest) throw new TypeError("coverage adapter digest lacks built-in provenance");
}

function assertFreshnessInterval(observedAt, freshUntil, evaluatedAt, label) {
  if (observedAt === undefined && freshUntil === undefined) return;
  if (observedAt === undefined || freshUntil === undefined) throw new TypeError(`${label} freshness interval is incomplete`);
  const observed = parseCanonicalTimestamp(observedAt, `${label} observation`);
  const expiry = parseCanonicalTimestamp(freshUntil, `${label} freshness expiry`);
  if (observed > evaluatedAt) throw new TypeError(`${label} observation is future-dated`);
  if (expiry <= observed || expiry - observed > MAX_FRESHNESS_MS) throw new TypeError(`${label} freshness interval is invalid`);
}

function parseCanonicalTimestamp(value, label) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) throw new TypeError(`${label} timestamp is invalid`);
  return timestamp;
}

function validateReportSemantics(report) {
  if (report.harness === null || report.adapter === null) {
    if (JSON.stringify(canonical(report)) !== JSON.stringify(canonical(failureReport()))) throw new TypeError("coverage refusal report is inconsistent");
    return;
  }
  assertBuiltinAdapter(report.harness, report.adapter);
  const evaluatedAt = parseCanonicalTimestamp(report.freshness.evaluatedAt, "coverage evaluation");
  const sourceIdentities = new Set();
  for (const source of report.sources) {
    if (sourceIdentities.has(source.sourceInstanceIdentityDigest)) throw new TypeError("coverage source identities are duplicated");
    sourceIdentities.add(source.sourceInstanceIdentityDigest);
    assertFreshnessInterval(source.observedAt ?? undefined, source.freshUntil ?? undefined, evaluatedAt, "coverage source");
  }
  const ids = new Set();
  const orderedIds = routeIds(report.inventory);
  if (JSON.stringify(report.inventory.map((route) => route.routeId)) !== JSON.stringify(orderedIds)) throw new TypeError("coverage inventory order is inconsistent");
  for (const route of report.inventory) {
    if (route.hostId !== report.harness.id || ids.has(route.routeId) || route.routing !== routingFor(route)) throw new TypeError("coverage route mapping is inconsistent");
    ids.add(route.routeId);
    assertFreshnessInterval(route.observedAt, route.freshUntil, evaluatedAt, "coverage route");
    if ((route.enforcement === "verified") !== (route.topologyEvidenceDigest !== null)) throw new TypeError("coverage route enforcement evidence is inconsistent");
  }
  if (report.inventory.some((route) => route.discoverySource === "host-config") && !report.sources.some((source) => source.kind === "host-config")) throw new TypeError("host config source evidence is missing");
  if (report.inventory.some((route) => route.discoverySource === "plugin-manifest") && !report.sources.some((source) => source.kind === "plugin-manifest")) throw new TypeError("plugin source evidence is missing");
  const mappings = {
    wrappedRoutes: routeIds(report.inventory.filter((route) => route.routing === "wrapped")),
    unwrappedRoutes: routeIds(report.inventory.filter((route) => route.routing === "unwrapped")),
    directHttpRoutes: routeIds(report.inventory.filter((route) => route.discoverySource === "direct-http")),
    privateHostRoutes: routeIds(report.inventory.filter((route) => route.discoverySource === "host-private" || route.reasonCodes.includes("plugin-private"))),
  };
  for (const [field, expected] of Object.entries(mappings)) if (JSON.stringify(report[field]) !== JSON.stringify(expected)) throw new TypeError(`coverage ${field} mapping is inconsistent`);
  const expectedFreshness = freshnessFor(report.inventory, report.sources, report.freshness.evaluatedAt);
  if (JSON.stringify(report.freshness) !== JSON.stringify(expectedFreshness)) throw new TypeError("coverage freshness is inconsistent");
  for (const claim of Object.values(report.claims)) if ((claim.status === "verified") !== (claim.evidenceDigest !== null)) throw new TypeError("coverage claim evidence is inconsistent");
  const expectedReasons = reasonsFor(report, report.inventory, report.freshness, mappings);
  if (JSON.stringify(report.reasonCodes) !== JSON.stringify(expectedReasons)) throw new TypeError("coverage reasons are inconsistent");
  if (report.status !== "failed" || report.mode !== "observed") throw new TypeError("discovery coverage cannot authorize execution");
  const expectedProvenance = { status: "asserted", adapter: "asserted", sources: "asserted", routeEvidenceDigest: routeEvidenceDigest(report.inventory) };
  if (JSON.stringify(report.provenance) !== JSON.stringify(expectedProvenance)) throw new TypeError("coverage provenance claim is inconsistent");
  if (report.integrityDigest !== integrityDigest(report)) throw new TypeError("coverage report integrity is invalid");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function routeEvidenceDigest(routes) {
  const evidence = [...routes]
    .sort((left, right) => Buffer.from(left.routeId).compare(Buffer.from(right.routeId)))
    .map((route) => [route.routeId, route.evidenceDigest]);
  return `sha256:${createHash("sha256").update(JSON.stringify({ v: "reelier.route-evidence-commitment/v0", evidence }), "utf8").digest("hex")}`;
}

function integrityDigest(report) {
  const { integrityDigest: ignored, ...payload } = report;
  void ignored;
  const envelope = { v: "reelier.coverage-envelope-integrity/v0", report: payload };
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(envelope)), "utf8").digest("hex")}`;
}

function failureReport() {
  return {
    v: "reelier.coverage-envelope-report/v0", status: "failed",
    harness: null, adapter: null, sources: [],
    inventory: [],
    wrappedRoutes: [], unwrappedRoutes: [], directHttpRoutes: [], privateHostRoutes: [], mode: "observed",
    freshness: { status: "absent", evaluatedAt: "1970-01-01T00:00:00.000Z", oldestObservedAt: null, freshUntil: null },
    claims: { topology: { status: "absent", evidenceDigest: null }, completeness: { status: "absent", evidenceDigest: null } },
    reasonCodes: ["input-unavailable", "no-routes-discovered"], nonClaims: NON_CLAIMS, provenance: null, integrityDigest: null,
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
