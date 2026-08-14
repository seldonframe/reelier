export function createStreamIngestor() {
  const instrumentation = new Map();
  const events = [];
  const findings = [];
  let cursor = 0;
  return Object.freeze({
    ingest(rows, startIndex) {
      let absolute = startIndex;
      for (const row of rows) {
        events.push(Object.freeze({ absoluteIndex: absolute, event: row }));
        const id = row?.meta?.id;
        if (typeof id === "string" && id.length > 0) instrumentation.set(id, row);
        else findings.push(Object.freeze({ code: "legacy-event-id-absent", absoluteIndex: absolute }));
        absolute += 1;
      }
      cursor = Math.max(cursor, absolute);
    },
    snapshot() {
      return Object.freeze({ cursor, events: Object.freeze([...events]), instrumentation: Object.freeze([...instrumentation.values()]), findings: Object.freeze([...findings]) });
    },
  });
}

export function createObservedEveClient() {
  const traffic = [];
  return Object.freeze({
    async request(input, init = {}) {
      const url = input instanceof URL ? input : new URL(input);
      const method = String(init.method ?? "GET").toUpperCase();
      const response = fetch(url, init);
      traffic.push(Object.freeze({ method, url: url.href }));
      return response;
    },
    traffic() {
      return Object.freeze(traffic.map((entry) => Object.freeze({ ...entry })));
    },
  });
}

export async function readEveStream({ client, baseUrl, sessionId, token, startIndex = 0 }) {
  const url = new URL(`/eve/v1/session/${encodeURIComponent(sessionId)}/stream`, baseUrl);
  url.searchParams.set("startIndex", String(startIndex));
  url.searchParams.set("includeTailIndex", "1");
  const response = await client.request(url, { redirect: "error", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok || !response.body) throw new Error(`Eve stream refused with HTTP ${response.status}`);
  const tail = Number(response.headers.get("x-eve-stream-tail-index"));
  if (!Number.isInteger(tail) || tail < -1) throw new Error("Eve stream omitted its absolute tail index");
  const rows = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (startIndex + rows.length <= tail) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      for (;;) {
        const newline = buffered.indexOf("\n");
        if (newline < 0) break;
        const line = buffered.slice(0, newline).trim();
        buffered = buffered.slice(newline + 1);
        if (line) rows.push(JSON.parse(line));
        if (startIndex + rows.length > tail) break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Object.freeze({ rows: Object.freeze(rows), cursor: startIndex + rows.length, tail });
}
