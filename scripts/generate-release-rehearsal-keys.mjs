#!/usr/bin/env node
// One-shot, rehearsal-only Ed25519 ceremony. The output directory is atomically published and is
// never reused. Private key bytes are written mode 0600 and never printed; stdout carries only
// signer ids and SHA-256 digests of public SPKI bytes.

import { createHash, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const IDENTITIES = Object.freeze([
  { name: "authorization", signerId: "reelier.rehearsal-authority.2026", purpose: "release-authorization" },
  { name: "evidence", signerId: "reelier.rehearsal-evidence.2026", purpose: "release-evidence" },
  { name: "graph-maker", signerId: "reelier.rehearsal-graph-maker.2026", purpose: "release-receipt-graph" },
]);

function fail(message) {
  process.stderr.write(`release rehearsal key ceremony: ${message}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write("Usage: node scripts/generate-release-rehearsal-keys.mjs --out <new-directory>\n");
  process.exit(0);
}
if (argv.length !== 2 || argv[0] !== "--out" || !argv[1] || argv[1].startsWith("--")) fail("exactly --out <new-directory> is required");
const out = path.resolve(argv[1]);
if (existsSync(out)) fail(`output ${out} already exists; rehearsal keys are never overwritten or reused`);
const parent = path.dirname(out);
if (!existsSync(parent)) fail(`parent directory ${parent} does not exist`);

const generated = IDENTITIES.map(identity => {
  const pair = generateKeyPairSync("ed25519");
  const publicDer = pair.publicKey.export({ format: "der", type: "spki" });
  return Object.freeze({
    ...identity,
    pair,
    publicKeySpkiBase64: publicDer.toString("base64"),
    publicKeySpkiDigest: `sha256:${createHash("sha256").update(publicDer).digest("hex")}`,
  });
});
if (new Set(generated.map(identity => identity.publicKeySpkiDigest)).size !== generated.length) fail("generated rehearsal identities are not distinct");

const stage = mkdtempSync(path.join(parent, `.${path.basename(out)}.`));
try {
  const byName = new Map(generated.map(identity => [identity.name, identity]));
  const writePrivate = (file, identity) => writeFileSync(path.join(stage, file), identity.pair.privateKey.export({ format: "pem", type: "pkcs8" }), { flag: "wx", mode: 0o600 });
  writePrivate("authorization.key.pem", byName.get("authorization"));
  writePrivate("evidence.key.pem", byName.get("evidence"));
  writePrivate("graph-maker.key.pem", byName.get("graph-maker"));
  writeFileSync(path.join(stage, "release-authority.pub.pem"), byName.get("authorization").pair.publicKey.export({ format: "pem", type: "spki" }), { flag: "wx", mode: 0o644 });
  writeFileSync(path.join(stage, "graph-maker.pub.pem"), byName.get("graph-maker").pair.publicKey.export({ format: "pem", type: "spki" }), { flag: "wx", mode: 0o644 });
  const trustPin = {
    publicKeySpkiBase64: byName.get("authorization").publicKeySpkiBase64,
    signerId: byName.get("authorization").signerId,
    v: "reelier.release-authorization-trust-pin/v1",
  };
  writeFileSync(path.join(stage, "trust-pin.json"), `${JSON.stringify(trustPin, null, 2)}\n`, { flag: "wx", mode: 0o644 });
  const manifest = {
    v: "reelier.release-rehearsal-key-manifest/v1",
    identities: generated.map(({ name, signerId, purpose, publicKeySpkiBase64, publicKeySpkiDigest }) => ({ name, purpose, publicKeySpkiBase64, publicKeySpkiDigest, signerId })),
  };
  writeFileSync(path.join(stage, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o644 });
  renameSync(stage, out);
} catch (error) {
  rmSync(stage, { recursive: true, force: true });
  fail(`could not atomically publish the rehearsal key set: ${error instanceof Error ? error.message : String(error)}`);
}

process.stdout.write("release rehearsal keys generated (private material not shown):\n");
for (const identity of generated) process.stdout.write(`  ${identity.purpose}: ${identity.signerId} ${identity.publicKeySpkiDigest}\n`);
process.stdout.write(`trust pin: ${path.join(out, "trust-pin.json")}\n`);
