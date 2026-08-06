import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDiscoveryOpportunity, parseDiscoverySelection } from "../src/cli.js";
import type { AgentOpportunity } from "../src/discovery.js";

const opportunity: AgentOpportunity = {
  fingerprint: { version: "workflow-shape-v1", sourceAgent: "claude-code", steps: [], dataflow: [], digest: "a".repeat(64) },
  displayLabel: "Slack → Notion → Linear workflow",
  observedCount: 8,
  lastUsedAt: "2026-08-04T12:00:00.000Z",
  durationMs: { total: 1200, average: 150 },
  servers: ["slack", "notion", "linear"],
  sourceAgents: ["Claude Code"],
  effectCounts: { read: 6, "idempotent-write": 1, destructive: 0 },
  evaluationPotential: "strong",
  configuredServerCount: 3,
  approvalBoundary: "approve_before_write",
  sessionPaths: ["C:/private/session.jsonl"],
};

test("parseDiscoverySelection accepts only one valid 1-based opportunity index", () => {
  assert.equal(parseDiscoverySelection("2", 3), 2);
  assert.equal(parseDiscoverySelection("0", 3), null);
  assert.equal(parseDiscoverySelection("4", 3), null);
  assert.equal(parseDiscoverySelection("2,3", 3), null);
});

test("formatDiscoveryOpportunity explains frequency, effects, evaluation, and approval", () => {
  const lines = formatDiscoveryOpportunity(1, opportunity);
  const output = lines.join("\n");
  assert.match(output, /Observed 8 times/);
  assert.match(output, /6 reads/);
  assert.match(output, /Evaluation potential: strong/);
  assert.match(output, /approve_before_write/);
  assert.doesNotMatch(output, /private\/session|C:\\private/);
});
