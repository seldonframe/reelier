import test from "node:test";
import assert from "node:assert/strict";
import { authorityDigest } from "../../src/authority/wire.js";
import {
  digestGovernedEffectCommitmentV1,
  parseGovernedEffectCommitmentV1,
} from "../../src/authority/governed-effect-commitment.js";

const sha = (character: string) => `sha256:${character.repeat(64)}`;

const commitment = Object.freeze({
  v: "reelier.governed-effect-commitment/v1" as const,
  definitionAlias: "github_release_candidate_publish_v1",
  pathCContractDigest: sha("1"),
  toolEffectContractDigest: sha("2"),
  transportBindingDigest: sha("3"),
  compiledEffectInputDigest: sha("4"),
  requestCommitmentDigest: sha("5"),
  operationKind: "github.candidate-publish",
  reviewedPolicyDigest: sha("6"),
  packDigest: sha("7"),
  definitionDigest: sha("8"),
});

test("governed effect commitment is a closed canonical durable join", () => {
  const parsed = parseGovernedEffectCommitmentV1(commitment);
  assert.deepEqual(parsed, commitment);
  assert.equal(digestGovernedEffectCommitmentV1(commitment), authorityDigest(commitment));
  assert.equal(Object.isFrozen(parsed), true);

  for (const field of Object.keys(commitment).filter(field => field !== "v")) {
    const replacement = field.endsWith("Digest") ? sha("9") : `${commitment[field as keyof typeof commitment]}-other`;
    assert.notEqual(
      digestGovernedEffectCommitmentV1({ ...commitment, [field]: replacement }),
      digestGovernedEffectCommitmentV1(commitment),
      field,
    );
  }
  assert.throws(() => parseGovernedEffectCommitmentV1({ ...commitment, extra: true }), /closed|field/i);
  assert.throws(() => parseGovernedEffectCommitmentV1({ ...commitment, pathCContractDigest: "sha256:bad" }), /digest/i);
});

test("governed effect commitment rejects accessors and proxies without executing them", () => {
  let effects = 0;
  const accessor = Object.create(Object.prototype, Object.fromEntries(Object.entries(commitment).map(([key, value]) => [key, {
    enumerable: true,
    ...(key === "operationKind" ? { get() { effects += 1; return value; } } : { value }),
  }])));
  assert.throws(() => parseGovernedEffectCommitmentV1(accessor), /data|inert|closed/i);
  assert.equal(effects, 0);

  const proxy = new Proxy({}, {
    getPrototypeOf() { effects += 1; return Object.prototype; },
    ownKeys() { effects += 1; return []; },
  });
  assert.throws(() => parseGovernedEffectCommitmentV1(proxy), /data|inert|closed/i);
  assert.equal(effects, 0);
});
