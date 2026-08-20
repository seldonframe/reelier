#!/usr/bin/env node
// Re-pins only the release-authorization verifier in an existing Cell runner config. This is an
// operator-side transformation: it accepts a public trust pin, never a private key or credential,
// preserves the configured provider repository, and validates the result through the production
// closed config parser before creating a new file.

import { createHash, createPublicKey } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function fail(message) {
  process.stderr.write(`Cell runner authority config preparer: ${message}\n`);
  process.exit(1);
}

const values = new Map();
const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write("Usage: node scripts/prepare-cell-runner-authority-config.mjs --in <runner.json> --trust-pin <pin.json> --repository <owner/name> --out <new.json>\n");
  process.exit(0);
}
for (let index = 0; index < argv.length; index += 1) {
  const flag = argv[index];
  if (!["--in", "--trust-pin", "--repository", "--out"].includes(flag) || values.has(flag)) fail(`unknown or duplicate argument ${flag}`);
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) fail(`${flag} requires a value`);
  values.set(flag, value);
  index += 1;
}
for (const flag of ["--in", "--trust-pin", "--repository", "--out"]) if (!values.has(flag)) fail(`${flag} is required`);
const inputFile = path.resolve(values.get("--in"));
const pinFile = path.resolve(values.get("--trust-pin"));
const outFile = path.resolve(values.get("--out"));
if (outFile === inputFile || outFile === pinFile || existsSync(outFile)) fail("--out must be a new file distinct from both inputs");

let input, pin;
try { input = JSON.parse(readFileSync(inputFile, "utf8")); } catch { fail("input runner config is absent or invalid JSON"); }
try { pin = JSON.parse(readFileSync(pinFile, "utf8")); } catch { fail("release trust pin is absent or invalid JSON"); }
if (!pin || typeof pin !== "object" || Array.isArray(pin) || Object.keys(pin).sort().join("\0") !== ["publicKeySpkiBase64", "signerId", "v"].sort().join("\0") || pin.v !== "reelier.release-authorization-trust-pin/v1") fail("release trust pin is not the closed v1 shape");
let publicDer;
try {
  publicDer = Buffer.from(pin.publicKeySpkiBase64, "base64");
  const key = createPublicKey({ key: publicDer, format: "der", type: "spki" });
  if (key.asymmetricKeyType !== "ed25519" || key.export({ format: "der", type: "spki" }).toString("base64") !== pin.publicKeySpkiBase64) throw new TypeError("noncanonical");
} catch { fail("release trust pin does not contain a canonical Ed25519 public SPKI"); }
if (typeof pin.signerId !== "string" || !/^[a-z0-9][a-z0-9._:-]{7,127}$/.test(pin.signerId)) fail("release trust pin signer identity is invalid");
if (input?.provider?.repository !== values.get("--repository")) fail("input runner config repository does not equal the explicit rehearsal repository");

const output = { ...input, releaseAuthority: { signerId: pin.signerId, publicKeySpkiBase64: pin.publicKeySpkiBase64 } };
const distRoot = process.env.REELIER_CELL_CONFIG_DIST
  ? pathToFileURL(path.resolve(process.env.REELIER_CELL_CONFIG_DIST) + path.sep).href
  : new URL("../dist/", import.meta.url).href;
let parser;
try { ({ parseGitHubReleaseRunnerOperatorConfig: parser } = await import(new URL("authority/host/github-release-runner-config.js", distRoot).href)); }
catch (error) { fail(`cannot load the production runner config parser; run npm run build first (${error instanceof Error ? error.message : String(error)})`); }
try { parser(output); } catch (error) { fail(`re-pinned runner config is refused by the production parser: ${error instanceof Error ? error.message : String(error)}`); }

try { writeFileSync(outFile, `${JSON.stringify(output, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 }); }
catch { fail(`cannot create output ${outFile}`); }
const spkiDigest = `sha256:${createHash("sha256").update(publicDer).digest("hex")}`;
process.stdout.write(`Cell runner release authority prepared: ${pin.signerId} ${spkiDigest}\n`);
process.stdout.write(`repository preserved: ${values.get("--repository")}\n`);
process.stdout.write(`output: ${outFile}\n`);
