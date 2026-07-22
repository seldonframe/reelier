import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseYamlSubset,
  parsePolicyStrict,
  validatePolicyObject,
  matchGlob,
  matchEndpointGlob,
  globToRegExp,
  extractEndpointHosts,
  evaluatePolicy,
  emptyPolicy,
  loadPolicyForWrap,
  summarizePolicyForWrapStart,
  policyPaths,
  hasEndpointRules,
  ENDPOINT_RULE_NOTE,
  findUnmatchedToolRules,
  formatUnmatchedToolRuleWarnings,
  type Policy,
} from "../src/policy.js";

// ---------------------------------------------------------------------------
// Tiny YAML subset parser
// ---------------------------------------------------------------------------

test("parseYamlSubset: flat scalar + lists of maps (the fixture from the spec)", () => {
  const source = `version: 1
deny:
  - tool: "*.delete_*"
  - tool: "gmail.send_email"
    unless: "--allow-writes"
  - endpoint: "*.stripe.com"
dry_run:
  - tool: "crm.*"
`;
  const parsed = parseYamlSubset(source);
  assert.equal(parsed.version, "1");
  assert.deepEqual(parsed.deny, [
    { tool: "*.delete_*" },
    { tool: "gmail.send_email", unless: "--allow-writes" },
    { endpoint: "*.stripe.com" },
  ]);
  assert.deepEqual(parsed.dry_run, [{ tool: "crm.*" }]);
});

test("parseYamlSubset: strips # comments outside quotes, keeps # inside quotes", () => {
  const source = `version: 1 # a comment
deny:
  - tool: "weird#not-a-comment"
`;
  const parsed = parseYamlSubset(source);
  assert.equal(parsed.version, "1");
  assert.deepEqual(parsed.deny, [{ tool: "weird#not-a-comment" }]);
});

test("parseYamlSubset: throws on unexpected indentation with no open list", () => {
  assert.throws(() => parseYamlSubset("  tool: foo\n"), /unexpected indentation/);
});

// ---------------------------------------------------------------------------
// Strict validation (reelier policy check)
// ---------------------------------------------------------------------------

test("validatePolicyObject: unknown top-level key is an error", () => {
  const result = validatePolicyObject({ version: "1", remote: "x" });
  assert.match(result.errors.join(";"), /unknown top-level key "remote"/);
});

test("validatePolicyObject: unsupported version is an error", () => {
  const result = validatePolicyObject({ version: "2" });
  assert.match(result.errors.join(";"), /not supported/);
});

test("validatePolicyObject: deny rule with unknown key is an error", () => {
  const result = validatePolicyObject({ deny: [{ tool: "x", nope: "y" }] });
  assert.match(result.errors.join(";"), /deny\[0\]: unknown key "nope"/);
});

test("validatePolicyObject: empty deny rule (no tool/endpoint) is an error", () => {
  const result = validatePolicyObject({ deny: [{ unless: "--allow-writes" }] });
  assert.match(result.errors.join(";"), /deny\[0\]: empty rule/);
});

test("validatePolicyObject: empty tool glob is an error", () => {
  const result = validatePolicyObject({ deny: [{ tool: "   " }] });
  assert.match(result.errors.join(";"), /"tool" glob is empty/);
});

test("validatePolicyObject: unknown unless flag is an error", () => {
  const result = validatePolicyObject({ deny: [{ tool: "x", unless: "--yolo" }] });
  assert.match(result.errors.join(";"), /unknown "unless" flag "--yolo"/);
});

test("validatePolicyObject: dry_run rule with no tool is an error", () => {
  const result = validatePolicyObject({ dry_run: [{}] });
  assert.match(result.errors.join(";"), /dry_run\[0\]: empty rule/);
});

