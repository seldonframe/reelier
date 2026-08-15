import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

test("Linux Eve cleanup terminates the captured process group after its launcher exits", { skip: process.platform === "linux" ? false : "requires POSIX process groups" }, async () => {
  const moduleUrl = pathToFileURL(resolve("conformance/continuity-adapter/v1/eve-fixture/scripts/eve-process.mjs")).href;
  const { stopEveProcess } = await import(moduleUrl) as { stopEveProcess(child: ReturnType<typeof spawn>): Promise<void> };
  const leader = spawn(process.execPath, ["--input-type=module", "--eval", [
    'import { spawn } from "node:child_process";',
    'const descendant = spawn(process.execPath, ["--input-type=module", "--eval", "setInterval(() => {}, 1_000)"], { stdio: "inherit" });',
    'process.stdout.write(`${descendant.pid}\\n`);',
    "setTimeout(() => process.exit(0), 25);",
  ].join("")], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  assert.ok(leader.pid);
  const leaderPid = leader.pid;
  try {
    const descendantPid = Number(String((await once(leader.stdout!, "data"))[0]).trim());
    assert.equal(Number.isSafeInteger(descendantPid) && descendantPid > 0, true);
    await once(leader, "exit");
    assert.notEqual(leader.exitCode, null);
    assert.equal(processExists(descendantPid), true);

    await stopEveProcess(leader);

    assert.equal(await waitForProcessExit(descendantPid, 2_000), true, `descendant PID ${descendantPid} survived Eve cleanup`);
  } finally {
    try { process.kill(-leaderPid, "SIGKILL"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    leader.stdout?.destroy();
    leader.stderr?.destroy();
  }
});

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processExists(pid)) return true;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
  }
  return !processExists(pid);
}
