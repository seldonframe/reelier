export const AUTHORITY_CELL_LINUX_REQUIRED = "AUTHORITY_CELL_LINUX_REQUIRED";

export class AuthorityCellLinuxRequiredError extends Error {
  readonly code = AUTHORITY_CELL_LINUX_REQUIRED;

  constructor() {
    super("Authority Cell hosting requires Linux. Windows is supported as a client; run the Cell through WSL, a Linux container, or a remote Linux Authority Cell.");
    this.name = "AuthorityCellLinuxRequiredError";
  }
}

let testPlatform: NodeJS.Platform | undefined;

/** Refuses authority-bearing host setup outside the Linux Authority Cell. */
export function assertLinuxAuthorityCellHost(): void {
  if ((testPlatform ?? process.platform) !== "linux") throw new AuthorityCellLinuxRequiredError();
}

/** Internal test seam. It is intentionally not re-exported from the host barrel. */
export function __testSetAuthorityCellHostPlatform(platform: NodeJS.Platform | undefined): () => void {
  const previous = testPlatform;
  testPlatform = platform;
  return () => { testPlatform = previous; };
}
