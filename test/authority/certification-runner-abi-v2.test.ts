import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { authorityDigest } from "../../src/authority/wire.js";
import {
  parseCertificationEndpointManifest,
  parseCertificationRunnerManifest,
  parseCertificationScenarioPlan,
} from "../../src/authority/certification/manifests.js";
import { deriveCertificationEndpointManifest } from "../../src/authority/certification/initializer.js";
import {
  getCertificationRunnerRegistryEntry,
  certificationRunnerRegistryDigest,
  certificationPolicyCommitments,
} from "../../src/authority/certification/runner-registry.js";
import {
  migrateCertificationOperatorConfig,
  parseCertificationOperatorConfigV3,
} from "../../src/authority/certification/config.js";
import { githubIssueLabelsAlias, githubIssueLabelsReadEndpointId, githubIssueLabelsWriteEndpointId } from "../../src/packs/github/manifest.js";
import { cloudflareDnsRecordSetReadEndpointId, cloudflareDnsRecordSetWriteEndpointId } from "../../src/packs/cloudflare/manifest.js";
import { slackChannelTopicReadEndpointId, slackChannelTopicWriteEndpointId } from "../../src/packs/slack-topic/manifest.js";
import { neonDatabaseMigrationReadEndpointId, neonDatabaseMigrationWriteEndpointId } from "../../src/packs/neon/manifest.js";
import { certificationScenarioPlanBindings } from "../../src/authority/certification/scenario-bindings.js";
import { createCertificationSelectionCommitment } from "../../src/authority/certification/commitment.js";
import { parseCertificationInitialization } from "../../src/authority/certification/initializer.js";
import { parseCertificationReadinessCandidate } from "../../src/authority/certification/readiness.js";
import { verifyCertificationExport } from "../../src/authority/certification/export.js";

const sha = (character: string) => `sha256:${character.repeat(64)}`;

function githubV3(): Record<string, unknown> {
  return {
    v: "reelier.certification-operator-config/v3",
    authorityConfigPath: "authority/authority.yml",
    evidenceDirectory: "authority/receipts/certification",
    scenarios: ["github-issue-labels"],
    resources: { "github-issue-labels": { apiBaseUrl: "https://api.github.com", owner: "fixlyai", repository: "reelier-certification", issueNumber: 1 } },
    cleanup: { "github-issue-labels": ["restore-github-issue-labels"] },
    desiredState: {},
    metadata: {},
    secretReferences: { githubCredential: "env:REELIER_GITHUB_TOKEN" },
  };
}

test("v3 migration splits Cloudflare DNS and bootstrap references without resolving either", () => {
  const legacy = {
    v: "reelier.certification-operator-config/v2",
    authorityConfigPath: "authority/authority.yml",
    evidenceDirectory: "authority/receipts/certification",
    scenarios: ["cloudflare-dns", "cloudflare-vercel-secret"],
    resources: {
      "cloudflare-dns": { apiBaseUrl: "https://api.cloudflare.com", accountId: "acct", zoneId: "zone", recordId: "record", recordName: "certification.example.com" },
      "cloudflare-vercel-secret": { cloudflareApiBaseUrl: "https://api.cloudflare.com", cloudflareAccountId: "acct", tokenName: "cert-token", vercelApiBaseUrl: "https://api.vercel.com", vercelAccountId: "team", projectId: "project" },
    },
    cleanup: { "cloudflare-dns": ["restore-dns"], "cloudflare-vercel-secret": ["remove-secret", "remove-token"] },
    metadata: {},
    secretReferences: { cloudflareCredential: "file:secrets/must-not-be-read", vercelCredential: "env:REELIER_VERCEL_TOKEN" },
  };
  const migrated = migrateCertificationOperatorConfig(legacy);
  assert.equal(migrated.v, "reelier.certification-operator-config/v3");
  assert.deepEqual(migrated.secretReferences, {
    cloudflareBootstrapCredential: "file:secrets/must-not-be-read",
    cloudflareDnsCredential: "file:secrets/must-not-be-read",
    vercelCredential: "env:REELIER_VERCEL_TOKEN",
  });
  assert.deepEqual(migrateCertificationOperatorConfig(migrated), migrated);
  assert.deepEqual(parseCertificationOperatorConfigV3(migrated), migrated);
});

