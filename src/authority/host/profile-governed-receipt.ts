import { createPublicKey } from "node:crypto";
import type { AuthorityReceipt, AuthorityReceiptBundle } from "../types.js";
import type { AuthorityDeploymentSnapshotV1, AuthorityRouteScopeV1, OutcomeProfileDraftV1, ProfileConformanceReportV1, ProfileVerificationRootsV1, SignedOutcomeProfileConformanceV1, SignedProfileAuthorityBindingV1, SignedTenantProfileActivationV1 } from "../outcome-profile.js";
import { parseAuthorityDeploymentSnapshot, parseAuthorityRouteScope, parseSignedProfileAuthorityBinding, verifyProfileGovernanceOffline } from "../outcome-profile.js";
import type { StaticPackRegistry } from "../pack.js";
import type { JobCardTrustPinV1 } from "./deployment.js";
import type { TrustEventV1 } from "../certification/authority.js";
import type { CertificationArtifactKeyBindingCommitmentV1, CertificationArtifactKeyBindingV1 } from "../certification/lifecycle-authority.js";
import { verifyCertificationArtifactKeyBinding } from "../certification/lifecycle-authority.js";
import type { SignedJobCardV1 } from "../job.js";
import { normalizeSignedJobCard, signedJobCardDigest, verifySignedJobCard } from "../job.js";
import type { RouteAuthoritySnapshotV1 } from "../ledger.js";
import { authorityDigest } from "../wire.js";
import { createAuthorityTrustViewAsOf, createCurrentAuthorityTrustView, currentAuthorityTrustViewState, createTrustRoots, trustRootSetDigest, type TrustRootEntry } from "../trust.js";
import { verifyAuthoritySignature } from "../crypto.js";
import { verifyAuthorityReceiptBundle, type VerifiedAuthorityReceiptBundle } from "../verify.js";
import { assertExactDataRecord } from "./profile-governance.js";
import { admittedProfileGovernanceState, assertAdmittedProfileGovernance, type AdmittedProfileGovernanceV1 } from "./profile-governance.js";
import { constructAuthorityReceiptBundle, validatedAuthorityReceiptSigningState, type AuthorityReceiptFoundationsV1, type ValidatedAuthorityReceiptSigningAuthorityV1 } from "./receipt-authority.js";
import type { DispatchOutcome, DispatchPublication, DispatchRequestState, DurableDispatchPublicationHeadV1, DurableDispatchPublicationIdentityV1, DurableDispatchPublicationQueryV1 } from "./dispatch.js";
import { lstat, mkdir, open, readdir, realpath, unlink, type FileHandle } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

export interface ProfileGovernedAuthorityReceiptV1{readonly v:"reelier.profile-governed-authority-receipt/v1";readonly profileDraft:OutcomeProfileDraftV1;readonly profileConformanceReport:ProfileConformanceReportV1;readonly profileConformance:SignedOutcomeProfileConformanceV1;readonly profileActivation:SignedTenantProfileActivationV1;readonly authorityReceiptBundle:AuthorityReceiptBundle;readonly authorityBindingEvidence:Readonly<{signedJobCard:SignedJobCardV1;artifactKeyBinding:CertificationArtifactKeyBindingV1;artifactKeyBindingCommitment:CertificationArtifactKeyBindingCommitmentV1;deploymentSnapshot:AuthorityDeploymentSnapshotV1;routeScope:AuthorityRouteScopeV1;routeAuthoritySnapshot:RouteAuthoritySnapshotV1;binding:SignedProfileAuthorityBindingV1}>;readonly edges:Readonly<{profileDigest:string;conformanceReportDigest:string;conformanceDigest:string;activationDigest:string;innerReceiptDigest:string;authorityBindingDigest:string}>}
export interface ProfileGovernedAuthorityReceiptVerificationOptionsV1{readonly profileTrustRoots:ProfileVerificationRootsV1;readonly profilePacks:StaticPackRegistry;readonly jobCardTrustPin:JobCardTrustPinV1;readonly currentAuthorityTrustEvents:readonly TrustEventV1[];readonly directAuthorityRoots:readonly TrustRootEntry[];readonly expectedTenant:string;readonly expectedAuthorityCellId:string;readonly expectedTaskId:string;readonly now:Date;readonly priorAuthorityReceipt?:AuthorityReceipt}

