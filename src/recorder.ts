// The proxy recorder: an MCP server (on stdio, via `reelier mcp`) that sits
// between an agent and one or more downstream MCP servers. It re-exposes
// downstream tools 1:1 as pure passthrough (never touches the live path) and
// adds three control tools that, while recording, write a lossless JSONL
// trace of every call. No interpretation happens here — that's the
// (not-yet-built) compiler's job.

import { mkdir, readdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildToolRoutes, type DownstreamConnection, type McpCallResult, type ToolRoute } from "./mcp-client.js";
import { redact } from "./redact.js";
import type { ToolEffectAnnotations } from "./effect-verbs.js";
import { digestSha256 } from "./canonical-json.js";
import type { ManifestTool } from "./skill.js";
import {
  LiveProvenanceIndex,
  addressableMcpResultBody,
  capNameList,
  type LeafResolution,
} from "./provenance.js";
import { ABSENT_FIELDS_MAX, ABSENT_FIELD_NAME_MAX } from "./expect-mac.js";
import {
  emptyPolicy,
  evaluatePolicy,
  findUnmatchedToolRules,
  formatUnmatchedToolRuleWarnings,
  withUnmatchedRules,
  type Policy,
  type PolicyRecord,
} from "./policy.js";

export type TraceRecord =
  | {
      t: "meta";
      seq: number;
      name: string;
      startedAt: string;
      wrapped: string[];
      /**
       * MCP tools/list annotation hints (readOnlyHint / destructiveHint /
       * idempotentHint) per EXPOSED tool name, captured at recording start.
       * Additive/optional: omitted entirely when no wrapped tool declares any
       * of the three hints, so annotation-free traces are byte-identical to
       * pre-0.13 ones. Hints, not security — see classifyEffect's trust ladder.
       */
      toolAnnotations?: Record<string, ToolEffectAnnotations>;
      /**
       * SUPERSEDED by `policy` below (docs/specs/policy-attestation-v1.md
       * §3.1). Still PARSED forever — traces on operators' disks predate the
       * replacement — but never WRITTEN: a writer emits `policy` or
       * (historically) `policyGap`, never both. `parseTraceLines` normalizes
       * a bare `policyGap` to `{ status: "failed" }` on read, so no consumer
       * downstream of the reader has to know this field existed.
       *
       * Set only when the active policy.yml failed to parse at wrap start —
       * one condition of four, carrying no digest, no source and no counts.
       */
      policyGap?: string;
      /**
       * The policy governing THIS RECORDING (§2). Describes the recording
       * session and nothing else: a skill compiled from this trace carries
       * NO policy field, and a later replay's RunRecord reports the policy
       * in force at THAT run. Inheriting this one would fabricate a claim
       * about the present out of the past (§3).
       *
       * Omitted entirely by callers that pass nothing, so pre-policy traces
       * stay byte-identical. Its ABSENCE means "written before this field
       * existed" — never `absent`, which is a positive finding.
       */
      policy?: PolicyRecord;
      /**
       * Per-EXPOSED-tool schema digests, captured at wrap time — the source
       * material for Skill.manifest (docs/specs/flight-recorder-v2.md §1).
       * Omitted entirely when empty so manifest-free traces stay
       * byte-identical to pre-v2 ones.
       */
      toolManifest?: ManifestTool[];
      /**
       * Fail-open gap marker (Prime Directive): exposed tool names whose
       * inputSchema could not be digested (e.g. a circular/exotic schema
       * value). Capture must never throw out of the proxy path — a tool
       * that can't be digested is simply omitted from toolManifest and
       * named here instead.
       */
      manifestGap?: string[];
    }
  | { t: "note"; seq: number; ts: string; text: string }
  | { t: "call"; seq: number; i: number; ts: string; tool: string; args: unknown }
  | {
      t: "prov";
      seq: number;
      i: number;
      resolved?: Array<{ path: string; via: "exact" | "normalized"; from: { call: number; at: string } }>;
      authored?: string[];
      unresolved?: Array<{ path: string; reason: string }>;
      truncated?: Partial<Record<"resolved" | "authored" | "unresolved", number>>;
    }
  | {
      t: "result";
      seq: number;
      i: number;
      ok: boolean;
      ms: number;
      body: unknown;
      /** Set (true) only when this call was blocked by policy — never present on an allowed call. */
      denied?: boolean;
      /** Set (true) only when this call was intercepted by a dry_run rule — never present on a real call. Never let a dry-run step read as a real one (never-lies). */
      dryRun?: boolean;
      /** Human-readable rule description, present alongside denied/dryRun. */
      rule?: string;
    };