test("v2 endpoint derivation uses reviewed pack aliases, endpoint IDs, methods, and directions", () => {
  const github = deriveCertificationEndpointManifest(parseCertificationOperatorConfigV3(githubV3()), "github-issue-labels");
  assert.equal(github.v, "reelier.certification-endpoint-manifest/v2");
  assert.deepEqual(github.definitionAliases, [githubIssueLabelsAlias]);
  assert.deepEqual(github.endpoints.map(endpoint => [endpoint.endpointId, endpoint.method, endpoint.direction]), [
    [githubIssueLabelsReadEndpointId, "GET", "read"],
    [githubIssueLabelsWriteEndpointId, "PUT", "write"],
  ]);

  const expected = {
    "cloudflare-dns": [cloudflareDnsRecordSetReadEndpointId, cloudflareDnsRecordSetWriteEndpointId],
    "slack-topic": [slackChannelTopicReadEndpointId, slackChannelTopicWriteEndpointId],
    "neon-migration": [neonDatabaseMigrationReadEndpointId, neonDatabaseMigrationWriteEndpointId],
  };
  for (const [scenario, endpointIds] of Object.entries(expected)) {
    const entry = getCertificationRunnerRegistryEntry(scenario as never);
    assert.deepEqual(entry.endpoints.map(endpoint => endpoint.endpointId), endpointIds);
  }
});

test("compound endpoint authority binds provider credential account resource method and direction per endpoint", () => {
  const config = parseCertificationOperatorConfigV3({
    ...githubV3(),
    v: "reelier.certification-operator-config/v3",
    scenarios: ["cloudflare-vercel-secret"],
    resources: { "cloudflare-vercel-secret": { cloudflareApiBaseUrl: "https://api.cloudflare.com", cloudflareAccountId: "cf-acct", tokenName: "cert-token", vercelApiBaseUrl: "https://api.vercel.com", vercelAccountId: "vc-team", projectId: "vc-project" } },
    cleanup: { "cloudflare-vercel-secret": ["remove-secret", "remove-token"] },
    desiredState: {},
    secretReferences: { cloudflareBootstrapCredential: "env:REELIER_CLOUDFLARE_BOOTSTRAP_TOKEN", vercelCredential: "env:REELIER_VERCEL_TOKEN" },
  });
  const manifest = deriveCertificationEndpointManifest(config, "cloudflare-vercel-secret");
  assert.equal(manifest.dispatchable, false);
  assert.deepEqual(manifest.endpoints.map(endpoint => ({ provider: endpoint.provider, credentialSlot: endpoint.credentialSlot, method: endpoint.method, direction: endpoint.direction })), [
    { provider: "cloudflare", credentialSlot: "cloudflareBootstrapCredential", method: "GET", direction: "read" },
    { provider: "cloudflare", credentialSlot: "cloudflareBootstrapCredential", method: "POST", direction: "write" },
    { provider: "vercel", credentialSlot: "vercelCredential", method: "GET", direction: "read" },
    { provider: "vercel", credentialSlot: "vercelCredential", method: "POST", direction: "write" },
  ]);
  assert.equal(new Set(manifest.endpoints.map(endpoint => endpoint.accountCommitment)).size, 2);
  assert.equal(new Set(manifest.endpoints.map(endpoint => endpoint.resourceCommitment)).size, 2);
});

test("runner v2 binds registry metadata but remains non-dispatchable without implementation and executed-test evidence", () => {
  const endpoint = deriveCertificationEndpointManifest(parseCertificationOperatorConfigV3(githubV3()), "github-issue-labels");
  const registry = getCertificationRunnerRegistryEntry("github-issue-labels");
  const runner = parseCertificationRunnerManifest({
    v: "reelier.certification-runner-manifest/v2",
    scenarioId: "github-issue-labels",
    runnerId: registry.runnerId,
    endpointManifestDigest: authorityDigest(endpoint),
    metadataDigest: registry.metadataDigest,
    registryDigest: certificationRunnerRegistryDigest,
    operations: ["prepare", "authoritative-read", "compile", "reserve", "authoritative-reread", "recompile", "dispatch", "controlled-cut", "reconcile", "receipt", "cleanup", "export", "offline-verify"],
    executionReady: false,
    dispatchable: false,
  }, "github-issue-labels");
  assert.equal(runner.dispatchable, false);
  assert.equal(runner.executionReady, false);
  assert.equal("implementationDigest" in runner, false);
  assert.throws(() => parseCertificationRunnerManifest({ ...runner, metadataDigest: sha("f") }, "github-issue-labels"), /metadata|registry/i);
  const v1 = parseCertificationRunnerManifest({ v: "reelier.certification-runner-manifest/v1", scenarioId: "github-issue-labels", runnerId: "legacy_runner", endpointManifestDigest: sha("1"), implementationDigest: sha("2"), operations: ["prepare", "authoritative-read", "compile", "reserve", "reread", "dispatch", "reconcile", "receipt", "cleanup"] });
  assert.equal(v1.dispatchable, false);
});

