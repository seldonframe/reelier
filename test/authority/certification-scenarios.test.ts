import test from "node:test";
import assert from "node:assert/strict";
import { CERTIFICATION_SCENARIO_IDS, CERTIFICATION_SCENARIOS } from "../../src/authority/certification/scenarios.js";

test("the closed certification scenario registry contains eight unique sorted declarative scenarios", () => {
  assert.equal(Object.isFrozen(CERTIFICATION_SCENARIO_IDS), true);
  assert.deepEqual(CERTIFICATION_SCENARIO_IDS, ["cloudflare-dns", "cloudflare-vercel-secret", "codex-ten-principal", "fly-topology", "github-issue-labels", "neon-migration", "slack-topic", "vercel-promotion"]);
  assert.equal(new Set(CERTIFICATION_SCENARIO_IDS).size, 8);
  assert.deepEqual(Object.keys(CERTIFICATION_SCENARIOS), CERTIFICATION_SCENARIO_IDS);
  for (const scenario of Object.values(CERTIFICATION_SCENARIOS)) {
    assert.equal(Object.isFrozen(scenario), true);
    assert.equal(Object.isFrozen(scenario.resourceSections), true);
    assert.equal(Object.isFrozen(scenario.cleanupCommitments), true);
    assert.equal(Object.isFrozen(scenario.metadataSections), true);
    assert.equal(Object.isFrozen(scenario.secretSlots), true);
    assert.equal("run" in scenario, false);
    assert.equal("adapter" in scenario, false);
  }
});

test("scenario requirements declare selected-only resources, cleanup, metadata, and named secret slots", () => {
  assert.deepEqual(CERTIFICATION_SCENARIOS["github-issue-labels"], {
    scenarioId: "github-issue-labels",
    resourceSections: ["github-issue-labels"],
    cleanupCommitments: ["github-issue-labels"],
    metadataSections: [],
    secretSlots: ["githubCredential"],
  });
  assert.deepEqual(CERTIFICATION_SCENARIOS["cloudflare-vercel-secret"].secretSlots, ["cloudflareCredential", "vercelCredential"]);
  assert.deepEqual(CERTIFICATION_SCENARIOS["neon-migration"].secretSlots, ["neonApiCredential", "neonDatabaseUrl"]);
  assert.deepEqual(CERTIFICATION_SCENARIOS["fly-topology"].metadataSections, ["flyTopology"]);
  assert.deepEqual(CERTIFICATION_SCENARIOS["fly-topology"].secretSlots, ["flyApiCredential"]);
  assert.deepEqual(CERTIFICATION_SCENARIOS["codex-ten-principal"].metadataSections, ["codexTenPrincipal"]);
  assert.deepEqual(CERTIFICATION_SCENARIOS["codex-ten-principal"].secretSlots, []);
});
