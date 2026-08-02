import type { ValidateFunction } from "ajv";
import canonicalize from "canonicalize";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AuthorityKind, AuthorityWire, AuthorityWireByKind } from "./types.js";

const packagedSchemaDirectory = fileURLToPath(new URL("./schemas/", import.meta.url));
const schemaDirectory = existsSync(packagedSchemaDirectory)
  ? packagedSchemaDirectory
  : fileURLToPath(new URL("../../../contract/authority/v1/", import.meta.url));
const schemas = new Map<AuthorityKind, ValidateFunction>();
const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/2020").default as new (options: object) => {
  compile(schema: object): ValidateFunction;
  errorsText(errors: unknown, options: { separator: string }): string;
};
const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
const addFormats = require("ajv-formats").default as (instance: object) => void;
addFormats(ajv);

function validator(kind: AuthorityKind): ValidateFunction {
  const cached = schemas.get(kind);
  if (cached) return cached;
  const schema = JSON.parse(readFileSync(`${schemaDirectory}${kind}.schema.json`, "utf8")) as object;
  const compiled = ajv.compile(schema);
  schemas.set(kind, compiled);
  return compiled;
}

function errorMessage(validate: ValidateFunction): string {
  return ajv.errorsText(validate.errors, { separator: "; " });
}

/** RFC 8785/JCS bytes for new authority objects only; legacy canonical-json stays untouched. */
export function authorityCanonicalBytes(value: unknown): Buffer {
  const canonical = canonicalize(value);
  if (canonical === undefined) throw new TypeError("authority wire value is not JSON-canonicalizable");
  return Buffer.from(canonical, "utf8");
}

export function authorityDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(authorityCanonicalBytes(value)).digest("hex")}`;
}

/** Validates a closed authority object and returns a detached, immutable-typed copy. */
export function parseAuthorityWire<K extends AuthorityKind>(kind: K, value: unknown): AuthorityWireByKind[K] {
  const validate = validator(kind);
  if (!validate(value)) throw new TypeError(`invalid ${kind}: ${errorMessage(validate)}`);
  const parsed = JSON.parse(authorityCanonicalBytes(value).toString("utf8")) as AuthorityWireByKind[K];
  if (kind === "outcome-request") {
    const choices = (parsed as AuthorityWireByKind["outcome-request"]).choices;
    if (Object.keys(choices).some((key) => ["tenant", "body", "url", "credentials", "providerargs"].includes(key.toLowerCase()))) {
      throw new TypeError("invalid outcome-request: forbidden choice property name");
    }
  }
  if (kind === "transport-effect") {
    const effect = parsed as AuthorityWireByKind["transport-effect"];
    if (Object.keys(effect.headers).some((key) => ["authorization", "cookie", "host"].includes(key.toLowerCase()))) throw new TypeError("invalid transport-effect: forbidden header property name");
    if (Buffer.from(effect.bodyBase64, "base64").toString("base64") !== effect.bodyBase64) throw new TypeError("invalid transport-effect: noncanonical base64");
    if (effect.query.some((entry, index) => index > 0 && `${effect.query[index - 1].key}\u0000${effect.query[index - 1].value}` >= `${entry.key}\u0000${entry.value}`)) throw new TypeError("invalid transport-effect: query is not canonically ordered");
  }
  return parsed;
}

/** Refuses JSON whose original bytes are not its RFC 8785/JCS representation. */
export function parseCanonicalAuthorityJson<K extends AuthorityKind>(kind: K, json: string): AuthorityWireByKind[K] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new TypeError(`invalid ${kind}: invalid JSON`);
  }
  if (authorityCanonicalBytes(value).toString("utf8") !== json) {
    throw new TypeError(`invalid ${kind}: JSON is not RFC 8785/JCS canonical`);
  }
  return parseAuthorityWire(kind, value);
}
