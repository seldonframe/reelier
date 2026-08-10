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
    default: console.error(`unknown authority command: ${subcommand}`); return 1;
  }
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
      ingress: loaded.config.ingress?.bearerRef ? "verified" : "unchecked",
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
  const loaded = await loadAuthorityHostConfig(args.opts.path ?? "authority/authority.yml");
  const artifactRoot = path.dirname(loaded.file);
  const artifactDataKey = await loadOrCreateArtifactKey(artifactRoot, "artifact-data.key");
  const artifactMasterKey = await loadOrCreateArtifactKey(artifactRoot, "artifact-master.key");
  const artifactStore = createArtifactStore({ tenant: loaded.config.tenant, key: artifactDataKey, masterKey: artifactMasterKey, rootDir: path.join(loaded.config.receiptDir, "artifacts") });
  const authorityRuntime = await createLocalAuthorityRuntime(loaded.config);
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
  const server = createAuthorityHostServer(loaded.config, runtime);
  await server.startStdio();
  return 0;
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
