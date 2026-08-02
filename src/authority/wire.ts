import type { ValidateFunction } from "ajv";
import canonicalize from "canonicalize";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AuthorityKind, AuthorityWire } from "./types.js";

const schemaDirectory = fileURLToPath(new URL("../../../contract/authority/v1/", import.meta.url));
const schemas = new Map<AuthorityKind, ValidateFunction>();
const require = createRequire(import.meta.url);
const Ajv = require("ajv").default as new (options: object) => {
  compile(schema: object): ValidateFunction;
  errorsText(errors: unknown, options: { separator: string }): string;
};
const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true, validateSchema: false });
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
export function parseAuthorityWire(kind: AuthorityKind, value: unknown): AuthorityWire {
  const validate = validator(kind);
  if (!validate(value)) throw new TypeError(`invalid ${kind}: ${errorMessage(validate)}`);
  return JSON.parse(authorityCanonicalBytes(value).toString("utf8")) as AuthorityWire;
}

/** Refuses JSON whose original bytes are not its RFC 8785/JCS representation. */
export function parseCanonicalAuthorityJson(kind: AuthorityKind, json: string): AuthorityWire {
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
