export const authorityKinds = ["principal","delegation-grant","source-bundle","outcome-contract","outcome-request","transport-effect","compiled-capability","gate-event","authority-receipt","pack-manifest"] as const;
export type AuthorityKind = (typeof authorityKinds)[number];
export type ClaimStatus = "verified" | "failed" | "unchecked" | "absent";
type Wire<V extends string> = Readonly<{ v: V }>;
export interface Principal extends Wire<"reelier.principal/v1"> { id: string; kind: "operator"|"requester"|"sponsor"|"gate"|"provider" }
export interface DelegationGrant extends Wire<"reelier.delegation-grant/v1"> { tenant:string; grantId:string; parentDigest:string; grantor:string; grantee:string; issuedAt:string; expiresAt:string; scope:string[] }
export interface OutcomeRequest extends Wire<"reelier.outcome-request/v1"> { requestId:string; sourceRefs:Record<string,string>; choices:Record<string,string|number|boolean|null> }
export interface SourceBundle extends Wire<"reelier.source-bundle/v1"> { tenant:string; sourceIdentity:string; triggerIdentity:string; observedAt:string; rawDigest:string; freshUntil:string; provenance:{resolverId:string;endpointId:string}; claims:{grounded:string[];authored:string[];unresolved:string[]}; projection:Record<string,unknown> }
export interface OutcomeContract extends Wire<"reelier.outcome-contract/v1"> { tenant:string;alias:string;contractId:string;validFrom:string;validUntil:string;packDigest:string;definitionDigest:string }
export interface TransportEffect extends Wire<"reelier.transport-effect/v1"> { endpointId:string;method:"POST"|"PUT"|"PATCH"|"DELETE";path:string;query:string;headers:Record<string,string>;bodyBase64:string;riskClass:string;idempotency:"native"|"reconcile-only";preconditions:{kind:string;digest:string}[];reconciliation:{recipeId:string} }
export interface CompiledCapability extends Wire<"reelier.compiled-capability/v1"> { capabilityId:string;requestKey:string;outcomeKey:string;effectDigest:string;issuedAt:string;expiresAt:string }
export interface GateEvent extends Wire<"reelier.gate-event/v1"> { eventId:string;at:string;verdict:"accepted"|"refused";reasonCode:string }
export interface AuthorityReceipt extends Wire<"reelier.authority-receipt/v1"> { receiptId:string;gateEventDigest:string;claims:{authorization:ClaimStatus;sourceCompleteness:ClaimStatus;dispatch:ClaimStatus;providerAcknowledgment:ClaimStatus;reconciliation:ClaimStatus;topology:ClaimStatus;completeness:ClaimStatus} }
export interface OutcomePackManifest extends Wire<"reelier.outcome-pack-manifest/v1"> { packId:string;packDigest:string;definitions:string[] }
export interface AuthorityWireByKind { principal:Principal;"delegation-grant":DelegationGrant;"source-bundle":SourceBundle;"outcome-contract":OutcomeContract;"outcome-request":OutcomeRequest;"transport-effect":TransportEffect;"compiled-capability":CompiledCapability;"gate-event":GateEvent;"authority-receipt":AuthorityReceipt;"pack-manifest":OutcomePackManifest }
export type AuthorityWire = AuthorityWireByKind[AuthorityKind];
export type AuthoritySignature = Readonly<{ alg:"ed25519";sig:string }>;
