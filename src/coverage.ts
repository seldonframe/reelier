// reelier coverage — read-only observed-coverage analysis for plugin-capable
// hosts (docs/specs/agent-plugins-coverage-v1.md §2). Codex first.
//
// The analysis functions are pure (raw text in, findings out); the one
// filesystem toucher is `collectCodexCoverage`, and it only ever reads. The
// vocabulary is two independent fields per finding — Location:
// parsed | unreadable | absent, Server routing: wrapped | unwrapped — and
// routing is judged by reading the entry, never assumed. `wrapped` is a
// routing claim only; it never means enforced or safe.
//
// The TOML reader below is deliberately a subset: it parses strictly ONLY
// inside the sections the probe cares about (mcp_servers, plugins,
// marketplaces) and reports anything it cannot understand there as
// `unreadable` rather than guessing. Irrelevant sections are skipped, not
// validated — the probe is an inventory, not a linter. (The JSON-only
// constraint in src/init.ts binds the config WRITER; reading TOML is fine.)

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export type CoverageLocation = "parsed" | "unreadable" | "absent";
export type CoverageRouting = "wrapped" | "unwrapped";

export const NO_NATIVE_WRAP_PATH = "no native Reelier wrap path";

export interface CoverageServer {
  name: string;
  /** File the entry was read from. */
  origin: string;
  location: Exclude<CoverageLocation, "absent">;
  transport?: "stdio" | "url";
  /** Undefined when the entry is unreadable — never guessed. */
  routing?: CoverageRouting;
  routingNote?: string;
  /** Why the entry is unreadable. */
  detail?: string;
}

export interface CodexPluginRegistration {
  name: string;
  marketplace: string;
  enabled: boolean;
}

export interface CodexMarketplace {
  name: string;
  source?: string;
  sourceType?: string;
}

export interface CodexConfigAnalysis {
  configPath: string;
  location: CoverageLocation;
  detail?: string;
  servers: CoverageServer[];
  plugins: CodexPluginRegistration[];
  marketplaces: CodexMarketplace[];
}

// ---------------------------------------------------------------------------
// TOML subset reading

type TomlValue = string | number | boolean | Array<string | number | boolean>;

/** Strip a trailing comment that sits outside any quoted string (basic or literal). */
function stripTrailingComment(line: string): string {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote === null && (ch === '"' || ch === "'")) quote = ch;
    else if (quote === '"' && ch === '"' && line[i - 1] !== "\\") quote = null;
    else if (quote === "'" && ch === "'") quote = null;
    else if (ch === "#" && quote === null) return line.slice(0, i);
  }
  return line;
}

function parseBasicString(src: string): string | undefined {
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(src);
  if (!m) return undefined;
  return m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/** Split a single-line array body on top-level commas (basic and literal quotes respected). */
function splitArrayElements(body: string): string[] | undefined {
  const parts: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quote === null && (ch === '"' || ch === "'")) quote = ch;
    else if (quote === '"' && ch === '"' && body[i - 1] !== "\\") quote = null;
    else if (quote === "'" && ch === "'") quote = null;
    if (ch === "," && quote === null) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (quote !== null) return undefined;
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

function parseScalar(src: string): string | number | boolean | undefined {
  const str = parseBasicString(src);
  if (str !== undefined) return str;
  const literal = /^'([^']*)'$/.exec(src);
  if (literal) return literal[1]; // TOML literal string — no escape processing, by definition
  if (src === "true") return true;
  if (src === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(src)) return Number(src);
  return undefined;
}

function parseValue(src: string): TomlValue | undefined {
  const arr = /^\[(.*)\]$/s.exec(src);
  if (arr) {
    const elements = splitArrayElements(arr[1].trim());
    if (elements === undefined) return undefined;
    const values: Array<string | number | boolean> = [];
    for (const element of elements) {
      const value = parseScalar(element);
      if (value === undefined) return undefined;
      values.push(value);
    }
    return values;
  }
  return parseScalar(src);
}

/** Parse a table-header inner text into path segments; quoted segments may contain dots. */
function parseHeaderSegments(inner: string): string[] | undefined {
  const segments: string[] = [];
  let rest = inner.trim();
  while (rest.length > 0) {
    let m = /^"((?:[^"\\]|\\.)*)"\s*(\.|$)/.exec(rest);
    if (m) {
      segments.push(m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
    } else {
      m = /^([A-Za-z0-9_-]+)\s*(\.|$)/.exec(rest);
      if (!m) return undefined;
      segments.push(m[1]);
    }
    rest = rest.slice(m[0].length).trimStart();
  }
  return segments.length > 0 ? segments : undefined;
}

