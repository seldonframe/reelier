import { createHash } from "node:crypto";
import type { SourceBundle } from "./types.js";
import { authorityDigest, parseAuthorityWire } from "./wire.js";

export interface SourceReadPlan {
  readonly endpointId: string;
  readonly opaqueHandle: string;
}

export interface RegisteredSourceResolver {
  readonly tenant: string;
  readonly resolverId: string;
  readonly definitionDigest: string;
  readonly projectionSchemaId: string;
  readonly readEndpointIds: readonly string[];
  readonly plan: (sourceRefs: Readonly<Record<string, string>>) => readonly SourceReadPlan[];
}

export interface SourceRegistry {
  readonly resolvers: ReadonlyMap<string, RegisteredSourceResolver>;
}

export interface SourceValidationAuthority {
  readonly tenant: string;
  readonly definitionDigest: string;
  readonly resolverId: string;
  readonly projectionSchemaId: string;
  readonly allowedReadEndpointIds: readonly string[];
  readonly authorizedProjectionPointers: readonly string[];
  readonly requiredGroundedPointers: readonly string[];
}

const validatedSourceBrand = Symbol("ValidatedSourceBundle");

export interface ValidatedSourceBundle {
  readonly [validatedSourceBrand]: true;
  readonly bundle: SourceBundle;
  readonly digest: string;
}

const resolverKey = (tenant: string, resolverId: string) => `${tenant}\0${resolverId}`;
const OPAQUE_HANDLE = /^(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*[\\/])[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;

export function createSourceRegistry(resolvers: readonly RegisteredSourceResolver[]): SourceRegistry {
  const indexed = new Map<string, RegisteredSourceResolver>();
  for (const resolver of resolvers) {
    const key = resolverKey(resolver.tenant, resolver.resolverId);
    if (indexed.has(key)) throw new TypeError("duplicate tenant-qualified source resolver");
    indexed.set(key, Object.freeze({ ...resolver, readEndpointIds: Object.freeze([...resolver.readEndpointIds]) }));
  }
  return Object.freeze({ resolvers: indexed });
}

export function planSourceReads(registry: SourceRegistry, input: Readonly<{ tenant: string; resolverId: string; definitionDigest: string; sourceRefs: Readonly<Record<string, string>>; allowedReadEndpointIds: readonly string[] }>): readonly SourceReadPlan[] {
  for (const handle of Object.values(input.sourceRefs)) if (!OPAQUE_HANDLE.test(handle)) throw new TypeError("source reference must be an opaque handle");
  const resolver = registry.resolvers.get(resolverKey(input.tenant, input.resolverId));
  if (!resolver) throw new TypeError("unknown resolver for tenant");
  if (resolver.definitionDigest !== input.definitionDigest) throw new TypeError("source resolver definition mismatch");
  const registered = new Set(resolver.readEndpointIds);
  const authorized = new Set(input.allowedReadEndpointIds);
  const plans = resolver.plan(Object.freeze({ ...input.sourceRefs })).map(plan => Object.freeze({ ...plan }));
  for (const plan of plans) {
    if (!registered.has(plan.endpointId)) throw new TypeError("unknown source read endpoint");
    if (!authorized.has(plan.endpointId)) throw new TypeError("unauthorized source read endpoint");
    if (!OPAQUE_HANDLE.test(plan.opaqueHandle)) throw new TypeError("source plan must retain an opaque handle");
  }
  return Object.freeze(plans);
}

export function validateSourceBundle(registry: SourceRegistry, input: Readonly<{ bundle: unknown; rawResponse: Uint8Array; authority: SourceValidationAuthority; now: Date }>): ValidatedSourceBundle {
  const bundle = parseAuthorityWire("source-bundle", input.bundle);
  const authority = input.authority;
  if (bundle.tenant !== authority.tenant) throw new TypeError("source bundle tenant mismatch");
  if (bundle.definitionDigest !== authority.definitionDigest) throw new TypeError("source definition mismatch");
  if (bundle.projectionSchemaId !== authority.projectionSchemaId) throw new TypeError("source projection schema mismatch");
  if (bundle.provenance.resolverId !== authority.resolverId) throw new TypeError("source resolver provenance mismatch");
  const resolver = registry.resolvers.get(resolverKey(bundle.tenant, bundle.provenance.resolverId));
  if (!resolver) throw new TypeError("unknown resolver for tenant");
  if (resolver.definitionDigest !== bundle.definitionDigest || resolver.projectionSchemaId !== bundle.projectionSchemaId) throw new TypeError("registered resolver schema or definition mismatch");
  if (!resolver.readEndpointIds.includes(bundle.provenance.endpointId)) throw new TypeError("unknown source provenance endpoint");
  if (!authority.allowedReadEndpointIds.includes(bundle.provenance.endpointId)) throw new TypeError("unauthorized source provenance endpoint");
  const rawDigest = `sha256:${createHash("sha256").update(input.rawResponse).digest("hex")}`;
  if (bundle.rawDigest !== rawDigest) throw new TypeError("source raw digest mismatch");
  const now = input.now.getTime();
  const observed = Date.parse(bundle.observedAt);
  const freshUntil = Date.parse(bundle.freshUntil);
  if (observed > now || freshUntil < observed) throw new TypeError("source observed time is invalid");
  if (now >= freshUntil) throw new TypeError("source bundle is stale");
  const authorized = new Set(authority.authorizedProjectionPointers);
  const grounded = new Set(bundle.claims.grounded.map(claim => claim.projectionPointer));
  for (const claims of [bundle.claims.grounded, bundle.claims.authored, bundle.claims.unresolved]) for (const claim of claims) {
    if (!authorized.has(claim.projectionPointer)) throw new TypeError("source projection contains unauthorized pointer");
  }
  for (const pointer of projectionLeafPointers(bundle.projection)) if (!authorized.has(pointer)) throw new TypeError("source projection contains unauthorized extra field");
  for (const pointer of authority.requiredGroundedPointers) {
    if (!grounded.has(pointer) || !hasOwnJsonPointer(bundle.projection, pointer)) throw new TypeError("required source field is not grounded at an own path");
  }
  return Object.freeze({ [validatedSourceBrand]: true as const, bundle: deepFreeze(bundle), digest: authorityDigest(bundle) });
}

export function isValidatedSourceBundle(value: unknown): value is ValidatedSourceBundle {
  return Boolean(value && typeof value === "object" && (value as Partial<ValidatedSourceBundle>)[validatedSourceBrand] === true);
}

function decodePointerSegment(segment: string): string { return segment.replace(/~1/g, "/").replace(/~0/g, "~"); }
function encodePointerSegment(segment: string): string { return segment.replace(/~/g, "~0").replace(/\//g, "~1"); }

function hasOwnJsonPointer(root: Record<string, unknown>, pointer: string): boolean {
  let current: unknown = root;
  for (const encoded of pointer.slice(1).split("/")) {
    const segment = decodePointerSegment(encoded);
    if (typeof current !== "object" || current === null || !Object.prototype.hasOwnProperty.call(current, segment)) return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
}

function projectionLeafPointers(value: unknown, prefix = ""): string[] {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 0) return entries.flatMap(([key, child]) => projectionLeafPointers(child, `${prefix}/${encodePointerSegment(key)}`));
  }
  return [prefix];
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
