import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { launchDetachedMissionControlBoardV1 } from "../../src/operator/mission-board-process.js";

test("the public launcher passes its capability only through child env and deletes the capability-free descriptor", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "reelier-board-launch-"));
  let opened = "";
  let capturedEnv: NodeJS.ProcessEnv | undefined;
  const previousProviderToken = process.env.REELIER_PROVIDER_TOKEN;
  process.env.REELIER_PROVIDER_TOKEN = "must-not-reach-board";
  try {
    const launched = await launchDetachedMissionControlBoardV1({
      root,
      cliPath: "C:\\fixture\\cli.js",
      openBrowser: (url) => { opened = url; },
      spawnImpl: (_command, _args, options) => {
        capturedEnv = options.env;
        const descriptorPath = options.env.REELIER_BOARD_DESCRIPTOR!;
        void writeFile(descriptorPath, `${JSON.stringify({ v: "reelier.mission-control-board-process/v1", origin: "http://127.0.0.1:43111", pid: 4321, expiresAt: options.env.REELIER_BOARD_EXPIRES_AT })}\n`, { encoding: "utf8", mode: 0o600 });
        return { unref() {} };
      },
    });
    assert.match(launched.url, /^http:\/\/127\.0\.0\.1:43111\/#[0-9a-f]{64}$/);
    assert.equal(opened, launched.url);
    assert.equal(capturedEnv?.REELIER_BOARD_CAPABILITY, launched.url.split("#")[1]);
    assert.equal(capturedEnv?.REELIER_BOARD_ROOT, root);
    assert.equal(capturedEnv?.REELIER_PROVIDER_TOKEN, undefined);
    const descriptorPath = capturedEnv?.REELIER_BOARD_DESCRIPTOR;
    assert.ok(descriptorPath);
    await assert.rejects(() => readFile(descriptorPath!, "utf8"), /ENOENT/);
  } finally {
    if (previousProviderToken === undefined) delete process.env.REELIER_PROVIDER_TOKEN;
    else process.env.REELIER_PROVIDER_TOKEN = previousProviderToken;
    await rm(root, { recursive: true, force: true });
  }
});
