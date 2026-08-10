import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { randomBytes } from "node:crypto";
import { signAuthorityDigest, verifyAuthoritySignature } from "./crypto.js";
import { authorityDigest } from "./wire.js";
import { loadAuthorityHostConfig, validateAuthorityHostConfig } from "./host/config.js";
import { createAuthorityHostServer, type AuthorityHostRuntime } from "./host/server.js";
import { firstPartyPacks } from "../packs/index.js";
import { verifyAuthorityReceiptBundle } from "./verify.js";
import { createArtifactStore } from "./host/artifacts.js";
import { runFirstPartyPackConformance } from "../packs/conformance.js";
import { createLocalAuthorityRuntime } from "./host/local.js";
import { createCertificationPreflight } from "./host/certification.js";
import { verifyReleaseEvidenceManifest } from "./host/release-evidence.js";
import { inspectCertificationSecretReferences, parseCertificationOperatorConfig, probePinnedCodexBinary } from "./host/certification-config.js";
import { createFounderCertificationSourceAdapter } from "./host/founder-source-adapter.js";
import { createFounderJsonHttpsDispatchAdapter } from "./host/founder-dispatch-adapter.js";
import { createCodexDogfoodPlan } from "./host/codex-dogfood.js";
import { launchCodexDogfood, materializeCodexDogfood, probeCodexLogin } from "./host/codex-launcher.js";
import { createFilePrincipalRegistry } from "./host/principal-registry.js";
import { runTopologyProbeCommand } from "./host/topology-probe-command.js";
import { createFlyRemoteTopologyOperations, probePinnedFlyBinary } from "./host/fly-remote-probe.js";
import { runFlyCertification } from "./host/fly-certification.js";
import { loadOrCreateLocalGateSigner } from "./host/gate-signer.js";
import { createAuthorityEgressGateway } from "./host/egress-gateway.js";
import { createSecretResolver } from "./host/secret-resolver.js";

export async function runAuthorityCommand(args: Readonly<{ positional: string[]; flags: Set<string>; opts: Record<string, string> }>): Promise<number> {
  const subcommand = args.positional[0] ?? "doctor";
  switch (subcommand) {
    case "init": return authorityInit(args);
    case "doctor": return authorityDoctor(args);
    case "validate": return authorityValidate(args);
    case "sign": return authoritySign(args);
    case "verify": return authorityVerify(args);
    case "serve": return authorityServe(args);
    case "conformance": return authorityConformance(args);
    case "certify": return authorityCertify(args);
    case "topology-probe": return authorityTopologyProbe(args);
    case "egress-gateway": return authorityEgressGateway(args);
    default: console.error(`unknown authority command: ${subcommand}`); return 1;
  }
}

async function authorityEgressGateway(args: Readonly<{ opts: Record<string, string> }>): Promise<number> {
  const configPath = args.opts.config;
  if (!configPath) { console.error(JSON.stringify({ status: "refused", reasonCode: "egress-gateway-config-required" })); return 1; }
  try {
    const rawPort = args.opts.port ?? "8443";
    if (!/^[1-9][0-9]{0,4}$/.test(rawPort) || Number(rawPort) > 65535) throw new TypeError("egress gateway port is invalid");
    const host = args.opts.host ?? "::";
    const config = JSON.parse(await readFile(path.resolve(configPath), "utf8"));
    const gateway = createAuthorityEgressGateway({ config, secrets: createSecretResolver() });
    const address = await gateway.start(Number(rawPort), host);
    console.error(JSON.stringify({ status: "ready", service: "authority-egress-gateway", host: address.host, port: address.port }));
    return 0;
  } catch (error) {
    console.error(JSON.stringify({ status: "refused", reasonCode: "egress-gateway-unavailable", message: error instanceof Error ? error.message : String(error) }));
    return 1;
  }
}

