import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { canonicalJson } from "./canonical-json.js";
import { loadSigningKey, signRecordDigest, signingKeyDir } from "./signing.js";

export interface ArenaCliArgs {
  positional: string[];
  flags: Set<string>;
  opts: Record<string, string>;
}

export interface ArenaAdapterCommand {
  command: string;
  args: string[];
}

const RESTRICTED_KEY = /(authorization|api[-_]?key|credential|password|private[-_]?key|prompt|raw[-_]?trace|secret|token|cookie|headers?)/i;

export function parseArenaAdapterCommand(raw: string): ArenaAdapterCommand {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Arena adapter command must be JSON, for example {\"command\":\"eve\",\"args\":[\"arena-run\"]}");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || typeof (parsed as { command?: unknown }).command !== "string") throw new Error("Arena adapter command JSON requires a command string");
  const args = (parsed as { args?: unknown }).args ?? [];
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) throw new Error("Arena adapter command args must be an array of strings");
  return { command: (parsed as { command: string }).command, args: args as string[] };
}

export function sanitizeArenaBundleValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeArenaBundleValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !RESTRICTED_KEY.test(key)).map(([key, child]) => [key, sanitizeArenaBundleValue(child)]));
}

function runAdapter(command: ArenaAdapterCommand, request: unknown, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, { stdio: ["pipe", "pipe", "pipe"], shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      done(new Error(`Arena adapter timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); done(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) return done(new Error(`Arena adapter exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
      const line = stdout.split(/\r?\n/).map((value) => value.trim()).find(Boolean);
      if (!line) return done(new Error("Arena adapter returned no JSON response"));
      try { done(undefined, JSON.parse(line)); } catch { done(new Error("Arena adapter did not return valid JSON")); }
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

async function arenaRun(args: ArenaCliArgs): Promise<number> {
  const challengeId = args.opts.challenge;
  const harness = args.opts.harness ?? "custom";
  if (!challengeId) throw new Error("reelier arena run requires --challenge <id>");
  const commandRaw = args.opts.command ?? process.env[`REELIER_ARENA_${harness.toUpperCase()}_COMMAND`];
  if (!commandRaw) throw new Error("reelier arena run requires --command '<JSON>' or a REELIER_ARENA_<HARNESS>_COMMAND environment variable");
  const command = parseArenaAdapterCommand(commandRaw);
  const conditions = {
    challengeVersion: args.opts["challenge-version"] ?? "local-v1",
    fixtureDigest: args.opts["fixture"] ?? "user-local-fixture",
    armConfigDigest: `${harness}:${args.opts["adapter-version"] ?? "local-v1"}`,
    evaluatorVersion: args.opts.evaluator ?? "arena-contract-v1",
    rendererVersion: "arena-renderer-v1",
  };
  const raw = await runAdapter(command, { schemaVersion: "arena-run-request.v1", challengeId, harness, conditions, runNonce: randomUUID(), reelier: { mode: "wrap", command: ["reelier", "mcp", "--wrap"] } }, Number(args.opts.timeout ?? 120_000));
  const result = typeof raw === "object" && raw !== null && "result" in raw ? (raw as { result: unknown }).result : raw;
  const sanitized = sanitizeArenaBundleValue(result) as Record<string, unknown>;
  const key = await loadSigningKey(signingKeyDir(os.homedir()));
  if (!key) throw new Error("No signing key found. Run 'reelier init --signing' before submitting an Arena bundle.");
  const unsigned = { schemaVersion: "arena-run-bundle.v1", challengeId, conditions, adapter: { harness, version: args.opts["adapter-version"] ?? "local-v1" }, ...sanitized };
  const digest = createHash("sha256").update(canonicalJson(unsigned)).digest("hex");
  const bundle = { ...unsigned, signature: { algorithm: "ed25519", keyId: key.keyId, value: signRecordDigest(key.privateKey, digest) } };
  const output = JSON.stringify(bundle, null, 2);
  if (args.opts.out) await writeFile(args.opts.out, `${output}\n`, { encoding: "utf8", mode: 0o600 });
  else console.log(output);
  return 0;
}

async function arenaInit(): Promise<number> {
  const filePath = path.join(process.cwd(), ".reelier", "arena.json");
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify({ schemaVersion: "arena-local-config.v1", fixture: "marketing-fixture-v1", adapters: { eve: "set REELIER_ARENA_EVE_COMMAND", hermes: "set REELIER_ARENA_HERMES_COMMAND" } }, null, 2)}\n`, "utf8");
  console.log(`Arena local configuration written to ${filePath}`);
  return 0;
}

async function arenaSubmit(args: ArenaCliArgs): Promise<number> {
  const file = args.opts.bundle ?? args.positional[1];
  if (!file) throw new Error("reelier arena submit requires <bundle.json> or --bundle <path>");
  const apiKey = process.env.REELIER_CLOUD_KEY;
  if (!apiKey) throw new Error("REELIER_CLOUD_KEY is required; the bundle never contains this key");
  const baseUrl = (process.env.REELIER_CLOUD_URL ?? "https://www.reelier.com").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/api/arena/bundles`, { method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }, body: await readFile(file, "utf8") });
  const body = await response.text();
  if (!response.ok) { console.error(body); return 1; }
  console.log(body);
  return 0;
}

export async function cmdArena(args: ArenaCliArgs): Promise<number> {
  switch (args.positional[0]) {
    case "init": return arenaInit();
    case "run": return arenaRun(args);
    case "submit": return arenaSubmit(args);
    default: throw new Error("Usage: reelier arena <init|run|submit> [options]");
  }
}
