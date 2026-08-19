import { open } from "node:fs/promises";

/**
 * One directory-durability helper for every host store that creates durable dirents.
 *
 * A file `fsync` persists the file's DATA; it does NOT persist the parent directory ENTRY that
 * names it. After a crash the bytes can therefore be durable while the name that reaches them is
 * gone — a terminal receipt silently rolls back to "absent". Every site that creates a directory
 * entry (a node file, a store subdirectory, a rename into place) must follow it with a parent
 * directory sync, and every such site is enumerated in the closed `site` union below so a new
 * store cannot quietly skip one.
 */
export type AuthorityDurabilitySiteV1 = "node-create" | "durable-mkdir" | "legacy-rename" | "governed-node-create" | "governed-store-mkdir";

export type ReceiptsDurabilityProbeEventV1 = Readonly<{ kind: "created" | "synced"; site: AuthorityDurabilitySiteV1; target: string }>;

let testDurabilityProbe: ((event: ReceiptsDurabilityProbeEventV1) => void) | undefined;

/** Internal test seam. It is intentionally not re-exported from the host barrel. */
export function __testSetReceiptsDurabilityProbe(probe: ((event: ReceiptsDurabilityProbeEventV1) => void) | undefined): () => void {
  const previous = testDurabilityProbe;
  testDurabilityProbe = probe;
  return () => { testDurabilityProbe = previous; };
}

/** Records that a durable directory entry now exists. Ordering against `syncDirectory` is the
 * observable the durability tests pin: a `created` event is only durable once its `synced` twin
 * for the SAME site follows it. */
export function noteDurableEntryCreated(site: AuthorityDurabilitySiteV1, target: string): void {
  testDurabilityProbe?.({ kind: "created", site, target });
}

/** Persists a new directory entry. Hard-required on a real Linux Authority Cell; failure codes are tolerated elsewhere so win32 tests under the platform override still run. */
export async function syncDirectory(directory: string, site: AuthorityDurabilitySiteV1): Promise<void> {
  try {
    const handle = await open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    if (process.platform === "linux") throw error;
  }
  testDurabilityProbe?.({ kind: "synced", site, target: directory });
}
