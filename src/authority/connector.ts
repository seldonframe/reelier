import { authorityDigest } from "./wire.js";

const connectorRegistryBrand = Symbol("ConnectorRegistry");
export interface ConnectorRegistry { readonly [connectorRegistryBrand]: true }
export interface ConnectorRegistration {
  readonly tenant:string;readonly connectorId:string;readonly accountId:string;readonly providerAccountIdentity:string;
  readonly allowedReadEndpointIds:readonly string[];readonly allowedWriteEndpointIds:readonly string[];readonly riskClasses:readonly string[];
  readonly operatorConfigurationDigest:string;
}
const ID = /^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$/;
const SHA = /^sha256:[0-9a-f]{64}$/;
const ZERO_SHA = `sha256:${"0".repeat(64)}`;
const FIELDS = new Set(["tenant","connectorId","accountId","providerAccountIdentity","allowedReadEndpointIds","allowedWriteEndpointIds","riskClasses","operatorConfigurationDigest"]);
const registryStates = new WeakMap<object, ReadonlyMap<string,ConnectorRegistration>>();
const key = (tenant:string,connectorId:string,accountId:string) => `${tenant}\0${connectorId}\0${accountId}`;

export function createConnectorRegistry(registrations:readonly ConnectorRegistration[]):ConnectorRegistry {
  const indexed = new Map<string,ConnectorRegistration>();
  for (const input of registrations) {
    if (!input || typeof input !== "object" || Object.keys(input).some(field => !FIELDS.has(field)) || Object.keys(input).length !== FIELDS.size) throw new TypeError("connector registration must be a closed object");
    for (const field of ["tenant","connectorId","accountId","providerAccountIdentity"] as const) assertId(field,input[field]);
    if (!SHA.test(input.operatorConfigurationDigest) || input.operatorConfigurationDigest === ZERO_SHA) throw new TypeError("operator configuration digest must be non-zero lowercase sha256");
    const allowedReadEndpointIds = canonicalList("allowed read endpoints",input.allowedReadEndpointIds);
    const allowedWriteEndpointIds = canonicalList("allowed write endpoints",input.allowedWriteEndpointIds);
    const riskClasses = canonicalList("risk classes",input.riskClasses);
    const read = new Set(allowedReadEndpointIds);
    if (allowedWriteEndpointIds.some(endpoint => read.has(endpoint))) throw new TypeError("connector endpoint is ambiguous across read and write classes");
    const registration = Object.freeze({ tenant:input.tenant,connectorId:input.connectorId,accountId:input.accountId,providerAccountIdentity:input.providerAccountIdentity,allowedReadEndpointIds,allowedWriteEndpointIds,riskClasses,operatorConfigurationDigest:input.operatorConfigurationDigest });
    const registrationKey = key(input.tenant,input.connectorId,input.accountId);
    if (indexed.has(registrationKey)) throw new TypeError("duplicate tenant-qualified connector registration");
    indexed.set(registrationKey,registration);
  }
  const registry=Object.freeze(Object.create(null)) as ConnectorRegistry;registryStates.set(registry,indexed);return registry;
}

export function lookupConnectorRegistration(registry:ConnectorRegistry,tenant:string,connectorId:string,accountId:string):ConnectorRegistration|undefined {
  const states=requireStates(registry);const found=states.get(key(tenant,connectorId,accountId));return found ? detached(found) : undefined;
}

export function connectorRegistrationDigest(registry:ConnectorRegistry,tenant:string,connectorId:string,accountId:string):string {
  const registration=requireStates(registry).get(key(tenant,connectorId,accountId));if(!registration)throw new TypeError("missing connector registration");
  return authorityDigest({v:"reelier.connector-registration/internal-v1",...registration});
}
export function connectorRegistrationStatus(registry:ConnectorRegistry,tenant:string,connectorId:string,accountId:string):Readonly<{status:"found"|"connector-missing"|"account-missing";digest:string}> {
  const states=requireStates(registry),registration=states.get(key(tenant,connectorId,accountId));
  if(registration)return Object.freeze({status:"found" as const,digest:connectorRegistrationDigest(registry,tenant,connectorId,accountId)});
  const connectorExists=[...states.values()].some(value=>value.tenant===tenant&&value.connectorId===connectorId);
  const status=connectorExists?"account-missing" as const:"connector-missing" as const;
  return Object.freeze({status,digest:authorityDigest({v:"reelier.connector-registration-status/internal-v1",tenant,connectorId,accountId,status})});
}

function requireStates(registry:ConnectorRegistry){const state=registryStates.get(registry as object);if(!state)throw new TypeError("unrecognized connector registry");return state;}
function detached(value:ConnectorRegistration):ConnectorRegistration{return Object.freeze({...value,allowedReadEndpointIds:Object.freeze([...value.allowedReadEndpointIds]),allowedWriteEndpointIds:Object.freeze([...value.allowedWriteEndpointIds]),riskClasses:Object.freeze([...value.riskClasses])});}
function canonicalList(label:string,value:readonly string[]):readonly string[]{if(!Array.isArray(value)||value.length===0)throw new TypeError(`${label} must be nonempty`);for(const item of value)assertId(label,item);if(new Set(value).size!==value.length)throw new TypeError(`duplicate ${label}`);return Object.freeze([...value].sort(compareText));}
function assertId(label:string,value:string):void{if(typeof value!=="string"||!ID.test(value))throw new TypeError(`${label} must be a bounded identifier`);}
function compareText(left:string,right:string){return left<right?-1:left>right?1:0;}
