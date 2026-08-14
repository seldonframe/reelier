import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const NATIVE_LIVE_PINS = Object.freeze({
  candidateId: "sha256:e46498b6441a44e7de42264ebf243e4462aae6e4c4b3d33ed4276fcc50190e96",
  publicCommitSha: "03ac48e",
  tarballDigest: "sha256:0659c2f402002d733dfd2621c5d8cce5df301975606a3fcb1b802e492bec5309",
  packDigest: "sha256:8101632acbacaf2738b8a7e698b0fb301539163edc713a37e74df0a6d233d689",
  task9VerificationDigest: "sha256:9999999999999999999999999999999999999999999999999999999999999999",
});

const WORKFLOW_ENVIRONMENT = "native-github-live";
const AMBIGUOUS_SEND_POLICY = "ambiguous-send-no-resend";

function fail(message) {
  throw new Error(`refused: ${message}`);
}

function parseArgs(argv) {
  if (argv.length !== 4 || argv[0] !== "--candidate" || argv[2] !== "--mode" || !["preflight", "run"].includes(argv[3])) {
    fail("usage is --candidate <absolute-path> --mode <preflight|run>");
  }
  if (!path.isAbsolute(argv[1])) fail("candidate path must be absolute");
  return { candidatePath: path.resolve(argv[1]), mode: argv[3] };
}

function candidateMatchesPins(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  return Object.entries(NATIVE_LIVE_PINS).every(([key, expected]) => candidate[key] === expected);
}

export function validateWorkflowText(text) {
  const errors = [];
  if (!/^\s*workflow_dispatch:\s*(?:\{\s*\}|\n)/m.test(text)) errors.push("workflow_dispatch-only trigger required");
  for (const trigger of ["push", "pull_request", "schedule", "repository_dispatch"]) {
    if (new RegExp(`^\\s*${trigger}:`, "m").test(text)) errors.push(`automatic trigger ${trigger} is forbidden`);
  }
  if (!/permissions:\s*\n\s+contents:\s*read(?:\s|$)/m.test(text)) errors.push("contents: read permission required");
  if (!/environment:\s*\n\s+name:\s*native-github-live\b/.test(text)) errors.push("protected native-github-live environment required");
  if (!/matrix:\s*\n[\s\S]*os:\s*\n\s*-\s*ubuntu-latest\s*\n\s*-\s*windows-latest/m.test(text)) errors.push("explicit Ubuntu/Windows matrix required");
  for (const [key, expected] of Object.entries(NATIVE_LIVE_PINS)) if (!text.includes(expected)) errors.push(`missing immutable ${key} pin`);
  if (!/disposable[_-]?target/i.test(text)) errors.push("disposable target input required");
  if (/production/i.test(text)) errors.push("production target is forbidden");
  if (/continue-on-error|(^|\s)retry\b|timeout-minutes:\s*0/i.test(text)) errors.push("retry/continue-on-error is forbidden");
  if (/\$\{\{\s*secrets\.[^}]+\s*\}\}/.test(text) || /GITHUB_TOKEN\s*[:=]/.test(text)) errors.push("credential interpolation is forbidden");
  if (!/if:\s*\$\{\{[^}]*approved|approval|environment/i.test(text)) errors.push("approval gate required");
  const verify = text.search(/verify|preflight/i);
  const upload = text.search(/upload-artifact/);
  if (verify < 0 || upload < 0 || upload <= verify) errors.push("artifact upload must follow verification");
  if (/\b(write|send|delete|cleanup)\b/i.test(text.slice(0, Math.max(0, verify)))) errors.push("write-capable step before approval/preflight");
  return errors;
}

async function loadCandidate(candidatePath) {
  let raw;
  try {
    raw = await readFile(candidatePath, "utf8");
  } catch {
    fail("candidate cannot be read");
  }
  let candidate;
  try {
    candidate = JSON.parse(raw);
  } catch {
    fail("candidate is not JSON");
  }
  if (!candidateMatchesPins(candidate)) fail("candidate does not match the immutable Task 10 pins");
  return candidate;
}

async function main(argv = process.argv.slice(2)) {
  const { candidatePath, mode } = parseArgs(argv);
  await loadCandidate(candidatePath);
  if (mode === "run") {
    if (process.env.GITHUB_ACTIONS !== "true") fail("run mode is only available inside GitHub Actions");
    if (process.env.NATIVE_GITHUB_LIVE_APPROVED !== "true") fail("protected environment approval marker is absent");
    if (process.env.NATIVE_GITHUB_LIVE_EXECUTE !== "true") fail("explicit execution marker is absent; Gate 4 remains held");
    // This marker is deliberately the final stop in Task 11. Task 12 supplies the
    // separately approved hosted executor; this task never performs provider I/O.
    console.log(`status=held execution=not-authored-in-task-11 policy=${AMBIGUOUS_SEND_POLICY}`);
    return 78;
  }
  console.log("status=preflight-ok candidate=verified");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((status) => process.exitCode = status).catch((error) => {
    console.error(error instanceof Error ? error.message : "refused: invalid runner input");
    process.exitCode = 1;
  });
}