async function authorityTopologyProbe(args: Readonly<{ positional: string[]; opts: Record<string, string> }>): Promise<number> {
  const action = args.positional[1];
  const argument = args.positional[2];
  const configPath = args.opts.config;
  if ((action !== "snapshot" && action !== "egress") || !argument || !configPath) {
    console.error(JSON.stringify({ status: "refused", reasonCode: "topology-probe-input-required" }));
    return 1;
  }
  try {
    const config = JSON.parse(await readFile(path.resolve(configPath), "utf8"));
    const result = await runTopologyProbeCommand({ action, argument, config });
    console.log(JSON.stringify(result));
    return 0;
  } catch (error) {
    console.error(JSON.stringify({ status: "refused", reasonCode: "topology-probe-failed", message: error instanceof Error ? error.message : String(error) }));
    return 1;
  }
}

export type AuthorityServeMode =
  | Readonly<{ transport: "stdio" }>
  | Readonly<{ transport: "http"; host: string; port: number }>;

/** Parse the host-owned serving boundary. Network exposure is always explicit. */
export function parseAuthorityServeMode(opts: Readonly<Record<string, string>>): AuthorityServeMode {
  const transport = opts.transport ?? "stdio";
  if (transport === "stdio") {
    if (opts.host !== undefined || opts.port !== undefined) throw new TypeError("stdio authority transport does not accept host or port");
    return Object.freeze({ transport: "stdio" });
  }
  if (transport !== "http") throw new TypeError("authority serve transport must be stdio or http");
  const rawPort = opts.port ?? "8080";
  if (!/^[1-9][0-9]{0,4}$/.test(rawPort)) throw new TypeError("authority HTTP port is invalid");
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port > 65535) throw new TypeError("authority HTTP port is invalid");
  const host = opts.host ?? "127.0.0.1";
  if (!/^[A-Za-z0-9.:[\]-]{1,253}$/.test(host)) throw new TypeError("authority HTTP host is invalid");
  return Object.freeze({ transport: "http", host, port });
}

async function authorityInit(args: Readonly<{ opts: Record<string, string> }>): Promise<number> {
  const root = path.resolve(args.opts.path ?? "authority");
  await Promise.all(["contracts", "trust", "connectors", "receipts", "decisions", "ledger", "keys"].map(dir => mkdir(path.join(root, dir), { recursive: true })));
  const configPath = path.join(root, "authority.yml");
  const config = {
    version: 1, tenant: "local", requester: "operator", definitions: firstPartyPacks.map(pack => pack.definition.alias), topology: "same-user",
    ledgerDir: "ledger", decisionDir: "decisions", receiptDir: "receipts", gateKeyFile: "keys/local-gate.pem",
    ingress: { allowedRequester: "operator" }, endpoints: [],
  };
  try { await readFile(configPath, "utf8"); console.log(`authority already initialized: ${configPath}`); return 0; } catch { /* create below */ }
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  for (const pack of firstPartyPacks) {
    const definition = pack.definition;
    const template = {
      v: "reelier.outcome-contract-template/v1",
      status: "unsigned-template",
      alias: definition.alias,
      packDigest: definition.packDigest,
      definitionDigest: definition.definitionDigest,
      resolverId: definition.resolverId,
      projectionSchemaId: definition.projectionSchemaId,
      readEndpointIds: definition.readEndpointIds,
      writeEndpointIds: definition.writeEndpointIds,
      riskClasses: definition.riskClasses,
      policySchemaId: definition.policySchemaId,
      requiredGroundedPointers: definition.requiredGroundedPointers,
      manifest: pack.manifest,
      note: "Template only. Add a signed contract, delegation, trust, account, and activation state before deployment.",
    };
    await writeFile(path.join(root, "contracts", `${definition.alias}.template.json`), `${JSON.stringify(template, null, 2)}\n`, "utf8");
  }
  console.log(`initialized authority workspace at ${root}`);
  return 0;
}

