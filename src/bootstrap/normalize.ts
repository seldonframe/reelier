import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { ValidateFunction } from "ajv";
import type { AuthorityCellSessionBindingV1, AuthorityCellSessionBindingVerificationV1, BootstrapReportV1, SupervisorStatusV1 } from "./types.js";

type BootstrapSchemaName = "agent-project" | "bootstrap-report" | "supervisor-status" | "authority-cell-session-binding" | "route-coverage" | "runtime-descriptor";
const validators = new Map<BootstrapSchemaName, ValidateFunction>();
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const schemaDirectories = [join(moduleDirectory, "../../contract/bootstrap/v1"), join(moduleDirectory, "../../../contract/bootstrap/v1")];
const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/2020").default as new (options: object) => { compile(schema: object): ValidateFunction; errorsText(errors: unknown, options: { separator: string }): string };
const ajv = new Ajv({ allErrors: true, strict: true });
const intrinsicDateParse = Date.parse;
const intrinsicDateToISOString = Date.prototype.toISOString;

export function parseBootstrapReportV1(value: unknown): BootstrapReportV1 {
  const parsed = parseBootstrapSchema<BootstrapReportV1>("bootstrap-report", value);
  parseCanonicalTime(parsed.initializedAt, "bootstrap initialization time");
  return parsed;
}

export function parseSupervisorStatusV1(value: unknown): SupervisorStatusV1 {
  const parsed = parseBootstrapSchema<SupervisorStatusV1>("supervisor-status", value);
  parseCanonicalTime(parsed.observedAt, "supervisor observation time");
  for (const count of [parsed.partialRoutes, parsed.uncoveredRoutes, parsed.unknownRoutes]) {
    if (count > parsed.observedRoutes) throw new TypeError("supervisor route counts exceed observed routes");
  }
  if (parsed.outcomesEnforced > parsed.outcomesActivated) throw new TypeError("supervisor enforced outcomes exceed activated outcomes");
  return parsed;
}

export function parseAuthorityCellSessionBindingV1(value: unknown): AuthorityCellSessionBindingV1 {
  const parsed = parseBootstrapSchema<AuthorityCellSessionBindingV1>("authority-cell-session-binding", value);
  const observed = parseCanonicalTime(parsed.bindingObservedAt, "binding observation time");
  const freshUntil = parseCanonicalTime(parsed.bindingFreshUntil, "binding freshness time");
  const expires = parseCanonicalTime(parsed.expiresAt, "binding expiry time");
  if (observed >= freshUntil || freshUntil > expires) throw new TypeError("authority Cell binding lifetime is invalid");
  if ((parsed.topologyEvidenceDigest === null) !== (parsed.topologyFreshUntil === null)) throw new TypeError("authority Cell topology evidence pair is incomplete");
  if (parsed.topologyFreshUntil !== null && parseCanonicalTime(parsed.topologyFreshUntil, "topology freshness time") > expires) throw new TypeError("topology evidence exceeds binding lifetime");
  return parsed;
}

export function verifyAuthorityCellSessionBindingV1(value: unknown, expected: AuthorityCellSessionBindingVerificationV1): AuthorityCellSessionBindingV1 {
  assertOwnDataTree(expected, "authority Cell binding verification input");
  assertExactKeys(expected, ["observationTime", "cellId", "adapterContractDigest", "authorityContractDigest", "tenant", "principalId", "taskId", "runtimeSessionId", "jobId", "jobCardDigest", "grantId", "grantDigest", "allocationId", "profileDigest", "activationDigest", "profileTrustHeadDigest", "principalSession"], "authority Cell binding verification input");
  assertExactKeys(expected.principalSession, ["tenant", "principalId", "grantId", "expiresAt"], "principal session binding");
  const binding = parseAuthorityCellSessionBindingV1(value);
  const fields = ["cellId", "adapterContractDigest", "authorityContractDigest", "tenant", "principalId", "taskId", "runtimeSessionId", "jobId", "jobCardDigest", "grantId", "grantDigest", "allocationId", "profileDigest", "activationDigest", "profileTrustHeadDigest"] as const;
  for (const field of fields) if (binding[field] !== expected[field]) throw new TypeError(`authority Cell binding ${field} mismatch`);
  if (binding.tenant !== expected.principalSession.tenant || binding.principalId !== expected.principalSession.principalId || binding.grantId !== expected.principalSession.grantId || binding.expiresAt !== expected.principalSession.expiresAt) throw new TypeError("authority Cell binding principal session mismatch");
  const observation = parseCanonicalTime(expected.observationTime, "external binding observation time");
  const observed = parseCanonicalTime(binding.bindingObservedAt, "binding observation time");
  const freshUntil = parseCanonicalTime(binding.bindingFreshUntil, "binding freshness time");
  const expires = parseCanonicalTime(binding.expiresAt, "binding expiry time");
  if (observation < observed || observation >= freshUntil || observation >= expires) throw new TypeError("authority Cell binding is not current at the external observation time");
  return binding;
}

export function parseBootstrapSchema<T>(name: BootstrapSchemaName, value: unknown): T {
  assertOwnDataTree(value, name);
  let validate = validators.get(name);
  if (!validate) {
    let schemaText: string | undefined;
    for (const directory of schemaDirectories) {
      try { schemaText = readFileSync(join(directory, `${name}.schema.json`), "utf8"); break; } catch {}
    }
    if (schemaText === undefined) throw new TypeError(`missing ${name} schema from Bootstrap Contract`);
    validate = ajv.compile(JSON.parse(schemaText) as object);
    validators.set(name, validate);
  }
  if (!validate(value)) throw new TypeError(`invalid closed ${name}: ${ajv.errorsText(validate.errors, { separator: "; " })}`);
  return deepFreeze(JSON.parse(JSON.stringify(value)) as T);
}

export function assertOwnDataTree(value: unknown, label: string, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new TypeError(`${label} must not be cyclic`);
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) throw new TypeError(`${label} arrays must use the intrinsic prototype`);
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== "string" || (key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key))) || keys.length !== value.length + 1) throw new TypeError(`${label} arrays must be dense own-data arrays`);
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError(`${label} array entries must be enumerable own data properties`);
      assertOwnDataTree(descriptor.value, label, seen);
    }
  } else {
    if (Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must use the plain object prototype`);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError(`${label} must not contain symbol keys`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new TypeError(`${label} fields must be enumerable own data properties`);
      assertOwnDataTree(descriptor.value, label, seen);
    }
  }
  seen.delete(value);
}

export function assertExactKeys(value: unknown, expected: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain record`);
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some(key => typeof key !== "string" || !expected.includes(key))) throw new TypeError(`${label} is closed and must contain exact fields`);
}

export function parseCanonicalTime(value: string, label: string): number {
  const epoch = Reflect.apply(intrinsicDateParse, Date, [value]) as number;
  let canonical: string;
  try { canonical = Reflect.apply(intrinsicDateToISOString, new Date(epoch), []) as string; } catch { throw new TypeError(`${label} must be canonical RFC 3339 milliseconds`); }
  if (!Number.isFinite(epoch) || canonical !== value) throw new TypeError(`${label} must be canonical RFC 3339 milliseconds`);
  return epoch;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}
