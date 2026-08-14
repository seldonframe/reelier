import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { OUTCOME_PROFILE_CONTRACT_V1, OUTCOME_PROFILE_CONTRACT_V1_DIGEST } from "../../src/authority/outcome-profile-contract.js";
import { authorityDigest } from "../../src/authority/wire.js";

const contractDirectory = path.join(process.cwd(), "contract", "outcome-profile", "v1");
const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/2020").default as new (options: object) => {
  addSchema(schema: object): void;
  compile(schema: object): (value: unknown) => boolean;
};
const members = [
  "profile-activation.schema.json",
  "profile-conformance-report.schema.json",
  "profile-conformance.schema.json",
  "profile-draft.schema.json",
  "profile-governance-manifest.schema.json",
  "profile-governed-receipt.schema.json",
  "profile-trust-pin.schema.json",
];

test("Outcome Profile contract is a separate exact seven-schema digest", () => {
  assert.deepEqual(OUTCOME_PROFILE_CONTRACT_V1.members.map((member: Readonly<{ path: string }>) => member.path), members);
  assert.equal(OUTCOME_PROFILE_CONTRACT_V1.digest, OUTCOME_PROFILE_CONTRACT_V1_DIGEST);
  assert.equal(authorityDigest({ v: OUTCOME_PROFILE_CONTRACT_V1.v, domain: OUTCOME_PROFILE_CONTRACT_V1.domain, members: OUTCOME_PROFILE_CONTRACT_V1.members }), OUTCOME_PROFILE_CONTRACT_V1_DIGEST);
  assert.deepEqual(readdirSync(contractDirectory).sort(), ["contract-descriptor.json", ...members].sort());
  const authorityDescriptor = readFileSync(path.join(process.cwd(), "contract", "authority", "v1", "adapter-contract-v1.json"), "utf8");
  assert.equal(authorityDescriptor.includes("outcome-profile"), false, "Authority Contract v1 membership is unchanged");
  assert.equal(Object.isFrozen(OUTCOME_PROFILE_CONTRACT_V1), true);
  assert.equal(Object.isFrozen(OUTCOME_PROFILE_CONTRACT_V1.members), true);
  assert.equal(Object.isFrozen(OUTCOME_PROFILE_CONTRACT_V1.members[0]), true);
});

test("profile schema contract members are closed and descriptor digests normalize LF bytes", () => {
  for (const member of OUTCOME_PROFILE_CONTRACT_V1.members) {
    const bytes = readFileSync(path.join(contractDirectory, member.path));
    const normalized = Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
    assert.equal(member.digest, `sha256:${createHash("sha256").update(normalized).digest("hex")}`, member.path);
    const schema = JSON.parse(bytes.toString("utf8")) as { additionalProperties?: boolean };
    assert.equal(schema.additionalProperties, false, `${member.path} is closed`);
  }
});

test("the complete governed receipt schema graph compiles under declared identifiers", () => {
  const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
  const schemas = members.map(member => JSON.parse(readFileSync(path.join(contractDirectory, member), "utf8")) as object);
  const authorityReceiptBundle = JSON.parse(readFileSync(path.join(process.cwd(), "contract", "authority", "v1", "authority-receipt-bundle.schema.json"), "utf8")) as object;
  const governedReceipt = schemas[members.indexOf("profile-governed-receipt.schema.json")];
  for (const schema of [...schemas.filter(schema => schema !== governedReceipt), authorityReceiptBundle]) ajv.addSchema(schema);
  assert.equal(typeof ajv.compile(governedReceipt), "function");
});

test("Outcome Profile contract builder check is deterministic", () => {
  const output = execFileSync(process.execPath, ["scripts/build-outcome-profile-contract.mjs", "--check"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(output, "");
});