interface RelevantSection {
  segments: string[];
  entries: Record<string, TomlValue>;
  unreadable?: string; // detail when a line inside could not be parsed
}

/**
 * Read the sections the probe cares about out of TOML text. Strict inside
 * relevant sections (a failed line marks that section unreadable and skips to
 * the next header); everything else is ignored without validation.
 */
function readRelevantSections(raw: string): RelevantSection[] {
  const RELEVANT_ROOTS = new Set(["mcp_servers", "plugins", "marketplaces"]);
  const sections: RelevantSection[] = [];
  let current: RelevantSection | undefined;
  let skipping = true; // top-level preamble is irrelevant

  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = stripTrailingComment(lines[i]).trim();
    if (line === "") continue;

    const header = /^\[\s*(.+?)\s*\]$/.exec(line);
    if (header) {
      const segments = parseHeaderSegments(header[1]);
      // Relevant and addressable: exactly [root, name]. Deeper tables (env,
      // http_headers, …) cannot change routing — skipped, not validated.
      if (segments && RELEVANT_ROOTS.has(segments[0]) && segments.length === 2) {
        current = { segments, entries: {} };
        sections.push(current);
        skipping = false;
      } else {
        current = undefined;
        skipping = true;
      }
      continue;
    }

    if (skipping || !current || current.unreadable) continue;

    const eq = /^("(?:[^"\\]|\\.)*"|[A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    const value = eq ? parseValue(eq[2].trim()) : undefined;
    if (!eq || value === undefined) {
      current.unreadable = `line ${i + 1}: ${line.slice(0, 80)}`;
      continue;
    }
    const key = eq[1].startsWith('"') ? (parseBasicString(eq[1]) ?? eq[1]) : eq[1];
    current.entries[key] = value;
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Routing — judged by reading the entry, never assumed

/** True when the token sequence demonstrably invokes `reelier mcp --wrap`. */
export function isWrappedInvocation(tokens: string[]): boolean {
  const normalized = tokens.map((t) => t.trim().toLowerCase().replace(/\.(cmd|exe)$/, ""));
  const idx = normalized.findIndex((t) => t === "reelier" || t.endsWith("/reelier") || t.endsWith("\\reelier"));
  if (idx < 0) return false;
  const rest = normalized.slice(idx + 1);
  const mcpIdx = rest.indexOf("mcp");
  return mcpIdx >= 0 && rest.slice(mcpIdx + 1).includes("--wrap");
}

function serverFromEntries(name: string, origin: string, entries: Record<string, unknown>): CoverageServer {
  const url = typeof entries.url === "string" ? entries.url : undefined;
  const command = typeof entries.command === "string" ? entries.command : undefined;
  if (url !== undefined) {
    return { name, origin, location: "parsed", transport: "url", routing: "unwrapped", routingNote: NO_NATIVE_WRAP_PATH };
  }
  if (command !== undefined) {
    const args = Array.isArray(entries.args) ? entries.args.map(String) : [];
    return {
      name,
      origin,
      location: "parsed",
      transport: "stdio",
      routing: isWrappedInvocation([command, ...args]) ? "wrapped" : "unwrapped",
    };
  }
  return { name, origin, location: "unreadable", detail: "entry has neither a command nor a url" };
}

// ---------------------------------------------------------------------------

/** Analyze a Codex config.toml's raw text (undefined means the file is absent). Pure. */
export function analyzeCodexConfig(raw: string | undefined, configPath: string): CodexConfigAnalysis {
  if (raw === undefined) {
    return { configPath, location: "absent", servers: [], plugins: [], marketplaces: [] };
  }

  const servers: CoverageServer[] = [];
  const plugins: CodexPluginRegistration[] = [];
  const marketplaces: CodexMarketplace[] = [];

  for (const section of readRelevantSections(raw)) {
    const [root, name] = section.segments;
    if (root === "mcp_servers") {
      if (section.unreadable) {
        servers.push({ name, origin: configPath, location: "unreadable", detail: section.unreadable });
      } else {
        servers.push(serverFromEntries(name, configPath, section.entries));
      }
      continue;
    }
    if (section.unreadable) continue; // a busted plugins/marketplaces table has nothing safe to report
    if (root === "plugins") {
      const at = name.lastIndexOf("@");
      plugins.push({
        name: at > 0 ? name.slice(0, at) : name,
        marketplace: at > 0 ? name.slice(at + 1) : "",
        enabled: section.entries.enabled !== false,
      });
    } else if (root === "marketplaces") {
      marketplaces.push({
        name,
        source: typeof section.entries.source === "string" ? section.entries.source : undefined,
        sourceType: typeof section.entries.source_type === "string" ? section.entries.source_type : undefined,
      });
    }
  }

  return { configPath, location: "parsed", servers, plugins, marketplaces };
}

