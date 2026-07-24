// Cross-platform runner for `npm run test:fuzz` (no new deps: avoids
// shell-specific env-var syntax so this works the same on Windows/PowerShell
// and POSIX shells). Runs test/fuzz.test.ts alone, at a much higher
// per-property run count than the default `npm test` pass, for on-demand
// deep fuzzing. Not wired into CI — this is meant to be run by hand.
import { spawnSync } from "node:child_process";

const runs = process.env.FUZZ_RUNS ?? "20000";

const result = spawnSync(process.execPath, ["--test", "dist-test/test/fuzz.test.js"], {
  stdio: "inherit",
  env: { ...process.env, FUZZ_RUNS: runs },
});

process.exit(result.status ?? 1);
