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
import { knownMcpConfigPaths } from "./init.js";

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
// JSON host configs (.mcp.json at a repo root, ~/.claude.json)

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function serversFromMap(map: Record<string, unknown>, origin: string): CoverageServer[] {
  const servers: CoverageServer[] = [];
  for (const [name, entry] of Object.entries(map)) {
    if (!isPlainObject(entry)) {
      servers.push({ name, origin, location: "unreadable", detail: "entry is not an object" });
      continue;
    }
    servers.push(serverFromEntries(name, origin, entry));
  }
  return servers;
}

/**
 * Analyze a JSON host config (undefined means the file is absent). Pure.
 *
 * Host configs are read through the `mcpServers` key ONLY. The bare-root-map
 * branch `analyzePluginManifest` needs is deliberately absent here: ~/.claude.json
 * is a large object of unrelated keys, so a bare-map reader would decide the
 * whole file is not a server map and report it unreadable — a false negative
 * that looks like honesty. Plugin manifests keep the bare-map branch, where it
 * is correct; host configs do not, where it is not.
 *
 * `projectKey` selects `projects[<key>].mcpServers` instead of the top-level
 * map. The host loads both; `install` (planInstall, src/wrap.ts) rewrites only
 * the top-level one, so the two get separate sources with separate denominators
 * rather than one merged total that would hide install's blind spot.
 */
export function analyzeJsonMcpConfig(raw: string | undefined, configPath: string, projectKey?: string): CoverageSource {
  const sourcePath = projectKey === undefined ? configPath : `${configPath}#projects/${projectKey}`;
  if (raw === undefined) return { path: sourcePath, location: "absent", servers: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { path: sourcePath, location: "unreadable", servers: [], detail: (err as Error).message };
  }
  if (!isPlainObject(parsed)) {
    return { path: sourcePath, location: "unreadable", servers: [], detail: "config root is not an object" };
  }

  let container: Record<string, unknown> = parsed;
  let detail: string | undefined;
  if (projectKey !== undefined) {
    const projects = parsed.projects;
    if (!isPlainObject(projects)) return { path: sourcePath, location: "absent", servers: [] };
    // Only this workspace's entry is read. The siblings are counted rather than
    // parsed so "inspected" keeps meaning "actually read".
    const siblings = Object.keys(projects).filter((key) => key !== projectKey).length;
    detail = `${siblings} sibling project key(s) in ${configPath} were counted, not inspected — only the entry for this workspace was read.`;
    const entry = projects[projectKey];
    if (!isPlainObject(entry)) return { path: sourcePath, location: "absent", servers: [], detail };
    container = entry;
  }

  const mcpServers = container.mcpServers;
  // No mcpServers key is a config that declares no servers — absence, not an
  // error. Reporting it unreadable would invent a problem.
  if (mcpServers === undefined) return { path: sourcePath, location: "parsed", servers: [], detail };
  if (!isPlainObject(mcpServers)) {
    return { path: sourcePath, location: "unreadable", servers: [], detail: "mcpServers is not an object" };
  }
  return { path: sourcePath, location: "parsed", servers: serversFromMap(mcpServers, sourcePath), detail };
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

/**
 * Tri-state on purpose. A host can record a plugin as on, as off, or say
 * nothing at all — and "said nothing" is not "on". Collapsing the third state
 * into a boolean would make the probe assert an enablement it never read,
 * which is the same class of claim the routing field is forbidden from making.
 */
export type PluginEnablementState = "enabled" | "disabled" | "unknown";

export interface PluginEnablement {
  state: PluginEnablementState;
  /** The file (and key) the state was read from, or why no file decided it. */
  source: string;
}

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
  /**
   * Present only for hosts whose enablement is genuinely tri-state. When set it
   * OVERRIDES `registration.enabled`, which is a boolean and therefore cannot
   * represent `unknown`. Codex leaves this undefined and keeps the boolean.
   */
  enablement?: PluginEnablement;
  /** Install scope, when the host records one (user/project/local). */
  scope?: string;
}

