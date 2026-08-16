import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export const CONFORMANCE_REPOSITORY = "fixlyai/soloproof";
export const CONFORMANCE_BRANCH = "reelier/conformance-20260816";
export const CONFORMANCE_PATH = "reelier-conformance-proof.txt";

const execFileAsync = promisify(execFile);
const SHA = /^[0-9a-f]{40}$/;

function refuse(message) {
  throw new TypeError(`refused: ${message}`);
}

function validateTarget({ repository, branch, path }) {
  if (repository !== CONFORMANCE_REPOSITORY) refuse(`repository must be ${CONFORMANCE_REPOSITORY}`);
  if (branch !== CONFORMANCE_BRANCH) refuse(`branch must be ${CONFORMANCE_BRANCH}; main is never allowed`);
  if (path !== CONFORMANCE_PATH) refuse(`path must be ${CONFORMANCE_PATH}`);
}

function fingerprint(request) {
  return createHash("sha256")
    .update(JSON.stringify([request.repository, request.branch, request.path, request.content]), "utf8")
    .digest("hex");
}

export function createIdempotentGithubTools(adapter) {
  const completed = new Map();

  async function requireAuth() {
    if (!(await adapter.authStatus())) refuse("gh auth is unavailable");
  }

  async function read(request) {
    validateTarget(request);
    await requireAuth();
    return adapter.readState(request);
  }

  async function put(request) {
    validateTarget(request);
    if (typeof request.requestKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/.test(request.requestKey)) {
      refuse("requestKey must be a bounded non-secret identifier");
    }
    if (typeof request.content !== "string" || Buffer.byteLength(request.content, "utf8") > 4096) {
      refuse("content must be UTF-8 text no larger than 4096 bytes");
    }
    await requireAuth();
    const requestFingerprint = fingerprint(request);
    const previous = completed.get(request.requestKey);
    if (previous) {
      if (previous.fingerprint !== requestFingerprint) refuse("idempotency-key collision with different content");
      return { ...previous.result, disposition: "duplicate", effectDelta: 0 };
    }

    const before = await adapter.readState(request);
    if (before.content === request.content) {
      const result = { disposition: "unchanged", effectDelta: 0, requestKey: request.requestKey, providerState: before };
      completed.set(request.requestKey, { fingerprint: requestFingerprint, result });
      return result;
    }
    const dispatch = await adapter.writeFile({ ...request, currentBlob: before.blob });
    const providerState = await adapter.readState(request);
    if (providerState.content !== request.content) refuse("provider readback bytes do not match the dispatched content");
    if (dispatch.commit !== providerState.head) refuse("provider readback head does not match the write response commit");
    const result = { disposition: "written", effectDelta: 1, requestKey: request.requestKey, before, dispatch, providerState };
    completed.set(request.requestKey, { fingerprint: requestFingerprint, result });
    return result;
  }

  return { read, put };
}

async function gh(args, { discard = false } = {}) {
  try {
    const result = await execFileAsync("gh", args, {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      env: process.env,
    });
    return discard ? "" : result.stdout;
  } catch (error) {
    const detail = typeof error?.stderr === "string" ? error.stderr.trim().slice(0, 1000) : "gh command failed";
    throw new Error(detail || "gh command failed");
  }
}

function parseJson(text, operation) {
  try {
    return JSON.parse(text);
  } catch {
    throw new TypeError(`${operation} returned malformed JSON`);
  }
}

export function createGhAdapter() {
  return {
    authStatus: async () => {
      try {
        await gh(["auth", "status"], { discard: true });
        return true;
      } catch {
        return false;
      }
    },
    readState: async ({ repository, branch, path }) => {
      const ref = parseJson(await gh(["api", `repos/${repository}/git/ref/heads/${branch}`]), "git ref read");
      const head = ref?.object?.sha;
      if (!SHA.test(head ?? "")) throw new TypeError("GitHub returned an invalid branch head");
      const commit = parseJson(await gh(["api", `repos/${repository}/git/commits/${head}`]), "commit read");
      const tree = commit?.tree?.sha;
      if (!SHA.test(tree ?? "")) throw new TypeError("GitHub returned an invalid commit tree");
      const treeBody = parseJson(await gh(["api", `repos/${repository}/git/trees/${tree}?recursive=1`]), "tree read");
      if (treeBody?.truncated === true) throw new TypeError("GitHub tree read was truncated");
      const entry = treeBody?.tree?.find((item) => item?.path === path && item?.type === "blob");
      const blob = entry?.sha;
      if (!SHA.test(blob ?? "")) throw new TypeError(`predetermined file ${path} is absent from the exact branch tree`);
      const blobBody = parseJson(await gh(["api", `repos/${repository}/git/blobs/${blob}`]), "blob read");
      if (blobBody?.encoding !== "base64" || typeof blobBody?.content !== "string") throw new TypeError("GitHub blob was not base64 encoded");
      const content = Buffer.from(blobBody.content.replace(/\s/g, ""), "base64").toString("utf8");
      return { repository, branch, path, head, tree, blob, content };
    },
    writeFile: async ({ repository, branch, path, content, currentBlob, requestKey }) => {
      const body = parseJson(
        await gh([
          "api", `repos/${repository}/contents/${path}`,
          "--method", "PUT",
          "-H", "Accept: application/vnd.github+json",
          "-f", `message=Reelier Path A conformance ${requestKey}`,
          "-f", `content=${Buffer.from(content, "utf8").toString("base64")}`,
          "-f", `branch=${branch}`,
          "-f", `sha=${currentBlob}`,
        ]),
        "contents update",
      );
      const commit = body?.commit?.sha;
      if (!SHA.test(commit ?? "")) throw new TypeError("GitHub update returned an invalid commit SHA");
      return { commit };
    },
  };
}

function jsonResult(value, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

export function buildServer(adapter = createGhAdapter()) {
  const tools = createIdempotentGithubTools(adapter);
  const server = new Server({ name: "reelier-disposable-github", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
    {
      name: "github_read_conformance_state",
      description: "Read the exact approved disposable branch head, tree, predetermined blob, and UTF-8 bytes.",
      inputSchema: { type: "object", properties: { repository: { type: "string" }, branch: { type: "string" }, path: { type: "string" } }, required: ["repository", "branch", "path"], additionalProperties: false },
      annotations: { readOnlyHint: true },
    },
    {
      name: "github_put_conformance_file",
      description: "Update only the predetermined file on the approved disposable branch; process-local request-key retries do not write twice.",
      inputSchema: { type: "object", properties: { repository: { type: "string" }, branch: { type: "string" }, path: { type: "string" }, content: { type: "string" }, requestKey: { type: "string" } }, required: ["repository", "branch", "path", "content", "requestKey"], additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
  ] }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      if (params.name === "github_read_conformance_state") return jsonResult(await tools.read(params.arguments ?? {}));
      if (params.name === "github_put_conformance_file") return jsonResult(await tools.put(params.arguments ?? {}));
      return jsonResult({ status: "refused", reason: "unknown tool" }, true);
    } catch (error) {
      return jsonResult({ status: "refused", reason: error instanceof Error ? error.message : "operation failed" }, true);
    }
  });
  return server;
}

async function main() {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