export function verifyProfileGovernedAuthorityReceipt(value:unknown,options:ProfileGovernedAuthorityReceiptVerificationOptionsV1):Readonly<{receipt:ProfileGovernedAuthorityReceiptV1;inner:VerifiedAuthorityReceiptBundle;digest:string;currentStatus:Readonly<{authority:"current"|"changed";profile:"current"|"changed"}>}>{
  // Preserve the old malformed-inner diagnostic without authorizing the obsolete envelope.
  if(value&&typeof value==="object"&&Object.hasOwn(value,"authorityReceiptBundle")&&!Object.hasOwn(value,"authorityBindingEvidence")){const legacy=options as any;verifyAuthorityReceiptBundle((value as any).authorityReceiptBundle,legacy.authority);}
  const optionKeys=["profileTrustRoots","profilePacks","jobCardTrustPin","currentAuthorityTrustEvents","directAuthorityRoots","expectedTenant","expectedAuthorityCellId","expectedTaskId","now",...(Object.hasOwn(options as object,"priorAuthorityReceipt")?["priorAuthorityReceipt"]:[])];assertExactDataRecord(options,optionKeys,"profile-governed verification options");
  assertExactDataRecord(value,["v","profileDraft","profileConformanceReport","profileConformance","profileActivation","authorityReceiptBundle","authorityBindingEvidence","edges"],"profile-governed authority receipt");const receipt=value as unknown as ProfileGovernedAuthorityReceiptV1;if(receipt.v!=="reelier.profile-governed-authority-receipt/v1")throw new TypeError("invalid profile-governed authority receipt version");
  assertExactDataRecord(receipt.authorityBindingEvidence,["signedJobCard","artifactKeyBinding","artifactKeyBindingCommitment","deploymentSnapshot","routeScope","routeAuthoritySnapshot","binding"],"profile-governed authority binding evidence");
  const binding=parseSignedProfileAuthorityBinding(receipt.authorityBindingEvidence.binding),deployment=parseAuthorityDeploymentSnapshot(receipt.authorityBindingEvidence.deploymentSnapshot),scope=parseAuthorityRouteScope(receipt.authorityBindingEvidence.routeScope),job=normalizeSignedJobCard(receipt.authorityBindingEvidence.signedJobCard);
  const governance=verifyProfileGovernanceOffline({tenant:options.expectedTenant,draft:receipt.profileDraft,report:receipt.profileConformanceReport,conformance:receipt.profileConformance,activation:receipt.profileActivation,trustRoots:options.profileTrustRoots,packs:options.profilePacks,now:new Date(binding.observedAt)});
  const trustView=createAuthorityTrustViewAsOf({tenant:options.expectedTenant,authorityCellId:options.expectedAuthorityCellId,taskId:options.expectedTaskId,observedAt:new Date(binding.observedAt),jobCardTrustPin:options.jobCardTrustPin}),asOf=currentAuthorityTrustViewState(trustView);
  if(authorityDigest(options.currentAuthorityTrustEvents)!==authorityDigest(options.jobCardTrustPin.currentTrustEvents))throw new TypeError("current Authority trust events differ from the external pin");
  if(!Array.isArray(options.directAuthorityRoots)||options.directAuthorityRoots.length!==5||Object.getPrototypeOf(options.directAuthorityRoots)!==Array.prototype)throw new TypeError("direct Authority roots must contain exactly five enumerable entries");
  const directPurposes=["outcome-contract","delegation-grant","gate-event","authority-evidence","authority-receipt"] as const,seen=new Set<string>();for(const candidate of options.directAuthorityRoots){assertExactDataRecord(candidate,["tenant","signerId","principalId","publicKey","purposes"],"direct Authority root");const root=candidate as unknown as TrustRootEntry;if(root.tenant!==options.expectedTenant||root.purposes.length!==1||!directPurposes.includes(root.purposes[0] as any)||seen.has(root.purposes[0]!)||root.publicKey.type!=="public"||root.publicKey.asymmetricKeyType!=="ed25519")throw new TypeError("direct Authority root tenant, purpose, or key is invalid");seen.add(root.purposes[0]!);const descriptor=options.jobCardTrustPin.keyDescriptors.find(item=>item.keyId===root.signerId&&item.purpose===root.purposes[0]&&item.publicKeySpkiBase64===spki(root.publicKey));if(!descriptor||!asOf.activeDescriptorDigests.has(authorityDigest(descriptor)))throw new TypeError("direct Authority root is not externally active as of signing");}
  const evidenceRoot=options.directAuthorityRoots.find(root=>root.purposes[0]==="authority-evidence")!,jobDescriptor=options.jobCardTrustPin.keyDescriptors.find(item=>item.keyId===job.signerId&&item.purpose==="signed-job-card");if(!jobDescriptor||!verifySignedJobCard(job,publicKey(jobDescriptor.publicKeySpkiBase64)))throw new TypeError("signed Job Card authority is invalid");
  if(binding.signerId!==evidenceRoot.signerId||!verifyAuthoritySignature(evidenceRoot.publicKey,"authority-evidence",authorityDigest({v:"reelier.profile-authority-binding-signature-preimage/v1",purpose:"profile-authority-binding",artifactDigest:authorityDigest(unsignedBinding(binding))}),binding.signature))throw new TypeError("profile Authority binding signature is invalid");
  if(authorityDigest(deployment)!==binding.deploymentDigest||trustRootSetDigest(createTrustRoots(options.directAuthorityRoots),options.expectedTenant)!==deployment.trustRootSetDigest)throw new TypeError("authenticated deployment direct trust-root set mismatch");
  const evidenceDescriptor=options.jobCardTrustPin.keyDescriptors.find(item=>item.keyId===evidenceRoot.signerId&&item.purpose==="authority-evidence"&&item.publicKeySpkiBase64===spki(evidenceRoot.publicKey))!;verifyCertificationArtifactKeyBinding(receipt.authorityBindingEvidence.artifactKeyBinding,receipt.authorityBindingEvidence.artifactKeyBindingCommitment,{descriptors:options.jobCardTrustPin.keyDescriptors,signedReadiness:options.jobCardTrustPin.signedReadiness,now:new Date(binding.observedAt),expectedParentEvidenceDescriptor:evidenceDescriptor,activeDescriptorDigests:asOf.activeDescriptorDigests});
  const artifactRoots=receipt.authorityBindingEvidence.artifactKeyBinding.entries.map(entry=>({tenant:options.expectedTenant,signerId:entry.keyId,principalId:options.expectedAuthorityCellId,publicKey:publicKey(entry.publicKeySpkiBase64),purposes:[entry.artifactPurpose]} as TrustRootEntry));
  const roots=createTrustRoots([...options.directAuthorityRoots,...artifactRoots]),inner=verifyAuthorityReceiptBundle(receipt.authorityReceiptBundle,{tenant:options.expectedTenant,trustRoots:roots,...(options.priorAuthorityReceipt?{priorReceipt:options.priorAuthorityReceipt}:{})});
  const snapshot=receipt.authorityBindingEvidence.routeAuthoritySnapshot,stable={v:"reelier.authority-route-scope/v1",tenant:options.expectedTenant,definitionAlias:job.definitionAliases[0],connectorRegistrationDigest:snapshot.connectorRegistrationDigest,operatorConfigurationDigest:snapshot.operatorConfigurationDigest,routeDigest:snapshot.routeDigest,providerId:snapshot.providerId,connectorId:snapshot.connectorId,accountId:snapshot.accountId,providerAccountIdentity:snapshot.providerAccountIdentity,endpointId:snapshot.endpointId,credentialSlotId:snapshot.credentialSlotId,sourceReadRouteDigest:snapshot.sourceReadRouteDigest,projectionSchemaDigest:snapshot.projectionSchemaDigest};if(authorityDigest(parseAuthorityRouteScope(stable))!==authorityDigest(scope))throw new TypeError("dynamic route snapshot does not project to stable scope");
  const bindingAt=Date.parse(binding.observedAt),activation=receipt.profileActivation,bindingDigest=authorityDigest(binding),bindingAuthorization=receipt.authorityBindingEvidence.artifactKeyBinding,bindingCommitment=receipt.authorityBindingEvidence.artifactKeyBindingCommitment;
  assertExactDataRecord(receipt.edges,["profileDigest","conformanceReportDigest","conformanceDigest","activationDigest","innerReceiptDigest","authorityBindingDigest"],"profile-governed receipt edges");if(bindingAt<Date.parse(activation.validFrom)||bindingAt>=Date.parse(activation.validUntil)||receipt.edges.profileDigest!==governance.profileDigest||receipt.edges.conformanceReportDigest!==governance.conformanceReportDigest||receipt.edges.conformanceDigest!==governance.conformanceDigest||receipt.edges.activationDigest!==governance.activationDigest||receipt.edges.innerReceiptDigest!==inner.digest||receipt.edges.authorityBindingDigest!==bindingDigest||binding.profileDigest!==governance.profileDigest||binding.activationDigest!==governance.activationDigest||binding.innerReceiptDigest!==inner.digest||binding.jobCardDigest!==signedJobCardDigest(job)||binding.artifactKeyBindingDigest!==authorityDigest(bindingAuthorization)||binding.artifactKeyBindingCommitmentDigest!==authorityDigest(bindingCommitment)||binding.contractDigest!==inner.bundle.contract.digest||binding.deploymentDigest!==authorityDigest(deployment)||binding.routeScopeDigest!==authorityDigest(scope)||binding.routeAuthoritySnapshotDigest!==authorityDigest(snapshot)||binding.authorityTrustHeadDigest!==asOf.trustHeadDigest||activation.jobCardDigest!==signedJobCardDigest(job)||activation.contractDigest!==inner.bundle.contract.digest||activation.deploymentDigest!==authorityDigest(deployment)||activation.routeScopeDigest!==authorityDigest(scope)||activation.authorityTrustHeadDigest!==asOf.trustHeadDigest)throw new TypeError("profile-governed authority receipt edge mismatch");
  const current=currentAuthorityTrustViewState(createCurrentAuthorityTrustView({tenant:options.expectedTenant,authorityCellId:options.expectedAuthorityCellId,taskId:options.expectedTaskId,observedAt:options.now,jobCardTrustPin:options.jobCardTrustPin}));let profileCurrent:"current"|"changed"="current";try{verifyProfileGovernanceOffline({tenant:options.expectedTenant,draft:receipt.profileDraft,report:receipt.profileConformanceReport,conformance:receipt.profileConformance,activation:receipt.profileActivation,trustRoots:options.profileTrustRoots,packs:options.profilePacks,now:options.now});}catch{profileCurrent="changed";}
  const directCurrentlyActive=options.directAuthorityRoots.every(root=>{const descriptor=options.jobCardTrustPin.keyDescriptors.find(item=>item.keyId===root.signerId&&item.purpose===root.purposes[0]&&item.publicKeySpkiBase64===spki(root.publicKey));return Boolean(descriptor&&current.activeDescriptorDigests.has(authorityDigest(descriptor)));}),parentCurrentlyActive=current.activeDescriptorDigests.has(bindingAuthorization.parentEvidenceDescriptorDigest),bindingCurrentlyValid=Date.parse(bindingAuthorization.issuedAt)<=options.now.getTime()&&options.now.getTime()<Date.parse(bindingAuthorization.expiresAt),authorityCurrent=current.trustHeadDigest===asOf.trustHeadDigest&&directCurrentlyActive&&parentCurrentlyActive&&bindingCurrentlyValid;
  return Object.freeze({receipt,inner,digest:authorityDigest(receipt),currentStatus:Object.freeze({authority:authorityCurrent?"current" as const:"changed" as const,profile:profileCurrent})});
}
function unsignedBinding(binding:SignedProfileAuthorityBindingV1){const{signature:_signature,...body}=binding;return body;}
function publicKey(base64:string){return createPublicKey({key:Buffer.from(base64,"base64"),format:"der",type:"spki"});}
function spki(key:import("node:crypto").KeyObject){return key.export({type:"spki",format:"der"}).toString("base64");}