test("validatePolicyObject: valid policy has zero errors and returns the parsed Policy", () => {
  const result = validatePolicyObject({
    version: "1",
    deny: [{ tool: "*.delete_*" }, { tool: "gmail.send_email", unless: "--allow-writes" }, { endpoint: "*.stripe.com" }],
    dry_run: [{ tool: "crm.*" }],
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.policy, {
    version: 1,
    deny: [{ tool: "*.delete_*" }, { tool: "gmail.send_email", unless: "--allow-writes" }, { endpoint: "*.stripe.com" }],
    dryRun: [{ tool: "crm.*" }],
  });
});

test("parsePolicyStrict: a YAML syntax error surfaces as a validation error, not a throw", () => {
  const result = parsePolicyStrict("  bad: indent\n");
  assert.equal(result.policy, undefined);
  assert.ok(result.errors.length > 0);
});

// ---------------------------------------------------------------------------
// Glob matching
// ---------------------------------------------------------------------------

test("matchGlob: * wildcard, case-insensitive, anchored full match", () => {
  assert.equal(matchGlob("*.delete_*", "gmail.delete_message"), true);
  assert.equal(matchGlob("*.delete_*", "delete_message"), false); // no leading segment before "delete_" — anchored, no partial
  assert.equal(matchGlob("crm.*", "crm.create_contact"), true);
  assert.equal(matchGlob("crm.*", "CRM.CREATE_CONTACT"), true); // case-insensitive
  assert.equal(matchGlob("gmail.send_email", "gmail.send_email"), true);
  assert.equal(matchGlob("gmail.send_email", "gmail.send_emails"), false);
  // Plain glob semantics (used for TOOL rules, unchanged by the endpoint
  // apex-or-subdomain fix below): "*." requires a literal leading segment
  // before the dot, so the bare apex "stripe.com" does NOT match — this is
  // intentional here; endpoint RULES get their own matcher (matchEndpointGlob)
  // specifically because this behavior is wrong for destinations.
  assert.equal(matchGlob("*.stripe.com", "api.stripe.com"), true);
  assert.equal(matchGlob("*.stripe.com", "stripe.com"), false);
});

test("globToRegExp: only * is special; other regex metacharacters are escaped literally", () => {
  const re = globToRegExp("a.b+c");
  assert.equal(re.test("a.b+c"), true);
  assert.equal(re.test("aXb+c"), false); // "." escaped -> literal dot, not "any char"
});

// ---------------------------------------------------------------------------
// Endpoint-rule glob matching (B2): "*.host.tld" is apex-or-subdomain, NOT
// plain glob semantics — deliberately more protective than matchGlob, never
// less (see policy.ts's matchEndpointGlob doc comment).
// ---------------------------------------------------------------------------

test("matchEndpointGlob: *.host.tld matches the apex itself", () => {
  assert.equal(matchEndpointGlob("*.stripe.com", "stripe.com"), true);
});

test("matchEndpointGlob: *.host.tld matches a subdomain", () => {
  assert.equal(matchEndpointGlob("*.stripe.com", "api.stripe.com"), true);
  assert.equal(matchEndpointGlob("*.stripe.com", "checkout.stripe.com"), true);
});

test("matchEndpointGlob: *.host.tld does not match an unrelated host or a look-alike suffix", () => {
  assert.equal(matchEndpointGlob("*.stripe.com", "example.com"), false);
  assert.equal(matchEndpointGlob("*.stripe.com", "notstripe.com"), false); // must be apex or a DOT-separated subdomain, not just a suffix
  assert.equal(matchEndpointGlob("*.stripe.com", "stripe.com.evil.com"), false);
});

test("matchEndpointGlob: case-insensitive", () => {
  assert.equal(matchEndpointGlob("*.STRIPE.com", "Stripe.COM"), true);
});

test("matchEndpointGlob: a glob without a leading '*.' falls back to plain glob semantics", () => {
  assert.equal(matchEndpointGlob("api.stripe.com", "api.stripe.com"), true);
  assert.equal(matchEndpointGlob("*stripe*", "checkout.stripe.com"), true);
});

// ---------------------------------------------------------------------------
// Endpoint extraction
// ---------------------------------------------------------------------------

test("extractEndpointHosts: finds a URL nested anywhere in args, lowercased", () => {
  const hosts = extractEndpointHosts({ nested: { webhook: "https://API.Stripe.com/v1/charges" }, other: 5 });
  assert.deepEqual([...hosts], ["api.stripe.com"]);
});

test("extractEndpointHosts: ignores non-URL strings", () => {
  const hosts = extractEndpointHosts({ text: "not a url", n: 5, flag: true });
  assert.deepEqual([...hosts], []);
});

// ---------------------------------------------------------------------------
// Evaluation: deny/dry-run/pass per rule type, precedence, unless-escape
// ---------------------------------------------------------------------------

const ctxNoEscape = { allowWrites: false };
const ctxEscaped = { allowWrites: true };

test("evaluatePolicy: tool-glob deny rule blocks a matching call", () => {
  const policy: Policy = { version: 1, deny: [{ tool: "*.delete_*" }], dryRun: [] };
  const verdict = evaluatePolicy(policy, "gmail.delete_message", {}, ctxNoEscape);
  assert.equal(verdict.verdict, "deny");
});

test("evaluatePolicy: endpoint-glob deny rule blocks a call whose args carry a matching URL (subdomain)", () => {
  const policy: Policy = { version: 1, deny: [{ endpoint: "*.stripe.com" }], dryRun: [] };
  const verdict = evaluatePolicy(policy, "http.post", { url: "https://api.stripe.com/v1/charges" }, ctxNoEscape);
  assert.equal(verdict.verdict, "deny");
});

test("evaluatePolicy: endpoint-glob deny rule ALSO blocks the apex host (B2 — *.host.tld is apex-or-subdomain for endpoint rules)", () => {
  const policy: Policy = { version: 1, deny: [{ endpoint: "*.stripe.com" }], dryRun: [] };
  const verdict = evaluatePolicy(policy, "http.post", { url: "https://stripe.com/v1/charges" }, ctxNoEscape);
  assert.equal(verdict.verdict, "deny");
});

test("evaluatePolicy: endpoint rules never see a structured call with no URL in its args — this is the documented B1 limit, not a bug", () => {
  const policy: Policy = { version: 1, deny: [{ endpoint: "*.stripe.com" }], dryRun: [] };
  // A Composio-style structured Stripe call: no URL string anywhere in args.
  const verdict = evaluatePolicy(policy, "STRIPE_CREATE_CHARGE", { amount: 500, currency: "usd", customer: "cus_123" }, ctxNoEscape);
  assert.equal(verdict.verdict, "allow"); // NOT covered — must be denied by `tool` instead
});

test("evaluatePolicy: endpoint-glob deny rule does not block an unrelated destination", () => {
  const policy: Policy = { version: 1, deny: [{ endpoint: "*.stripe.com" }], dryRun: [] };
  const verdict = evaluatePolicy(policy, "http.post", { url: "https://example.com/webhook" }, ctxNoEscape);
  assert.equal(verdict.verdict, "allow");
});

test("evaluatePolicy: unless escape lets the call through when the flag is set", () => {
  const policy: Policy = { version: 1, deny: [{ tool: "gmail.send_email", unless: "--allow-writes" }], dryRun: [] };
  assert.equal(evaluatePolicy(policy, "gmail.send_email", {}, ctxNoEscape).verdict, "deny");
  assert.equal(evaluatePolicy(policy, "gmail.send_email", {}, ctxEscaped).verdict, "allow");
});

test("evaluatePolicy: dry_run tool-glob rule intercepts a matching call", () => {
  const policy: Policy = { version: 1, deny: [], dryRun: [{ tool: "crm.*" }] };
  const verdict = evaluatePolicy(policy, "crm.create_contact", {}, ctxNoEscape);
  assert.equal(verdict.verdict, "dry_run");
});

test("evaluatePolicy: a call matching neither list passes through", () => {
  const policy: Policy = { version: 1, deny: [{ tool: "*.delete_*" }], dryRun: [{ tool: "crm.*" }] };
  const verdict = evaluatePolicy(policy, "calendar.list_events", {}, ctxNoEscape);
  assert.equal(verdict.verdict, "allow");
});

test("evaluatePolicy: precedence — deny beats dry_run when both match", () => {
  const policy: Policy = { version: 1, deny: [{ tool: "crm.delete_*" }], dryRun: [{ tool: "crm.*" }] };
  const verdict = evaluatePolicy(policy, "crm.delete_contact", {}, ctxNoEscape);
  assert.equal(verdict.verdict, "deny");
});

test("evaluatePolicy: glob matching normalizes namespace-prefixed tool names (reuses effect-verbs normalization)", () => {
  const policy: Policy = { version: 1, deny: [{ tool: "gmail.send_email" }], dryRun: [] };
  const verdict = evaluatePolicy(policy, "composio__gmail.send_email", {}, ctxNoEscape);
  assert.equal(verdict.verdict, "deny");
});

test("evaluatePolicy: empty policy allows everything", () => {
  const verdict = evaluatePolicy(emptyPolicy(), "anything.at_all", {}, ctxNoEscape);
  assert.equal(verdict.verdict, "allow");
});

// ---------------------------------------------------------------------------
// Resolution: project overrides global; malformed fails safe
// ---------------------------------------------------------------------------

test("loadPolicyForWrap: no file anywhere -> ok:true, empty policy, no sourcePath", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "reelier-policy-cwd-"));
  const home = await mkdtemp(path.join(tmpdir(), "reelier-policy-home-"));
  try {
    const result = await loadPolicyForWrap(cwd, home);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.sourcePath, undefined);
      assert.deepEqual(result.policy, emptyPolicy());
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("loadPolicyForWrap: project policy.yml overrides global when both exist", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "reelier-policy-cwd-"));
  const home = await mkdtemp(path.join(tmpdir(), "reelier-policy-home-"));
  try {
    const { project, global } = policyPaths(cwd, home);
    await mkdir(path.dirname(project), { recursive: true });
    await mkdir(path.dirname(global), { recursive: true });
    await writeFile(project, 'version: 1\ndeny:\n  - tool: "project.*"\n', "utf8");
    await writeFile(global, 'version: 1\ndeny:\n  - tool: "global.*"\n', "utf8");

    const result = await loadPolicyForWrap(cwd, home);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.sourcePath, project);
      assert.deepEqual(result.policy.deny, [{ tool: "project.*" }]);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("loadPolicyForWrap: falls back to global when project policy.yml is absent", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "reelier-policy-cwd-"));
  const home = await mkdtemp(path.join(tmpdir(), "reelier-policy-home-"));
  try {
    const { global } = policyPaths(cwd, home);
    await mkdir(path.dirname(global), { recursive: true });
    await writeFile(global, 'version: 1\ndeny:\n  - tool: "global.*"\n', "utf8");

    const result = await loadPolicyForWrap(cwd, home);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.sourcePath, global);
      assert.deepEqual(result.policy.deny, [{ tool: "global.*" }]);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("loadPolicyForWrap: a malformed project policy.yml fails SAFE (deny nothing), never throws", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "reelier-policy-cwd-"));
  const home = await mkdtemp(path.join(tmpdir(), "reelier-policy-home-"));
  try {
    const { project } = policyPaths(cwd, home);
    await mkdir(path.dirname(project), { recursive: true });
    await writeFile(project, "  bad: indent\n", "utf8");

    const result = await loadPolicyForWrap(cwd, home);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.policy, emptyPolicy());
      assert.equal(result.sourcePath, project);
      assert.ok(result.error.length > 0);
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("summarizePolicyForWrapStart: 1-2 lines, WARN + gap language on failure, plain summary on success", () => {
  const okNone = summarizePolicyForWrapStart({ ok: true, policy: emptyPolicy(), sourcePath: undefined });
  assert.equal(okNone.length, 1);
  assert.match(okNone[0], /none configured/);

  const okSome = summarizePolicyForWrapStart({
    ok: true,
    policy: { version: 1, deny: [{ tool: "a" }], dryRun: [{ tool: "b" }] },
    sourcePath: "/x/.reelier/policy.yml",
  });
  assert.equal(okSome.length, 1);
  assert.match(okSome[0], /1 deny rule\(s\), 1 dry-run rule\(s\)/);

  const failed = summarizePolicyForWrapStart({
    ok: false,
    policy: emptyPolicy(),
    sourcePath: "/x/.reelier/policy.yml",
    error: "boom",
  });
  assert.ok(failed.length >= 1 && failed.length <= 2);
  assert.match(failed.join(" "), /WARNING/);
  assert.match(failed.join(" "), /disabled/i);
});

