import { createOperatorHarnessRegistryV1, type OperatorHarnessProbeV1 } from "./harness.js";
import { createMissionControlJournalV1 } from "./mission-journal.js";

export type MissionControlDoctorResultV1 = Readonly<{
  status: "ready" | "attention";
  accountRequired: false;
  cloudRequired: false;
  productReadyHarnesses: readonly ("codex" | "claude-code")[];
  journalReadable: boolean;
}>;

export async function runMissionControlDoctorV1(input: Readonly<{
  root: string;
  probeHarnesses?: () => Promise<readonly OperatorHarnessProbeV1[]>;
}>): Promise<MissionControlDoctorResultV1> {
  const probes = await (input.probeHarnesses ?? (() => createOperatorHarnessRegistryV1().probeAll()))();
  const productReadyHarnesses = probes.filter((probe) => probe.installed && (probe.descriptor.id === "codex" || probe.descriptor.id === "claude-code")).map((probe) => probe.descriptor.id as "codex" | "claude-code");
  let journalReadable = false;
  try { await (await createMissionControlJournalV1({ root: input.root })).reconstruct(); journalReadable = true; } catch { journalReadable = false; }
  return Object.freeze({ status: journalReadable && productReadyHarnesses.length > 0 ? "ready" : "attention", accountRequired: false, cloudRequired: false, productReadyHarnesses: Object.freeze(productReadyHarnesses), journalReadable });
}