type CurrentReceiptAuthority=Readonly<{signingAuthority:ValidatedAuthorityReceiptSigningAuthorityV1;jobCardTrustPin:JobCardTrustPinV1;observedAt:string}>;
interface GovernedReceiptPublicationInputV1{readonly rootDir:string;readonly governance:AdmittedProfileGovernanceV1;readonly signedJobCard:SignedJobCardV1;readonly deploymentSnapshot:AuthorityDeploymentSnapshotV1;readonly expectedRouteScopeDigest:string;readonly foundations:Omit<AuthorityReceiptFoundationsV1,"gateEvent">;readonly signingAuthority:ValidatedAuthorityReceiptSigningAuthorityV1;readonly currentAuthority?:(capabilityDigest:string)=>CurrentReceiptAuthority;readonly verification:Omit<ProfileGovernedAuthorityReceiptVerificationOptionsV1,"now"|"priorAuthorityReceipt">;readonly portablePublication?:DispatchPublication}
type StoredGovernedNode=Readonly<{v:"reelier.governed-receipt-store-node/v1";identity:DurableDispatchPublicationIdentityV1;phase:"reservation"|"dispatch"|"ambiguous"|"reconcile";terminalKind:null|"acknowledged"|"definitive-failure"|"ambiguous"|"reconciled";reservationReceiptRef:string;priorReceiptRef:string|null;receipt:ProfileGovernedAuthorityReceiptV1}>;
type GovernedStoreOpenEvent=Readonly<{phase:"parent-retained"|"before-child-open"|"child-opened"|"after-child-write"|"load-directory-observed";root:string;governedDirectory:string;reservationDirectory:string;file:string}>;
type GovernedStoreFilesystemBarrier=(event:GovernedStoreOpenEvent)=>Promise<void>;
let governedStoreFilesystemBarrier:GovernedStoreFilesystemBarrier|undefined;