test("scenario plan is closed, selected-only, digest-bound, and rejects secret or executable shapes", () => {
  const config = parseCertificationOperatorConfigV3(githubV3());
  const bindings = certificationScenarioPlanBindings(config, "github-issue-labels");
  const base = {
    v: "reelier.certification-scenario-plan/v1",
    scenarioId: "github-issue-labels",
    definitionAliases: [githubIssueLabelsAlias],
    sourceRefs: bindings.sourceRefs,
    resourceDigest: bindings.resourceDigest,
    accountCommitments: bindings.accountCommitments,
    desiredStateDigest: bindings.desiredStateDigest,
    policyCommitments: certificationPolicyCommitments("github-issue-labels"),
    cleanup: { recipeIds: bindings.cleanupRecipeIds, beforeState: "pending" },
    controlledCut: { case: "ambiguous-after-dispatch" },
    runnerManifestDigest: sha("3"),
    testManifestDigest: sha("4"),
    endpointManifestDigest: sha("5"),
    runnerRegistryDigest: certificationRunnerRegistryDigest,
  };
  assert.equal(parseCertificationScenarioPlan(base, config, ["github-issue-labels"]).scenarioId, "github-issue-labels");
  for (const mutation of [
    { ...base, scenarioId: "slack-topic" },
    { ...base, callback: () => undefined },
    { ...base, modulePath: "./runner.js" },
    { ...base, command: "node runner.js" },
    { ...base, sourceRefs: { github: sha("9") } },
    { ...base, cleanup: { recipeIds: ["caller-choice"], beforeState: "pending" } },
    { ...base, unselectedScenarioData: { "slack-topic": {} } },
  ]) assert.throws(() => parseCertificationScenarioPlan(mutation, config, ["github-issue-labels"]), /closed|authority|config|selected|scenario|pending/i);
  assert.throws(() => parseCertificationScenarioPlan({ ...base, policyCommitments: [{ schemaId: "github_issue_labels_policy_v1", digest: sha("9") }] }, config, ["github-issue-labels"]), /policy|digest/i);
  assert.throws(() => parseCertificationScenarioPlan({ ...base, cleanup: { recipeIds: bindings.cleanupRecipeIds, beforeStateDigest: sha("9") } }, config, ["github-issue-labels"]), /before.state|pending|cleanup|closed/i);
});

test("sanitized commitments disclose no raw desired-state values", () => {
  const canary = "TASK4A_DESIRED_STATE_CANARY";
  const config = parseCertificationOperatorConfigV3({
    ...githubV3(),
    desiredState: { "github-issue-labels": { labels: [canary] } },
  });
  const commitment = createCertificationSelectionCommitment(config, ["github-issue-labels"], sha("a"));
  const serialized = JSON.stringify(commitment.projection);
  assert.doesNotMatch(serialized, new RegExp(canary));
  assert.match(serialized, /digest|byteCount|type/i);
});

test("public certification artifact parsers reject getters without invoking them", () => {
  const getterObject = (keys: readonly string[], getterKey: string, getter: () => unknown): Record<string, unknown> => {
    const descriptors: PropertyDescriptorMap = {};
    for (const key of keys) descriptors[key] = key === getterKey
      ? { enumerable: true, configurable: true, get: getter }
      : { enumerable: true, configurable: true, writable: true, value: null };
    return Object.create(Object.prototype, descriptors) as Record<string, unknown>;
  };
  let getterCalls = 0;
  const initialization = getterObject(["v", "configDigest", "privateConfigDigest", "sanitizedProjectionDigest", "scenarios", "identifiers", "completeness"], "v", () => { getterCalls += 1; return "reelier.certification-initialization/v1"; });
  assert.throws(() => parseCertificationInitialization(initialization));
  assert.equal(getterCalls, 0);

  const preflight = getterObject(["v", "configDigest", "selectionDigest", "identifiers", "scenarios", "resources", "cleanup", "credentialReferences", "inputs", "runnerRegistryDigest", "topology", "trust", "signatureStatus", "authorization", "completeness", "missing", "ok", "preparationReady", "executionReady", "dispatchable", "digest"], "v", () => { getterCalls += 1; return "reelier.certification-preflight/v2"; });
  assert.throws(() => parseCertificationReadinessCandidate({}, preflight));
  assert.equal(getterCalls, 0);

  const exported = getterObject(["v", "manifest", "artifacts", "digest"], "v", () => { getterCalls += 1; return "reelier.certification-export/v1"; });
  assert.throws(() => verifyCertificationExport(exported));
  assert.equal(getterCalls, 0);
});

