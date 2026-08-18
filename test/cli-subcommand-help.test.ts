import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Keep this list in lockstep with main()'s dispatch switch. The parity test
// below refuses to let a newly dispatched command escape this contract.
const DISPATCH_COMMANDS = [
  "run", "bench", "baseline", "cost", "prices", "mcp", "serve", "trace",
  "compile", "manifest", "resolve", "approve", "push", "get", "verify", "diff",
  "ci", "policy", "authority", "init", "up", "discover", "connections", "connect",
  "deploy", "doctor", "bridge", "coverage", "from-session", "scan", "install", "uninstall",
  "login", "logout", "whoami",
] as const;

const cliPath = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const cliSourcePath = fileURLToPath(new URL("../../src/cli.ts", import.meta.url));
const MAX_RSS_KIB = 256 * 1024;
const PERMISSION_ARGS = ["--permission", "--allow-fs-read=*"] as const;

const ORACLE = String.raw`
const { syncBuiltinESMExports } = require("node:module");
const fail = (api) => () => { throw new Error("REELIER_HELP_ORACLE side effect: " + api); };
const block = (target, label, keys) => {
  for (const key of keys) if (typeof target[key] === "function") target[key] = fail(label + "." + key);
};
// Permission mode denies filesystem mutation, subprocesses, native addons,
// and process.binding. Patch the lowest network surfaces still callable by
// application code: socket/server/datagram instances and both DNS APIs.
const net = require("node:net");
block(net, "node:net", ["connect", "createConnection", "createServer"]);
block(net.Socket.prototype, "node:net.Socket", ["connect"]);
block(net.Server.prototype, "node:net.Server", ["listen"]);
const tls = require("node:tls");
block(tls, "node:tls", ["connect", "createServer"]);
block(tls.TLSSocket.prototype, "node:tls.TLSSocket", ["connect"]);
const dgram = require("node:dgram");
block(dgram, "node:dgram", ["createSocket"]);
block(dgram.Socket.prototype, "node:dgram.Socket", ["bind", "connect", "send", "sendto"]);
const dnsKeys = ["lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTlsa", "resolveTxt", "reverse"];
const dns = require("node:dns");
block(dns, "node:dns", dnsKeys);
block(dns.Resolver.prototype, "node:dns.Resolver", dnsKeys);
const dnsPromises = require("node:dns/promises");
block(dnsPromises, "node:dns/promises", dnsKeys);
block(dnsPromises.Resolver.prototype, "node:dns/promises.Resolver", dnsKeys);
globalThis.fetch = fail("global.fetch");
syncBuiltinESMExports();
process.once("beforeExit", () => {
  console.error("REELIER_HELP_ORACLE_MAX_RSS_KIB=" + process.resourceUsage().maxRSS);
});
`;

interface Invocation {
  status: number | null;
  signal: NodeJS.Signals | null;
  error: Error | undefined;
  output: string;
  maxRssKiB: number | undefined;
}

function invoke(command: string, args: readonly string[], sandbox: string, oraclePath: string): Invocation {
  const home = path.join(sandbox, "home");
  const result = spawnSync(process.execPath, [...PERMISSION_ARGS, "--require", oraclePath, cliPath, command, ...args], {
    cwd: sandbox,
    // Do not let the child inherit credentials, configuration, proxy settings,
    // or an ambient home. Permission mode allows imports and other reads while
    // denying filesystem mutation, subprocesses, and native escape hatches.
    env: { HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, TEMP: sandbox, TMP: sandbox, PATH: process.env.PATH ?? "" },
    encoding: "utf8",
    timeout: 1_500,
    windowsHide: true,
  });
  const output = `${result.stdout}${result.stderr}`;
  const rss = output.match(/REELIER_HELP_ORACLE_MAX_RSS_KIB=(\d+)/);
  return { status: result.status, signal: result.signal, error: result.error, output, maxRssKiB: rss ? Number(rss[1]) : undefined };
}

