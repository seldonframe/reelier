import { createHash } from "node:crypto";

const HANDLE = Symbol("reelier.secret-handle");

export interface SecretHandle {
  readonly digest: string;
  readonly readOnce: () => Uint8Array;
  readonly destroy: () => void;
  readonly expiresAt: string;
}

/** A one-use, memory-only secret handoff. The value is never included in a wire object. */
export function createSecretHandle(value: Uint8Array | string, input: Readonly<{ expiresAt: string }>): SecretHandle {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : Uint8Array.from(value);
  if (bytes.byteLength === 0) throw new TypeError("secret value must not be empty");
  const expiry = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new TypeError("secret handle expiry is invalid");
  let buffer: Uint8Array | undefined = Uint8Array.from(bytes);
  let used = false;
  const digest = `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
  const handle: SecretHandle & { readonly [HANDLE]: true } = {
    [HANDLE]: true,
    digest,
    expiresAt: new Date(expiry).toISOString(),
    readOnce() {
      if (!buffer || used || Date.now() >= expiry) {
        if (buffer) buffer.fill(0);
        buffer = undefined;
        used = true;
        throw new Error("secret handle is unavailable");
      }
      used = true;
      const output = Uint8Array.from(buffer);
      buffer.fill(0);
      buffer = undefined;
      return output;
    },
    destroy() {
      if (buffer) buffer.fill(0);
      buffer = undefined;
      used = true;
    },
  };
  return Object.freeze(handle);
}

export function isSecretHandle(value: unknown): value is SecretHandle {
  return Boolean(value && typeof value === "object" && (value as Record<symbol, unknown>)[HANDLE] === true);
}

export function redactSecretValue(value: unknown): string {
  if (value instanceof Uint8Array) return `sha256:${createHash("sha256").update(value).digest("hex")}`;
  if (typeof value === "string") return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
  return "absent";
}
