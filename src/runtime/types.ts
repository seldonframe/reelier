export interface RuntimeDescriptorV1 {
  readonly v: "reelier.runtime-descriptor/v1";
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly adapterDigest: string;
  readonly launchMode: "local-process" | "externally-managed";
  readonly command: string | null;
  readonly args: readonly string[];
  readonly cwd: string | null;
  readonly connectionRef: string | null;
  readonly environmentAllowlist: readonly string[];
  readonly authenticatedBinding: "bearer-file" | "loopback-session" | "host-private";
  readonly shutdown: "signal-owned-child" | "external";
}