test("private runner registry is exact metadata and unavailable compound runners stay non-dispatchable", () => {
  const scenarios = ["cloudflare-dns", "cloudflare-vercel-secret", "github-issue-labels", "neon-migration", "slack-topic", "vercel-promotion"];
  const entries = scenarios.map(scenario => getCertificationRunnerRegistryEntry(scenario as never));
  assert.deepEqual(entries.map(entry => entry.scenarioId), scenarios);
  assert.equal(entries.every(entry => entry.dispatchable === false), true);
  assert.equal(entries.every(entry => entry.executionReady === false), true);
  assert.equal(entries.every(entry => "implementationDigest" in entry === false), true);
  assert.equal(entries.find(entry => entry.scenarioId === "cloudflare-vercel-secret")?.dispatchable, false);
  assert.match(entries.find(entry => entry.scenarioId === "cloudflare-vercel-secret")?.unavailableReason ?? "", /not registered/i);
  const serialized = JSON.stringify(entries);
  assert.doesNotMatch(serialized, /function|callback|modulePath|sourcePath|command/i);
  assert.equal(entries.some(entry => Object.values(entry).some(value => typeof value === "function")), false);
});

test("public package exports do not expose the private runner registry", async () => {
  const authority = await import("../../src/authority/index.js") as Record<string, unknown>;
  const host = await import("../../src/authority/host/index.js") as Record<string, unknown>;
  for (const surface of [authority, host]) {
    assert.equal("getCertificationRunnerRegistryEntry" in surface, false);
    assert.equal("certificationRunnerRegistryDigest" in surface, false);
  }
  assert.equal("verifyCertificationScenarioPlanV1" in authority, false);
  for (const verifier of ["verifyCertificationOperatorConfigV3", "verifyCertificationEndpointManifestV2", "verifyCertificationRunnerManifestV2", "verifyCertificationScenarioPlanV1"]) assert.equal(typeof host[verifier], "function", verifier);
  const config = (host.verifyCertificationOperatorConfigV3 as any)(githubV3());
  const endpoint = deriveCertificationEndpointManifest(config, "github-issue-labels");
  const verifiedEndpoint = (host.verifyCertificationEndpointManifestV2 as any)(endpoint, config, "github-issue-labels");
  const registry = getCertificationRunnerRegistryEntry("github-issue-labels");
  const runner = { v: "reelier.certification-runner-manifest/v2", scenarioId: "github-issue-labels", runnerId: registry.runnerId, endpointManifestDigest: authorityDigest(endpoint), metadataDigest: registry.metadataDigest, registryDigest: certificationRunnerRegistryDigest, operations: registry.operations, executionReady: false, dispatchable: false };
  assert.equal((host.verifyCertificationRunnerManifestV2 as any)(runner, { scenarioId: "github-issue-labels", endpointManifestDigest: authorityDigest(verifiedEndpoint) }).runnerId, registry.runnerId);
  const bindings = certificationScenarioPlanBindings(config, "github-issue-labels");
  const plan = { v: "reelier.certification-scenario-plan/v1", scenarioId: "github-issue-labels", definitionAliases: registry.definitionAliases, sourceRefs: bindings.sourceRefs, resourceDigest: bindings.resourceDigest, accountCommitments: bindings.accountCommitments, desiredStateDigest: bindings.desiredStateDigest, policyCommitments: certificationPolicyCommitments("github-issue-labels"), cleanup: { recipeIds: bindings.cleanupRecipeIds, beforeState: "pending" }, controlledCut: { case: "ambiguous-after-dispatch" }, runnerManifestDigest: sha("3"), testManifestDigest: sha("4"), endpointManifestDigest: authorityDigest(endpoint), runnerRegistryDigest: certificationRunnerRegistryDigest };
  assert.equal((host.verifyCertificationScenarioPlanV1 as any)(plan, config, ["github-issue-labels"]).scenarioId, "github-issue-labels");
  assert.throws(() => (host.verifyCertificationScenarioPlanV1 as any)({ ...plan, cleanup: { recipeIds: ["attacker"], beforeState: "pending" } }, config, ["github-issue-labels"]), /cleanup|config/i);
});

