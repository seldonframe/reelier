import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runAuthorityCommand } from "../../src/authority/cli.js";
import { parseArgv } from "../../src/cli.js";
import { writeCertificationInputManifests } from "./certification-input-fixture.js";

async function fixture(): Promise<{ configPath: string; workspace: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-cert-cli-"));
  const configPath = path.join(root, "certification.local.json");
  await writeFile(configPath, JSON.stringify({
    v: "reelier.certification-operator-config/v2", authorityConfigPath: "authority/authority.yml", evidenceDirectory: "authority/receipts/certification",
    scenarios: ["github-issue-labels"], resources: { "github-issue-labels": { apiBaseUrl: "https://api.github.com", owner: "fixlyai", repository: "reelier-certification", issueNumber: 1 } },
    cleanup: { "github-issue-labels": ["restore-github-labels"] }, metadata: {}, secretReferences: { githubCredential: "env:REELIER_GITHUB_TOKEN" },
  }), "utf8");
  return { configPath, workspace: path.join(root, "certification") };
}

async function capture(command: Parameters<typeof runAuthorityCommand>[0]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = ""; let stderr = "";
  const log = console.log; const error = console.error;
  try {
    console.log = (...args: unknown[]) => { stdout += args.join(" "); };
    console.error = (...args: unknown[]) => { stderr += args.join(" "); };
    return { code: await runAuthorityCommand(command), stdout, stderr };
  } finally { console.log = log; console.error = error; }
}

test("root CLI parses exact certification scenario selection", () => {
  const parsed = parseArgv(["certify", "preflight", "--scenario", "github-issue-labels"]);
  assert.equal(parsed.opts.scenario, "github-issue-labels");
  assert.deepEqual(parsed.positional, ["certify", "preflight"]);
});

test("root CLI rejects missing and duplicate scenario option values", () => {
  assert.throws(() => parseArgv(["certify", "preflight", "--scenario"]), /requires a value/);
  assert.throws(() => parseArgv(["certify", "preflight", "--scenario", "--all"]), /requires a value/);
  assert.throws(() => parseArgv(["certify", "preflight", "--scenario", "github-issue-labels", "--scenario", "slack-topic"]), /duplicate/);
  assert.throws(() => parseArgv(["certify", "preflight", "--all", "--all"]), /duplicate/);
  for (const option of ["config", "workspace", "input"]) {
    assert.throws(() => parseArgv(["certify", "init", `--${option}`, "first", `--${option}`, "second"]), /duplicate/);
    assert.throws(() => parseArgv(["certify", "init", `--${option}`, "--all"]), /requires a value/);
  }
});

test("init and verify reject every irrelevant flag, option, and extra positional", async () => {
  const { configPath, workspace } = await fixture();
  const cases: Array<{ command: Parameters<typeof runAuthorityCommand>[0]; reason: string }> = [
    { command: { positional: ["certify", "init", "extra"], flags: new Set(), opts: { config: configPath } }, reason: "certification-command-invalid" },
    { command: { positional: ["certify", "init"], flags: new Set(["all"]), opts: { config: configPath } }, reason: "certification-command-invalid" },
    { command: { positional: ["certify", "init"], flags: new Set(), opts: { config: configPath, workspace } }, reason: "certification-command-invalid" },
    { command: { positional: ["certify", "verify", "extra"], flags: new Set(), opts: { input: "missing" } }, reason: "certification-command-invalid" },
    { command: { positional: ["certify", "verify"], flags: new Set(["all"]), opts: { input: "missing" } }, reason: "certification-command-invalid" },
    { command: { positional: ["certify", "verify"], flags: new Set(), opts: { input: "missing", scenario: "github-issue-labels" } }, reason: "certification-command-invalid" },
    { command: { positional: ["certify", "verify"], flags: new Set(), opts: { input: "missing", signer: "cell" } }, reason: "certification-command-invalid" },
  ];
  for (const item of cases) {
    const result = await capture(item.command);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).reasonCode, item.reason);
  }
});

test("certification preflight has no legacy no-config environment fallback", async () => {
  process.env.REELIER_LIVE_CREDENTIAL_REF = "private-value";
  try {
    const result = await capture({ positional: ["certify", "preflight"], flags: new Set(), opts: { workspace: path.join(tmpdir(), "missing-certification-workspace") } });
    assert.equal(result.code, 1);
    const output = JSON.parse(result.stderr);
    assert.deepEqual(Object.keys(output).sort(), ["reasonCode", "status"]);
    assert.equal(output.reasonCode, "certification-selection-invalid");
    assert.doesNotMatch(result.stderr, /private-value|REELIER_LIVE_CREDENTIAL_REF/);
  } finally { delete process.env.REELIER_LIVE_CREDENTIAL_REF; }
});