/** One config file (or one addressable section of one) that was looked at. */
export interface CoverageSource {
  /** The file, or `<file>#<section>` when a single file holds several independently-loaded server maps. */
  path: string;
  location: CoverageLocation;
  detail?: string;
  servers: CoverageServer[];
}

/** Host-agnostic shape the renderer consumes. Every host collapses to this. */
export interface CoverageView {
  host: string;
  sources: CoverageSource[];
  plugins: PluginCoverage[];
  /** File the plugin registrations were read from. */
  pluginSource?: string;
  /** State of that registry — so an empty plugin list can say WHY it is empty. */
  pluginRegistry?: { location: CoverageLocation; detail?: string };
  /** Every location actually opened during this run — the report names these. */
  inspectedLocations: string[];
  /** Host-specific limits printed above the closing line. Never a percentage. */
  notes?: string[];
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

/**
 * Find an MCP manifest at a payload root, or one level below it — the real
 * caches nest a version/channel directory (`<plugin>/local/.mcp.json`,
 * `<plugin>/2.0.6/.mcp.json`). Deeper nesting is NOT searched: recursive
 * traversal of a plugin tree does not terminate in useful time and the noise it
 * finds is plugin-shaped (npm packages ship their own dot-directories). Absence
 * one level down is reported as absence, never widened into a search.
 *
 * `fileNames` is ordered by host: Codex sees `mcp.json` first, Claude Code sees
 * `.mcp.json` first, which is the only filename observed in that ecosystem.
 */
export async function findPluginManifest(
  payloadDir: string,
  fileNames: string[],
): Promise<{ manifestPath: string; raw: string } | undefined> {
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
  for (const dir of manifestDirs) {
    for (const fileName of fileNames) {
      const candidate = path.join(dir, fileName);
      try {
        return { manifestPath: candidate, raw: await readFile(candidate, "utf8") };
      } catch {
        // keep looking; a missing manifest is not an error (absence is reported, not invented around)
      }
    }
  }
  return undefined;
}

async function readFileOrUndefined(p: string): Promise<string | undefined> {
  try {
    return await readFile(p, "utf8");
  } catch {
    return undefined;
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

    const found = await findPluginManifest(payloadDir, ["mcp.json", ".mcp.json"]);
    const manifestPath = found?.manifestPath;
    const manifestRaw = found?.raw;
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
// Claude Code — host configs (in install's reach) + plugin payloads (not)

/** Filename order matters: `.mcp.json` is the only form observed in this ecosystem; bare `mcp.json` is the Agent Plugins v1.0.0 normative name and is checked second. */
const CLAUDE_CODE_MANIFEST_NAMES = [".mcp.json", "mcp.json"];

interface ClaudeCodeInstall {
  key: string;
  name: string;
  marketplace: string;
  installPath: string;
  scope?: string;
}

/**
 * Where the plugin tree lives, first readable registry wins.
 *
 * NOT VERIFIED: both environment variables are documented but neither exists on
 * the one machine this was measured against. They are implemented from docs.
 * The default is last so a seeded container still falls back to it.
 *
 * Split on `path.delimiter`, never on a hardcoded `:` — on Windows that would
 * shred `C:\Users\...` into two nonexistent roots.
 */
function claudeCodePluginRoots(homedir: string, env: NodeJS.ProcessEnv): string[] {
  const roots: string[] = [];
  const cacheDir = env.CLAUDE_CODE_PLUGIN_CACHE_DIR?.trim();
  if (cacheDir) roots.push(cacheDir);
  const seed = env.CLAUDE_CODE_PLUGIN_SEED_DIR?.trim();
  if (seed) roots.push(...seed.split(path.delimiter).map((entry) => entry.trim()).filter((entry) => entry !== ""));
  roots.push(path.join(homedir, ".claude", "plugins"));
  return roots;
}

/**
 * Presence authority is `installed_plugins.json`, never a walk of the plugin
 * tree. The marketplace catalog clones under `marketplaces/` ship real
 * `.mcp.json` files and contribute zero tools — on the reference machine a walk
 * over-reported by 16 payloads. Orphaned cache version directories survive an
 * uninstall for days and over-report the same way.
 */
function parseInstalledPlugins(raw: string, registryPath: string): { installs: ClaudeCodeInstall[]; unreadable?: string; note?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { installs: [], unreadable: (err as Error).message };
  }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.plugins)) {
    return { installs: [], unreadable: `${registryPath} has no plugins object` };
  }
  const installs: ClaudeCodeInstall[] = [];
  let skipped = 0;
  for (const [key, value] of Object.entries(parsed.plugins)) {
    // One key can carry several installs (different scopes, different paths);
    // each is its own registration because each has its own payload.
    const records = Array.isArray(value) ? value : [value];
    const at = key.lastIndexOf("@");
    for (const record of records) {
      // Counted, not dropped: a registration this reader cannot understand is a
      // hole in the inventory, and a hole that reports nothing looks clean.
      if (!isPlainObject(record) || typeof record.installPath !== "string") {
        skipped++;
        continue;
      }
      installs.push({
        key,
        name: at > 0 ? key.slice(0, at) : key,
        marketplace: at > 0 ? key.slice(at + 1) : "",
        // installPath already ends with the version segment — never re-append
        // one. Observed segments include the literal string "unknown", so it is
        // not safe to treat it as semver either.
        installPath: record.installPath,
        scope: typeof record.scope === "string" ? record.scope : undefined,
      });
    }
  }
  return { installs, note: skipped > 0 ? `${skipped} registration(s) had no readable installPath` : undefined };
}

