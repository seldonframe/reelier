import test from "node:test";
import assert from "node:assert/strict";
import { authorityDigest } from "../../src/authority/wire.js";
import { digestGovernedEffectCommitmentV1 } from "../../src/authority/governed-effect-commitment.js";
import {
  githubReleaseCandidatePublishAlias,
  githubReleaseCandidatePublishDefinition,
  githubReleasePrEnsureAlias,
  githubReleasePrEnsureDefinition,
  githubReleasePrMergeAlias,
  githubReleasePrMergeDefinition,
  githubReleaseTagCreateAlias,
  githubReleaseTagCreateDefinition,
  githubReleasePacks,
  reconcileGitHubRelease,
} from "../../src/packs/github-release/index.js";
import { firstPartyPackForAlias } from "../../src/packs/index.js";

const cases = [
  [githubReleaseCandidatePublishAlias, githubReleaseCandidatePublishDefinition, "candidate-branch"],
  [githubReleasePrEnsureAlias, githubReleasePrEnsureDefinition, "draft-pr"],
  [githubReleasePrMergeAlias, githubReleasePrMergeDefinition, "exact-sha-merge"],
  [githubReleaseTagCreateAlias, githubReleaseTagCreateDefinition, "non-force-tag"],
] as const;

test("GitHub release registers four isolated empty-choice outcomes with host-owned authority handles", () => {
  assert.deepEqual(cases.map(([alias]) => alias), [
    "github_release_candidate_publish_v1",
    "github_release_pr_ensure_v1",
    "github_release_pr_merge_v1",
    "github_release_tag_create_v1",
  ]);
  assert.equal(githubReleasePacks.length, 4);
  for (const [alias, definition, effect] of cases) {
    assert.equal(firstPartyPackForAlias(alias)?.definition, definition);
    assert.deepEqual(definition.validateChoices({}), {});
    assert.throws(() => definition.validateChoices({ repository: "attacker/repo" }), /choices.*empty/i);
    const allocationId = `release-${effect}-01`;
    const allocationDigest = authorityDigest({ allocationId, effect, maxEffects: 1 });
    const policy = definition.parsePolicy({ allocationDigest, allocationId, authorizationHandleDigest: authorityDigest({ handle: "release_auth_1" }), effect, maxEffects: 1 }) as Record<string, unknown>;
    const compiled = definition.compile({ contract: {} as never, source: { projection: { authorizationHandle: "release_auth_1" } } as never, choices: {}, policy, now: new Date(0), connectorAccount: { connectorId: "github", accountId: "host" } }) as Record<string, unknown>;
    assert.equal(compiled.endpointId, `github.release.${effect}`);
    assert.equal(JSON.stringify(compiled).includes("seldonframe/reelier"), false);
    assert.equal(JSON.stringify(compiled).includes("0.32.1"), false);
    assert.throws(() => definition.parsePolicy({ ...policy, effect: effect === "candidate-branch" ? "draft-pr" : "candidate-branch" }), /effect|policy/i);
  }
});

test("GitHub release reconciliation matches only a closed verified evidence projection", () => {
  const evidenceDigest = authorityDigest({ evidence: 1 });
  assert.equal(reconcileGitHubRelease({ response: { status: 200, body: { status: "verified", phase: "candidate-verified", evidenceDigest } } }).status, "matched");
  assert.equal(reconcileGitHubRelease({ response: { status: 200, body: { status: "verified", phase: "candidate-verified", evidenceDigest, extra: true } } }).status, "unavailable");
  assert.equal(reconcileGitHubRelease({ response: { status: 200, body: { status: "verified", phase: "candidate-verified", evidenceDigest: "sha256:bad" } } }).status, "unavailable");
  let invoked = 0;
  const hostile = Object.create(Object.prototype, { status: { enumerable: true, get() { invoked++; return "verified"; } }, phase: { enumerable: true, value: "candidate-verified" }, evidenceDigest: { enumerable: true, value: evidenceDigest } });
  assert.equal(reconcileGitHubRelease({ response: { status: 200, body: hostile } }).status, "unavailable");
  assert.equal(invoked, 0);
});