test("dedicated help inventory exactly matches main's dispatch switch", async () => {
  const source = await readFile(cliSourcePath, "utf8");
  const dispatch = source.match(/switch \(cmd\) \{([\s\S]*?)\n    default:/)?.[1];
  assert.ok(dispatch, "could not locate main()'s dispatch switch");
  const actual = [...dispatch.matchAll(/case "([^"]+)":/g)].map((match) => match[1]).sort();
  assert.deepEqual([...DISPATCH_COMMANDS].sort(), actual);
});

test("the help oracle closes filesystem, subprocess, and low-level network escape paths", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "reelier-cli-help-escape-oracle-"));
  const oraclePath = path.join(sandbox, "oracle.cjs");
  await writeFile(oraclePath, ORACLE);
  const probes = [
    ["writable openSync", `require("node:fs").openSync(${JSON.stringify(path.join(sandbox, "open-sync.txt"))}, "w")`],
    ["promises mkdtempDisposable", `require("node:fs/promises").mkdtempDisposable(${JSON.stringify(path.join(sandbox, "disposable-"))})`],
    ["execSync", `require("node:child_process").execSync(${JSON.stringify(process.execPath)}, ["--version"])`],
    ["execFileSync", `require("node:child_process").execFileSync(${JSON.stringify(process.execPath)}, ["--version"])`],
    ["direct Socket", `new (require("node:net").Socket)().connect(9, "127.0.0.1")`],
    ["direct TLSSocket", `new (require("node:tls").TLSSocket)(new (require("node:net").Socket)()).connect(9, "127.0.0.1")`],
    ["direct datagram Socket", `new (require("node:dgram").Socket)("udp4").send("probe", 9, "127.0.0.1")`],
    ["DNS promises lookup", `require("node:dns/promises").lookup("localhost")`],
    ["DNS promises top-level TLSA", `(() => { const dns = require("node:dns/promises"); dns.setServers(["127.0.0.1"]); return dns.resolveTlsa("localhost"); })()`],
    ["DNS promises TLSA", `(() => { const dns = require("node:dns/promises"); const resolver = new dns.Resolver(); resolver.setServers(["127.0.0.1"]); return resolver.resolveTlsa("localhost"); })()`],
    ["fetch", `fetch("http://127.0.0.1:9/")`],
  ] as const;
  try {
    for (const [name, expression] of probes) {
      const source = `(async () => { try { await (${expression}); console.error("REELIER_HELP_ORACLE_ESCAPE"); process.exitCode = 0; } catch (error) { console.error(error && error.message); process.exitCode = 23; } })()`;
      const result = spawnSync(process.execPath, [...PERMISSION_ARGS, "--require", oraclePath, "-e", source], {
        cwd: sandbox,
        env: { HOME: sandbox, USERPROFILE: sandbox, APPDATA: sandbox, LOCALAPPDATA: sandbox, TEMP: sandbox, TMP: sandbox, PATH: process.env.PATH ?? "" },
        encoding: "utf8",
        timeout: 1_500,
        windowsHide: true,
      });
      const output = `${result.stdout}${result.stderr}`;
      assert.equal(result.error, undefined, `${name} oracle probe did not complete: ${result.error?.message}`);
      assert.equal(result.signal, null, `${name} oracle probe was terminated by ${result.signal}`);
      assert.equal(result.status, 23, `${name} bypassed the help oracle:\n${output}`);
      assert.match(output, /REELIER_HELP_ORACLE side effect|Access to this API has been restricted/, `${name} was not denied by the help oracle:\n${output}`);
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("every dispatched subcommand exits read-only for --help and -h", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "reelier-cli-help-"));
  const oraclePath = path.join(sandbox, "oracle.cjs");
  await writeFile(oraclePath, ORACLE);
  try {
    for (const command of DISPATCH_COMMANDS) {
      for (const helpFlag of ["--help", "-h"] as const) {
        const result = invoke(command, [helpFlag], sandbox, oraclePath);
        assert.equal(result.error, undefined, `${command} ${helpFlag} timed out or failed to start: ${result.error?.message}`);
        assert.equal(result.signal, null, `${command} ${helpFlag} was terminated by ${result.signal}`);
        assert.equal(result.status, 0, `${command} ${helpFlag} exited non-zero:\n${result.output}`);
        assert.match(result.output, /Usage: reelier/, `${command} ${helpFlag} did not print usage:\n${result.output}`);
        assert.doesNotMatch(result.output, /REELIER_HELP_ORACLE side effect/, `${command} ${helpFlag} touched a forbidden side-effect API:\n${result.output}`);
        assert.ok(result.maxRssKiB !== undefined, `${command} ${helpFlag} did not report peak RSS`);
        assert.ok(result.maxRssKiB < MAX_RSS_KIB, `${command} ${helpFlag} peak RSS ${result.maxRssKiB} KiB exceeds ${MAX_RSS_KIB} KiB`);
      }
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("subcommand help grammar does not reinterpret unknown commands or option values", async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "reelier-cli-help-grammar-"));
  const oraclePath = path.join(sandbox, "oracle.cjs");
  await writeFile(oraclePath, ORACLE);
  try {
    const unknown = invoke("not-a-command", ["--help"], sandbox, oraclePath);
    assert.equal(unknown.error, undefined, `unknown command did not start: ${unknown.error?.message}`);
    assert.equal(unknown.signal, null, `unknown command was terminated by ${unknown.signal}`);
    assert.equal(unknown.status, 1, `unknown command must remain non-zero:\n${unknown.output}`);
    assert.match(unknown.output, /Usage: reelier/, `unknown command must retain its usage output:\n${unknown.output}`);

    const optionValue = invoke("mcp", ["--wrap", "-h"], sandbox, oraclePath);
    assert.equal(optionValue.error, undefined, `option-value command did not start: ${optionValue.error?.message}`);
    assert.equal(optionValue.signal, null, `option-value command was terminated by ${optionValue.signal}`);
    assert.notEqual(optionValue.status, 0, `-h used as a --wrap value must not become help:\n${optionValue.output}`);
    assert.doesNotMatch(optionValue.output, /^Usage: reelier\n/m, `-h used as a --wrap value printed top-level help:\n${optionValue.output}`);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});
