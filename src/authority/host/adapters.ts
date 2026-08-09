export type SupportedAuthorityHost = "codex" | "claude-code" | "cursor" | "eve" | "hermes" | "openclaw";
export interface AuthorityHostAdapter { readonly host: SupportedAuthorityHost; readonly configFile: string; readonly mcp: Readonly<Record<string, unknown>>; }

/** Thin, host-neutral setup metadata. No runtime imports from any agent host are required. */
export function createAuthorityHostAdapters(command = "reelier authority serve"): readonly AuthorityHostAdapter[] {
  const hosts: readonly [SupportedAuthorityHost, string][] = [["codex", "~/.codex/config.toml"], ["claude-code", "~/.claude.json"], ["cursor", "~/.cursor/mcp.json"], ["eve", "connections/reelier.ts"], ["hermes", "~/.hermes/mcp.json"], ["openclaw", "~/.openclaw/mcp.json"]];
  return Object.freeze(hosts.map(([host, configFile]) => Object.freeze({ host, configFile, mcp: Object.freeze({ command, args: ["--stdio"] }) })));
}
