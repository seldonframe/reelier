import test from "node:test";
import assert from "node:assert/strict";
import { compileNeonDatabaseMigration, parseNeonDatabaseMigrationPolicy, reconcileNeonDatabaseMigration, validateNeonDatabaseMigrationChoices, type NeonDatabaseMigrationProjection } from "reelier/packs";

const source: NeonDatabaseMigrationProjection = { projectId: "prj_demo", branchId: "br_demo", databaseId: "db_demo", roleId: "role_app", schemaDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111", catalogDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222", lastMigrationId: "migration_previous" };
const policyInput = { projectId: "prj_demo", branchId: "br_demo", databaseId: "db_demo", roleId: "role_app", migrationId: "migration_2026_08_10", expectedSchemaDigest: source.schemaDigest, sql: "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS plan text NOT NULL;" };

test("Neon migration accepts only the signed narrow SQL subset and compiles exact bytes", () => {
  assert.throws(() => validateNeonDatabaseMigrationChoices({ sql: "DROP TABLE accounts" }));
  const policy = parseNeonDatabaseMigrationPolicy(policyInput);
  const effect = compileNeonDatabaseMigration({ source, policy });
  assert.equal(effect.endpointId, "neon.database.migration.apply");
  assert.equal(effect.method, "POST");
  assert.equal(effect.path, "/api/v2/projects/prj_demo/branches/br_demo/databases/db_demo/migrations");
  assert.deepEqual(JSON.parse(Buffer.from(effect.bodyBase64, "base64").toString("utf8")), { migrationId: "migration_2026_08_10", roleId: "role_app", sql: policyInput.sql });
  assert.equal(effect.reconciliation.recipeId, "neon_database_migration_readback_v1");
  assert.throws(() => parseNeonDatabaseMigrationPolicy({ ...policyInput, sql: "DROP TABLE accounts;" }));
  assert.throws(() => parseNeonDatabaseMigrationPolicy({ ...policyInput, sql: "ALTER TABLE accounts ADD COLUMN bad;" }));
});

test("Neon migration binds the exact database state and reconciles without blind retry", () => {
  const policy = parseNeonDatabaseMigrationPolicy(policyInput);
  assert.throws(() => compileNeonDatabaseMigration({ source: { ...source, schemaDigest: "sha256:3333333333333333333333333333333333333333333333333333333333333333" }, policy }));
  const response = { status: 200, body: { projectId: "prj_demo", branchId: "br_demo", databaseId: "db_demo", roleId: "role_app", migrationId: "migration_2026_08_10", schemaDigest: "sha256:3333333333333333333333333333333333333333333333333333333333333333", catalogDigest: "sha256:4444444444444444444444444444444444444444444444444444444444444444" } };
  assert.equal(reconcileNeonDatabaseMigration({ expected: source, policy, response }).status, "matched");
  assert.equal(reconcileNeonDatabaseMigration({ expected: source, policy, response: { status: 200, body: { ...response.body, migrationId: "migration_other" } } }).status, "conflict");
  assert.equal(reconcileNeonDatabaseMigration({ expected: source, policy, response: { status: 404, body: {} } }).status, "not-applied");
  assert.equal(reconcileNeonDatabaseMigration({ expected: source, policy, response: { status: 503, body: {} } }).status, "unavailable");
});