test("summarizePolicyForWrapStart: appends the endpoint-rule honesty note (B1) when the policy has any endpoint rules", () => {
  const withEndpoint = summarizePolicyForWrapStart({
    ok: true,
    policy: { version: 1, deny: [{ endpoint: "*.stripe.com" }], dryRun: [] },
    sourcePath: "/x/.reelier/policy.yml",
  });
  assert.equal(withEndpoint.length, 2);
  assert.equal(withEndpoint[1], `[reelier] policy: ${ENDPOINT_RULE_NOTE}`);

  const withoutEndpoint = summarizePolicyForWrapStart({
    ok: true,
    policy: { version: 1, deny: [{ tool: "*.delete_*" }], dryRun: [] },
    sourcePath: "/x/.reelier/policy.yml",
  });
  assert.equal(withoutEndpoint.length, 1);
});

test("hasEndpointRules: true iff at least one deny rule sets endpoint", () => {
  assert.equal(hasEndpointRules({ version: 1, deny: [{ endpoint: "*.stripe.com" }], dryRun: [] }), true);
  assert.equal(hasEndpointRules({ version: 1, deny: [{ tool: "*.delete_*" }], dryRun: [] }), false);
  assert.equal(hasEndpointRules(emptyPolicy()), false);
});

// ---------------------------------------------------------------------------
// N1 — unmatched-tool-rule detection: a deny/dry_run TOOL rule that matches
// none of the currently-wrapped tools warns at wrap start (typo / missed
// collision-rename prefix), a matching rule stays silent.
// ---------------------------------------------------------------------------

