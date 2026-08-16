import { parseBootstrapSchema } from "../bootstrap/normalize.js";
import type { RuntimeDescriptorV1 } from "./types.js";

const shellSyntax = /(?:&&|\|\||[;&|`<>]|\$\(|\r|\n)/;
const endpointSyntax = /[A-Za-z][A-Za-z0-9+.-]*:\/\//;
const credentialSyntax = /(?:^|[-_/])(?:api[-_]?key|token|secret|password|credential|private[-_]?key)(?:=|:|$)|\bBearer\s|\bsk_(?:live|test)_/i;
const shellExecutables = new Set(["cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe", "sh", "bash", "zsh", "fish", "wsl", "wsl.exe", "cscript", "cscript.exe", "wscript", "wscript.exe"]);
const shellModes = new Set(["/c", "/k", "-c", "-command", "-encodedcommand", "--command"]);
const forbiddenArgumentChannels = new Set(["api-key", "auth", "authorization", "cert", "cookie", "credential", "endpoint", "header", "key", "password", "private-key", "secret", "token", "user"]);
const safeArgumentSegment = /^[A-Za-z0-9_~][A-Za-z0-9._~-]*$/;
const secretName = /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|CREDENTIAL|PRIVATE_KEY)(?:_|$)/;

export function parseRuntimeDescriptorV1(value: unknown): RuntimeDescriptorV1 {
  const parsed = parseBootstrapSchema<RuntimeDescriptorV1>("runtime-descriptor", value);
  if (parsed.args.some(argument => shellSyntax.test(argument) || endpointSyntax.test(argument) || credentialSyntax.test(argument) || shellModes.has(argument.toLowerCase()) || !isStructurallySafeArgument(argument))) throw new TypeError("runtime arguments must use the closed safe launcher grammar");
  if (parsed.environmentAllowlist.some(name => secretName.test(name))) throw new TypeError("runtime environment allowlist cannot carry credential material");
  assertSortedUnique(parsed.environmentAllowlist, "runtime environment allowlist");
  if (parsed.launchMode === "local-process") {
    if (parsed.command === null || parsed.connectionRef !== null || parsed.shutdown !== "signal-owned-child") throw new TypeError("local runtime descriptor field combination is invalid");
    assertConfinedPath(parsed.command, "runtime command");
    const executable = parsed.command.split("/").at(-1)?.toLowerCase();
    if (executable === undefined || shellExecutables.has(executable)) throw new TypeError("runtime command cannot be a shell executable");
    if (parsed.cwd !== null) assertConfinedPath(parsed.cwd, "runtime working directory");
  } else {
    if (parsed.command !== null || parsed.args.length !== 0 || parsed.cwd !== null || parsed.connectionRef === null || parsed.environmentAllowlist.length !== 0 || parsed.shutdown !== "external") throw new TypeError("externally managed runtime descriptor field combination is invalid");
  }
  return parsed;
}

function assertConfinedPath(value: string, label: string): void {
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.split("/").some(part => part === "..") || shellSyntax.test(value)) throw new TypeError(`${label} must be a project-confined POSIX relative path`);
}

/** Structural safety only; the installed Task 6 adapter validates its exact option set. */
function isStructurallySafeArgument(value: string): boolean {
  if (value === ".") return true;
  if (value.startsWith("--")) {
    const separator = value.indexOf("=");
    const flag = separator === -1 ? value.slice(2) : value.slice(2, separator);
    if (!/^[a-z][a-z0-9-]*$/.test(flag) || forbiddenArgumentChannels.has(flag)) return false;
    return separator === -1 || isConfinedArgumentToken(value.slice(separator + 1));
  }
  return isConfinedArgumentToken(value);
}

function isConfinedArgumentToken(value: string): boolean {
  if (value === ".") return true;
  if (value.length === 0 || value.startsWith("/") || value.includes("\\") || /^[A-Za-z]:/.test(value)) return false;
  return value.split("/").every(segment => safeArgumentSegment.test(segment));
}

function assertSortedUnique(values: readonly string[], label: string): void {
  for (let index = 1; index < values.length; index++) if (Buffer.from(values[index - 1]).compare(Buffer.from(values[index])) >= 0) throw new TypeError(`${label} must be unique and UTF-8 byte sorted`);
}
