/**
 * The managed-init contract is intentionally a fixed, local-only preview.
 * It has no inputs because accepting an endpoint, credential, or mission here
 * would turn initialization into a configuration or authorization channel.
 */
export interface ManagedInitDescriptorV1 {
  readonly v: "reelier.managed-init/v1";
  readonly mode: "managed";
  readonly configurationDiff: Readonly<{
    readonly operation: "add";
    readonly path: "mcpServers.reelier-managed";
    readonly value: Readonly<{
      readonly transport: "streamable-http";
      readonly endpoint: "<remote-mcp-endpoint>";
      readonly trustDomain: "<trust-domain>";
      readonly sessionCredential: "<managed-session-credential>";
    }>;
  }>;
  readonly session: Readonly<{
    readonly trustDomain: "<trust-domain>";
    readonly remoteMcpEndpoint: "<remote-mcp-endpoint>";
  }>;
  readonly authority: "absent";
  readonly completeness: "unchecked";
  readonly credentials: "absent";
  readonly missionAuthorization: "absent";
}

export function createManagedInitDescriptor(): ManagedInitDescriptorV1 {
  const value = Object.freeze({
    transport: "streamable-http" as const,
    endpoint: "<remote-mcp-endpoint>" as const,
    trustDomain: "<trust-domain>" as const,
    sessionCredential: "<managed-session-credential>" as const,
  });
  const configurationDiff = Object.freeze({
    operation: "add" as const,
    path: "mcpServers.reelier-managed" as const,
    value,
  });
  const session = Object.freeze({
    trustDomain: "<trust-domain>" as const,
    remoteMcpEndpoint: "<remote-mcp-endpoint>" as const,
  });
  return Object.freeze({
    v: "reelier.managed-init/v1" as const,
    mode: "managed" as const,
    configurationDiff,
    session,
    authority: "absent" as const,
    completeness: "unchecked" as const,
    credentials: "absent" as const,
    missionAuthorization: "absent" as const,
  });
}

export function renderManagedInitDescriptor(descriptor: ManagedInitDescriptorV1): string {
  return JSON.stringify(descriptor, null, 2);
}