test("findUnmatchedToolRules: a rule matching nothing is reported", () => {
  const policy: Policy = { version: 1, deny: [{ tool: "*.frobnicate_*" }], dryRun: [] };
  const unmatched = findUnmatchedToolRules(policy, ["gmail.delete_message", "crm.create_contact"]);
  assert.deepEqual(unmatched, [{ kind: "deny", glob: "*.frobnicate_*" }]);
});

test("findUnmatchedToolRules: a rule matching at least one available tool is NOT reported", () => {
  const policy: Policy = { version: 1, deny: [{ tool: "*.delete_*" }], dryRun: [{ tool: "crm.*" }] };
  const unmatched = findUnmatchedToolRules(policy, ["gmail.delete_message", "crm.create_contact"]);
  assert.deepEqual(unmatched, []);
});

test("findUnmatchedToolRules: an endpoint-only rule is never flagged as unmatched (it has no tool glob to match)", () => {
  const policy: Policy = { version: 1, deny: [{ endpoint: "*.stripe.com" }], dryRun: [] };
  const unmatched = findUnmatchedToolRules(policy, ["gmail.delete_message"]);
  assert.deepEqual(unmatched, []);
});

test("findUnmatchedToolRules: matching is namespace-prefix aware, same as evaluatePolicy", () => {
  const policy: Policy = { version: 1, deny: [{ tool: "gmail.send_email" }], dryRun: [] };
  const unmatched = findUnmatchedToolRules(policy, ["composio__gmail.send_email"]);
  assert.deepEqual(unmatched, []); // matches once the collision/namespace prefix is stripped
});