interface EnablementScope {
  path: string;
  enabledPlugins?: Record<string, unknown>;
}

/**
 * Join the three independent facts. Narrowest scope that carries the key wins.
 *
 * NOT VERIFIED, and this matters: the `false` value was never observed in this
 * registry on the machine that was measured — all enabledPlugins entries there
 * are `true` — and no plugin.json there carried `defaultEnabled`. Both branches
 * below are implemented from documentation.
 *
 * A missing key therefore returns `unknown`, NOT `enabled`. The documented
 * default of true is still an assumption, and this module does not make routing
 * or enablement claims it did not read.
 */
function resolveEnablement(
  key: string,
  scopes: EnablementScope[],
  defaultEnabled?: { value: boolean; source: string },
): PluginEnablement {
  for (const scope of scopes) {
    const value = scope.enabledPlugins?.[key];
    if (typeof value === "boolean") {
      return { state: value ? "enabled" : "disabled", source: `${scope.path} enabledPlugins["${key}"]` };
    }
  }
  if (defaultEnabled) {
    return { state: defaultEnabled.value ? "enabled" : "disabled", source: defaultEnabled.source };
  }
  return { state: "unknown", source: "no enabledPlugins key at any scope and no defaultEnabled in plugin.json" };
}

async function readEnabledPlugins(configPath: string): Promise<EnablementScope> {
  const raw = await readFileOrUndefined(configPath);
  if (raw === undefined) return { path: configPath };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isPlainObject(parsed) && isPlainObject(parsed.enabledPlugins)) {
      return { path: configPath, enabledPlugins: parsed.enabledPlugins };
    }
  } catch {
    // a settings file we cannot parse decides nothing; the next scope is tried
  }
  return { path: configPath };
}

interface PluginJsonManifest {
  path: string;
  defaultEnabled?: boolean;
  mcpServers?: unknown;
  unreadable?: string;
}

async function readPluginJson(installPath: string): Promise<PluginJsonManifest | undefined> {
  const manifestPath = path.join(installPath, ".claude-plugin", "plugin.json");
  const raw = await readFileOrUndefined(manifestPath);
  if (raw === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { path: manifestPath, unreadable: (err as Error).message };
  }
  if (!isPlainObject(parsed)) return { path: manifestPath, unreadable: "plugin.json root is not an object" };
  return {
    path: manifestPath,
    // NOT VERIFIED: zero plugin.json files on the reference machine carry this key.
    defaultEnabled: typeof parsed.defaultEnabled === "boolean" ? parsed.defaultEnabled : undefined,
    mcpServers: parsed.mcpServers,
  };
}

