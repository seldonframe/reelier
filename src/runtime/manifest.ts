import { parseBootstrapSchema } from "../bootstrap/normalize.js";
import type { RuntimeDescriptorV1 } from "./types.js";

const shellSyntax = /(?:&&|\|\||[;&|`<>]|\$\(|\r|\n)/;
const endpointSyntax = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const secretName = /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|CREDENTIAL|PRIVATE_KEY)(?:_|$)/;

export function parseRuntimeDescriptorV1(value: unknown): RuntimeDescriptorV1 {
  const parsed = parseBootstrapSchema<RuntimeDescriptorV1>("runtime-descriptor", value);
  if (parsed.args.some(argument => shellSyntax.test(argument) || endpointSyntax.test(argument))) throw new TypeError("runtime arguments cannot contain shell command or endpoint syntax");
  if (parsed.environmentAllowlist.some(name => secretName.test(name))) throw new TypeError("runtime environment allowlist cannot carry credential material");
  assertSortedUnique(parsed.environmentAllowlist, "runtime environment allowlist");
  if (parsed.launchMode === "local-process") {
    if (parsed.command === null || parsed.connectionRef !== null || parsed.shutdown !== "signal-owned-child") throw new TypeError("local runtime descriptor field combination is invalid");
    assertConfinedPath(parsed.command, "runtime command");
    if (parsed.cwd !== null) assertConfinedPath(parsed.cwd, "runtime working directory");
  } else {
    if (parsed.command !== null || parsed.args.length !== 0 || parsed.cwd !== null || parsed.connectionRef === null || parsed.environmentAllowlist.length !== 0 || parsed.shutdown !== "external") throw new TypeError("externally managed runtime descriptor field combination is invalid");
  }
  return parsed;
}

function assertConfinedPath(value: string, label: string): void {
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.split("/").some(part => part === "..") || shellSyntax.test(value)) throw new TypeError(`${label} must be a project-confined POSIX relative path`);
}

function assertSortedUnique(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index++) if (Buffer.from(values[index - 1]).compare(Buffer.from(values[index])) >= 0) throw new TypeError(`${label} must be unique and UTF-8 byte sorted`);
}