/** Package-private deterministic race seam. Deliberately omitted from the public host barrel. */
export function __testSetGovernedReceiptFilesystemBarrier(barrier:GovernedStoreFilesystemBarrier):()=>void{
  if(typeof barrier!=="function")throw new TypeError("governed receipt filesystem barrier must be callable");
  const previous=governedStoreFilesystemBarrier;
  governedStoreFilesystemBarrier=barrier;
  return()=>{if(governedStoreFilesystemBarrier===barrier)governedStoreFilesystemBarrier=previous;};
}

/** Package-internal governed publication. All signer callbacks remain behind the validated handle. */
export function createProfileGovernedAuthorityReceiptPublication(input:GovernedReceiptPublicationInputV1):DispatchPublication{
  assertExactDataRecord(input,["rootDir","governance","signedJobCard","deploymentSnapshot","expectedRouteScopeDigest","foundations","signingAuthority",...(Object.hasOwn(input,"currentAuthority")?["currentAuthority"]:[]),"verification",...(Object.hasOwn(input,"portablePublication")?["portablePublication"]:[])],"governed receipt publication input");assertAdmittedProfileGovernance(input.governance);validatedAuthorityReceiptSigningState(input.signingAuthority);if(input.currentAuthority&&typeof input.currentAuthority!=="function")throw new TypeError("governed current Authority source is invalid");if(!path.isAbsolute(input.rootDir)||!/^sha256:(?!0{64}$)[0-9a-f]{64}$/.test(input.expectedRouteScopeDigest))throw new TypeError("governed receipt store root or route scope digest is invalid");
  const admitted=admittedProfileGovernanceState(input.governance),deployment=parseAuthorityDeploymentSnapshot(input.deploymentSnapshot),job=normalizeSignedJobCard(input.signedJobCard),reservationAuthorities=new Map<string,CurrentReceiptAuthority>();let physicalRoot:Readonly<{device:string;inode:string;canonical:string}>|undefined;
  const assertRoot=async()=>{const stat=await lstat(input.rootDir),canonical=await realpath(input.rootDir),next=Object.freeze({device:String(stat.dev),inode:String(stat.ino),canonical});if(!stat.isDirectory()||stat.isSymbolicLink()||canonical!==path.resolve(input.rootDir))throw new TypeError("governed receipt physical root is not canonical");if(physicalRoot&&(physicalRoot.device!==next.device||physicalRoot.inode!==next.inode||physicalRoot.canonical!==next.canonical))throw new TypeError("governed receipt physical root identity changed");physicalRoot??=next;};
  const load=async(identity:DurableDispatchPublicationIdentityV1):Promise<readonly StoredGovernedNode[]>=>{await assertRoot();return loadStoredChain(input,identity);};
  const publishNode=async(phase:StoredGovernedNode["phase"],identity:DurableDispatchPublicationIdentityV1,state:DispatchRequestState,outcome:DispatchOutcome,priorReceiptRef:string|null):Promise<Readonly<{receiptRef:string;evidenceDigest:string}>>=>{
    const existing=await load(identity),equal=existing.find(node=>node.phase===phase&&node.priorReceiptRef===priorReceiptRef&&node.receipt.authorityReceiptBundle.receipt.value.receiptId===semanticReceiptId(state,phase,outcome));if(equal)return Object.freeze({receiptRef:innerRef(equal.receipt),evidenceDigest:equal.receipt.authorityReceiptBundle.evidence.digest});const prior=priorReceiptRef===null?undefined:existing.find(node=>innerRef(node.receipt)===priorReceiptRef);if(priorReceiptRef!==null&&!prior)throw new TypeError("governed receipt prior is absent from verified store");
    const route=state.reservation.intent.routeAuthority,scope=route?projectScope(route,input.verification.expectedTenant,job.definitionAliases[0]!):undefined;if(!route||!scope||authorityDigest(scope)!==input.expectedRouteScopeDigest)throw new TypeError("persisted route authority does not project to admitted scope");
    const capabilityDigest=(state as any).capabilityDigest??(state.reservation.intent as any).capabilityDigest;if(!/^sha256:(?!0{64}$)[0-9a-f]{64}$/.test(capabilityDigest)||capabilityDigest!==identity.capabilityDigest)throw new TypeError("governed receipt capability provenance is invalid");let current=reservationAuthorities.get(identity.reservationId);if(phase==="reservation"){current=input.currentAuthority?.(capabilityDigest);if(!current)throw new TypeError("fresh reserve-time receipt authority is absent");reservationAuthorities.set(identity.reservationId,current);}else current??={signingAuthority:input.signingAuthority,jobCardTrustPin:input.verification.jobCardTrustPin,observedAt:new Date().toISOString()};const decision=(state as any).signedDecision,gateEvent=prior?.receipt.authorityReceiptBundle.gateEvent??(decision?Object.freeze({kind:"gate-event" as const,value:decision.gateEvent,digest:decision.gateEventDigest,signerId:decision.signerId,signature:decision.signature}):undefined);if(!gateEvent)throw new TypeError("governed receipt requires the exact signed gate event");const observedAt=current.observedAt,bundle=await constructAuthorityReceiptBundle({phase,state,outcome,observedAt,foundations:{...input.foundations,gateEvent},signingAuthority:current.signingAuthority,...(prior?{priorReceipt:prior.receipt.authorityReceiptBundle.receipt.value}:{}),...(prior?{recovered:prior.receipt.authorityReceiptBundle}:{})});
    const artifact=input.foundations,authorization=validatedAuthorityReceiptSigningState(current.signingAuthority).signingAuthority.artifactAuthorization,roots=createTrustRoots([...input.verification.directAuthorityRoots,...authorization.binding.entries.map(entry=>({tenant:input.verification.expectedTenant,signerId:entry.keyId,principalId:input.verification.expectedAuthorityCellId,publicKey:publicKey(entry.publicKeySpkiBase64),purposes:[entry.artifactPurpose]} as TrustRootEntry))]);void artifact;const verifiedInner=verifyAuthorityReceiptBundle(bundle,{tenant:input.verification.expectedTenant,trustRoots:roots,...(prior?{priorReceipt:prior.receipt.authorityReceiptBundle.receipt.value}:{})});
    const unsigned={v:"reelier.profile-authority-binding/v1" as const,purpose:"profile-authority-binding" as const,tenant:input.verification.expectedTenant,profileDigest:admitted.manifest.profileDigest,activationDigest:admitted.manifest.activationDigest,innerReceiptDigest:verifiedInner.digest,jobCardDigest:signedJobCardDigest(job),artifactKeyBindingDigest:authorityDigest(authorization.binding),artifactKeyBindingCommitmentDigest:authorityDigest(authorization.commitment),contractDigest:verifiedInner.bundle.contract.digest,deploymentDigest:authorityDigest(deployment),routeScopeDigest:authorityDigest(scope),routeAuthoritySnapshotDigest:authorityDigest(route),authorityTrustHeadDigest:admitted.activation.authorityTrustHeadDigest,observedAt,signerId:validatedAuthorityReceiptSigningState(current.signingAuthority).signingAuthority.evidence.signerId};
    const evidenceSigner=validatedAuthorityReceiptSigningState(current.signingAuthority).signingAuthority.evidence,signature=await evidenceSigner.sign({purpose:"authority-evidence",digest:authorityDigest({v:"reelier.profile-authority-binding-signature-preimage/v1",purpose:"profile-authority-binding",artifactDigest:authorityDigest(unsigned)})}),binding=parseSignedProfileAuthorityBinding({...unsigned,signature});
    const receipt:ProfileGovernedAuthorityReceiptV1=Object.freeze({v:"reelier.profile-governed-authority-receipt/v1",profileDraft:admitted.draft,profileConformanceReport:admitted.report,profileConformance:admitted.conformance,profileActivation:admitted.activation,authorityReceiptBundle:bundle,authorityBindingEvidence:Object.freeze({signedJobCard:job,artifactKeyBinding:authorization.binding,artifactKeyBindingCommitment:authorization.commitment,deploymentSnapshot:deployment,routeScope:scope,routeAuthoritySnapshot:route,binding}),edges:Object.freeze({profileDigest:admitted.manifest.profileDigest,conformanceReportDigest:admitted.manifest.conformanceReportDigest,conformanceDigest:admitted.manifest.conformanceDigest,activationDigest:admitted.manifest.activationDigest,innerReceiptDigest:verifiedInner.digest,authorityBindingDigest:authorityDigest(binding)})});
    verifyProfileGovernedAuthorityReceipt(receipt,{...input.verification,jobCardTrustPin:current.jobCardTrustPin,currentAuthorityTrustEvents:current.jobCardTrustPin.currentTrustEvents,now:new Date(observedAt),...(prior?{priorAuthorityReceipt:prior.receipt.authorityReceiptBundle.receipt.value}:{})});
    const receiptRef=authorityDigest(bundle.receipt.value),terminalKind=phase==="reservation"?null:phase==="ambiguous"?"ambiguous":phase==="reconcile"?"reconciled":outcome.kind==="acknowledged"?"acknowledged":"definitive-failure",node:StoredGovernedNode=Object.freeze({v:"reelier.governed-receipt-store-node/v1",identity,phase,terminalKind,reservationReceiptRef:phase==="reservation"?receiptRef:existing[0]!.reservationReceiptRef,priorReceiptRef,receipt});
    await assertRoot();const adopted=await storeNode(input.rootDir,node,existing);if(adopted){const chain=await load(identity),same=chain.find(item=>item.phase===phase&&item.priorReceiptRef===priorReceiptRef&&item.receipt.authorityReceiptBundle.receipt.value.receiptId===semanticReceiptId(state,phase,outcome));if(!same)throw new TypeError("governed receipt semantic CAS adoption failed");return Object.freeze({receiptRef:innerRef(same.receipt),evidenceDigest:same.receipt.authorityReceiptBundle.evidence.digest});}if(input.portablePublication)await input.portablePublication.publish({phase:phase==="reservation"?"ambiguous":phase,state,outcome,dispatchedRequestDigest:phase==="reservation"?null:outcome.materializedRequestDigest??identity.expectedDispatchedRequestDigest,priorReceiptDigest:priorReceiptRef});return Object.freeze({receiptRef,evidenceDigest:bundle.evidence.digest});
  };
  return Object.freeze({
    async publish(value:Parameters<DispatchPublication["publish"]>[0]){const identity=(await findIdentity(input.rootDir,physicalReservationId(value.state.reservation.reservationId)));return serializePublication(`${input.rootDir}\0${identity.reservationId}`,()=>publishNode(value.phase==="cancelled"?"dispatch":value.phase,identity,value.state,value.outcome,value.priorReceiptDigest??null));},
    async publishReservation(value:Parameters<NonNullable<DispatchPublication["publishReservation"]>>[0]){assertDurableIdentity(value.identity,input.verification.expectedTenant);return serializePublication(`${input.rootDir}\0${value.identity.reservationId}`,()=>publishNode("reservation",value.identity,value.state,value.outcome,null));},
    async loadDurableHead(query:DurableDispatchPublicationQueryV1,expect:"terminal"|"root-or-terminal"="terminal"){assertExactDataRecord(query,["v","identity","ledgerState","sendStarted"],"durable governed receipt query");if(query.v!=="reelier.durable-dispatch-publication-query/v1"||!(["dispatched","ambiguous"] as const).includes(query.ledgerState)||query.sendStarted!==true)throw new TypeError("durable governed receipt query is invalid");if(expect!=="terminal"&&expect!=="root-or-terminal")throw new TypeError("durable publication head expectation is invalid");assertDurableIdentity(query.identity,input.verification.expectedTenant);const chain=await load(query.identity);if(chain.length===0)return null;const head=chain.at(-1)!;if(expect==="terminal"&&head.phase==="reservation")throw new TypeError("durable publication terminal receipt is absent for a send-started reservation");return Object.freeze({v:"reelier.durable-dispatch-publication-head/v1",identity:head.identity,receiptRef:innerRef(head.receipt),evidenceDigest:head.receipt.authorityReceiptBundle.evidence.digest,reservationReceiptRef:head.reservationReceiptRef,priorReceiptRef:head.priorReceiptRef,phase:head.phase,terminalKind:head.terminalKind}) as DurableDispatchPublicationHeadV1;},
  });
}