test("closed public plan input rejects accessor-based callbacks without invoking them", () => {
  let calls = 0;
  const sourceRefs = Object.create(Object.prototype, {
    github: { enumerable: true, get: () => { calls += 1; return sha("1"); } },
  });
  const config = parseCertificationOperatorConfigV3(githubV3());
  const bindings = certificationScenarioPlanBindings(config, "github-issue-labels");
  const plan = {
    v: "reelier.certification-scenario-plan/v1",
    scenarioId: "github-issue-labels",
    definitionAliases: [githubIssueLabelsAlias],
    sourceRefs,
    resourceDigest: bindings.resourceDigest,
    accountCommitments: bindings.accountCommitments,
    desiredStateDigest: bindings.desiredStateDigest,
    policyCommitments: certificationPolicyCommitments("github-issue-labels"),
    cleanup: { recipeIds: bindings.cleanupRecipeIds, beforeState: "pending" },
    controlledCut: { case: "ambiguous-after-dispatch" },
    runnerManifestDigest: sha("3"), testManifestDigest: sha("4"), endpointManifestDigest: sha("5"), runnerRegistryDigest: certificationRunnerRegistryDigest,
  };
  assert.throws(() => parseCertificationScenarioPlan(plan, config, ["github-issue-labels"]), /inert|accessor|closed/i);
  assert.equal(calls, 0);
});

test("plan scenario selection rejects array accessors without invoking them", () => {
  let calls = 0;
  const selected = new Array(1);
  Object.defineProperty(selected, "0", { enumerable: true, get: () => { calls += 1; return "github-issue-labels"; } });
  const config = parseCertificationOperatorConfigV3(githubV3());
  const bindings = certificationScenarioPlanBindings(config, "github-issue-labels");
  const registry = getCertificationRunnerRegistryEntry("github-issue-labels");
  const plan = { v: "reelier.certification-scenario-plan/v1", scenarioId: "github-issue-labels", definitionAliases: registry.definitionAliases, sourceRefs: bindings.sourceRefs, resourceDigest: bindings.resourceDigest, accountCommitments: bindings.accountCommitments, desiredStateDigest: bindings.desiredStateDigest, policyCommitments: certificationPolicyCommitments("github-issue-labels"), cleanup: { recipeIds: bindings.cleanupRecipeIds, beforeState: "pending" }, controlledCut: { case: "ambiguous-after-dispatch" }, runnerManifestDigest: sha("3"), testManifestDigest: sha("4"), endpointManifestDigest: sha("5"), runnerRegistryDigest: certificationRunnerRegistryDigest };
  assert.throws(() => parseCertificationScenarioPlan(plan, config, selected as never), /array|inert|dense/i);
  assert.equal(calls, 0);
});

