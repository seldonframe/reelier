import test from "node:test";
import assert from "node:assert/strict";
import {
  compileVercelDeploymentRelease,
  parseVercelDeploymentReleasePolicy,
  reconcileVercelDeploymentRelease,
  validateVercelDeploymentReleaseChoices,
  type VercelDeploymentReleaseProjection,
} from "reelier/packs";

const source: VercelDeploymentReleaseProjection = {
  teamId: "team_demo",
  projectId: "prj_demo",
  deploymentId: "dpl_preview",
  deploymentUrl: "https://preview-demo.vercel.app",
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  checks: [{ name: "build", status: "passed" }, { name: "tests", status: "passed" }],
  domains: ["app.example.com"],
  currentProductionDeploymentId: "dpl_previous",
};

test("Vercel release rejects agent choices and compiles an exact promotion", () => {
  assert.throws(() => validateVercelDeploymentReleaseChoices({ deploymentId: "attacker" }));
  const policy = parseVercelDeploymentReleasePolicy({ teamId: "team_demo", projectId: "prj_demo", allowedDomains: ["app.example.com"] });
  const effect = compileVercelDeploymentRelease({ source, policy });
  assert.equal(effect.endpointId, "vercel.deployment.promote");
  assert.equal(effect.method, "POST");
  assert.equal(effect.path, "/v10/projects/prj_demo/promote/dpl_preview");
  assert.equal(effect.query, "teamId=team_demo");
  assert.equal(effect.bodyBase64, "");
  assert.deepEqual(effect.headers, { Accept: "*/*" });
  assert.equal(effect.idempotency, "reconcile-only");
  assert.deepEqual(effect.preconditions.map(item => item.kind), ["vercel-production-deployment", "vercel-deployment-commit", "vercel-deployment-checks", "vercel-deployment-domains"]);
  assert.equal(effect.reconciliation.recipeId, "vercel_deployment_release_readback_v1");
});

test("Vercel release refuses stale, failed, or already-current deployment state", () => {
  const policy = parseVercelDeploymentReleasePolicy({ teamId: "team_demo", projectId: "prj_demo", allowedDomains: ["app.example.com"] });
  assert.throws(() => compileVercelDeploymentRelease({ source: { ...source, checks: [{ name: "tests", status: "failed" }] }, policy }));
  assert.throws(() => compileVercelDeploymentRelease({ source: { ...source, currentProductionDeploymentId: source.deploymentId }, policy }));
  assert.throws(() => compileVercelDeploymentRelease({ source, policy: parseVercelDeploymentReleasePolicy({ teamId: "team_demo", projectId: "prj_demo", allowedDomains: ["attacker.example"] }) }));
});

test("Vercel release reconciles authoritative production state without treating acknowledgement as success", () => {
  const matched = reconcileVercelDeploymentRelease({
    expected: source,
    response: { status: 200, body: { id: "dpl_preview", teamId: "team_demo", projectId: "prj_demo", target: "production", commitSha: source.commitSha, domains: source.domains, currentProductionDeploymentId: "dpl_preview" } },
  });
  assert.equal(matched.status, "matched");
  assert.ok(matched.projectionDigest);
  assert.equal(reconcileVercelDeploymentRelease({ expected: source, response: { status: 200, body: { id: "dpl_other", teamId: "team_demo", projectId: "prj_demo", target: "production", commitSha: source.commitSha, domains: source.domains, currentProductionDeploymentId: "dpl_other" } } }).status, "conflict");
  assert.equal(reconcileVercelDeploymentRelease({ expected: source, response: { status: 404, body: {} } }).status, "not-applied");
  assert.equal(reconcileVercelDeploymentRelease({ expected: source, response: { status: 503, body: {} } }).status, "unavailable");
});