interface PluginJsonServers {
  location: CoverageLocation;
  servers: CoverageServer[];
  detail?: string;
  readPaths: string[];
}

/**
 * `plugin.json` may declare servers inline, or point at one or more in-plugin
 * JSON files. NOT VERIFIED: neither form has an instance on the reference
 * machine; both are documented and both are implemented from documentation.
 */
async function serversFromPluginJson(installPath: string, manifest: PluginJsonManifest): Promise<PluginJsonServers> {
  if (manifest.unreadable) {
    return { location: "unreadable", servers: [], detail: manifest.unreadable, readPaths: [manifest.path] };
  }
  const declared = manifest.mcpServers;
  if (declared === undefined) {
    return { location: "absent", servers: [], detail: "plugin.json declares no mcpServers", readPaths: [manifest.path] };
  }
  if (isPlainObject(declared)) {
    return { location: "parsed", servers: serversFromMap(declared, manifest.path), readPaths: [manifest.path] };
  }

  const pointers = typeof declared === "string" ? [declared] : Array.isArray(declared) ? declared.filter((p): p is string => typeof p === "string") : [];
  if (pointers.length === 0) {
    return { location: "unreadable", servers: [], detail: "mcpServers is neither an object nor a path", readPaths: [manifest.path] };
  }

  const servers: CoverageServer[] = [];
  const readPaths = [manifest.path];
  const failures: string[] = [];
  for (const pointer of pointers) {
    const resolved = path.resolve(installPath, pointer);
    const raw = await readFileOrUndefined(resolved);
    if (raw === undefined) {
      failures.push(`${pointer} could not be read`);
      continue;
    }
    readPaths.push(resolved);
    // Each pointed-at file is itself a manifest, so it may be either root shape.
    const analysis = analyzePluginManifest(resolved, raw);
    if (analysis.location === "unreadable") failures.push(`${pointer}: ${analysis.detail ?? "unreadable"}`);
    servers.push(...analysis.servers);
  }
  const detail = failures.length > 0 ? failures.join("; ") : undefined;
  // Partial success stays `parsed` with the failures named — silently dropping
  // a broken pointer would render as a clean result.
  if (servers.length === 0 && failures.length > 0) return { location: "unreadable", servers, detail, readPaths };
  return { location: "parsed", servers, detail, readPaths };
}

/**
 * Inventory a Claude Code CLI install's observed MCP surface. Read-only.
 *
 * Scope, and the report says so: this is the Claude Code **CLI**. The Claude
 * Desktop / Cowork plugin runtime keeps its own registry, its own enablement
 * key and its own manifest layout somewhere else entirely; its servers appear
 * in none of the files read here. Folding it in would make this a completeness
 * claim about a host it never opened.
 */