test("formatUnmatchedToolRuleWarnings: empty input -> no warning lines printed", () => {
  assert.deepEqual(formatUnmatchedToolRuleWarnings([], ["a", "b"]), []);
});

test("formatUnmatchedToolRuleWarnings: names the rule and up to 5 available tools", () => {
  const lines = formatUnmatchedToolRuleWarnings(
    [{ kind: "deny", glob: "*.frobnicate_*" }],
    ["a", "b", "c", "d", "e", "f", "g"]
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /WARNING/);
  assert.match(lines[0], /deny rule tool:"\*\.frobnicate_\*"/);
  assert.match(lines[0], /matches none of the currently-wrapped tools/);
  assert.match(lines[0], /available: a, b, c, d, e, \.\.\./); // capped at 5, "..." signals more exist
});

test("formatUnmatchedToolRuleWarnings: reports 'no tools wrapped' when there's nothing to sample", () => {
  const lines = formatUnmatchedToolRuleWarnings([{ kind: "dry_run", glob: "crm.*" }], []);
  assert.match(lines[0], /no tools wrapped/);
});

// ---------------------------------------------------------------------------
// N3 — duplicate keys within a single rule map are rejected, not last-wins.
// ---------------------------------------------------------------------------

test("parseYamlSubset: throws on a duplicate key within one list item (first key + continuation line)", () => {
  const source = 'deny:\n  - tool: "a.*"\n    tool: "b.*"\n';
  assert.throws(() => parseYamlSubset(source), /duplicate key "tool"/);
});

test("parseYamlSubset: no false positive across DIFFERENT list items — only within-item duplicates are rejected", () => {
  const source = 'deny:\n  - tool: "a.*"\n  - tool: "b.*"\n';
  const parsed = parseYamlSubset(source);
  assert.deepEqual(parsed.deny, [{ tool: "a.*" }, { tool: "b.*" }]);
});

test("parsePolicyStrict: surfaces the duplicate-key parse error as a validation error, exit-1-worthy for policy check", () => {
  const source = 'version: 1\ndeny:\n  - tool: "a.*"\n    tool: "b.*"\n';
  const result = parsePolicyStrict(source);
  assert.equal(result.policy, undefined);
  assert.match(result.errors.join(";"), /duplicate key "tool"/);
});
