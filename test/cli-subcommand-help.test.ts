import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
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
// Node adds low-level network APIs mid-major-version (not just at a major
// bump), and CI pins float independently per OS (ubuntu: latest 24.x;
// windows: latest 22.x — see .github/workflows/ci.yml), so a contributor's
// local Node, and each CI leg, can legitimately see a different callable
// surface. An exact-match inventory pinned to one snapshot breaks on every
// Node build that isn't that exact snapshot. So the floors below are
// checked against the running process, and the inventory (and the escape
// probe that has nothing to probe below its floor) are built from them,
// keeping the match exact for whichever Node is actually running instead of
// exact for only one.
//
// Floors verified empirically 2026-08-19 by sweeping node:20, node:22, and
// node:24.9.0 through node:24.19.0 in Docker (linux/amd64): every surface
// below is absent through the version just below its floor and present at
// and above it. Re-run the same sweep before moving a floor.
const NODE_VERSION_PARTS = process.versions.node.split(".").map(Number) as [number, number, number];
const nodeAtLeast = (major: number, minor: number, patch: number): boolean =>
  NODE_VERSION_PARTS[0] !== major ? NODE_VERSION_PARTS[0] > major
    : NODE_VERSION_PARTS[1] !== minor ? NODE_VERSION_PARTS[1] > minor
      : NODE_VERSION_PARTS[2] >= patch;

// net.Socket#get/setTypeOfService — Node 24.15.0.
const HAS_NET_TYPE_OF_SERVICE = nodeAtLeast(24, 15, 0);
// net.BoundSocket, tls.getCertificateCompressionAlgorithms, and
// dgram.Socket#bindSync/#connectSync all landed together — Node 24.19.0.
const HAS_NET_BOUND_SOCKET_BATCH = nodeAtLeast(24, 19, 0);