function projectScope(route:RouteAuthoritySnapshotV1,tenant:string,definitionAlias:string):AuthorityRouteScopeV1{return parseAuthorityRouteScope({v:"reelier.authority-route-scope/v1",tenant,definitionAlias,connectorRegistrationDigest:route.connectorRegistrationDigest,operatorConfigurationDigest:route.operatorConfigurationDigest,routeDigest:route.routeDigest,providerId:route.providerId,connectorId:route.connectorId,accountId:route.accountId,providerAccountIdentity:route.providerAccountIdentity,endpointId:route.endpointId,credentialSlotId:route.credentialSlotId,sourceReadRouteDigest:route.sourceReadRouteDigest,projectionSchemaDigest:route.projectionSchemaDigest});}
function innerRef(receipt:ProfileGovernedAuthorityReceiptV1):string{return authorityDigest(receipt.authorityReceiptBundle.receipt.value);}
async function storeNode(root:string,node:StoredGovernedNode,existing:readonly StoredGovernedNode[]):Promise<boolean>{
  if(node.phase==="reservation"&&existing.length!==0){
    if(authorityDigest(existing[0])===authorityDigest(node))return true;
    throw new TypeError("governed reservation root already exists");
  }
  if(node.phase!=="reservation"&&existing.some(item=>item.priorReceiptRef===node.priorReceiptRef)){
    const same=existing.find(item=>item.priorReceiptRef===node.priorReceiptRef)!;
    if(authorityDigest(same)===authorityDigest(node))return true;
    throw new TypeError("governed receipt semantic CAS conflict");
  }
  const governed=path.join(root,"governed"),directory=path.join(governed,node.identity.reservationId);
  await mkdir(governed).catch(error=>{if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;});
  await assertConfinedStoreDirectory(root,governed);
  await mkdir(directory).catch(error=>{if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;});
  await assertConfinedStoreDirectory(root,directory);
  const anchors=await captureStoreAnchors(root,governed,directory);
  const slot=node.phase==="reservation"?"root.json":`${node.priorReceiptRef!.slice(7)}.successor.json`;
  const file=path.join(directory,slot),bytes=Buffer.from(`${JSON.stringify(node)}\n`);
  try{return await createAnchoredNode(anchors,file,slot,bytes,node);}
  finally{await closeStoreAnchors(anchors);}
}
async function findIdentity(root:string,reservationId:string):Promise<DurableDispatchPublicationIdentityV1>{
  assertCanonicalStoreId(reservationId,"reservation");
  const governed=path.join(root,"governed"),directory=path.join(governed,reservationId);
  await assertConfinedStoreDirectory(root,directory);
  const anchors=await captureStoreAnchors(root,governed,directory);
  try{
    const directoryPath=await anchoredDirectoryPath(anchors),names=await readdir(directoryPath);
    if(names.length===0)throw new TypeError("governed reservation root is absent");
    const raw=await readConfinedNode(path.join(directoryPath,names.sort()[0]!),path.join(directory,names.sort()[0]!));
    return raw.identity;
  }finally{await closeStoreAnchors(anchors);}
}

