import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { authorityDigest } from "../../src/authority/wire.js";
import { createSignedJournal } from "../../src/authority/host/signed-journal.js";
import { createGitHubReleaseRunner } from "../../src/authority/host/github-release-runner.js";

test("signed journal detects tamper and atomic-head rollback", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-release-journal-"));
  const keys = generateKeyPairSync("ed25519");
  try {
    const journal = await createSignedJournal({ rootDir: root, journalId: "release", signerId: "release-journal-2026", privateKey: keys.privateKey, publicKey: keys.publicKey });
    await journal.append("request_1", authorityDigest({ request: 1 }), "authorized", { alias: "github_release_candidate_publish_v1" });
    await journal.append("request_1", authorityDigest({ request: 1 }), "blob-created", { sha: "a".repeat(40) });
    assert.equal((await journal.load("request_1")).at(-1)?.phase, "blob-created");
    const directory = path.join(root, authorityDigest({ journalId: "release", requestId: "request_1" }).slice(7));
    const events = (await readdir(directory)).filter(name => name.startsWith("event-")).sort();
    const eventPath = path.join(directory, events[0]!);
    const event = JSON.parse(await readFile(eventPath, "utf8"));
    await writeFile(eventPath, JSON.stringify({ ...event, data: { alias: "attacker" } }));
    await assert.rejects(() => journal.load("request_1"), /signature|digest|tamper/i);
    await writeFile(eventPath, JSON.stringify(event));
    await writeFile(path.join(directory, "head.json"), JSON.stringify({ digest: event.digest, sequence: 0 }));
    await assert.rejects(() => journal.load("request_1"), /rollback|head|fork/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("release runner refuses raw or wrong allocation authority before provider dispatch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reelier-release-runner-"));
  const keys = generateKeyPairSync("ed25519");
  let calls = 0;
  const provider = new Proxy({}, { get: () => async () => { calls += 1; throw new Error("provider must not be called"); } });
  try {
    const runner = await createGitHubReleaseRunner({
      rootDir: root,
      journalSigner: { signerId: "release-journal-2026", privateKey: keys.privateKey, publicKey: keys.publicKey },
      evidenceSigner: { signerId: "receipt-candidate-branch", privateKey: keys.privateKey },
      authorizationResolver: async () => ({ authorization: { value: { effectAllocations: [{ allocationId: "wrong", allocationDigest: authorityDigest({ wrong: true }), effect: "candidate-branch", maxEffects: 1 }] } } }) as never,
      provider: provider as never,
      now: () => new Date("2026-08-18T06:00:00.000Z"),
    });
    await assert.rejects(() => runner.run({ alias: "github_release_candidate_publish_v1", authorizationHandle: "release_auth_1", requestId: "request_1", semanticsDigest: authorityDigest({ request: 1 }) }), /verified authorization|allocation|brand/i);
    assert.equal(calls, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});
