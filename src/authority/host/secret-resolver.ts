import { constants, existsSync } from "node:fs";
import { access, lstat, open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const MAX_SLOT_BYTES = 64 * 1024;
const SLOT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const LEASE_TTL_MS = 30_000;

export interface SecretLeaseDescriptionV1 {
  readonly v: "reelier.secret-lease-description/v1";
  readonly slotId: string;
  readonly instanceId: string;
  readonly version: string;
  readonly expiresAt: string;
}

export interface SecretLease {
  readonly description: SecretLeaseDescriptionV1;
  readonly readOnce: () => string;
  readonly destroy: () => void;
}

export interface SecretSlotFileDefinition { readonly kind: "file"; readonly path: string; }
export interface SecretSlotEnvDefinition { readonly kind: "env"; readonly name: string; }
export type SecretSlotDefinition = SecretSlotFileDefinition | SecretSlotEnvDefinition;
export interface SecretSlotStatus { readonly slotId: string; readonly status: "configured" | "missing"; }

export interface SecretResolver {
  /** Legacy references remain available to non-certifiable callers only. */
  resolve(reference: string): Promise<string>;
  acquireSlot?: (slotId: string) => Promise<SecretLease>;
  inspectSlot?: (slotId: string) => SecretSlotStatus;
}
export interface SlotSecretResolver extends SecretResolver {
  readonly acquireSlot: (slotId: string) => Promise<SecretLease>;
  readonly inspectSlot: (slotId: string) => SecretSlotStatus;
}

export interface SecretResolverOptions {
  readonly fileRoot: string;
  readonly slots: Readonly<Record<string, SecretSlotDefinition>>;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export function describeSecretLease(lease: SecretLease): SecretLeaseDescriptionV1 {
  if (!lease || typeof lease !== "object" || !lease.description) throw new TypeError("secret lease is invalid");
  return lease.description;
}

/**
 * Host-owned credential resolver. Slot definitions are intentionally retained only in this
 * closure: neither the returned status surface nor a lease description contains a reference.
 */
export function createSecretResolver(options?: SecretResolverOptions): SlotSecretResolver {
  if (options !== undefined) validateOptions(options);
  const root = options ? path.resolve(options.fileRoot) : undefined;
  const slots = options ? new Map(Object.entries(options.slots)) : new Map<string, SecretSlotDefinition>();
  const env = options?.env ?? process.env;
  return Object.freeze({
    async resolve(reference: string): Promise<string> {
      if (typeof reference !== "string" || reference.length === 0) throw new TypeError("secret reference is required");
      if (reference.startsWith("env:")) {
        const name = reference.slice(4);
        if (!ENV_NAME.test(name)) throw new TypeError("invalid environment secret reference");
        const value = process.env[name];
        if (!value) throw new Error("secret is unavailable");
        return value;
      }
      if (reference.startsWith("file:")) {
        const file = reference.slice(5);
        if (!file) throw new TypeError("empty secret file reference");
        const value = (await readFile(file, "utf8")).trim();
        if (!value) throw new Error("secret is empty");
        if (value.includes("\0")) throw new Error("secret contains invalid data");
        return value;
      }
      throw new TypeError("secret references must use env: or file:");
    },
    async acquireSlot(slotId: string): Promise<SecretLease> {
      if (!options || !SLOT_ID.test(slotId)) throw new Error("secret slot is unavailable");
      const definition = slots.get(slotId);
      if (!definition) throw new Error("secret slot is unavailable");
      let value: string;
      let version: string;
      try {
        if (definition.kind === "env") {
          value = env[definition.name] ?? "";
          if (!value) throw new Error("missing");
          if (value.includes("\0")) throw new Error("invalid");
          version = "env";
        } else {
          const result = await readConfinedFile(root!, definition.path);
          value = result.value;
          version = result.version;
        }
      } catch {
        throw new Error("secret slot is unavailable");
      }
      const expiresAtMs = Date.now() + LEASE_TTL_MS;
      let bytes: Uint8Array | undefined = new TextEncoder().encode(value);
      let used = false;
      const description = Object.freeze({ v: "reelier.secret-lease-description/v1" as const, slotId, instanceId: randomUUID(), version, expiresAt: new Date(expiresAtMs).toISOString() });
      return Object.freeze({
        description,
        readOnce() {
          if (!bytes || used || Date.now() >= expiresAtMs) {
            if (bytes) bytes.fill(0);
            bytes = undefined;
            used = true;
            throw new Error("secret lease is unavailable");
          }
          used = true;
          const output = new TextDecoder().decode(bytes);
          bytes.fill(0);
          bytes = undefined;
          return output;
        },
        destroy() { if (bytes) bytes.fill(0); bytes = undefined; used = true; },
      });
    },
    inspectSlot(slotId: string): SecretSlotStatus {
      if (!options || !SLOT_ID.test(slotId) || !slots.has(slotId)) return Object.freeze({ slotId, status: "missing" });
      const definition = slots.get(slotId)!;
      if (definition.kind === "env") return Object.freeze({ slotId, status: env[definition.name] ? "configured" : "missing" });
      return Object.freeze({ slotId, status: safeRelative(definition.path) && existsSync(path.resolve(root!, definition.path)) ? "configured" : "missing" });
    },
  });
}

function validateOptions(options: SecretResolverOptions): void {
  if (!options || typeof options.fileRoot !== "string" || !options.fileRoot || !options.slots || typeof options.slots !== "object" || Array.isArray(options.slots)) throw new TypeError("secret resolver options are invalid");
  if (Object.getPrototypeOf(options.slots) !== Object.prototype) throw new TypeError("secret slot map prototype is invalid");
  const slotDescriptors = Object.getOwnPropertyDescriptors(options.slots);
  if (Object.values(slotDescriptors).some(descriptor => !Object.prototype.hasOwnProperty.call(descriptor, "value") || descriptor.get || descriptor.set)) throw new TypeError("secret slot map contains accessor fields");
  for (const [slotId, definition] of Object.entries(options.slots)) {
    if (!SLOT_ID.test(slotId) || !definition || typeof definition !== "object" || Object.getPrototypeOf(definition) !== Object.prototype) throw new TypeError("secret slot definition is invalid");
    const definitionDescriptors = Object.getOwnPropertyDescriptors(definition);
    if (Object.values(definitionDescriptors).some(descriptor => !Object.prototype.hasOwnProperty.call(descriptor, "value") || descriptor.get || descriptor.set)) throw new TypeError("secret slot definition contains accessor fields");
    const keys = Object.keys(definition);
    if ((definition as SecretSlotDefinition).kind === "file") {
      if (keys.length !== 2 || keys.some(key => !["kind", "path"].includes(key)) || typeof (definition as SecretSlotFileDefinition).path !== "string" || !(definition as SecretSlotFileDefinition).path || (definition as SecretSlotFileDefinition).path.includes("\0")) throw new TypeError("secret file slot definition is invalid");
    } else if ((definition as SecretSlotDefinition).kind === "env") {
      if (keys.length !== 2 || keys.some(key => !["kind", "name"].includes(key)) || typeof (definition as SecretSlotEnvDefinition).name !== "string" || !ENV_NAME.test((definition as SecretSlotEnvDefinition).name)) throw new TypeError("secret environment slot definition is invalid");
    } else throw new TypeError("secret slot definition kind is invalid");
  }
}

function safeRelative(value: string): boolean {
  if (!value || value.includes("\0") || path.isAbsolute(value)) return false;
  const segments = value.split(/[\\/]+/);
  return segments.every(segment => segment.length > 0 && segment !== "." && segment !== "..");
}

async function readConfinedFile(root: string, relative: string): Promise<{ value: string; version: string }> {
  if (!safeRelative(relative)) throw new Error("secret path escapes root");
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("secret root is not a regular directory");
  const rootReal = await realpath(root);
  const candidate = path.resolve(root, relative);
  const boundary = process.platform === "win32" ? rootReal.toLowerCase() : rootReal;
  const candidateLexical = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  if (candidateLexical !== boundary && !candidateLexical.startsWith(`${boundary}${path.sep}`)) throw new Error("secret path escapes root");
  const segments = path.relative(root, candidate).split(path.sep).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error("secret path link indirection is prohibited");
  }
  const flags = constants.O_RDONLY | (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
  const handle = await open(candidate, flags);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_SLOT_BYTES) throw new Error("secret file is invalid");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const currentPathStat = await lstat(candidate);
    const canonicalCandidate = await realpath(candidate);
    const canonicalExpected = path.resolve(rootReal, path.relative(root, candidate));
    const identityChanged = before.dev !== currentPathStat.dev || before.ino !== currentPathStat.ino;
    if (canonicalCandidate !== canonicalExpected || currentPathStat.isSymbolicLink() || !currentPathStat.isFile() || identityChanged || !after.isFile() || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || bytes.byteLength !== after.size) throw new Error("secret file changed");
    const value = bytes.toString("utf8").trim();
    if (!value || value.includes("\0") || Buffer.byteLength(value, "utf8") > MAX_SLOT_BYTES) throw new Error("secret file is invalid");
    return { value, version: `${after.size}:${after.mtimeMs}` };
  } finally { await handle.close(); }
}