test("portable Task 4A schemas agree with runtime parsers on a positive and negative corpus", () => {
  const Ajv2020 = createRequire(import.meta.url)("ajv/dist/2020").default;
  const ajv = new Ajv2020({ strict: false });
  createRequire(import.meta.url)("ajv-formats").default(ajv);
  const load = (name: string) => JSON.parse(readFileSync(path.join(process.cwd(), "contract", "authority", "v1", name), "utf8"));
  const validators = new Map<string, (value: unknown) => boolean>();
  const validates = (schema: string, value: unknown) => { if (!validators.has(schema)) validators.set(schema, ajv.compile(load(schema))); return validators.get(schema)!(value); };
  const config = parseCertificationOperatorConfigV3(githubV3());
  assert.equal(validates("certification-operator-config-v3.schema.json", githubV3()), true);
  const endpoint = deriveCertificationEndpointManifest(config, "github-issue-labels");
  const registry = getCertificationRunnerRegistryEntry("github-issue-labels");
  const runner = { v: "reelier.certification-runner-manifest/v2", scenarioId: "github-issue-labels", runnerId: registry.runnerId, endpointManifestDigest: authorityDigest(endpoint), metadataDigest: registry.metadataDigest, registryDigest: certificationRunnerRegistryDigest, operations: registry.operations, executionReady: false, dispatchable: false };
  const bindings = certificationScenarioPlanBindings(config, "github-issue-labels");
  const plan = { v: "reelier.certification-scenario-plan/v1", scenarioId: "github-issue-labels", definitionAliases: registry.definitionAliases, sourceRefs: bindings.sourceRefs, resourceDigest: bindings.resourceDigest, accountCommitments: bindings.accountCommitments, desiredStateDigest: bindings.desiredStateDigest, policyCommitments: certificationPolicyCommitments("github-issue-labels"), cleanup: { recipeIds: bindings.cleanupRecipeIds, beforeState: "pending" }, controlledCut: { case: "ambiguous-after-dispatch" }, runnerManifestDigest: sha("3"), testManifestDigest: sha("4"), endpointManifestDigest: authorityDigest(endpoint), runnerRegistryDigest: certificationRunnerRegistryDigest };
  for (const [schema, positive, parse] of [
    ["certification-runner-manifest-v2.schema.json", runner, () => parseCertificationRunnerManifest(runner)],
    ["certification-endpoint-manifest-v2.schema.json", endpoint, () => parseCertificationEndpointManifest(endpoint)],
    ["certification-scenario-plan.schema.json", plan, () => parseCertificationScenarioPlan(plan, config)],
  ] as const) { assert.equal(validates(schema, positive), true); assert.doesNotThrow(parse); }
  for (const [schema, negative, parse] of [
    ["certification-runner-manifest-v2.schema.json", { ...runner, dispatchable: true }, () => parseCertificationRunnerManifest({ ...runner, dispatchable: true })],
    ["certification-endpoint-manifest-v2.schema.json", { ...endpoint, dispatchable: true }, () => parseCertificationEndpointManifest({ ...endpoint, dispatchable: true })],
    ["certification-scenario-plan.schema.json", { ...plan, choices: {} }, () => parseCertificationScenarioPlan({ ...plan, choices: {} }, config)],
  ] as const) { assert.equal(validates(schema, negative), false); assert.throws(parse); }
  const configNegatives = [
    { ...githubV3(), resources: { "github-issue-labels": { ...(githubV3().resources as any)["github-issue-labels"], owner: "token=plaintext" } } },
    { ...githubV3(), resources: {} },
    { ...githubV3(), resources: { ...(githubV3().resources as object), "slack-topic": { apiBaseUrl: "https://slack.com", teamId: "team", channelId: "channel" } } },
    { ...githubV3(), authorityConfigPath: "../authority.yml" },
    { ...githubV3(), secretReferences: { githubCredential: "env:1_BAD" } },
    { ...githubV3(), secretReferences: { githubCredential: "file:../secret" } },
    { ...githubV3(), scenarios: ["github-issue-labels", "cloudflare-dns"] },
    { ...githubV3(), authorityConfigPath: "file:../authority.yml" },
    { ...githubV3(), resources: { "github-issue-labels": { ...(githubV3().resources as any)["github-issue-labels"], issueNumber: Number.MAX_SAFE_INTEGER + 1 } } },
  ];
  for (const [index, negative] of configNegatives.entries()) { assert.equal(validates("certification-operator-config-v3.schema.json", negative), false, `config negative ${index}`); assert.throws(() => parseCertificationOperatorConfigV3(negative)); }

  for (const [schema, negative] of [
    ["certification-runner-manifest-v2.schema.json", { ...runner, runnerId: "arbitrary_runner" }],
    ["certification-runner-manifest-v2.schema.json", { ...runner, metadataDigest: sha("f") }],
    ["certification-runner-manifest-v2.schema.json", { ...runner, registryDigest: sha("e") }],
    ["certification-endpoint-manifest-v2.schema.json", { ...endpoint, definitionAliases: ["arbitrary_alias"] }],
    ["certification-endpoint-manifest-v2.schema.json", { ...endpoint, endpoints: endpoint.endpoints.map((item, index) => index === 0 ? { ...item, endpointId: "arbitrary_endpoint" } : item) }],
    ["certification-scenario-plan.schema.json", { ...plan, definitionAliases: ["arbitrary_alias"] }],
    ["certification-scenario-plan.schema.json", { ...plan, runnerRegistryDigest: sha("d") }],
    ["certification-scenario-plan.schema.json", { ...plan, sourceRefs: { vercel: plan.sourceRefs.github } }],
    ["certification-scenario-plan.schema.json", { ...plan, accountCommitments: [{ provider: "vercel", digest: plan.accountCommitments[0].digest }] }],
  ] as const) assert.equal(validates(schema, negative), false, `${schema} must reject arbitrary reviewed authority`);

  const dynamicCleanupSubstitution = { ...plan, cleanup: { recipeIds: ["attacker-selected-recipe"], beforeState: "pending" } };
  assert.equal(validates("certification-scenario-plan.schema.json", dynamicCleanupSubstitution), true, "packaged JSON Schema validates structure, not config-bound recipe identity");
  assert.throws(() => parseCertificationScenarioPlan(dynamicCleanupSubstitution, config), /cleanup|config|pending/i);

  const relativeFile = { ...githubV3(), secretReferences: { githubCredential: "file:secrets/github-token" } };
  assert.equal(validates("certification-operator-config-v3.schema.json", relativeFile), true);
  assert.doesNotThrow(() => parseCertificationOperatorConfigV3(relativeFile));
  for (const reference of ["file:C:/private/token", "file:https://attacker.example/token", "file:secrets/token:alternate", "file:/absolute/token"]) {
    const negative = { ...githubV3(), secretReferences: { githubCredential: reference } };
    assert.equal(validates("certification-operator-config-v3.schema.json", negative), false, reference);
    assert.throws(() => parseCertificationOperatorConfigV3(negative), /secret reference/i);
  }
});