function textResult(text: string): McpCallResult {
  return { content: [{ type: "text", text }] };
}

/** Hard memory bound for the live, hash-only response index. */
export const LIVE_PROVENANCE_LEAF_CAP = 4096;

function clipProvName(name: string): string {
  return name.length > ABSENT_FIELD_NAME_MAX ? name.slice(0, ABSENT_FIELD_NAME_MAX) : name;
}

/**
 * Owns recording state + the append-only trace file. All writes are
 * serialized through a promise chain so concurrent tool calls can never
 * interleave out of seq order — order in the file IS the association.
 */
export class Recorder {
  /** Hash-only and process-local; reset for every recording window. */
  private provenance = new LiveProvenanceIndex(LIVE_PROVENANCE_LEAF_CAP);
  private traceDir: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private recording = false;
  private currentPath: string | null = null;
  private currentName: string | null = null;
  private seq = 0;
  private callIndex = 0;
  private callCount = 0;

  constructor(traceDir: string) {
    this.traceDir = traceDir;
  }

  get isRecording(): boolean {
    return this.recording;
  }

  private nextSeq(): number {
    return this.seq++;
  }

  private write(record: TraceRecord): void {
    if (!this.currentPath) return;
    const filePath = this.currentPath;
    this.writeQueue = this.writeQueue.then(() => appendFile(filePath, JSON.stringify(record) + "\n", "utf8"));
  }

  private async flush(): Promise<void> {
    await this.writeQueue;
  }