// ---------------------------------------------------------------------------
// Plugin manifests (mcp.json / .mcp.json at a payload root)

export interface PluginManifestAnalysis {
  manifestPath: string;
  location: Exclude<CoverageLocation, "absent">;
  servers: CoverageServer[];
  detail?: string;
}

/** Analyze a plugin's MCP manifest text. Pure. Malformed JSON is unreadable, never guessed at. */
export function analyzePluginManifest(manifestPath: string, raw: string): PluginManifestAnalysis {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { manifestPath, location: "unreadable", servers: [], detail: (err as Error).message };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { manifestPath, location: "unreadable", servers: [], detail: "manifest root is not an object" };
  }
  const root = parsed as Record<string, unknown>;
  // Two real shapes: the Agent Plugins / documented form `{ mcpServers: {...} }`,
  // and the bare root map Claude-format plugin .mcp.json files actually ship
  // (`{ "<server>": { command: ... } }`). A bare map is accepted only when
  // every value looks like a server entry — anything else is unreadable, not
  // guessed at.
  let mcpServers: Record<string, unknown>;
  if (root.mcpServers !== undefined) {
    if (root.mcpServers === null || typeof root.mcpServers !== "object" || Array.isArray(root.mcpServers)) {
      return { manifestPath, location: "unreadable", servers: [], detail: "mcpServers is not an object" };
    }
    mcpServers = root.mcpServers as Record<string, unknown>;
  } else {
    const values = Object.values(root);
    const looksLikeServerMap = values.every(
      (value) =>
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        (typeof (value as Record<string, unknown>).command === "string" || typeof (value as Record<string, unknown>).url === "string"),
    );
    if (!looksLikeServerMap) {
      return { manifestPath, location: "unreadable", servers: [], detail: "no mcpServers object and the root is not a bare server map" };
    }
    mcpServers = root;
  }
  const servers: CoverageServer[] = [];
  for (const [name, entry] of Object.entries(mcpServers)) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      servers.push({ name, origin: manifestPath, location: "unreadable", detail: "entry is not an object" });
      continue;
    }
    servers.push(serverFromEntries(name, manifestPath, entry as Record<string, unknown>));
  }
  return { manifestPath, location: "parsed", servers };
}

// ---------------------------------------------------------------------------
// Collector — the only filesystem toucher, and it only ever reads

export interface PluginCoverage {
  registration: CodexPluginRegistration;
  /** False for disabled registrations — their payloads are not inspected. */
  inspected: boolean;
  /** State of the plugin's MCP manifest: parsed/unreadable, or absent when the payload or manifest could not be located. */
  location: CoverageLocation;
  payloadDir?: string;
  manifestPath?: string;
  /** Payload directories checked, named so "not located" is auditable. */
  candidatesTried: string[];
  servers: CoverageServer[];
  detail?: string;
}

export interface CodexCoverageReport {
  homedir: string;
  configPath: string;
  config: CodexConfigAnalysis;
  plugins: PluginCoverage[];
  /** Every location actually read during this run — the report names these. */
  inspectedLocations: string[];
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Inventory a Codex install's observed MCP surface. Read-only: writes nothing, edits nothing. */
export async function collectCodexCoverage(homedir: string): Promise<CodexCoverageReport> {
  const configPath = path.join(homedir, ".codex", "config.toml");
  const inspectedLocations: string[] = [configPath];

  let raw: string | undefined;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    raw = undefined;
  }
  const config = analyzeCodexConfig(raw, configPath);