test("order-insensitive config lists validate structurally and canonicalize before commitments", () => {
  const Ajv2020 = createRequire(import.meta.url)("ajv/dist/2020").default;
  const ajv = new Ajv2020({ strict: false });
  createRequire(import.meta.url)("ajv-formats").default(ajv);
  const schema = JSON.parse(readFileSync(path.join(process.cwd(), "contract", "authority", "v1", "certification-operator-config-v3.schema.json"), "utf8"));
  const validate = ajv.compile(schema);
  const github = { ...githubV3(), cleanup: { "github-issue-labels": ["z-cleanup", "a-cleanup"] }, desiredState: { "github-issue-labels": { labels: ["z-label", "a-label"] } } };
  assert.equal(validate(github), true);
  const parsedGithub = parseCertificationOperatorConfigV3(github);
  assert.deepEqual(parsedGithub.cleanup["github-issue-labels"], ["a-cleanup", "z-cleanup"]);
  assert.deepEqual(parsedGithub.desiredState["github-issue-labels"]?.labels, ["a-label", "z-label"]);

  const compound = {
    ...githubV3(),
    scenarios: ["cloudflare-vercel-secret"],
    resources: { "cloudflare-vercel-secret": { cloudflareApiBaseUrl: "https://api.cloudflare.com", cloudflareAccountId: "account", tokenName: "token-name", vercelApiBaseUrl: "https://api.vercel.com", vercelAccountId: "team", projectId: "project" } },
    cleanup: { "cloudflare-vercel-secret": ["z-cleanup", "a-cleanup"] },
    desiredState: { "cloudflare-vercel-secret": { cloudflare: { permissionGroupIds: ["z-permission", "a-permission"], resources: { zone: "zone-id" }, notBefore: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-02T00:00:00.000Z", requestIpIn: ["z-range", "a-range"], requestIpNotIn: ["z-deny", "a-deny"] }, vercel: { environment: "production", key: "CERTIFICATION_KEY" } } },
    secretReferences: { cloudflareBootstrapCredential: "env:REELIER_CLOUDFLARE_BOOTSTRAP_TOKEN", vercelCredential: "env:REELIER_VERCEL_TOKEN" },
  };
  assert.equal(validate(compound), true);
  const parsedCompound = parseCertificationOperatorConfigV3(compound);
  assert.deepEqual(parsedCompound.cleanup["cloudflare-vercel-secret"], ["a-cleanup", "z-cleanup"]);
  const desired = parsedCompound.desiredState["cloudflare-vercel-secret"] as any;
  assert.deepEqual(desired.cloudflare.permissionGroupIds, ["a-permission", "z-permission"]);
  assert.deepEqual(desired.cloudflare.requestIpIn, ["a-range", "z-range"]);
  assert.deepEqual(desired.cloudflare.requestIpNotIn, ["a-deny", "z-deny"]);
});