  /** Pick the next `<name>-<n>.jsonl` path such that no existing trace is ever overwritten. */
  private async nextTracePath(name: string): Promise<string> {
    await mkdir(this.traceDir, { recursive: true });
    let entries: string[] = [];
    try {
      entries = await readdir(this.traceDir);
    } catch {
      entries = [];
    }
    const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)\\.jsonl$`);
    let maxN = 0;
    for (const entry of entries) {
      const m = entry.match(re);
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    }
    return path.join(this.traceDir, `${name}-${maxN + 1}.jsonl`);
  }

  async start(
    name: string,
    wrapped: string[],
    toolAnnotations?: Record<string, ToolEffectAnnotations>,
    policy?: PolicyRecord,
    toolManifest?: ManifestTool[],
    manifestGap?: string[]
  ): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
    if (this.recording) {
      return {
        ok: false,
        message: `Already recording "${this.currentName}" to ${this.currentPath}. Call reelier_stop_recording first.`,
      };
    }
    const filePath = await this.nextTracePath(name);
    this.currentPath = filePath;
    this.currentName = name;
    this.seq = 0;
    this.callIndex = 0;
    this.callCount = 0;
    this.provenance = new LiveProvenanceIndex(LIVE_PROVENANCE_LEAF_CAP);
    this.recording = true;
    this.write({
      t: "meta",
      seq: this.nextSeq(),
      name,
      startedAt: new Date().toISOString(),
      wrapped,
      // Omit the key entirely when nothing is annotated — annotation-free
      // traces stay byte-identical to older ones.
      ...(toolAnnotations && Object.keys(toolAnnotations).length > 0 ? { toolAnnotations } : {}),
      ...(policy ? { policy } : {}),
      ...(toolManifest && toolManifest.length > 0 ? { toolManifest } : {}),
      ...(manifestGap && manifestGap.length > 0 ? { manifestGap } : {}),
    });
    await this.flush();
    return { ok: true, path: filePath };
  }

  note(text: string): { ok: true } | { ok: false; message: string } {
    if (!this.recording) {
      return { ok: false, message: `Not recording — call reelier_start_recording first. Note ignored: ${text}` };
    }
    this.write({ t: "note", seq: this.nextSeq(), ts: new Date().toISOString(), text });
    return { ok: true };
  }

  /** Record a call (before it's dispatched downstream). Returns the call index shared with the matching result. */
  recordCall(tool: string, args: unknown): number {
    const i = this.callIndex++;
    this.callCount++;
    this.write({ t: "call", seq: this.nextSeq(), i, ts: new Date().toISOString(), tool, args: redact(args) });
    return i;
  }

  /** Record the pre-dispatch lineage measurement for a call that WILL dispatch. */
  recordProvenance(i: number, args: unknown): void {
    let rows: LeafResolution[];
    try {
      rows = this.provenance.resolve(args);
    } catch {
      // Provenance is record-only. A measurement failure must never become a
      // dispatch refusal at the live proxy boundary.
      this.write({
        t: "prov",
        seq: this.nextSeq(),
        i,
        unresolved: [{ path: "args", reason: "measurement-failed" }],
      });
      return;
    }
    const resolvedRows = rows.filter(
      (row): row is Extract<LeafResolution, { state: "grounded" }> => row.state === "grounded"
    );
    const authoredRows = rows.filter(
      (row): row is Extract<LeafResolution, { state: "authored" }> => row.state === "authored"
    );
    const unresolvedRows = rows.filter(
      (row): row is Extract<LeafResolution, { state: "unresolved" }> => row.state === "unresolved"
    );
    const resolved = resolvedRows.slice(0, ABSENT_FIELDS_MAX).map((row) => ({
      path: clipProvName(row.path),
      via: row.via,
      from: { call: Number(row.from.source.slice(1)), at: clipProvName(row.from.at) },
    }));
    const authoredCap = capNameList(authoredRows.map((row) => row.path));
    const unresolved = unresolvedRows.slice(0, ABSENT_FIELDS_MAX).map((row) => ({
      path: clipProvName(row.path),
      reason: row.reason,
    }));
    const truncated = {
      ...(resolvedRows.length > resolved.length ? { resolved: resolvedRows.length - resolved.length } : {}),
      ...(authoredCap.truncated ? { authored: authoredCap.truncated } : {}),
      ...(unresolvedRows.length > unresolved.length ? { unresolved: unresolvedRows.length - unresolved.length } : {}),
    };
    this.write({
      t: "prov",
      seq: this.nextSeq(),
      i,
      ...(resolved.length > 0 ? { resolved } : {}),
      ...(authoredCap.names.length > 0 ? { authored: authoredCap.names } : {}),
      ...(unresolved.length > 0 ? { unresolved } : {}),
      ...(Object.keys(truncated).length > 0 ? { truncated } : {}),
    });
  }

  recordResult(i: number, ok: boolean, ms: number, body: unknown): void {
    this.write({ t: "result", seq: this.nextSeq(), i, ok, ms, body: redact(body) });
    if (!ok) return;
    const value = addressableMcpResultBody(body);
    if (value === undefined) this.provenance.addGap(`#${i}`);
    else {
      try {
        this.provenance.addSource(`#${i}`, value);
      } catch {
        // The downstream result still returns verbatim. Only the index loses a
        // source, which is represented as a gap on every later miss.
        this.provenance.addGap(`#${i}`);
      }
    }
  }

  /** Record a call the policy DENIED — never dispatched downstream. `body` is the structured error handed back to the agent. */
  recordDenied(i: number, ms: number, body: unknown, rule: string): void {
    this.write({ t: "result", seq: this.nextSeq(), i, ok: false, ms, body: redact(body), denied: true, rule });
  }

  /** Record a call a dry_run rule intercepted — never dispatched downstream. `body` is the synthetic success handed back to the agent. */
  recordDryRun(i: number, ms: number, body: unknown, rule: string): void {
    this.write({ t: "result", seq: this.nextSeq(), i, ok: true, ms, body: redact(body), dryRun: true, rule });
  }

  async stop(): Promise<{ ok: true; path: string; callCount: number } | { ok: false; message: string }> {
    if (!this.recording) {
      return { ok: false, message: "Not recording — nothing to stop." };
    }
    await this.flush();
    const result = { ok: true as const, path: this.currentPath!, callCount: this.callCount };
    this.recording = false;
    this.currentPath = null;
    this.currentName = null;
    return result;
  }
}

const CONTROL_TOOL_DESCRIPTIONS: Record<string, string> = {
  reelier_start_recording:
    "Begin recording the tool calls you're ABOUT to make as a Reelier trace — it captures only calls made " +
    "after this, so you cannot record work retroactively. If the workflow already happened earlier this " +
    "session, do NOT re-do it just to record it — compile it straight from history instead " +
    "(reelier_from_session, or the `reelier serve` scan→from_session path). Otherwise: call reelier_note " +
    "before each logical step to narrate intent, then call the tools you'd normally call — they pass " +
    "through unchanged and are logged. Call reelier_stop_recording when done.",
  reelier_note:
    "Narrate what you're about to do, in one sentence (e.g. \"I'm about to pull this week's " +
    "bookings\"). No-op if not currently recording.",
  reelier_stop_recording: "Stop the current recording and return the trace file path + how many calls were logged.",
};

