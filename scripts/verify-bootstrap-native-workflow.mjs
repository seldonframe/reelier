import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = readFileSync(path.join(root, ".github", "workflows", "ci.yml"), "utf8");
const required = [
  "build-bootstrap-native:", "os: ubuntu-latest", "target: linux-x64", "os: windows-latest", "target: win32-x64",
  "node scripts/build-bootstrap-native.mjs --target ${{ matrix.target }}", "native-bootstrap-${{ matrix.target }}",
  "assemble-bootstrap-native:", "node scripts/assemble-bootstrap-native-artifacts.mjs", "node scripts/verify-bootstrap-native-artifacts.mjs",
  "native-bootstrap-universal",
];
const missing = required.filter(value => !workflow.includes(value));
if (missing.length > 0) { process.stderr.write(`native bootstrap workflow refused: missing ${missing.join(", ")}\n`); process.exit(1); }
process.stdout.write("native bootstrap workflow verified\n");