  const marketplaceSources = new Map(config.marketplaces.map((m) => [m.name, m.source]));
  const plugins: PluginCoverage[] = [];
  for (const registration of config.plugins) {
    if (!registration.enabled) {
      plugins.push({
        registration,
        inspected: false,
        location: "absent",
        candidatesTried: [],
        servers: [],
        detail: "disabled — payload not inspected",
      });
      continue;
    }

    const candidates: string[] = [];
    const source = marketplaceSources.get(registration.marketplace);
    if (source) candidates.push(path.join(source, registration.name));
    candidates.push(path.join(homedir, ".codex", "plugins", "cache", registration.marketplace, registration.name));
    candidates.push(path.join(homedir, ".codex", "plugins", "cache", registration.name));

    let payloadDir: string | undefined;
    for (const candidate of candidates) {
      if (await isDirectory(candidate)) {
        payloadDir = candidate;
        break;
      }
    }
    if (!payloadDir) {
      plugins.push({
        registration,
        inspected: true,
        location: "absent",
        candidatesTried: candidates,
        servers: [],
        detail: "payload not located",
      });
      continue;
    }

    // Manifest at the payload root, or one level down — the real Codex cache
    // nests a version/channel directory (e.g. <plugin>/local/.mcp.json).
    // Deeper nesting is NOT searched; absence one level down reports absent.
    const manifestDirs = [payloadDir];
    try {
      const children = (await readdir(payloadDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      manifestDirs.push(...children.map((child) => path.join(payloadDir, child)));
    } catch {
      // payload dir unreadable as a directory listing — root-only check below still applies
    }
    let manifestPath: string | undefined;
    let manifestRaw: string | undefined;
    outer: for (const dir of manifestDirs) {
      for (const fileName of ["mcp.json", ".mcp.json"]) {
        const candidate = path.join(dir, fileName);
        try {
          manifestRaw = await readFile(candidate, "utf8");
          manifestPath = candidate;
          break outer;
        } catch {
          // keep looking; a missing manifest is not an error (absence is reported, not invented around)
        }
      }
    }
    if (manifestPath === undefined || manifestRaw === undefined) {
      plugins.push({
        registration,
        inspected: true,
        location: "absent",
        payloadDir,
        candidatesTried: candidates,
        servers: [],
        detail: "no MCP manifest at the payload root or one level below it",
      });
      continue;
    }

    inspectedLocations.push(manifestPath);
    const manifest = analyzePluginManifest(manifestPath, manifestRaw);
    plugins.push({
      registration,
      inspected: true,
      location: manifest.location,
      payloadDir,
      manifestPath,
      candidatesTried: candidates,
      servers: manifest.servers,
      detail: manifest.detail,
    });
  }

  return { homedir, configPath, config, plugins, inspectedLocations };
}

// ---------------------------------------------------------------------------
// Rendering — named denominators; never an overall percentage

function formatServerLine(server: CoverageServer): string {
  if (server.location === "unreadable") return `  ${server.name}  unreadable (${server.detail ?? "could not be parsed"})`;
  if (server.transport === "url") return `  ${server.name}  url  unwrapped — ${NO_NATIVE_WRAP_PATH}`;
  return `  ${server.name}  stdio  ${server.routing}`;
}

function formatPluginLines(plugin: PluginCoverage): string[] {
  const label = `${plugin.registration.name}@${plugin.registration.marketplace}`;
  if (!plugin.inspected) return [`  ${label} — disabled — payload not inspected`];
  if (plugin.location === "absent" && !plugin.payloadDir) {
    return [`  ${label} — enabled — payload not located (tried: ${plugin.candidatesTried.join("; ")})`];
  }
  if (plugin.location === "absent") {
    return [`  ${label} — enabled — no MCP manifest at the payload root or one level below it (${plugin.payloadDir})`];
  }
  if (plugin.location === "unreadable") {
    return [`  ${label} — enabled — manifest unreadable (${plugin.detail ?? plugin.manifestPath})`];
  }
  const lines = [`  ${label} — enabled — ${plugin.servers.length} MCP server(s) in ${plugin.manifestPath}:`];
  for (const server of plugin.servers) lines.push(`  ${formatServerLine(server)}`);
  return lines;
}

/** Render the report. The last line is always the exact inventory disclaimer. */
export function renderCoverageReport(report: CodexCoverageReport): string[] {
  const lines: string[] = ["Observed coverage — host: codex", "", "Inspected:"];
  for (const location of report.inspectedLocations) lines.push(`  ${location}`);
  lines.push("");

  const { config } = report;
  if (config.location === "absent") {
    lines.push(`MCP servers: ${config.configPath} — absent (no configuration found).`);
  } else {
    const parsedEntries = config.servers.filter((s) => s.location === "parsed");
    lines.push(`MCP servers in ${config.configPath}:`);
    for (const server of config.servers) lines.push(formatServerLine(server));
    const wrapped = parsedEntries.filter((s) => s.routing === "wrapped").length;
    const unwrapped = parsedEntries.filter((s) => s.routing === "unwrapped").length;
    const urls = parsedEntries.filter((s) => s.transport === "url").length;
    lines.push(
      `  Observed: ${parsedEntries.length} of ${config.servers.length} entries in ${config.configPath} parsed; ` +
        `${wrapped} wrapped, ${unwrapped} unwrapped${urls > 0 ? ` (${urls} url ${urls === 1 ? "entry" : "entries"}: ${NO_NATIVE_WRAP_PATH})` : ""}.`,
    );
  }
  lines.push("");

  if (report.plugins.length > 0) {
    lines.push(`Plugins (${report.plugins.length} registration(s) in ${config.configPath}):`);
    for (const plugin of report.plugins) lines.push(...formatPluginLines(plugin));
    lines.push("");
  }

  lines.push("Observed inventory only; this is not proof of completeness.");
  return lines;
}