export interface ProxyServerOptions {
  traceDir: string;
  /** The seatbelt (spec §1). Omitted/undefined behaves exactly like the empty policy — everything allowed, no enforcement overhead beyond the (cheap) empty-array checks. */
  policy?: Policy;
  /**
   * The four-state claim about the policy file that produced `policy`,
   * carried into the trace meta record (docs/specs/policy-attestation-v1.md
   * §2). Supersedes the old `policyGap` string, which marked only the
   * malformed case. Omitted → the meta record carries no `policy` key and
   * the trace stays byte-identical to a pre-policy one.
   */
  policyRecord?: PolicyRecord;
  /** Whether this wrap process was started with --allow-writes — the one `unless` escape flag deny rules can reference. */
  allowWrites?: boolean;
}

/**
 * Capture each routed tool's effect-relevant annotation hints from its
 * downstream tools/list entry, keyed by EXPOSED name (post collision-prefixing
 * — the same name `call` records carry, so the compiler's lookup matches).
 * Only the three hints classifyEffect consults are kept, and only when the
 * downstream actually declared at least one — never fabricated defaults.
 */
export function collectToolAnnotations(routes: Map<string, ToolRoute>): Record<string, ToolEffectAnnotations> {
  const out: Record<string, ToolEffectAnnotations> = {};
  for (const route of routes.values()) {
    const a = route.tool.annotations;
    if (!a) continue;
    const hints: ToolEffectAnnotations = {};
    if (typeof a.readOnlyHint === "boolean") hints.readOnlyHint = a.readOnlyHint;
    if (typeof a.destructiveHint === "boolean") hints.destructiveHint = a.destructiveHint;
    if (typeof a.idempotentHint === "boolean") hints.idempotentHint = a.idempotentHint;
    if (Object.keys(hints).length > 0) out[route.exposedName] = hints;
  }
  return out;
}

/**
 * Capture a per-tool schema digest at wrap time, keyed by EXPOSED name (same
 * key space as collectToolAnnotations and as replay's tool lookup) — the
 * source material for Skill.manifest (docs/specs/flight-recorder-v2.md §1).
 *
 * Fail-open (Prime Directive): if a tool's inputSchema cannot be digested
 * (e.g. it contains a circular reference), that tool is OMITTED from the
 * manifest and its exposed name is appended to `gap` instead — capture must
 * never throw out of the proxy path.
 */
export function collectToolManifest(routes: Map<string, ToolRoute>): { manifest: ManifestTool[]; gap: string[] } {
  const manifest: ManifestTool[] = [];
  const gap: string[] = [];
  for (const route of routes.values()) {
    try {
      const digest = digestSha256(route.tool.inputSchema);
      manifest.push({ name: route.exposedName, server: route.downstream.name, digest });
    } catch {
      gap.push(route.exposedName);
    }
  }
  return { manifest, gap };
}

/**
 * Build (but do not connect) the proxy MCP server for a set of already-
 * connected downstreams. Pure/testable — connecting a transport is the
 * caller's job (stdio for the real CLI, InMemory for tests).
 */