async function authorityDoctor(args: Readonly<{ opts: Record<string, string>; flags: Set<string> }>): Promise<number> {
  const file = args.opts.path ?? "authority/authority.yml";
  try {
    const loaded = await loadAuthorityHostConfig(file);
    const root = path.dirname(loaded.file);
    const entries = async (directory: string, suffix?: string): Promise<number> => {
      try { return (await readdir(path.join(root, directory))).filter(name => !suffix || name.endsWith(suffix)).length; } catch { return 0; }
    };
    const exists = async (directory: string): Promise<boolean> => { try { await access(path.join(root, directory)); return true; } catch { return false; } };
    const [contracts, trust, connectors, ledger, decisions, receipts] = await Promise.all([
      entries("contracts", ".json"), entries("trust"), entries("connectors", ".json"), exists(path.relative(root, loaded.config.ledgerDir)), exists(path.relative(root, loaded.config.decisionDir)), exists(path.relative(root, loaded.config.receiptDir)),
    ]);
    const checks: Record<string, string> = {
      config: "verified",
      // A config value is an operator claim, not proof that agents lack credentials or
      // direct provider egress. Keep the claim visible separately and leave evidence
      // unchecked until a live topology probe establishes it.
      topology: "unchecked",
      topologyDeclaration: loaded.config.topology ?? "unknown",
      ingress: loaded.config.ingress?.bearerRef || loaded.config.ingress?.principalRegistryFile ? "verified" : "unchecked",
      contracts: contracts > 0 ? "configured" : "unchecked",
      trust: trust > 0 ? "configured" : "unchecked",
      connectors: connectors > 0 ? "configured" : "unchecked",
      ledger: ledger ? "configured" : "missing",
      decisions: decisions ? "configured" : "missing",
      receipts: receipts ? "configured" : "missing",
      endpoints: loaded.config.endpoints.length ? "configured" : "unchecked",
      cloud: loaded.config.cloud ? "configured" : "unchecked",
      live: args.flags.has("live") ? "unchecked" : "not-run",
    };
    console.log(JSON.stringify({ ok: true, file: loaded.file, digest: loaded.digest, checks }, null, 2));
    return 0;
  } catch (error) { console.error(JSON.stringify({ ok: false, reasonCode: "invalid-config", message: error instanceof Error ? error.message : String(error) })); return 1; }
}

async function authorityValidate(args: Readonly<{ opts: Record<string, string> }>): Promise<number> {
  try { const loaded = await loadAuthorityHostConfig(args.opts.path ?? "authority/authority.yml"); console.log(JSON.stringify({ valid: true, digest: loaded.digest })); return 0; }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); return 1; }
}

