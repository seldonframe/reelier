import { createHash, sign as cryptoSign, type KeyObject } from "node:crypto";
import { classifyEffect } from "./effect-verbs.js";
import { classifyToolUse, parseSessionTranscriptForFormat, type SessionFormatId } from "./session.js";
import type { Effect } from "./skill.js";

export const AGENT_DISCOVERY_BUNDLE_VERSION = "AgentDiscoveryBundleV1" as const;
export const AGENT_DISCOVERY_ADAPTER_VERSION = "reelier-discovery-v1" as const;

type EvaluationPotential = "strong" | "partial" | "none";
type ApprovalBoundary = "draft_only" | "approve_before_write" | "bounded_write";

export interface DiscoverySessionInput {
  content: string;
  path: string;
  project: string;
  sourceId: string;
  sourceLabel: string;
  mtimeMs: number;
  format?: SessionFormatId;
}

export interface DiscoveryFingerprintStep {
  server: string | null;
  tool: string;
  argKeys: string[];
  effect: Effect;
  ok: boolean;
  approvalLike: boolean;
}

export interface DiscoveryDataflow {
  fromStep: number;
  toStep: number;
  relation: "write_then_read_back";
}

export interface DiscoveryFingerprint {
  version: "workflow-shape-v1";
  sourceAgent: string;
  steps: DiscoveryFingerprintStep[];
  dataflow: DiscoveryDataflow[];
  digest: string;
}

export interface AgentOpportunity {
  fingerprint: DiscoveryFingerprint;
  displayLabel: string;
  observedCount: number;
  lastUsedAt: string;
  durationMs: { total: number; average: number };
  servers: string[];
  sourceAgents: string[];
  effectCounts: { read: number; "idempotent-write": number; destructive: number };
  evaluationPotential: EvaluationPotential;
  configuredServerCount: number;
  approvalBoundary: ApprovalBoundary;
  sessionPaths: string[];
}