export function buildProxyServer(downstreams: DownstreamConnection[], options: ProxyServerOptions): Server {
  const routes = buildToolRoutes(downstreams);
  const recorder = new Recorder(options.traceDir);
  const toolAnnotations = collectToolAnnotations(routes);
  const { manifest: toolManifest, gap: manifestGap } = collectToolManifest(routes);
  const policy = options.policy ?? emptyPolicy();
  const policyCtx = { allowWrites: options.allowWrites ?? false };

  // N1 hardening: a deny/dry_run TOOL rule matching none of the tools this
  // wrap session actually exposes is almost always a typo or a missed
  // collision-rename prefix — warn once, at wrap start, naming the rule and
  // a sample of what IS available. Read-only and cheap (computed once from
  // already-built routes), so it always runs.
  const availableToolNames = [...routes.keys()];
  for (const line of formatUnmatchedToolRuleWarnings(findUnmatchedToolRules(policy, availableToolNames), availableToolNames)) {
    console.error(line);
  }
  // The same computation, carried into the record instead of only to stderr
  // (docs/specs/policy-attestation-v1.md §2.3). This is the ONLY place with
  // a live tool inventory, which is why the count exists on the wrap path
  // and never on a RunRecord (§2.4). Counts only — the offending globs stay
  // on the terminal, where the reader is the operator; a record is a
  // publishable artifact and a glob is an internal tool name.
  const policyRecord = options.policyRecord ? withUnmatchedRules(options.policyRecord, policy, availableToolNames) : undefined;

  const server = new Server({ name: "reelier-proxy", version: "0.0.1" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [
      ...Array.from(routes.values()).map((route: ToolRoute) => ({
        name: route.exposedName,
        description: route.tool.description,
        inputSchema: route.tool.inputSchema as { type: "object"; [k: string]: unknown },
      })),
      {
        name: "reelier_start_recording",
        description: CONTROL_TOOL_DESCRIPTIONS.reelier_start_recording,
        inputSchema: { type: "object" as const, properties: { name: { type: "string" } }, required: ["name"] },
      },
      {
        name: "reelier_note",
        description: CONTROL_TOOL_DESCRIPTIONS.reelier_note,
        inputSchema: { type: "object" as const, properties: { text: { type: "string" } }, required: ["text"] },
      },
      {
        name: "reelier_stop_recording",
        description: CONTROL_TOOL_DESCRIPTIONS.reelier_stop_recording,
        inputSchema: { type: "object" as const, properties: {} },
      },
    ];
    return { tools };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<Record<string, unknown>> => {
    const { name, arguments: args } = request.params;

    if (name === "reelier_start_recording") {
      const traceName = (args as Record<string, unknown> | undefined)?.name;
      if (typeof traceName !== "string" || !traceName) {
        return { ...textResult("reelier_start_recording requires a string 'name' argument."), isError: true };
      }
      const wrapped = downstreams.map((d) => d.name);
      const result = await recorder.start(traceName, wrapped, toolAnnotations, policyRecord, toolManifest, manifestGap);
      return result.ok ? textResult(`Recording started: ${result.path}`) : textResult(result.message);
    }

    if (name === "reelier_note") {
      const text = (args as Record<string, unknown> | undefined)?.text;
      if (typeof text !== "string" || !text) {
        return { ...textResult("reelier_note requires a string 'text' argument."), isError: true };
      }
      const result = recorder.note(text);
      return result.ok ? textResult(`Noted: ${text}`) : textResult(result.message);
    }

    if (name === "reelier_stop_recording") {
      const result = await recorder.stop();
      return result.ok
        ? textResult(`Recording stopped: ${result.path} (${result.callCount} calls)`)
        : textResult(result.message);
    }

    const route = routes.get(name);
    if (!route) {
      return { ...textResult(`Unknown tool: ${name}`), isError: true };
    }

    const isRecording = recorder.isRecording;
    const started = Date.now();

    // Policy enforcement — the chokepoint. Evaluated BEFORE the call is
    // dispatched downstream so a deny/dry_run rule never lets the real
    // effect happen. Precedence (spec §1): deny > dry_run > allow.
    const verdict = evaluatePolicy(policy, name, args, policyCtx);

    if (verdict.verdict === "deny") {
      const message = `blocked by reelier policy: ${verdict.description}`;
      const body = { ...textResult(message), isError: true };
      if (isRecording) {
        const callIndex = recorder.recordCall(name, args);
        recorder.recordDenied(callIndex, Date.now() - started, body, verdict.description);
      }
      return body;
    }

    if (verdict.verdict === "dry_run") {
      const body = textResult(`[DRY-RUN] ${name} — matched policy rule ${verdict.description}; no call was forwarded downstream.`);
      if (isRecording) {
        const callIndex = recorder.recordCall(name, args);
        recorder.recordDryRun(callIndex, Date.now() - started, body, verdict.description);
      }
      return body;
    }

    const callIndex = isRecording ? recorder.recordCall(name, args) : -1;
    if (isRecording) recorder.recordProvenance(callIndex, args);
    let result: McpCallResult;
    let ok = true;
    try {
      result = await route.downstream.call(route.realName, args);
      ok = !result.isError;
    } catch (err) {
      ok = false;
      result = { ...textResult(`Error: ${(err as Error).message}`), isError: true };
    }
    if (isRecording) {
      recorder.recordResult(callIndex, ok, Date.now() - started, result);
    }
    return result;
  });

  return server;
}
