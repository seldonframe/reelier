import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_CLOUD_URL,
  cliConfigPath,
  readCliConfig,
  writeCliConfig,
  clearCliCredentials,
} from "../src/cloud-config.js";

async function withTmpHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(path.join(tmpdir(), "reelier-cloud-config-"));
  try {
    return await fn(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("cliConfigPath: joins <home>/.reelier/config.json", async () => {
  await withTmpHome(async (home) => {
    assert.equal(cliConfigPath(home), path.join(home, ".reelier", "config.json"));
  });
});

test("readCliConfig: missing file returns {}", async () => {
  await withTmpHome(async (home) => {
    const config = await readCliConfig(home);
    assert.deepEqual(config, {});
  });
});

test("readCliConfig: corrupt JSON returns {}", async () => {
  await withTmpHome(async (home) => {
    await mkdir(path.join(home, ".reelier"), { recursive: true });
    await writeFile(cliConfigPath(home), "{ not valid json", "utf8");
    const config = await readCliConfig(home);
    assert.deepEqual(config, {});
  });
});

test("writeCliConfig + readCliConfig: round-trips through a temp homedir", async () => {
  await withTmpHome(async (home) => {
    await writeCliConfig(
      { apiKey: "sk-test-123456", tenantName: "acme", githubLogin: "maxim" },
      home,
    );
    const config = await readCliConfig(home);
    assert.deepEqual(config, {
      apiKey: "sk-test-123456",
      tenantName: "acme",
      githubLogin: "maxim",
    });
  });
});

test("writeCliConfig: creates ~/.reelier if it does not exist", async () => {
  await withTmpHome(async (home) => {
    await writeCliConfig({ apiKey: "sk-abc" }, home);
    const config = await readCliConfig(home);
    assert.equal(config.apiKey, "sk-abc");
  });
});

test("clearCliCredentials: strips apiKey/tenantName/githubLogin, preserves a custom cloudUrl", async () => {
  await withTmpHome(async (home) => {
    await writeCliConfig(
      {
        cloudUrl: "https://staging.reelier.com",
        apiKey: "sk-test",
        tenantName: "acme",
        githubLogin: "maxim",
      },
      home,
    );

    const changed = await clearCliCredentials(home);
    assert.equal(changed, true);

    const config = await readCliConfig(home);
    assert.deepEqual(config, { cloudUrl: "https://staging.reelier.com" });
  });
});

test("clearCliCredentials: returns false on a second call (no key existed)", async () => {
  await withTmpHome(async (home) => {
    await writeCliConfig({ cloudUrl: "https://staging.reelier.com", apiKey: "sk-test" }, home);

    const first = await clearCliCredentials(home);
    assert.equal(first, true);

    const second = await clearCliCredentials(home);
    assert.equal(second, false);

    const config = await readCliConfig(home);
    assert.deepEqual(config, { cloudUrl: "https://staging.reelier.com" });
  });
});

test("clearCliCredentials: returns false when config file does not exist at all", async () => {
  await withTmpHome(async (home) => {
    const changed = await clearCliCredentials(home);
    assert.equal(changed, false);
  });
});

test("DEFAULT_CLOUD_URL: is the production reelier.com URL", () => {
  assert.equal(DEFAULT_CLOUD_URL, "https://www.reelier.com");
});
