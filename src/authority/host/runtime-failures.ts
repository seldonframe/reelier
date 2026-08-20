import { randomBytes } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { authorityCanonicalBytes, authorityDigest } from "../wire.js";
import type { DispatchFailureDiagnosticV1, DispatchFailureRecorder } from "./runtime.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const FIELDS = ["v", "requestId", "reservationId", "classification", "phase", "providerEffectPossible", "errorDigest", "observedAt"] as const;

/** Immutable internal diagnostics. These records aid repair; they are not signed receipts and make
 * no correctness, completeness, or provider-effect claim beyond their explicit boolean. */
export function createFileDispatchFailureRecorder(rootDir: string): DispatchFailureRecorder {
  const root = path.resolve(rootDir);
  return Object.freeze({
    async record(input: DispatchFailureDiagnosticV1): Promise<void> {
      const value = snapshot(input);
      const bytes = Buffer.concat([authorityCanonicalBytes(value), Buffer.from("\n")]);
      const digest = authorityDigest(value).slice(7);
      await mkdir(root, { recursive: true, mode: 0o700 });
      const target = path.join(root, `diagnostic-${digest}.json`);
      const temporary = path.join(root, `.diagnostic-${digest}.${randomBytes(8).toString("hex")}.tmp`);
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      try { await link(temporary, target); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      finally { await unlink(temporary).catch(() => {}); }
      const persisted = await readFile(target);
      if (!persisted.equals(bytes)) throw new Error("conflicting immutable dispatch failure diagnostic");
      if (process.platform !== "win32") { const directory = await open(root, "r"); try { await directory.sync(); } finally { await directory.close(); } }
    },
  });
}

function snapshot(input: DispatchFailureDiagnosticV1): DispatchFailureDiagnosticV1 {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) throw new TypeError("dispatch failure diagnostic is not inert");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(input).length !== FIELDS.length || FIELDS.some(field => !(field in descriptors)) || Reflect.ownKeys(input).some(key => typeof key !== "string" || !FIELDS.includes(key as typeof FIELDS[number])) || Object.values(descriptors).some(descriptor => !("value" in descriptor) || !descriptor.enumerable)) throw new TypeError("dispatch failure diagnostic is not closed");
  if (input.v !== "reelier.dispatch-failure-diagnostic/internal-v1" || !input.requestId || !input.reservationId || !input.classification || !input.phase || typeof input.providerEffectPossible !== "boolean" || !DIGEST.test(input.errorDigest) || new Date(input.observedAt).toISOString() !== input.observedAt) throw new TypeError("dispatch failure diagnostic is invalid");
  return Object.freeze(Object.fromEntries(FIELDS.map(field => [field, input[field]]))) as unknown as DispatchFailureDiagnosticV1;
}
