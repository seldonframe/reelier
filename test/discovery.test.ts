import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  buildDiscoveryBundle,
  discoverOpportunities,
  formatDiscoveryPreview,
  signDiscoveryBundle,
  type DiscoverySessionInput,
} from "../src/discovery.js";

function transcript(values: Array<{ name: string; input: Record<string, unknown>; ok?: boolean }>): string {
  return values
    .flatMap((value, index) => [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: `t${index}`, name: value.name, input: value.input }] } }),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: `t${index}`, content: "private response", is_error: value.ok === false }] } }),
    ])
    .join("\n");
}

function session(content: string, overrides: Partial<DiscoverySessionInput> = {}): DiscoverySessionInput {
  return {
    content,
    path: "C:/Users/alice/.claude/projects/demo/session.jsonl",
    project: "demo",
    sourceId: "claude-code",
    sourceLabel: "Claude Code",
    mtimeMs: Date.parse("2026-08-04T12:00:00.000Z"),
    ...overrides,
  };
}

const workflow = transcript([
  { name: "mcp__slack__get_request", input: { channel: "launch-room" } },
  { name: "mcp__notion__create_page", input: { id: "brief", title: "Northstar", body: "private" } },
  { name: "mcp__notion__get_page", input: { id: "brief" } },
  { name: "mcp__linear__create_issue", input: { id: "issue", title: "Review" } },
  { name: "mcp__linear__get_issue", input: { id: "issue" } },
]);

test("discoverOpportunities keeps fingerprints stable when argument values change", () => {
  const first = discoverOpportunities([session(workflow)], { nowMs: Date.parse("2026-08-06T12:00:00.000Z") });
  const changed = discoverOpportunities(
    [session(workflow.replaceAll("launch-room", "other-room").replaceAll("Northstar", "Moonshot"))],
    { nowMs: Date.parse("2026-08-06T12:00:00.000Z") },
  );
  assert.equal(first[0]?.fingerprint.digest, changed[0]?.fingerprint.digest);
});

test("discoverOpportunities separates changed ordered tool shapes and labels side effects", () => {
  const opportunities = discoverOpportunities(
    [
      session(workflow, { mtimeMs: Date.parse("2026-08-05T12:00:00.000Z") }),
      session(transcript([{ name: "mcp__slack__get_request", input: { channel: "x" } }, { name: "mcp__linear__get_issue", input: { id: "x" } }])),
    ],
    { nowMs: Date.parse("2026-08-06T12:00:00.000Z"), configuredServers: ["slack", "notion", "linear"] },
  );
  assert.equal(opportunities.length, 2);
  assert.equal(opportunities[0]?.observedCount, 1);
  assert.equal(opportunities[0]?.evaluationPotential, "strong");
  assert.equal(opportunities[0]?.approvalBoundary, "approve_before_write");
  assert.equal(opportunities[0]?.configuredServerCount, 3);
  assert.match(opportunities[0]?.displayLabel ?? "", /slack.*notion.*linear/i);
});

test("buildDiscoveryBundle excludes raw values and absolute paths, and preview names the boundary", () => {
  const [opportunity] = discoverOpportunities([session(workflow)]);
  const { privateKey } = generateKeyPairSync("ed25519");
  const bundle = buildDiscoveryBundle(opportunity, { runNonce: "nonce-1234567890123456" });
  const signed = signDiscoveryBundle(bundle, { privateKey, keyId: "0123456789abcdef", publicKeyPem: "public-key" });
  const serialized = JSON.stringify(signed);
  assert.doesNotMatch(serialized, /private response|launch-room|Northstar|Users[\\/]|\.claude/);
  assert.match(serialized, /argKeys/);
  const preview = formatDiscoveryPreview(signed);
  assert.match(preview, /Will share/);
  assert.match(preview, /Will never share/);
  assert.match(preview, /explicit confirmation/);
});
