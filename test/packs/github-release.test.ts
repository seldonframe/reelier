import test from "node:test";
import assert from "node:assert/strict";
import { authorityDigest } from "../../src/authority/wire.js";
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
    const policy = definition.parsePolicy({ allocationDigest, allocationId, authorizationHandleDigest: authorityDigest({ handle: "release_auth_1" }), effect, maxEffects: 1 });
    const compiled = definition.compile({ contract: {} as never, source: { projection: { authorizationHandle: "release_auth_1" } } as never, choices: {}, policy, now: new Date(0), connectorAccount: { connectorId: "github", accountId: "host" } }) as Record<string, unknown>;
    assert.equal(compiled.endpointId, `github.release.${effect}`);
    assert.equal(JSON.stringify(compiled).includes("seldonframe/reelier"), false);
    assert.equal(JSON.stringify(compiled).includes("0.32.1"), false);
    assert.throws(() => definition.parsePolicy({ ...policy, effect: "candidate-branch" }), /effect|policy/i);
  }
});