async function loadStoredChain(input:GovernedReceiptPublicationInputV1,identity:DurableDispatchPublicationIdentityV1):Promise<readonly StoredGovernedNode[]>{
  const governed=path.join(input.rootDir,"governed"),directory=path.join(governed,identity.reservationId);
  const anchors=await captureLoadStoreAnchors(input.rootDir,governed,directory,identity.reservationId);
  if(!anchors)return Object.freeze([]);
  try{
    await assertConfinedStoreDirectory(input.rootDir,directory);
    await governedStoreFilesystemBarrier?.(Object.freeze({phase:"load-directory-observed",root:anchors.root.path,governedDirectory:anchors.governed.path,reservationDirectory:anchors.reservation.path,file:directory}));
    for(const anchor of [anchors.root,anchors.governed,anchors.reservation])await assertDirectoryAnchor(anchor);
    const directoryPath=await anchoredDirectoryPath(anchors),names=(await readdir(directoryPath)).filter(name=>name.endsWith(".json"));
    if(names.length===0)return Object.freeze([]);
    const nodes:StoredGovernedNode[]=[];
    for(const name of names){
      const raw=await readConfinedNode(path.join(directoryPath,name),path.join(directory,name));
      assertExactDataRecord(raw,["v","identity","phase","terminalKind","reservationReceiptRef","priorReceiptRef","receipt"],"stored governed receipt node");
      if(raw.v!=="reelier.governed-receipt-store-node/v1"||authorityDigest(raw.identity)!==authorityDigest(identity))throw new TypeError("stored governed receipt identity mismatch");
      nodes.push(raw);
    }
    const roots=nodes.filter(node=>node.phase==="reservation"&&node.priorReceiptRef===null);
    if(roots.length!==1)throw new TypeError("governed receipt store has no unique root");
    const ordered=[roots[0]!];
    while(ordered.length<nodes.length){
      const prior=innerRef(ordered.at(-1)!.receipt),next=nodes.filter(node=>node.priorReceiptRef===prior);
      if(next.length!==1)throw new TypeError("governed receipt store is forked or incomplete");
      ordered.push(next[0]!);
    }
    let prior:AuthorityReceipt|undefined;
    for(const node of ordered){
      verifyProfileGovernedAuthorityReceipt(node.receipt,{...input.verification,now:new Date(),...(prior?{priorAuthorityReceipt:prior}:{})});
      if(node.reservationReceiptRef!==innerRef(ordered[0]!.receipt))throw new TypeError("governed receipt root identity mismatch");
      prior=node.receipt.authorityReceiptBundle.receipt.value;
    }
    return Object.freeze(ordered);
  }catch(error){
    if((error as NodeJS.ErrnoException).code==="ENOENT")throw new TypeError("governed receipt observed store became unreadable",{cause:error});
    throw error;
  }finally{await closeStoreAnchors(anchors);}
}