const NETWORK_CALLABLE_SURFACES = {
  // BoundSocket's constructor performs a real OS bind() synchronously (the
  // dangerous half lives in construction itself, not in a later method
  // call), so it is denied at the module export in the ORACLE below like
  // dgram's Socket rather than by patching a prototype method.
  net: [
    ...(HAS_NET_BOUND_SOCKET_BATCH ? ["BoundSocket"] : []),
    "Server", "Socket", "Stream", "_createServerHandle", "_normalizeArgs", "connect", "createConnection", "createServer", "getDefaultAutoSelectFamily", "getDefaultAutoSelectFamilyAttemptTimeout", "isIP", "isIPv4", "isIPv6", "setDefaultAutoSelectFamily", "setDefaultAutoSelectFamilyAttemptTimeout",
  ],
  // get/setTypeOfService are inert without a live `_handle` (setTypeOfService
  // just caches the value; getTypeOfService returns the cached value) — the
  // same shape as the already-unguarded setKeepAlive/setNoDelay/setTimeout
  // siblings, and a handle only exists after the already-denied connect().
  // Not blocked in the ORACLE.
  netSocket: [
    "_destroy", "_final", "_getpeername", "_getsockname", "_onTimeout", "_read", "_reset", "_unrefTimer", "_write", "_writeGeneric", "_writev", "address", "connect", "constructor", "destroySoon", "end",
    ...(HAS_NET_TYPE_OF_SERVICE ? ["getTypeOfService"] : []),
    "pause", "read", "ref", "resetAndDestroy", "resume", "setKeepAlive", "setNoDelay", "setTimeout",
    ...(HAS_NET_TYPE_OF_SERVICE ? ["setTypeOfService"] : []),
    "unref",
  ],
  netServer: ["_emitCloseIfDrained", "_listen2", "_setupWorker", "address", "close", "constructor", "getConnections", "listen", "ref", "unref"],
  // getCertificateCompressionAlgorithms is a pure capability query (no
  // socket, no I/O) — the same shape as the already-unguarded
  // getCiphers/getCACertificates siblings. Not blocked in the ORACLE.
  tls: [
    "SecureContext", "Server", "TLSSocket", "checkServerIdentity", "connect", "convertALPNProtocols", "createSecureContext", "createServer", "getCACertificates",
    ...(HAS_NET_BOUND_SOCKET_BATCH ? ["getCertificateCompressionAlgorithms"] : []),
    "getCiphers", "setDefaultCACertificates",
  ],
  tlsSocket: ["_destroySSL", "_emitTLSError", "_finishInit", "_handleTimeout", "_init", "_releaseControl", "_start", "_tlsError", "_wrapHandle", "constructor", "disableRenegotiation", "enableTrace", "exportKeyingMaterial", "getCertificate", "getCipher", "getEphemeralKeyInfo", "getFinished", "getPeerCertificate", "getPeerFinished", "getPeerX509Certificate", "getProtocol", "getSession", "getSharedSigalgs", "getTLSTicket", "getX509Certificate", "isSessionReused", "renegotiate", "setKeyCert", "setMaxSendFragment", "setServername", "setSession"],
  dgram: ["Socket", "_createSocketHandle", "createSocket"],
  // bindSync/connectSync are synchronous twins of the already-denied
  // bind/connect — same side effect, so blocked identically in the ORACLE.
  dgramSocket: [
    "_healthCheck", "_stopReceiving", "addMembership", "addSourceSpecificMembership", "address", "bind",
    ...(HAS_NET_BOUND_SOCKET_BATCH ? ["bindSync"] : []),
    "close", "connect",
    ...(HAS_NET_BOUND_SOCKET_BATCH ? ["connectSync"] : []),
    "constructor", "disconnect", "dropMembership", "dropSourceSpecificMembership", "getRecvBufferSize", "getSendBufferSize", "getSendQueueCount", "getSendQueueSize", "ref", "remoteAddress", "send", "sendto", "setBroadcast", "setMulticastInterface", "setMulticastLoopback", "setMulticastTTL", "setRecvBufferSize", "setSendBufferSize", "setTTL", "unref",
  ],
  dns: ["Resolver", "getDefaultResultOrder", "getServers", "lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTlsa", "resolveTxt", "reverse", "setDefaultResultOrder", "setServers"],
  dnsResolver: ["constructor", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTlsa", "resolveTxt", "reverse"],
  dnsPromises: ["Resolver", "getDefaultResultOrder", "getServers", "lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTlsa", "resolveTxt", "reverse", "setDefaultResultOrder", "setServers"],
  dnsPromisesResolver: ["constructor", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTlsa", "resolveTxt", "reverse"],
} as const;

const ORACLE = String.raw`
const { syncBuiltinESMExports } = require("node:module");
const fail = (api) => function () { throw new Error("REELIER_HELP_ORACLE side effect: " + api); };
const block = (target, label, keys) => {
  for (const key of keys) if (typeof target[key] === "function") target[key] = fail(label + "." + key);
};
// Permission mode denies filesystem mutation, subprocesses, native addons,
// and process.binding. Patch the lowest network surfaces still callable by
// application code: socket/server/datagram instances and both DNS APIs.
const net = require("node:net");
// BoundSocket's constructor itself performs the bind() syscall (added
// Node 24.19), so — unlike Socket/Server, whose construction is inert —
// the module export must be denied directly; there is no later method call
// to intercept instead.
block(net, "node:net", ["BoundSocket", "_createServerHandle", "connect", "createConnection", "createServer"]);
block(net.Socket.prototype, "node:net.Socket", ["connect"]);
block(net.Server.prototype, "node:net.Server", ["_listen2", "listen"]);
const tls = require("node:tls");
block(tls, "node:tls", ["connect", "createServer"]);
block(tls.TLSSocket.prototype, "node:tls.TLSSocket", ["connect"]);
const dgram = require("node:dgram");
block(dgram, "node:dgram", ["_createSocketHandle", "createSocket"]);
block(dgram.Socket.prototype, "node:dgram.Socket", [
  "_stopReceiving", "addMembership", "addSourceSpecificMembership", "bind", "bindSync", "close",
  "connect", "connectSync", "disconnect", "dropMembership", "dropSourceSpecificMembership", "ref",
  "send", "sendto", "setBroadcast", "setMulticastInterface", "setMulticastLoopback",
  "setMulticastTTL", "setRecvBufferSize", "setSendBufferSize", "setTTL", "unref",
]);
block(dgram, "node:dgram", ["Socket"]);
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

test("init help documents the managed local preview without implying authorization", () => {
  const result = spawnSync(process.execPath, [cliPath, "init", "--help"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /reelier init --managed \[--dry-run\]/);
  assert.match(result.stdout, /local preview/i);
  assert.match(result.stdout, /does not authorize missions/i);
});

test("network oracle inventory exactly matches Node's callable network surfaces", () => {
  const callableOwnProperties = (target: object) => Object.getOwnPropertyNames(target)
    .filter((key) => typeof Object.getOwnPropertyDescriptor(target, key)?.value === "function")
    .sort();
  const require = createRequire(import.meta.url);
  const net = require("node:net") as typeof import("node:net");
  const tls = require("node:tls") as typeof import("node:tls");
  const dgram = require("node:dgram") as typeof import("node:dgram");
  const dns = require("node:dns") as typeof import("node:dns");
  const dnsPromises = require("node:dns/promises") as typeof import("node:dns/promises");
  assert.deepEqual(callableOwnProperties(net), [...NETWORK_CALLABLE_SURFACES.net].sort());
  assert.deepEqual(callableOwnProperties(net.Socket.prototype), [...NETWORK_CALLABLE_SURFACES.netSocket].sort());
  assert.deepEqual(callableOwnProperties(net.Server.prototype), [...NETWORK_CALLABLE_SURFACES.netServer].sort());
  assert.deepEqual(callableOwnProperties(tls), [...NETWORK_CALLABLE_SURFACES.tls].sort());
  assert.deepEqual(callableOwnProperties(tls.TLSSocket.prototype), [...NETWORK_CALLABLE_SURFACES.tlsSocket].sort());
  assert.deepEqual(callableOwnProperties(dgram), [...NETWORK_CALLABLE_SURFACES.dgram].sort());
  assert.deepEqual(callableOwnProperties(dgram.Socket.prototype), [...NETWORK_CALLABLE_SURFACES.dgramSocket].sort());
  assert.deepEqual(callableOwnProperties(dns), [...NETWORK_CALLABLE_SURFACES.dns].sort());
  assert.deepEqual(callableOwnProperties(dns.Resolver.prototype), [...NETWORK_CALLABLE_SURFACES.dnsResolver].sort());
  assert.deepEqual(callableOwnProperties(dnsPromises), [...NETWORK_CALLABLE_SURFACES.dnsPromises].sort());
  assert.deepEqual(callableOwnProperties(dnsPromises.Resolver.prototype), [...NETWORK_CALLABLE_SURFACES.dnsPromisesResolver].sort());
});

test("the help oracle closes filesystem, subprocess, and low-level network escape paths", async (t) => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), "reelier-cli-help-escape-oracle-"));
  const oraclePath = path.join(sandbox, "oracle.cjs");
  await writeFile(oraclePath, ORACLE);
  const probes = [
    ["writable openSync", `require("node:fs").openSync(${JSON.stringify(path.join(sandbox, "open-sync.txt"))}, "w")`],
    ["promises mkdtempDisposable", `require("node:fs/promises").mkdtempDisposable(${JSON.stringify(path.join(sandbox, "disposable-"))})`],
    ["execSync", `require("node:child_process").execSync(${JSON.stringify(process.execPath)}, ["--version"])`],
    ["execFileSync", `require("node:child_process").execFileSync(${JSON.stringify(process.execPath)}, ["--version"])`],
    ["direct Socket", `new (require("node:net").Socket)().connect(9, "127.0.0.1")`],
    ["raw TCP server handle", `require("node:net")._createServerHandle("127.0.0.1", 0, 4)`],
    ["direct TCP Server _listen2", `new (require("node:net").Server)()._listen2("127.0.0.1", 0, 4, 511, undefined, 0)`],
    ["direct TLSSocket", `new (require("node:tls").TLSSocket)(new (require("node:net").Socket)()).connect(9, "127.0.0.1")`],
    // node:net.BoundSocket does not exist below its Node 24.19.0 floor
    // (see NETWORK_CALLABLE_SURFACES above): there is nothing to construct,
    // so the probe is skipped rather than asserting a denial that can never
    // fire on this Node build.
    ["direct BoundSocket construction", `new (require("node:net").BoundSocket)({ port: 0 })`, HAS_NET_BOUND_SOCKET_BATCH],
    ["direct datagram Socket construction", `new (require("node:dgram").Socket)("udp4")`],
    ["direct datagram Socket", `new (require("node:dgram").Socket)("udp4").send("probe", 9, "127.0.0.1")`],
    ["raw datagram handle", `require("node:dgram")._createSocketHandle("127.0.0.1", 0, "udp4")`],
    ["datagram addMembership", `new (require("node:dgram").Socket)("udp4").addMembership("224.0.0.114")`],
    ["datagram bindSync", `new (require("node:dgram").Socket)("udp4").bindSync()`],
    ["datagram connectSync", `new (require("node:dgram").Socket)("udp4").connectSync(9, "127.0.0.1")`],
    ["DNS promises lookup", `require("node:dns/promises").lookup("localhost")`],
    ["DNS promises top-level TLSA", `(() => { const dns = require("node:dns/promises"); dns.setServers(["127.0.0.1"]); return dns.resolveTlsa("localhost"); })()`],
    ["DNS promises TLSA", `(() => { const dns = require("node:dns/promises"); const resolver = new dns.Resolver(); resolver.setServers(["127.0.0.1"]); return resolver.resolveTlsa("localhost"); })()`],
    ["fetch", `fetch("http://127.0.0.1:9/")`],
  ] as const;
  try {
    for (const [name, expression, available = true] of probes) {
      await t.test(name, { skip: available ? false : `unavailable on ${process.version}` }, () => {
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
      });
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