export interface AgentDiscoveryBundleV1 {
  schemaVersion: typeof AGENT_DISCOVERY_BUNDLE_VERSION;
  adapterVersion: typeof AGENT_DISCOVERY_ADAPTER_VERSION;
  runNonce: string;
  workflow: {
    fingerprint: Omit<DiscoveryFingerprint, "digest">;
    fingerprintDigest: string;
    sourceAgents: string[];
    occurrenceCount: number;
    lastUsedAt: string;
    durationMs: { total: number; average: number };
    servers: string[];
    effectCounts: AgentOpportunity["effectCounts"];
    evaluationPotential: EvaluationPotential;
    approvalBoundary: ApprovalBoundary;
    dataflow: DiscoveryDataflow[];
  };
  skillDigest?: string;
  redactionReport: {
    removedFields: string[];
    sourceDigest: string;
    rawValuesIncluded: false;
  };
  signature?: {
    algorithm: "ed25519";
    keyId: string;
    publicKeyPem: string;
    value: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

const RESTRICTED_KEY = /(authorization|api[-_]?key|credential|password|private[-_]?key|prompt|raw[-_]?trace|secret|token|cookie|header|env|home)/i;
const APPROVAL_TOOL = /(approve|approval|confirm|consent|review)/i;
const READ_VERBS = new Set(["get", "list", "read", "search", "fetch", "query", "describe", "find", "check", "status", "show", "view", "lookup", "inspect", "preview", "retrieve"]);
const WRITE_VERBS = new Set(["create", "update", "set", "upsert", "put", "write", "save", "add", "modify", "move", "insert", "patch", "append", "sync", "mark"]);

function argumentKeys(value: unknown, prefix = "", out: string[] = []): string[] {
  if (!isRecord(value) && !Array.isArray(value)) return out;
  if (Array.isArray(value)) {
    for (const child of value) argumentKeys(child, `${prefix}[]`, out);
    return [...new Set(out)].sort().slice(0, 64);
  }
  for (const [key, child] of Object.entries(value)) {
    if (RESTRICTED_KEY.test(key)) continue;
    const next = prefix ? `${prefix}.${key}` : key;
    out.push(next);
    argumentKeys(child, next, out);
  }
  return [...new Set(out)].sort().slice(0, 64);
}

function resourceStem(tool: string): string {
  const parts = tool.split(/[._-]+/).filter(Boolean);
  if (parts.length <= 1) return tool;
  return WRITE_VERBS.has(parts[0]) || READ_VERBS.has(parts[0]) ? parts.slice(1).join(".") : parts.slice(1).join(".");
}

function isApprovalLike(tool: string): boolean {
  return APPROVAL_TOOL.test(tool);
}

function fingerprintFor(input: DiscoverySessionInput): { fingerprint: DiscoveryFingerprint; effects: AgentOpportunity["effectCounts"]; durationMs: number } | null {
  const parsed = parseSessionTranscriptForFormat(input.content, input.format);
  const steps: DiscoveryFingerprintStep[] = [];
  for (const pair of parsed.pairs) {
    const classification = classifyToolUse(pair.call.name);
    if (!classification.replayable || !pair.result) continue;
    const effect = classifyEffect(classification.traceTool).effect;
    steps.push({
      server: classification.server ?? null,
      tool: classification.traceTool,
      argKeys: argumentKeys(pair.call.input),
      effect,
      ok: pair.result.ok,
      approvalLike: isApprovalLike(classification.traceTool),
    });
  }
  if (steps.length === 0) return null;
  const dataflow: DiscoveryDataflow[] = [];
  steps.forEach((step, fromStep) => {
    if (step.effect === "read") return;
    const readBack = steps.findIndex((candidate, index) => index > fromStep && candidate.effect === "read" && candidate.server === step.server && resourceStem(candidate.tool) === resourceStem(step.tool));
    if (readBack >= 0) dataflow.push({ fromStep, toStep: readBack, relation: "write_then_read_back" });
  });
  const normalized: Omit<DiscoveryFingerprint, "digest"> = {
    version: "workflow-shape-v1",
    sourceAgent: input.sourceId,
    steps,
    dataflow,
  };
  return {
    fingerprint: { ...normalized, digest: sha256(normalized) },
    effects: {
      read: steps.filter((step) => step.effect === "read").length,
      "idempotent-write": steps.filter((step) => step.effect === "idempotent-write").length,
      destructive: steps.filter((step) => step.effect === "destructive").length,
    },
    durationMs: 0,
  };
}

function displayLabel(fingerprint: DiscoveryFingerprint): string {
  const labels: string[] = [];
  for (const step of fingerprint.steps) {
    const label = step.server ?? step.tool;
    if (!labels.includes(label)) labels.push(label);
  }
  return `${labels.join(" → ")} workflow`;
}

function evaluationPotential(fingerprint: DiscoveryFingerprint): EvaluationPotential {
  if (fingerprint.dataflow.length > 0) return "strong";
  if (fingerprint.steps.some((step) => step.effect !== "read")) return "partial";
  return "none";
}

function approvalBoundary(effects: AgentOpportunity["effectCounts"]): ApprovalBoundary {
  return effects["idempotent-write"] + effects.destructive > 0 ? "approve_before_write" : "draft_only";
}

export function discoverOpportunities(
  sessions: DiscoverySessionInput[],
  options: { nowMs?: number; configuredServers?: string[] } = {},
): AgentOpportunity[] {
  const nowMs = options.nowMs ?? Date.now();
  const configured = new Set(options.configuredServers ?? []);
  const clusters = new Map<string, AgentOpportunity>();
  for (const input of sessions) {
    const built = fingerprintFor(input);
    if (!built) continue;
    const existing = clusters.get(built.fingerprint.digest);
    const observedAt = new Date(input.mtimeMs).toISOString();
    const servers = [...new Set(built.fingerprint.steps.flatMap((step) => (step.server ? [step.server] : [])))].sort();
    const sourceAgents = [input.sourceLabel];
    if (!existing) {
      clusters.set(built.fingerprint.digest, {
        fingerprint: built.fingerprint,
        displayLabel: displayLabel(built.fingerprint),
        observedCount: 1,
        lastUsedAt: observedAt,
        durationMs: { total: built.durationMs, average: built.durationMs },
        servers,
        sourceAgents,
        effectCounts: built.effects,
        evaluationPotential: evaluationPotential(built.fingerprint),
        configuredServerCount: servers.filter((server) => configured.has(server)).length,
        approvalBoundary: approvalBoundary(built.effects),
        sessionPaths: [input.path],
      });
      continue;
    }
    existing.observedCount += 1;
    existing.effectCounts.read += built.effects.read;
    existing.effectCounts["idempotent-write"] += built.effects["idempotent-write"];
    existing.effectCounts.destructive += built.effects.destructive;
    existing.durationMs.total += built.durationMs;
    existing.durationMs.average = existing.durationMs.total / existing.observedCount;
    existing.lastUsedAt = Math.max(Date.parse(existing.lastUsedAt), input.mtimeMs) === input.mtimeMs ? observedAt : existing.lastUsedAt;
    existing.sourceAgents = [...new Set(existing.sourceAgents.concat(sourceAgents))].sort();
    existing.sessionPaths.push(input.path);
  }
  return [...clusters.values()].sort((left, right) => {
    const recencyLeft = Math.max(0, nowMs - Date.parse(left.lastUsedAt));
    const recencyRight = Math.max(0, nowMs - Date.parse(right.lastUsedAt));
    const scoreLeft = left.observedCount * 100 + left.fingerprint.steps.length * 2 + left.configuredServerCount * 5 + (left.evaluationPotential === "strong" ? 25 : left.evaluationPotential === "partial" ? 10 : 0) - recencyLeft / 86_400_000;
    const scoreRight = right.observedCount * 100 + right.fingerprint.steps.length * 2 + right.configuredServerCount * 5 + (right.evaluationPotential === "strong" ? 25 : right.evaluationPotential === "partial" ? 10 : 0) - recencyRight / 86_400_000;
    return scoreRight - scoreLeft || left.displayLabel.localeCompare(right.displayLabel);
  });
}

function bundlePayload(bundle: AgentDiscoveryBundleV1): Omit<AgentDiscoveryBundleV1, "signature"> {
  const { signature: _signature, ...payload } = bundle;
  void _signature;
  return payload;
}

export function buildDiscoveryBundle(opportunity: AgentOpportunity, options: { runNonce: string; skillDigest?: string }): AgentDiscoveryBundleV1 {
  if (!/^[A-Za-z0-9._-]{16,256}$/.test(options.runNonce)) throw new Error("runNonce must be 16-256 safe characters");
  const { sessionPaths: _sessionPaths, ...workflowStats } = opportunity;
  void _sessionPaths;
  return {
    schemaVersion: AGENT_DISCOVERY_BUNDLE_VERSION,
    adapterVersion: AGENT_DISCOVERY_ADAPTER_VERSION,
    runNonce: options.runNonce,
    workflow: {
      fingerprint: {
        version: opportunity.fingerprint.version,
        sourceAgent: opportunity.fingerprint.sourceAgent,
        steps: opportunity.fingerprint.steps,
        dataflow: opportunity.fingerprint.dataflow,
      },
      fingerprintDigest: opportunity.fingerprint.digest,
      sourceAgents: workflowStats.sourceAgents,
      occurrenceCount: workflowStats.observedCount,
      lastUsedAt: workflowStats.lastUsedAt,
      durationMs: workflowStats.durationMs,
      servers: workflowStats.servers,
      effectCounts: workflowStats.effectCounts,
      evaluationPotential: workflowStats.evaluationPotential,
      approvalBoundary: workflowStats.approvalBoundary,
      dataflow: opportunity.fingerprint.dataflow,
    },
    ...(options.skillDigest ? { skillDigest: options.skillDigest } : {}),
    redactionReport: {
      removedFields: ["rawPrompts", "rawToolArguments", "rawToolResponses", "credentials", "environmentValues", "absolutePaths", "unrelatedSessions"],
      sourceDigest: opportunity.fingerprint.digest,
      rawValuesIncluded: false,
    },
  };
}

export function signDiscoveryBundle(
  bundle: AgentDiscoveryBundleV1,
  input: { privateKey: KeyObject; keyId: string; publicKeyPem: string },
): AgentDiscoveryBundleV1 {
  const digest = sha256(bundlePayload(bundle));
  return {
    ...bundle,
    signature: {
      algorithm: "ed25519",
      keyId: input.keyId,
      publicKeyPem: input.publicKeyPem,
      value: cryptoSign(null, Buffer.from(digest, "utf8"), input.privateKey).toString("base64url"),
    },
  };
}

export function validateDiscoveryBundle(value: unknown): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["bundle must be an object"] };
  if (value.schemaVersion !== AGENT_DISCOVERY_BUNDLE_VERSION) errors.push("unsupported bundle version");
  if (value.adapterVersion !== AGENT_DISCOVERY_ADAPTER_VERSION) errors.push("unsupported adapter version");
  if (typeof value.runNonce !== "string" || !/^[A-Za-z0-9._-]{16,256}$/.test(value.runNonce)) errors.push("invalid runNonce");
  if (!isRecord(value.workflow) || typeof value.workflow.fingerprintDigest !== "string") errors.push("workflow fingerprint is required");
  if (!isRecord(value.redactionReport) || value.redactionReport.rawValuesIncluded !== false || !Array.isArray(value.redactionReport.removedFields)) errors.push("redaction report is invalid");
  if (!isRecord(value.signature) || value.signature.algorithm !== "ed25519" || typeof value.signature.keyId !== "string" || typeof value.signature.publicKeyPem !== "string" || typeof value.signature.value !== "string") errors.push("ed25519 signature is required");
  if (JSON.stringify(value).length > 512 * 1024) errors.push("bundle exceeds 512kb");
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function formatDiscoveryPreview(bundle: AgentDiscoveryBundleV1): string {
  const workflow = bundle.workflow;
  const effects = workflow.effectCounts;
  return [
    "Discovery upload preview",
    "",
    "Will share:",
    `  workflow fingerprint: ${workflow.fingerprintDigest}`,
    `  source agents: ${workflow.sourceAgents.join(", ") || "none"}`,
    `  tools: ${workflow.servers.join(" → ") || "none"}`,
    `  observed: ${workflow.occurrenceCount} time(s), last used ${workflow.lastUsedAt}`,
    `  effects: ${effects.read} reads · ${effects["idempotent-write"]} proposed writes · ${effects.destructive} destructive/unknown writes`,
    `  approval boundary: ${workflow.approvalBoundary}`,
    "",
    "Will never share:",
    "  credentials, environment values, raw prompts, raw tool arguments or responses, private traces, unrelated sessions, or absolute home-directory paths",
    "",
    "No upload will happen without explicit confirmation (or the purpose-specific --yes flag).",
  ].join("\n");
}