export async function collectClaudeCodeCoverage(
  cwd: string,
  homedir: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CoverageView> {
  const inspectedLocations: string[] = [];
  const sources: CoverageSource[] = [];

  // Group A — the configs `install` can reach. Derived from the same list that
  // drives the config WRITER, so the probe and `install` cannot drift apart
  // silently; that drift is the exact failure this probe exists to expose.
  const hostConfigs = knownMcpConfigPaths(cwd, homedir).filter((config) => config.label.startsWith("Claude Code"));
  for (const config of hostConfigs) {
    inspectedLocations.push(config.path);
    const raw = await readFileOrUndefined(config.path);
    sources.push(analyzeJsonMcpConfig(raw, config.path));
    // D-6: the host also loads projects[<cwd>].mcpServers from ~/.claude.json,
    // which planInstall (src/wrap.ts) never rewrites. Reporting only what
    // install touches would match install's blind spot and turn the closing
    // disclaimer into a fig leaf, so it gets its own source and its own
    // denominator. Only emitted when the file itself was readable — a second
    // "absent" line for a file already reported absent is noise, not honesty.
    if (config.label === "Claude Code (user)" && raw !== undefined) {
      sources.push(analyzeJsonMcpConfig(raw, config.path, cwd));
    }
  }

  // Group B — plugin-delivered, outside install's reach (§7.6).
  const roots = claudeCodePluginRoots(homedir, env);
  let pluginSource = path.join(roots[0], "installed_plugins.json");
  let registryRaw: string | undefined;
  for (const root of roots) {
    const candidate = path.join(root, "installed_plugins.json");
    const raw = await readFileOrUndefined(candidate);
    if (raw !== undefined) {
      pluginSource = candidate;
      registryRaw = raw;
      break;
    }
  }
  inspectedLocations.push(pluginSource);

  const plugins: PluginCoverage[] = [];
  let pluginRegistry: { location: CoverageLocation; detail?: string };
  if (registryRaw === undefined) {
    pluginRegistry = { location: "absent", detail: "no plugin registry found" };
  } else {
    const { installs, unreadable, note } = parseInstalledPlugins(registryRaw, pluginSource);
    pluginRegistry = unreadable
      ? { location: "unreadable", detail: unreadable }
      : { location: "parsed", detail: note ?? (installs.length === 0 ? "no plugin registrations" : undefined) };

    // Narrowest scope first. NOT VERIFIED: the two project-scoped files have
    // zero instances on the reference machine and come from documentation.
    const scopes: EnablementScope[] = [];
    for (const scopePath of [
      path.join(cwd, ".claude", "settings.local.json"),
      path.join(cwd, ".claude", "settings.json"),
      path.join(homedir, ".claude", "settings.json"),
    ]) {
      inspectedLocations.push(scopePath);
      scopes.push(await readEnabledPlugins(scopePath));
    }

    for (const install of installs) {
      // installPath is absolute in every observed registry; resolve() leaves an
      // absolute path untouched and anchors a relative one at the plugin root.
      const payloadDir = path.resolve(path.dirname(pluginSource), install.installPath);
      // plugin.json is read before the enablement verdict because defaultEnabled
      // lives in it. That is manifest metadata, not server enumeration — the
      // "payload not inspected" claim below is about the latter.
      const pluginJson = await readPluginJson(payloadDir);
      const enablement = resolveEnablement(
        install.key,
        scopes,
        pluginJson?.defaultEnabled === undefined ? undefined : { value: pluginJson.defaultEnabled, source: `${pluginJson.path} defaultEnabled` },
      );
      const registration: CodexPluginRegistration = {
        name: install.name,
        marketplace: install.marketplace,
        // Boolean legacy field, kept for the Codex shape. It cannot express
        // `unknown`, which is why `enablement` exists and why the renderer
        // prefers it; `unknown` maps to false here so nothing downstream that
        // reads the boolean alone can mistake it for a positive claim.
        enabled: enablement.state === "enabled",
      };

      if (enablement.state === "disabled") {
        plugins.push({
          registration,
          enablement,
          scope: install.scope,
          inspected: false,
          location: "absent",
          candidatesTried: [],
          servers: [],
          detail: "disabled — payload not inspected",
        });
        continue;
      }

      if (!(await isDirectory(payloadDir))) {
        plugins.push({
          registration,
          enablement,
          scope: install.scope,
          inspected: true,
          location: "absent",
          candidatesTried: [payloadDir],
          servers: [],
          detail: "payload not located",
        });
        continue;
      }

      const found = await findPluginManifest(payloadDir, CLAUDE_CODE_MANIFEST_NAMES);
      if (found) {
        inspectedLocations.push(found.manifestPath);
        const manifest = analyzePluginManifest(found.manifestPath, found.raw);
        plugins.push({
          registration,
          enablement,
          scope: install.scope,
          inspected: true,
          location: manifest.location,
          payloadDir,
          manifestPath: found.manifestPath,
          candidatesTried: [payloadDir],
          servers: manifest.servers,
          detail: manifest.detail,
        });
        continue;
      }

      if (pluginJson) {
        // A standalone manifest wins when both exist. This under-claims rather
        // than merging two files that may declare the same server twice; the
        // closing line already disclaims completeness, so under-claiming is the
        // safe direction and double-counting is not.
        const fromPluginJson = await serversFromPluginJson(payloadDir, pluginJson);
        inspectedLocations.push(...fromPluginJson.readPaths);
        plugins.push({
          registration,
          enablement,
          scope: install.scope,
          inspected: true,
          location: fromPluginJson.location,
          payloadDir,
          manifestPath: pluginJson.path,
          candidatesTried: [payloadDir],
          servers: fromPluginJson.servers,
          detail: fromPluginJson.detail,
        });
        continue;
      }

      plugins.push({
        registration,
        enablement,
        scope: install.scope,
        inspected: true,
        location: "absent",
        payloadDir,
        candidatesTried: [payloadDir],
        servers: [],
        detail: "no MCP manifest at the payload root or one level below it",
      });
    }
  }

  return {
    host: "claude-code",
    sources,
    plugins,
    pluginSource,
    pluginRegistry,
    inspectedLocations,
    notes: [
      "Plugin-delivered servers load from the plugin's own manifest, not from a config `reelier install` rewrites; listing one here is not a claim that it is covered.",
      "Session plugins loaded with --plugin-dir or --plugin-url are recorded in no file and cannot be inventoried from disk.",
      "Claude Code CLI only. Claude Desktop / Cowork plugins are a separate host with a separate registry and were not inspected.",
    ],
  };
}

// ---------------------------------------------------------------------------
// Rendering — named denominators; never an overall percentage

function formatServerLine(server: CoverageServer): string {
  if (server.location === "unreadable") return `  ${server.name}  unreadable (${server.detail ?? "could not be parsed"})`;
  if (server.transport === "url") return `  ${server.name}  url  unwrapped — ${NO_NATIVE_WRAP_PATH}`;
  return `  ${server.name}  stdio  ${server.routing}`;
}

/**
 * `enablement` wins when present because it is the only field that can say
 * `unknown`. Never render `unknown` as `enabled` — a host that told us nothing
 * is not a host that told us yes.
 */
function formatEnablement(plugin: PluginCoverage): string {
  const state = plugin.enablement?.state ?? (plugin.registration.enabled ? "enabled" : "disabled");
  return state === "unknown" ? "enablement unknown" : state;
}

function formatPluginLines(plugin: PluginCoverage): string[] {
  const scope = plugin.scope ? ` [${plugin.scope}]` : "";
  const label = `${plugin.registration.name}@${plugin.registration.marketplace}${scope}`;
  const state = formatEnablement(plugin);
  // Sourced only when the host gives a tri-state; Codex renders as before.
  const sourced = plugin.enablement ? `${state} (${plugin.enablement.source})` : state;
  // The verdict that SUPPRESSES inspection is the one most worth being able to
  // check, so it names its source too. Codex has no enablement source and
  // renders exactly as before.
  if (!plugin.inspected) return [`  ${label} — ${sourced} — payload not inspected`];
  if (plugin.location === "absent" && !plugin.payloadDir) {
    return [`  ${label} — ${sourced} — payload not located (tried: ${plugin.candidatesTried.join("; ")})`];
  }
  if (plugin.location === "absent") {
    return [`  ${label} — ${sourced} — ${plugin.detail ?? "no MCP manifest at the payload root or one level below it"} (${plugin.payloadDir})`];
  }
  if (plugin.location === "unreadable") {
    return [`  ${label} — ${sourced} — manifest unreadable (${plugin.detail ?? plugin.manifestPath})`];
  }
  const lines = [`  ${label} — ${sourced} — ${plugin.servers.length} MCP server(s) in ${plugin.manifestPath}:`];
  for (const server of plugin.servers) {
    // A pointer manifest declares servers that live in another file; naming it
    // keeps the origin honest instead of implying they sit in the declaring one.
    const elsewhere = server.origin !== plugin.manifestPath ? `  (${server.origin})` : "";
    lines.push(`  ${formatServerLine(server)}${elsewhere}`);
  }
  if (plugin.detail && plugin.location === "parsed") lines.push(`    note: ${plugin.detail}`);
  return lines;
}

function formatSourceLines(source: CoverageSource): string[] {
  if (source.location === "absent") {
    // The detail suffix carries facts an absent section still knows — e.g. how
    // many sibling project keys existed but were not read.
    return [`MCP servers: ${source.path} — absent (no configuration found).${source.detail ? ` ${source.detail}` : ""}`];
  }
  if (source.location === "unreadable") {
    return [`MCP servers: ${source.path} — unreadable (${source.detail ?? "could not be parsed"}).`];
  }
  const parsedEntries = source.servers.filter((s) => s.location === "parsed");
  const lines = [`MCP servers in ${source.path}:`];
  for (const server of source.servers) lines.push(formatServerLine(server));
  const wrapped = parsedEntries.filter((s) => s.routing === "wrapped").length;
  const unwrapped = parsedEntries.filter((s) => s.routing === "unwrapped").length;
  const urls = parsedEntries.filter((s) => s.transport === "url").length;
  lines.push(
    `  Observed: ${parsedEntries.length} of ${source.servers.length} entries in ${source.path} parsed; ` +
      `${wrapped} wrapped, ${unwrapped} unwrapped${urls > 0 ? ` (${urls} url ${urls === 1 ? "entry" : "entries"}: ${NO_NATIVE_WRAP_PATH})` : ""}.`,
  );
  if (source.detail) lines.push(`  ${source.detail}`);
  return lines;
}

/**
 * Render a host-agnostic view. One denominator per file and never an overall
 * percentage: a single total across in-reach and out-of-reach surfaces would
 * read as a coverage score, which this probe does not compute. The last line is
 * always the exact inventory disclaimer.
 */
export function renderCoverageView(view: CoverageView): string[] {
  const lines: string[] = [`Observed coverage — host: ${view.host}`, "", "Inspected:"];
  for (const location of view.inspectedLocations) lines.push(`  ${location}`);
  lines.push("");

  for (const source of view.sources) {
    lines.push(...formatSourceLines(source));
    lines.push("");
  }

  if (view.plugins.length > 0) {
    lines.push(`Plugins (${view.plugins.length} registration(s) in ${view.pluginSource}):`);
    for (const plugin of view.plugins) lines.push(...formatPluginLines(plugin));
    if (view.pluginRegistry?.detail) lines.push(`  note: ${view.pluginRegistry.detail}`);
    lines.push("");
  } else if (view.pluginRegistry) {
    // An empty plugin list must say why it is empty; printing nothing here
    // would make an unread registry indistinguishable from a clean result.
    const { location, detail } = view.pluginRegistry;
    lines.push(`Plugins: ${view.pluginSource} — ${location}${detail ? ` (${detail})` : ""}.`);
    lines.push("");
  }

  for (const note of view.notes ?? []) lines.push(note);
  if (view.notes && view.notes.length > 0) lines.push("");

  lines.push("Observed inventory only; this is not proof of completeness.");
  return lines;
}

/**
 * Codex adapter. It exists as an adapter rather than a second renderer so that
 * "the Codex output did not move" is a mechanical property of the code and not
 * a claim someone has to re-check by eye.
 */
export function renderCoverageReport(report: CodexCoverageReport): string[] {
  const { config } = report;
  return renderCoverageView({
    host: "codex",
    sources: [{ path: config.configPath, location: config.location, detail: config.detail, servers: config.servers }],
    plugins: report.plugins,
    pluginSource: config.configPath,
    inspectedLocations: report.inspectedLocations,
  });
}