async function authoritySign(args: Readonly<{ opts: Record<string, string> }>): Promise<number> {
  const inputPath = args.opts.input ?? args.opts.path;
  const outputPath = args.opts.out ?? inputPath;
  const keyPath = args.opts.key;
  if (!inputPath || !outputPath || !keyPath) { console.error("authority sign requires --input/--path, --out, and --key"); return 1; }
  const value = JSON.parse(await readFile(path.resolve(inputPath), "utf8")) as Record<string, unknown>;
  const kind = value.kind as Parameters<typeof signAuthorityDigest>[1];
  const artifact = (value.value ?? value) as Record<string, unknown>;
  const digest = authorityDigest(artifact);
  const privateKey = createPrivateKey(await readFile(path.resolve(keyPath)));
  const signed = { kind, signerId: String(value.signerId ?? "operator"), digest, value: artifact, signature: signAuthorityDigest(privateKey, kind, digest) };
  await writeFile(path.resolve(outputPath), `${JSON.stringify(signed, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ signed: true, digest })); return 0;
}

async function authorityVerify(args: Readonly<{ opts: Record<string, string> }>): Promise<number> {
  const inputPath = args.opts.input ?? args.opts.path;
  const keyPath = args.opts.key;
  if (!inputPath || !keyPath) { console.error("authority verify requires --input/--path and --key"); return 1; }
  try {
    const parsed = JSON.parse(await readFile(path.resolve(inputPath), "utf8")) as Record<string, unknown>;
    if (parsed.v === "reelier.authority-receipt-bundle/v1") {
      const tenant = args.opts.tenant; if (!tenant) throw new Error("portable bundle verification requires --tenant");
      const publicKey = createPublicKey(await readFile(path.resolve(keyPath)));
      const result = verifyAuthorityReceiptBundle(parsed, { tenant, trustRoots: [{ tenant, signerId: String(args.opts.signer ?? "operator"), principalId: String(args.opts.signer ?? "operator"), publicKey, purposes: ["outcome-contract", "delegation-grant", "source-bundle", "compiled-capability", "transport-effect", "gate-event", "authority-evidence", "authority-receipt", "pack-manifest"] }] });
      console.log(JSON.stringify({ valid: true, digest: result.digest, claims: result.claims })); return 0;
    }
    const artifact = parsed as { kind: Parameters<typeof verifyAuthoritySignature>[1]; digest: string; value: Record<string, unknown>; signature: { alg: "ed25519"; sig: string } };
    const recomputed = authorityDigest(artifact.value);
    const publicKey = createPublicKey(await readFile(path.resolve(keyPath)));
    const valid = recomputed === artifact.digest && verifyAuthoritySignature(publicKey, artifact.kind, artifact.digest, artifact.signature);
    console.log(JSON.stringify({ valid, digest: recomputed, claims: { authorization: valid ? "verified" : "failed", completeness: "unchecked" } })); return valid ? 0 : 1;
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); return 1; }
}

async function authorityServe(args: Readonly<{ opts: Record<string, string> }>): Promise<number> {
  const serveMode = parseAuthorityServeMode(args.opts);
  const loaded = await loadAuthorityHostConfig(args.opts.path ?? "authority/authority.yml");
  const artifactRoot = path.dirname(loaded.file);
  const artifactDataKey = await loadOrCreateArtifactKey(artifactRoot, "artifact-data.key");
  const artifactMasterKey = await loadOrCreateArtifactKey(artifactRoot, "artifact-master.key");
  const artifactStore = createArtifactStore({ tenant: loaded.config.tenant, key: artifactDataKey, masterKey: artifactMasterKey, rootDir: path.join(loaded.config.receiptDir, "artifacts") });
  const certificationConfig = args.opts["certification-config"]
    ? parseCertificationOperatorConfig(JSON.parse(await readFile(path.resolve(args.opts["certification-config"]), "utf8")))
    : undefined;
  const authorityRuntime = await createLocalAuthorityRuntime(loaded.config, certificationConfig ? {
    sourceReadAdapter: createFounderCertificationSourceAdapter({ config: certificationConfig, handles: { githubIssue: "certification_github_issue", cloudflareRecord: "certification_cloudflare_record", slackChannel: "certification_slack_channel" } }),
    dispatchAdapter: createFounderJsonHttpsDispatchAdapter({ config: certificationConfig }),
  } : {});
  const runtime: AuthorityHostRuntime = {
    outcome: authorityRuntime.outcome,
    status: authorityRuntime.status,
    jobsSearch: authorityRuntime.jobsSearch,
    jobLoad: authorityRuntime.jobLoad,
    invoke: authorityRuntime.invoke,
    async artifactStage(input) {
      const value = input as Record<string, unknown>;
      const requestId = typeof value?.requestId === "string" ? value.requestId : "";
      if (typeof value?.text !== "string" || value.mediaType !== "text/plain") return { requestId, verdict: "refused", reasonCode: "invalid-artifact", lifecycleState: "refused" };
      const staged = await artifactStore.stage({ mediaType: "text/plain", bytes: Buffer.from(value.text, "utf8"), sourceBinding: typeof value.sourceBinding === "string" ? value.sourceBinding : undefined });
      return { requestId, verdict: "accepted", reasonCode: "staged", lifecycleState: "staged", commitment: staged.commitment };
    },
  };
  const principalRegistry = loaded.config.ingress?.principalRegistryFile ? createFilePrincipalRegistry({ tenant: loaded.config.tenant, file: loaded.config.ingress.principalRegistryFile }) : undefined;
  const server = createAuthorityHostServer(loaded.config, runtime, principalRegistry ? { principalRegistry } : {});
  if (serveMode.transport === "http") {
    await server.startHttp(serveMode.port, serveMode.host);
    console.error(JSON.stringify({ status: "ready", transport: "http", host: serveMode.host, port: serveMode.port }));
  } else {
    await server.startStdio();
  }
  return 0;
}

async function authorityCertify(args: Readonly<{ positional: string[]; flags: Set<string>; opts: Record<string, string> }>): Promise<number> {
  const action = args.positional[1] ?? "preflight";
  if (action === "preflight") {
    if (args.opts.config) {
      try {
        const config = parseCertificationOperatorConfig(JSON.parse(await readFile(path.resolve(args.opts.config), "utf8")));
        const secretStatuses = await inspectCertificationSecretReferences(config);
        const secretStatus = (owner: string, slot = "credential") => secretStatuses.find(item => item.owner === owner && item.slot === slot)?.status === "configured";
        const codexBinary = await probePinnedCodexBinary(config.codex.binaryPath, config.codex.version);
        const codexLogin = codexBinary === "available" ? await probeCodexLogin(config.codex.binaryPath, config.codex.codexHomePath) : "missing";
        const codex = codexBinary === "available" && codexLogin === "available" ? "available" : "missing";
        const flyBinary = await probePinnedFlyBinary(config.fly.flyctlPath, config.fly.flyctlVersion);
        const packageVersion = process.env.npm_package_version ?? "0.32.0";
        const base = createCertificationPreflight({
          packageVersion,
          expectedPackageVersion: "0.32.0",
          cloud: { deploymentId: process.env.REELIER_CLOUD_DEPLOYMENT_ID ?? "", status: process.env.REELIER_CLOUD_DEPLOYMENT_STATUS === "ready" ? "ready" : "unknown" },
          migrations: { status: process.env.REELIER_MIGRATIONS_DIGEST ? "applied" : "unknown", digest: process.env.REELIER_MIGRATIONS_DIGEST ?? "sha256:" + "0".repeat(64) },
          runtime: { codex, fly: secretStatus("fly", "api") && secretStatus("fly", "egress") && flyBinary === "available" ? "available" : "missing" },
          resources: Object.entries(config.providers).map(([provider, resource]) => ({ provider, accountId: resource.accountId, credentialRef: secretStatus(provider) ? "configured" : undefined, cleanupRef: resource.cleanupRef })),
        });
        const extraMissing = secretStatuses.filter(item => item.status === "missing").map(item => `secret:${item.owner}:${item.slot}`);
        if (codexBinary === "available" && codexLogin === "missing") extraMissing.push("runtime:codex-authentication");
        if (flyBinary === "missing") extraMissing.push("runtime:flyctl-version");
        const missing = Object.freeze([...new Set([...base.missing, ...extraMissing])].sort());
        const { digest: _baseDigest, ...baseBody } = base;
        void _baseDigest;
        const body = { ...baseBody, ok: missing.length === 0, missing, nextActions: Object.freeze(missing.map(item => `provide ${item}`)) };
        const report = Object.freeze({ ...body, digest: authorityDigest(body) });
        console.log(JSON.stringify(report, null, 2));
        return report.ok ? 0 : 1;
      } catch (error) {
        console.error(JSON.stringify({ ok: false, reasonCode: "invalid-certification-config", message: error instanceof Error ? error.message : String(error) }));
        return 1;
      }
    }
    const packageVersion = process.env.npm_package_version ?? "0.32.0";
    const providers = ["github", "vercel", "neon", "cloudflare", "hubspot", "slack", "codex", "fly"] as const;
    const resources = providers.map(provider => {
      const envName = provider.toUpperCase().replace(/-/g, "_");
      const current = process.env.REELIER_LIVE_PROVIDER === provider;
      return { provider, accountId: process.env[`REELIER_CERTIFY_${envName}_ACCOUNT`] ?? (current ? process.env.REELIER_LIVE_ACCOUNT : undefined) ?? "", credentialRef: process.env[`REELIER_CERTIFY_${envName}_CREDENTIAL_REF`] ?? (current ? process.env.REELIER_LIVE_CREDENTIAL_REF : undefined), cleanupRef: process.env[`REELIER_CERTIFY_${envName}_CLEANUP_REF`] ?? (current ? process.env.REELIER_LIVE_CLEANUP_REF : undefined) };
    });
    const migrationDigest = process.env.REELIER_MIGRATIONS_DIGEST ?? "sha256:" + "0".repeat(64);
    const report = createCertificationPreflight({
      packageVersion,
      expectedPackageVersion: "0.32.0",
      cloud: { deploymentId: process.env.REELIER_CLOUD_DEPLOYMENT_ID ?? "", status: process.env.REELIER_CLOUD_DEPLOYMENT_STATUS === "ready" ? "ready" : "unknown" },
      migrations: { status: process.env.REELIER_MIGRATIONS_DIGEST ? "applied" : "unknown", digest: migrationDigest },
      runtime: { codex: process.env.REELIER_CODEX_BIN ? "available" : "missing", fly: process.env.REELIER_FLY_APP ? "available" : "missing" },
      resources,
    });
    console.log(JSON.stringify(report, null, 2));
    return report.ok ? 0 : 1;
  }
  if (action === "run") {
    if (process.env.REELIER_LIVE_CERTIFY !== "1") { console.error(JSON.stringify({ status: "refused", reasonCode: "live-acknowledgement-required" })); return 1; }
    if (args.opts.adapter === "codex-ten-agent") {
      if (!args.opts.config) { console.error(JSON.stringify({ status: "refused", reasonCode: "certification-config-required" })); return 1; }
      try {
        const config = parseCertificationOperatorConfig(JSON.parse(await readFile(path.resolve(args.opts.config), "utf8")));
        const plan = createCodexDogfoodPlan({ taskId: config.codex.taskId, endpoint: config.codex.authorityEndpoint });
        const materialized = await materializeCodexDogfood({ plan, workspace: config.codex.workspacePath, codexHome: config.codex.codexHomePath, evidenceDirectory: config.evidenceDirectory });
        const result = await launchCodexDogfood({ plan, binaryPath: config.codex.binaryPath, expectedVersion: config.codex.version, codexHome: config.codex.codexHomePath, workspace: config.codex.workspacePath, evidenceDirectory: config.evidenceDirectory, sessionCredentialDirectory: config.codex.sessionCredentialDirectory, materialized });
        console.log(JSON.stringify({ status: result.exitCode === 0 ? "completed" : "failed", adapter: "codex-ten-agent", exitCode: result.exitCode, stdoutPath: result.stdoutPath, stderrPath: result.stderrPath, identityMapPath: result.identityMapPath, hookEvidenceDirectory: result.hookEvidenceDirectory }, null, 2));
        return result.exitCode === 0 ? 0 : 1;
      } catch (error) { console.error(JSON.stringify({ status: "refused", reasonCode: "codex-dogfood-unavailable", message: error instanceof Error ? error.message : String(error) })); return 1; }
    }
    if (args.opts.adapter === "fly-topology") {
      if (!args.opts.config) { console.error(JSON.stringify({ status: "refused", reasonCode: "certification-config-required" })); return 1; }
      try {
        const config = parseCertificationOperatorConfig(JSON.parse(await readFile(path.resolve(args.opts.config), "utf8")));
        if (await probePinnedFlyBinary(config.fly.flyctlPath, config.fly.flyctlVersion) !== "available") throw new Error("pinned flyctl binary is unavailable");
        const loaded = await loadAuthorityHostConfig(config.authorityConfigPath);
        const endpoints = Object.values(config.providers).map(provider => new URL(provider.apiBaseUrl).hostname.toLowerCase()).sort();
        const operations = createFlyRemoteTopologyOperations({
          resource: config.fly,
          expected: {
            providerEndpoints: endpoints,
            schemaDigest: config.fly.schemaDigest,
            networkPolicyDigest: config.fly.networkPolicyDigest,
            runtimeImageDigest: config.fly.agentImageDigest,
            authorityImageDigest: config.fly.authorityImageDigest,
            gatewayImageDigest: config.fly.gatewayImageDigest,
          },
        });
        const observedAt = new Date();
        const expiresAt = new Date(observedAt.getTime() + 60_000);
        const signer = await loadOrCreateLocalGateSigner(loaded.config.gateKeyFile ?? path.join(path.dirname(loaded.file), "keys", "local-gate.pem"));
        const result = await runFlyCertification({
          declaredSurface: { providerEndpoints: endpoints, rawWriteRouteIds: [], schemaDigest: config.fly.schemaDigest, networkPolicyDigest: config.fly.networkPolicyDigest, runtimeImageDigest: config.fly.agentImageDigest },
          operations,
          tenant: loaded.config.tenant,
          observedAt: observedAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          nonce: randomBytes(24).toString("hex"),
          signer: { signerId: "authority-cell", privateKey: signer.privateKey },
        });
        await mkdir(path.resolve(config.evidenceDirectory), { recursive: true });
        const output = path.join(path.resolve(config.evidenceDirectory), `topology-${result.evidenceDigest.slice(7, 23)}.json`);
        await writeFile(output, `${JSON.stringify(result.signed ?? result, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        console.log(JSON.stringify({ status: "verified", adapter: "fly-topology", evidenceDigest: result.evidenceDigest, output }, null, 2));
        return 0;
      } catch (error) { console.error(JSON.stringify({ status: "refused", reasonCode: "fly-topology-unavailable", message: error instanceof Error ? error.message : String(error) })); return 1; }
    }
    console.error(JSON.stringify({ status: "refused", reasonCode: "adapter-runner-not-configured", adapter: args.opts.adapter ?? null }));
    return 1;
  }
  if (action === "verify") {
    const inputPath = args.opts.input;
    const keyPath = args.opts.key;
    if (!inputPath || !keyPath) { console.error("authority certify verify requires --input and --key"); return 1; }
    try {
      const { createPublicKey } = await import("node:crypto");
      const manifest = JSON.parse(await readFile(path.resolve(inputPath), "utf8"));
      const publicKey = createPublicKey(await readFile(path.resolve(keyPath)));
      const verified = verifyReleaseEvidenceManifest(manifest, { signerId: args.opts.signer ?? "cell", publicKey });
      console.log(JSON.stringify({ valid: true, digest: verified.digest, packageVersion: verified.manifest.package.version }));
      return 0;
    } catch (error) { console.error(JSON.stringify({ valid: false, reasonCode: "release-evidence-invalid", message: error instanceof Error ? error.message : String(error) })); return 1; }
  }
  console.error(`unknown authority certify action: ${action}`);
  return 1;
}

