import { authorityDigest } from "../../authority/wire.js";

export const informationFlowCommitAlias = "hubspot_slack_information_flow_commit_v1" as const;
export const informationFlowResolverId = "hubspot_ticket_projection_source_v1" as const;
export const informationFlowProjectionSchemaId = "hubspot_ticket_projection_v1" as const;
export const informationFlowPolicySchemaId = "hubspot_slack_information_flow_policy_v1" as const;
export const informationFlowRiskClass = "information_flow_commit" as const;
export const informationFlowReadEndpointId = "hubspot.ticket.get" as const;
export const informationFlowWriteEndpointId = "slack.chat.postMessage" as const;
export const informationFlowRecipeId = "information_flow_commit_readback_v1" as const;
const definitionShape = Object.freeze({ v: "reelier.outcome-pack-definition/v1", alias: informationFlowCommitAlias, resolverId: informationFlowResolverId, projectionSchemaId: informationFlowProjectionSchemaId, policySchemaId: informationFlowPolicySchemaId, readEndpointIds: [informationFlowReadEndpointId], writeEndpointIds: [informationFlowWriteEndpointId], riskClasses: [informationFlowRiskClass], requiredGroundedPointers: ["/hubspotAccountId", "/ticketId", "/contactId", "/customerEmail", "/subject", "/status", "/priority"], maxFreshnessSeconds: 60 });
export const informationFlowPackDigest = authorityDigest({ v: "reelier.outcome-pack/v1", packId: "hubspot_slack_information_flow", definitions: [definitionShape] });
export const informationFlowDefinitionDigest = authorityDigest({ ...definitionShape, packDigest: informationFlowPackDigest });
export const informationFlowManifest = Object.freeze({ v: "reelier.outcome-pack-manifest/v1" as const, packId: "hubspot_slack_information_flow", packDigest: informationFlowPackDigest, definitions: [informationFlowCommitAlias] });
export type InformationFlowField = "ticketId" | "subject" | "status" | "priority";
export interface InformationFlowProjection extends Record<string, unknown> { readonly hubspotAccountId: string; readonly ticketId: string; readonly contactId: string; readonly customerEmail: string; readonly subject: string; readonly status: string; readonly priority: string; }