test("certification init, selected preflight, seal, export, and offline verify emit closed honest JSON", async () => {
  const { configPath, workspace } = await fixture();
  const init = await capture({ positional: ["certify", "init"], flags: new Set(), opts: { config: configPath } });
  assert.equal(init.code, 0);
  const initialized = JSON.parse(init.stdout);
  assert.deepEqual(Object.keys(initialized).sort(), ["configDigest", "identifiers", "status", "workspace"]);
  assert.doesNotMatch(init.stdout, /REELIER_GITHUB_TOKEN/);
  await writeCertificationInputManifests(workspace, ["github-issue-labels"]);

  const preflight = await capture({ positional: ["certify", "preflight"], flags: new Set(), opts: { workspace, scenario: "github-issue-labels" } });
  assert.equal(preflight.code, 0);
  const report = JSON.parse(preflight.stdout);
  assert.deepEqual(report.scenarios, ["github-issue-labels"]);
  assert.equal(report.completeness, "unchecked");
  assert.equal(report.preparationReady, true);

  const seal = await capture({ positional: ["certify", "seal-readiness"], flags: new Set(), opts: { workspace, scenario: "github-issue-labels" } });
  assert.equal(seal.code, 0);
  const sealed = JSON.parse(seal.stdout);
  assert.deepEqual(Object.keys(sealed).sort(), ["authorization", "digest", "dispatchable", "path", "preparationReady", "signatureStatus", "status"]);
  assert.equal(sealed.status, "awaiting-human-signature");
  assert.equal(sealed.dispatchable, false);

  const exportedResult = await capture({ positional: ["certify", "export"], flags: new Set(), opts: { workspace, scenario: "github-issue-labels" } });
  assert.equal(exportedResult.code, 0);
  const exported = JSON.parse(exportedResult.stdout);
  const verifiedResult = await capture({ positional: ["certify", "verify"], flags: new Set(), opts: { input: exported.path } });
  assert.equal(verifiedResult.code, 0);
  const verified = JSON.parse(verifiedResult.stdout);
  assert.deepEqual(verified.claims, { providerCertification: "unchecked", signatureVerification: "unchecked", completion: "unchecked", completeness: "unchecked" });
  assert.equal(verified.authorization, "absent");
  assert.equal(verified.dispatchable, false);

  const bundle = JSON.parse(await readFile(exported.path, "utf8"));
  bundle.artifacts.readiness.dispatchable = true;
  await chmod(exported.path, 0o600);
  await writeFile(exported.path, JSON.stringify(bundle), "utf8");
  const tampered = await capture({ positional: ["certify", "verify"], flags: new Set(), opts: { input: exported.path } });
  assert.equal(tampered.code, 1);
  assert.deepEqual(Object.keys(JSON.parse(tampered.stderr)).sort(), ["reasonCode", "status"]);
});

test("selection-requiring certification commands reject unknown flags, IDs, conflicts, and extra positionals", async () => {
  const { configPath, workspace } = await fixture();
  assert.equal((await capture({ positional: ["certify", "init"], flags: new Set(), opts: { config: configPath } })).code, 0);
  const cases: (Parameters<typeof runAuthorityCommand>[0])[] = [];
  for (const action of ["preflight", "seal-readiness", "export"]) {
    cases.push(
      { positional: ["certify", action, "extra"], flags: new Set(["all"]), opts: { workspace } },
      { positional: ["certify", action], flags: new Set(["unknown"]), opts: { workspace, scenario: "github-issue-labels" } },
      { positional: ["certify", action], flags: new Set(["all"]), opts: { workspace, scenario: "github-issue-labels" } },
      { positional: ["certify", action], flags: new Set(), opts: { workspace, scenario: "unknown-scenario" } },
      { positional: ["certify", action], flags: new Set(), opts: { workspace } },
    );
  }
  for (const command of cases) {
    const result = await capture(command);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).reasonCode, "certification-selection-invalid");
  }
});

test("sign-readiness refuses noninteractive invocation and has no auto-sign path", async () => {
  const result = await capture({
    positional: ["certify", "sign-readiness"],
    flags: new Set(),
    opts: { workspace: "missing", candidate: "missing", key: "missing", descriptors: "missing", "trust-events": "missing" },
  });
  assert.equal(result.code, 1);
  assert.deepEqual(JSON.parse(result.stderr), { status: "refused", reasonCode: "certification-interactive-confirmation-required" });
});