async function loadOrCreateArtifactKey(root: string, name = "artifact-master.key"): Promise<Buffer> {
  const file = path.join(root, "trust", name);
  try { const existing = await readFile(file); if (existing.length === 32) return existing; } catch { /* create below */ }
  const key = randomBytes(32); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, key, { mode: 0o600 }); return key;
}

async function authorityConformance(args: Readonly<{ opts: Record<string, string> }>): Promise<number> {
  const aliases = args.opts.pack ? [args.opts.pack] : firstPartyPacks.map(pack => pack.definition.alias);
  const unknown = aliases.filter(alias => !firstPartyPacks.some(pack => pack.definition.alias === alias));
  if (unknown.length) { console.error(`unknown pack: ${unknown.join(", ")}`); return 1; }
  try {
    const report = runFirstPartyPackConformance();
    const selected = report.aliases.filter(alias => aliases.includes(alias));
    console.log(JSON.stringify({ conformance: selected.length === aliases.length ? "passed" : "failed", packs: selected, corpus: "shared-v1", checks: report.checks, passed: report.passed, caseIds: report.caseIds }));
    return selected.length === aliases.length ? 0 : 1;
  } catch (error) { console.error(JSON.stringify({ conformance: "failed", packs: aliases, corpus: "shared-v1", reasonCode: "pack-conformance-failed", message: error instanceof Error ? error.message : String(error) })); return 1; }
}
