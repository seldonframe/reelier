import { authorityDigest } from "../../authority/wire.js";

export const neonDatabaseMigrationAlias = "neon_database_migration_apply_v1" as const;
export const neonDatabaseMigrationResolverId = "neon_database_migration_source_v1" as const;
export const neonDatabaseMigrationProjectionSchemaId = "neon_database_migration_projection_v1" as const;
export const neonDatabaseMigrationPolicySchemaId = "neon_database_migration_policy_v1" as const;
export const neonDatabaseMigrationRiskClass = "neon_database_migration" as const;
export const neonDatabaseMigrationReadEndpointId = "neon.database.catalog.get" as const;
export const neonDatabaseMigrationWriteEndpointId = "neon.database.migration.apply" as const;
export const neonDatabaseMigrationRecipeId = "neon_database_migration_readback_v1" as const;
const definitionShape = Object.freeze({ v: "reelier.outcome-pack-definition/v1", alias: neonDatabaseMigrationAlias, resolverId: neonDatabaseMigrationResolverId, projectionSchemaId: neonDatabaseMigrationProjectionSchemaId, policySchemaId: neonDatabaseMigrationPolicySchemaId, readEndpointIds: [neonDatabaseMigrationReadEndpointId], writeEndpointIds: [neonDatabaseMigrationWriteEndpointId], riskClasses: [neonDatabaseMigrationRiskClass], requiredGroundedPointers: ["/projectId", "/branchId", "/databaseId", "/roleId", "/schemaDigest", "/catalogDigest", "/lastMigrationId"], maxFreshnessSeconds: 60 });
export const neonDatabaseMigrationPackDigest = authorityDigest({ v: "reelier.outcome-pack/v1", packId: "neon_database", definitions: [definitionShape] });
export const neonDatabaseMigrationDefinitionDigest = authorityDigest({ ...definitionShape, packDigest: neonDatabaseMigrationPackDigest });
export const neonDatabaseMigrationManifest = Object.freeze({ v: "reelier.outcome-pack-manifest/v1" as const, packId: "neon_database", packDigest: neonDatabaseMigrationPackDigest, definitions: [neonDatabaseMigrationAlias] });
export interface NeonDatabaseMigrationProjection extends Record<string, unknown> { readonly projectId: string; readonly branchId: string; readonly databaseId: string; readonly roleId: string; readonly schemaDigest: string; readonly catalogDigest: string; readonly lastMigrationId: string; }
