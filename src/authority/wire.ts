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
    if (Object.keys(choices).some((key) => ["tenant", "provideraccount", "account", "connector", "pack", "endpoint", "recipient", "template", "body", "url", "providerargs", "providerarguments", "credentials"].includes(key.toLowerCase()))) {
      throw new TypeError("invalid outcome-request: forbidden choice property name");
    }
  }
  if (kind === "outcome-contract") {
    const commitment = (parsed as AuthorityWireByKind["outcome-contract"]).policyCommitment;
    const bytes = Buffer.from(commitment.jcsBase64, "base64");
    if (bytes.toString("base64") !== commitment.jcsBase64) throw new TypeError("invalid outcome-contract: policy commitment base64 is not canonical");
    let policy: unknown;
    try { policy = JSON.parse(bytes.toString("utf8")); }
    catch { throw new TypeError("invalid outcome-contract: policy commitment is not valid JSON"); }
    if (authorityCanonicalBytes(policy).compare(bytes) !== 0) throw new TypeError("invalid outcome-contract: policy commitment bytes are not RFC 8785/JCS canonical");
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (digest !== commitment.digest) throw new TypeError("invalid outcome-contract: policy commitment digest mismatch");
  }
  if (kind === "source-bundle") {
    const source = parsed as AuthorityWireByKind["source-bundle"];
    const claimIds = new Set<string>();
    const pointers = new Set<string>();
    for (const [claimClass, claims] of Object.entries(source.claims)) {
      for (const claim of claims) {
        if (claimIds.has(claim.claimId)) throw new TypeError("invalid source-bundle: claim id must be globally unique");
        claimIds.add(claim.claimId);
        if (pointers.has(claim.projectionPointer)) throw new TypeError("invalid source-bundle: projection pointer appears in more than one class");
        pointers.add(claim.projectionPointer);
        if (claimClass === "grounded" && !hasOwnJsonPointer(source.projection, claim.projectionPointer)) {
          throw new TypeError("invalid source-bundle: grounded projection pointer does not resolve to an own path");
        }
      }
    }
  }
  if (kind === "transport-effect") {
    const effect = parsed as AuthorityWireByKind["transport-effect"];
    if (Object.keys(effect.headers).some((key) => ["authorization", "cookie", "host"].includes(key.toLowerCase()))) throw new TypeError("invalid transport-effect: forbidden header property name");
    if (Buffer.from(effect.bodyBase64, "base64").toString("base64") !== effect.bodyBase64) throw new TypeError("invalid transport-effect: noncanonical base64");
    if (effect.query) {
      const pairs = effect.query.split("&");
      let previous = "";
      const keys = new Set<string>();
      for (const pair of pairs) {
        const split = pair.indexOf("=");
        if (split <= 0 || split !== pair.lastIndexOf("=")) throw new TypeError("invalid transport-effect: query is not canonically encoded");
        const key = pair.slice(0, split);
        const value = pair.slice(split + 1);
        try {
          for (const encoded of [...key.matchAll(/%[0-9A-F]{2}/g), ...value.matchAll(/%[0-9A-F]{2}/g)]) {
            const byte = Number.parseInt(encoded[0].slice(1), 16);
            if ((byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a) || (byte >= 0x30 && byte <= 0x39) || "._~-".includes(String.fromCharCode(byte))) throw new TypeError("unreserved escape");
          }
          decodeURIComponent(key); decodeURIComponent(value);
        } catch { throw new TypeError("invalid transport-effect: query is not canonically encoded"); }
        if (keys.has(key) || (previous && previous >= key)) throw new TypeError("invalid transport-effect: query is not canonically encoded");
        keys.add(key); previous = key;
      }
    }
  }
  return parsed;
}

function hasOwnJsonPointer(root: Record<string, unknown>, pointer: string): boolean {
  let current: unknown = root;
  for (const encoded of pointer.slice(1).split("/")) {
    const segment = encoded.replace(/~1/g, "/").replace(/~0/g, "~");
    if ((typeof current !== "object" || current === null) || !Object.prototype.hasOwnProperty.call(current, segment)) return false;
    current = (current as Record<string, unknown>)[segment];
  }
  return true;
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