test("GitHub release pack policy and projection refuse accessors without invoking them", () => {
  const definition = githubReleaseCandidatePublishDefinition;
  let invoked = 0;
  const hostilePolicy = Object.create(Object.prototype, {
    allocationDigest: { enumerable: true, value: authorityDigest({ allocation: 1 }) }, allocationId: { enumerable: true, value: "release-candidate-branch-01" },
    authorizationHandleDigest: { enumerable: true, value: authorityDigest({ handle: "release_auth_1" }) }, effect: { enumerable: true, get() { invoked++; return "candidate-branch"; } }, maxEffects: { enumerable: true, value: 1 },
  });
  assert.throws(() => definition.parsePolicy(hostilePolicy), /closed|inert|policy/i);
  assert.equal(invoked, 0);
  const policy = definition.parsePolicy({ allocationDigest: authorityDigest({ allocation: 1 }), allocationId: "release-candidate-branch-01", authorizationHandleDigest: authorityDigest({ handle: "release_auth_1" }), effect: "candidate-branch", maxEffects: 1 });
  const projection = Object.create(Object.prototype, { authorizationHandle: { enumerable: true, get() { invoked++; return "release_auth_1"; } } });
  assert.throws(() => definition.compile({ contract: {} as never, source: { projection } as never, choices: {}, policy, now: new Date(0), connectorAccount: { connectorId: "github", accountId: "host" } }), /projection|inert|handle/i);
  assert.equal(invoked, 0);
  let traps = 0;
  const proxy = new Proxy({}, { getPrototypeOf() { traps++; return Object.prototype; }, ownKeys() { traps++; return []; } });
  assert.throws(() => definition.parsePolicy(proxy), /closed|inert|policy/i);
  assert.equal(reconcileGitHubRelease({ response: proxy }).status, "unavailable");
  assert.equal(traps, 0);
});

test("GitHub release choices reject proxies without invoking traps", () => {
  let traps = 0;
  const choices = new Proxy({}, {
    getPrototypeOf() { traps += 1; return Object.prototype; },
    ownKeys() { traps += 1; return []; },
  });
  assert.throws(() => githubReleaseCandidatePublishDefinition.validateChoices(choices), /closed|inert|choices/i);
  assert.equal(traps, 0);
});

test("GitHub release emits the exact governed Task-4 digest join from signed inputs", () => {
  const definition = githubReleaseCandidatePublishDefinition;
  const contract = { alias: githubReleaseCandidatePublishAlias, packDigest: definition.packDigest, definitionDigest: definition.definitionDigest } as never;
  const source = { projection: { authorizationHandle: "release_auth_1" }, sourceIdentity: "source_1", triggerIdentity: "trigger_1" };
  const choices = {};
  const governed = Object.freeze({
    toolEffectContractDigest: authorityDigest({ tool: "candidate" }),
    transportBindingDigest: authorityDigest({ binding: "candidate" }),
    operationKind: "github.candidate-publish",
    reviewedPolicyDigest: authorityDigest({ policy: "reviewed" }),
  });
  const policy = definition.parsePolicy({
    allocationDigest: authorityDigest({ allocation: 1 }),
    allocationId: "release-candidate-branch-01",
    authorizationHandleDigest: authorityDigest({ handle: "release_auth_1" }),
    effect: "candidate-branch",
    maxEffects: 1,
    governed,
  });
  const compiled = definition.compile({ contract, source: source as never, choices, policy, now: new Date(0), connectorAccount: { connectorId: "github", accountId: "host" } }) as { preconditions: readonly { kind: string; digest: string }[] };
  const precondition = compiled.preconditions.find(item => item.kind === "governed-effect-commitment-v1");
  assert.ok(precondition);
  assert.equal(precondition.digest, digestGovernedEffectCommitmentV1({
    v: "reelier.governed-effect-commitment/v1",
    definitionAlias: githubReleaseCandidatePublishAlias,
    pathCContractDigest: authorityDigest(contract),
    toolEffectContractDigest: governed.toolEffectContractDigest,
    transportBindingDigest: governed.transportBindingDigest,
    compiledEffectInputDigest: authorityDigest({ v: "reelier.compiled-effect-input/v1", definitionAlias: githubReleaseCandidatePublishAlias, source, choices, connectorAccount: { connectorId: "github", accountId: "host" } }),
    requestCommitmentDigest: authorityDigest({ v: "reelier.effect-request-commitment/v1", definitionAlias: githubReleaseCandidatePublishAlias, projection: source.projection, choices }),
    operationKind: governed.operationKind,
    reviewedPolicyDigest: governed.reviewedPolicyDigest,
    packDigest: definition.packDigest,
    definitionDigest: definition.definitionDigest,
  }));
  assert.throws(() => definition.parsePolicy({ ...(policy as object), commitmentDigest: authorityDigest({ attacker: true }) }), /closed|policy/i);
});
