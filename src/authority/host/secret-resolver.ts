import { readFile } from "node:fs/promises";

export interface SecretResolver { resolve(reference: string): Promise<string>; }

/** Host-only resolver. References are deliberately limited to env vars or files. */
export function createSecretResolver(): SecretResolver {
  return Object.freeze({
    async resolve(reference: string): Promise<string> {
      if (typeof reference !== "string" || reference.length === 0) throw new TypeError("secret reference is required");
      if (reference.startsWith("env:")) {
        const name = reference.slice(4);
        if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) throw new TypeError("invalid environment secret reference");
        const value = process.env[name];
        if (!value) throw new Error(`secret environment variable ${name} is unavailable`);
        return value;
      }
      if (reference.startsWith("file:")) {
        const file = reference.slice(5);
        if (!file) throw new TypeError("empty secret file reference");
        const value = (await readFile(file, "utf8")).trim();
        if (!value) throw new Error("secret file is empty");
        return value;
      }
      throw new TypeError("secret references must use env: or file:");
    },
  });
}