async function readConfinedNode(file:string,canonicalFile:string=path.resolve(file)):Promise<StoredGovernedNode>{
  const flags=constants.O_RDONLY|(typeof constants.O_NOFOLLOW==="number"?constants.O_NOFOLLOW:0),handle=await open(file,flags);
  try{
    const before=await handle.stat();
    if(!before.isFile())throw new TypeError("governed receipt node is not a regular file");
    const bytes=await handle.readFile(),after=await handle.stat(),pathStat=await lstat(file);
    if(pathStat.isSymbolicLink()||!pathStat.isFile()||before.dev!==after.dev||before.ino!==after.ino||before.dev!==pathStat.dev||before.ino!==pathStat.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||await realpath(file)!==canonicalFile)throw new TypeError("governed receipt node identity changed during read");
    return JSON.parse(bytes.toString("utf8")) as StoredGovernedNode;
  }finally{await handle.close();}
}
async function assertConfinedStoreDirectory(root:string,directory:string):Promise<void>{const resolvedRoot=path.resolve(root);if(await realpath(resolvedRoot)!==resolvedRoot)throw new TypeError("governed receipt physical root is not canonical");let current=resolvedRoot;for(const part of path.relative(resolvedRoot,directory).split(path.sep)){current=path.join(current,part);const stat=await lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink()||await realpath(current)!==current)throw new TypeError("governed receipt directory link or junction escape is prohibited");}}
type DirectoryAnchor={readonly path:string;readonly dev:number;readonly ino:number;readonly canonical:string;readonly handle?:FileHandle};
type StoreAnchors=Readonly<{root:DirectoryAnchor;governed:DirectoryAnchor;reservation:DirectoryAnchor}>;

async function captureDirectoryAnchor(directory:string):Promise<DirectoryAnchor>{
  const resolved=path.resolve(directory),stat=await lstat(resolved),canonical=await realpath(resolved);
  if(!stat.isDirectory()||stat.isSymbolicLink()||canonical!==resolved)throw new TypeError("governed receipt directory is not physically canonical");
  let handle:FileHandle|undefined;
  if(process.platform==="linux"){
    const flags=constants.O_RDONLY|constants.O_DIRECTORY|(typeof constants.O_NOFOLLOW==="number"?constants.O_NOFOLLOW:0);
    handle=await open(resolved,flags);
    try{
      const opened=await handle.stat();
      if(!opened.isDirectory()||opened.dev!==stat.dev||opened.ino!==stat.ino)throw new TypeError("governed receipt directory changed before retention");
    }catch(error){await handle.close().catch(()=>undefined);throw error;}
  }
  return{path:resolved,dev:stat.dev,ino:stat.ino,canonical,...(handle?{handle}:{})};
}

async function captureLoadStoreAnchors(root:string,governed:string,reservation:string,reservationId:string):Promise<StoreAnchors|null>{
  const captured:DirectoryAnchor[]=[];
  let transferred=false;
  try{
    const rootAnchor=await captureDirectoryAnchor(root);
    captured.push(rootAnchor);
    if(!await retainedDirectoryContains(rootAnchor,path.basename(governed)))return null;
    const governedAnchor=await captureObservedDirectoryAnchor(governed);
    captured.push(governedAnchor);
    await assertDirectoryAnchor(rootAnchor);
    if(!await retainedDirectoryContains(governedAnchor,reservationId))return null;
    const reservationAnchor=await captureObservedDirectoryAnchor(reservation);
    captured.push(reservationAnchor);
    await assertDirectoryAnchor(rootAnchor);
    await assertDirectoryAnchor(governedAnchor);
    transferred=true;
    return Object.freeze({root:rootAnchor,governed:governedAnchor,reservation:reservationAnchor});
  }finally{
    if(!transferred)await Promise.all(captured.map(anchor=>anchor.handle?.close().catch(()=>undefined)));
  }
}

async function captureObservedDirectoryAnchor(directory:string):Promise<DirectoryAnchor>{
  try{return await captureDirectoryAnchor(directory);}
  catch(error){
    if((error as NodeJS.ErrnoException).code==="ENOENT")throw new TypeError("governed receipt observed store became unreadable",{cause:error});
    throw error;
  }
}

async function retainedDirectoryContains(parent:DirectoryAnchor,child:string):Promise<boolean>{
  const retained=parent.handle?`/proc/self/fd/${parent.handle.fd}`:parent.path;
  const contains=(await readdir(retained)).includes(child);
  await assertDirectoryAnchor(parent);
  return contains;
}

async function captureStoreAnchors(root:string,governed:string,reservation:string):Promise<StoreAnchors>{
  const captured:DirectoryAnchor[]=[];
  try{
    for(const directory of [root,governed,reservation])captured.push(await captureDirectoryAnchor(directory));
    return Object.freeze({root:captured[0]!,governed:captured[1]!,reservation:captured[2]!});
  }catch(error){await Promise.all(captured.map(anchor=>anchor.handle?.close().catch(()=>undefined)));throw error;}
}

async function closeStoreAnchors(anchors:StoreAnchors):Promise<void>{
  await Promise.all([anchors.reservation.handle,anchors.governed.handle,anchors.root.handle].filter((handle):handle is FileHandle=>Boolean(handle)).map(handle=>handle.close()));
}

async function assertDirectoryAnchor(anchor:DirectoryAnchor):Promise<void>{
  const stat=await lstat(anchor.path),canonical=await realpath(anchor.path);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.dev!==anchor.dev||stat.ino!==anchor.ino||canonical!==anchor.canonical)throw new TypeError("governed receipt directory identity changed during publication");
  if(anchor.handle){const opened=await anchor.handle.stat();if(!opened.isDirectory()||opened.dev!==anchor.dev||opened.ino!==anchor.ino)throw new TypeError("governed receipt retained directory identity changed");}
}

