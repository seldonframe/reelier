import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

test("Linux Eve cleanup kills a SIGTERM-resistant descendant after its launcher exits", { skip: process.platform === "linux" ? false : "requires POSIX process groups" }, async () => {
  const moduleUrl = pathToFileURL(resolve("conformance/continuity-adapter/v1/eve-fixture/scripts/eve-process.mjs")).href;
  const { stopEveProcess } = await import(moduleUrl) as { stopEveProcess(child: ReturnType<typeof spawn>): Promise<void> };
  const leader = spawn(process.execPath, ["--input-type=module", "--eval", [
    'import { spawn } from "node:child_process";',
    'const descendant = spawn(process.execPath, ["--input-type=module", "--eval", "process.on(\\"SIGTERM\\", () => {});process.send?.(\\"ready\\");setInterval(() => {}, 1_000)"], { stdio: ["inherit", "inherit", "inherit", "ipc"] });',
    'descendant.once("message", () => { process.stdout.write(`${descendant.pid}\\n`); process.exit(0); });',
  ].join("")], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
  assert.ok(leader.pid);
  const leaderPid = leader.pid;
  const leaderExit = once(leader, "exit");
  try {
    const descendantPid = Number(String((await once(leader.stdout!, "data"))[0]).trim());
    assert.equal(Number.isSafeInteger(descendantPid) && descendantPid > 0, true);
    await leaderExit;
    assert.notEqual(leader.exitCode, null);
    assert.equal(processExists(descendantPid), true);

    const closePromise = once(leader, "close").then(() => true);
    await stopEveProcess(leader);

    const closed = await Promise.race([
      closePromise,
      new Promise<boolean>(resolveClosed => setTimeout(() => resolveClosed(false), 2_000)),
    ]);
    assert.equal(closed, true, "Eve launcher stdio must close after process-group cleanup");

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

async function processIsLive(pid: number): Promise<boolean> {
  if (!processExists(pid)) return false;
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(") ");
    const state = close < 0 ? undefined : stat.slice(close + 2).trim().split(/\s+/u)[0];
    return state !== "Z" && state !== "X";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    return true;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await processIsLive(pid)) return true;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
  }
  return !await processIsLive(pid);
}
