// `reelier login` / `logout` / `whoami` — the OAuth-Device-Flow-shaped client
// for Reelier Cloud (see task-9 brief / SPEC.md "Cloud sync API"). This file
// owns only the wire client + browser-open helper; the printed UX and config
// writes live in cli.ts's cmdLogin/cmdLogout/cmdWhoami (mirrors how push.ts
// stays fetch-only and cli.ts's cmdPush owns the console output).
//
// Cloud API contract (consumer-side only):
//   POST {base}/api/v1/device/authorize  (empty JSON body)
//     -> 200 {deviceCode, userCode, verificationUri, verificationUriComplete, expiresIn, interval}
//   POST {base}/api/v1/device/token  body {deviceCode}
//     -> 200 {apiKey, tenant:{name, githubLogin}}
//     -> 400 {error: "authorization_pending" | "slow_down" | "expired_token" | "access_denied"}
//   GET {base}/api/v1/me  Authorization: Bearer <key>
//     -> 200 {tenant:{name, githubLogin}} | 401

import { spawn } from "node:child_process";

export interface DeviceStartResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export async function startLogin(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<DeviceStartResponse> {
  const res = await fetchImpl(`${baseUrl}/api/v1/device/authorize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Failed to start login (HTTP ${res.status}): ${text}`);
  }
  return JSON.parse(text) as DeviceStartResponse;
}

export interface PollForTokenResult {
  apiKey: string;
  tenant: { name: string; githubLogin: string | null };
}

const DEFAULT_MAX_WAIT_MS = 15 * 60 * 1000; // 15 minutes — comfortably above the cloud's typical device-code TTL.

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `/api/v1/device/token` until the user approves (or denies/expires) the
 * device code in their browser. Loop semantics (task-9 brief, verbatim):
 *   200                     -> resolve with {apiKey, tenant}
 *   400 authorization_pending -> sleep `interval` seconds, poll again
 *   400 slow_down           -> interval += 5, THEN sleep, poll again
 *   400 expired_token       -> throw "Login expired — run 'reelier login' again."
 *   400 access_denied       -> throw "Login was denied from the browser."
 */
export async function pollForToken(
  baseUrl: string,
  deviceCode: string,
  opts: {
    intervalSeconds?: number;
    maxWaitMs?: number;
    fetchImpl?: typeof fetch;
    sleepImpl?: (ms: number) => Promise<void>;
  } = {}
): Promise<PollForTokenResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleepImpl = opts.sleepImpl ?? defaultSleep;
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  let intervalSeconds = opts.intervalSeconds ?? 5;

  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const res = await fetchImpl(`${baseUrl}/api/v1/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode }),
    });
    const text = await res.text();
    if (res.ok) {
      return JSON.parse(text) as PollForTokenResult;
    }

    let error: string | undefined;
    try {
      error = (JSON.parse(text) as { error?: string }).error;
    } catch {
      // fall through — treated as an unrecognized error below
    }

    switch (error) {
      case "authorization_pending":
        break;
      case "slow_down":
        intervalSeconds += 5;
        break;
      case "expired_token":
        throw new Error("Login expired — run 'reelier login' again.");
      case "access_denied":
        throw new Error("Login was denied from the browser.");
      default:
        throw new Error(`Login failed (HTTP ${res.status}): ${text}`);
    }

    if (Date.now() >= deadline) {
      throw new Error("Login expired — run 'reelier login' again.");
    }
    await sleepImpl(intervalSeconds * 1000);
  }
}

/**
 * Best-effort browser launch for the device-flow confirm page. Printing the
 * URL is the actual contract (cmdLogin always prints it); this is a
 * convenience on top, so EVERY failure mode — a synchronous throw from
 * `spawn` (e.g. missing binary on some platforms) or an async 'error' event
 * on the child (e.g. ENOENT on others) — is swallowed. Detached + unref so
 * the CLI process never waits on the browser.
 */
export function openBrowser(
  url: string,
  platform: NodeJS.Platform = process.platform,
  spawnImpl: typeof spawn = spawn
): void {
  try {
    const [cmd, args] =
      platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : platform === "darwin"
          ? ["open", [url]]
          : ["xdg-open", [url]];
    const child = spawnImpl(cmd as string, args as string[], { detached: true, stdio: "ignore" });
    child.on("error", () => {
      // Swallowed — opening the browser is best-effort only.
    });
    child.unref();
  } catch {
    // Swallowed — opening the browser is best-effort only.
  }
}