async function createAnchoredNode(anchors:StoreAnchors,canonicalFile:string,slot:string,bytes:Buffer,node:StoredGovernedNode):Promise<boolean>{
  const event=(phase:GovernedStoreOpenEvent["phase"]):GovernedStoreOpenEvent=>Object.freeze({phase,root:anchors.root.path,governedDirectory:anchors.governed.path,reservationDirectory:anchors.reservation.path,file:canonicalFile});
  await governedStoreFilesystemBarrier?.(event("parent-retained"));
  await governedStoreFilesystemBarrier?.(event("before-child-open"));
  const fallback=process.platform!=="linux"&&Boolean(governedStoreFilesystemBarrier);
  const anchoredDirectory=await anchoredDirectoryPath(anchors),file=path.join(anchoredDirectory,slot);
  const flags=constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(typeof constants.O_NOFOLLOW==="number"?constants.O_NOFOLLOW:0);
  let created:Readonly<{dev:number;ino:number}>|undefined,handle:FileHandle|undefined;
  try{
    handle=await open(file,flags,0o600);
    const before=await handle.stat();
    created=Object.freeze({dev:before.dev,ino:before.ino});
    if(fallback){
      await handle.writeFile(bytes);await handle.sync();await handle.close();handle=undefined;
      await governedStoreFilesystemBarrier!(event("child-opened"));
    }else{
      await governedStoreFilesystemBarrier?.(event("child-opened"));
      await handle.writeFile(bytes);await handle.sync();
    }
    const after=handle?await handle.stat():await lstat(await currentNodePath(anchors,slot));
    if(!after.isFile()||after.dev!==before.dev||after.ino!==before.ino||after.size!==bytes.length)throw new TypeError("governed receipt node identity changed during write");
    await handle?.close();handle=undefined;
    await governedStoreFilesystemBarrier?.(event("after-child-write"));
    for(const anchor of [anchors.root,anchors.governed,anchors.reservation])await assertDirectoryAnchor(anchor);
    const currentFile=await currentNodePath(anchors,slot),pathStat=await lstat(currentFile);
    if(pathStat.isSymbolicLink()||!pathStat.isFile()||pathStat.dev!==before.dev||pathStat.ino!==before.ino||await realpath(currentFile)!==canonicalFile)throw new TypeError("governed receipt node escaped its anchored directory");
    const raw=await readConfinedNode(currentFile,canonicalFile);
    if(authorityDigest(raw)!==authorityDigest(node))throw new TypeError("governed receipt bytes changed after write");
    return false;
  }catch(error){
    await handle?.close().catch(()=>undefined);
    if((error as NodeJS.ErrnoException).code==="EEXIST"&&!created){
      for(const anchor of [anchors.root,anchors.governed,anchors.reservation])await assertDirectoryAnchor(anchor);
      const raw=await readConfinedNode(await currentNodePath(anchors,slot),canonicalFile);
      if(authorityDigest(raw)!==authorityDigest(node))throw new TypeError("governed receipt semantic CAS conflict");
      return true;
    }
    if(created){
      try{
        const currentFile=await currentNodePath(anchors,slot),current=await lstat(currentFile);
        if(!current.isSymbolicLink()&&current.isFile()&&current.dev===created.dev&&current.ino===created.ino)await unlink(currentFile);
      }catch{/* The anchored slot no longer names the artifact opened by this publication. */}
    }
    throw error;
  }
}

async function anchoredDirectoryPath(anchors:StoreAnchors):Promise<string>{
  if(anchors.reservation.handle)return`/proc/self/fd/${anchors.reservation.handle.fd}`;
  if(!governedStoreFilesystemBarrier)return anchors.reservation.path;
  const root=await locateDirectoryAnchor(anchors.root,path.dirname(anchors.root.path));
  const governed=await locateDirectoryAnchor(anchors.governed,root);
  return locateDirectoryAnchor(anchors.reservation,governed);
}

async function currentNodePath(anchors:StoreAnchors,slot:string):Promise<string>{return path.join(await anchoredDirectoryPath(anchors),slot);}

async function locateDirectoryAnchor(anchor:DirectoryAnchor,parent:string):Promise<string>{
  for(const name of await readdir(parent)){
    const candidate=path.join(parent,name);
    try{const stat=await lstat(candidate);if(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.dev===anchor.dev&&stat.ino===anchor.ino)return candidate;}
    catch{/* A deterministic test mutation may move the candidate between listing and stat. */}
  }
  throw new TypeError("governed receipt retained directory is unavailable");
}
function assertCanonicalStoreId(value:unknown,label:string):asserts value is string{if(typeof value!=="string"||!/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(value)||value==="."||value===".."||/%(?:2e|2f|5c)/iu.test(value))throw new TypeError(`durable publication ${label} identity is not canonical`);}
function physicalReservationId(value:string):string{return /^sha256:[0-9a-f]{64}$/.test(value)?`reservation_${value.slice(7)}`:value;}
function assertDurableIdentity(value:DurableDispatchPublicationIdentityV1,expectedTenant?:string):void{assertExactDataRecord(value,["v","reservationId","tenant","requestDigest","capabilityDigest","effectDigest","routeAuthorityDigest","expectedDispatchedRequestDigest","reservationIntentDigest"],"durable publication identity");assertCanonicalStoreId(value.reservationId,"reservation");assertCanonicalStoreId(value.tenant,"tenant");if(value.v!=="reelier.durable-dispatch-publication-identity/v1"||expectedTenant!==undefined&&value.tenant!==expectedTenant||[value.requestDigest,value.capabilityDigest,value.effectDigest,value.routeAuthorityDigest,value.expectedDispatchedRequestDigest,value.reservationIntentDigest].some(item=>!/^sha256:(?!0{64}$)[0-9a-f]{64}$/.test(item)))throw new TypeError("durable publication identity is invalid");}
function semanticReceiptId(state:DispatchRequestState,phase:StoredGovernedNode["phase"],outcome:DispatchOutcome):string{const result=phase==="reservation"?authorityDigest({reservationId:state.reservation.reservationId,phase:"reservation"}):outcome.resultDigest;return `receipt_${authorityDigest({reservationId:state.reservation.reservationId,phase,result}).slice(7,31)}`;}
const publicationLocks=new Map<string,Promise<void>>();async function serializePublication<T>(key:string,operation:()=>Promise<T>):Promise<T>{const prior=publicationLocks.get(key)??Promise.resolve();let release!:()=>void;const tail=new Promise<void>(resolve=>{release=resolve;}),queued=prior.catch(()=>undefined).then(()=>tail);publicationLocks.set(key,queued);await prior.catch(()=>undefined);try{return await operation();}finally{release();if(publicationLocks.get(key)===queued)publicationLocks.delete(key);}}
