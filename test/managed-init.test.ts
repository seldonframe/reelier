import test from "node:test";
import assert from "node:assert/strict";
import { createManagedInitDescriptor, renderManagedInitDescriptor } from "../src/managed-init.js";

test("managed initialization emits a closed, redacted remote-session descriptor", () => {
  const descriptor = createManagedInitDescriptor();

  assert.deepEqual(descriptor, {
    v: "reelier.managed-init/v1",
    mode: "managed",
    configurationDiff: {
      operation: "add",
      path: "mcpServers.reelier-managed",
      value: {
        transport: "streamable-http",
        endpoint: "<remote-mcp-endpoint>",
        trustDomain: "<trust-domain>",
        sessionCredential: "<managed-session-credential>",
      },
    },
    session: {
      trustDomain: "<trust-domain>",
      remoteMcpEndpoint: "<remote-mcp-endpoint>",
    },
    authority: "absent",
    completeness: "unchecked",
    credentials: "absent",
    missionAuthorization: "absent",
  });
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.configurationDiff), true);
  assert.equal(Object.isFrozen(descriptor.configurationDiff.value), true);
  assert.equal(Object.isFrozen(descriptor.session), true);
});

test("managed initialization rendering never includes ambient credentials", () => {
  const rendered = renderManagedInitDescriptor(createManagedInitDescriptor());

  assert.match(rendered, /"credentials": "absent"/);
  assert.match(rendered, /"missionAuthorization": "absent"/);
  assert.doesNotMatch(rendered, /ambient-provider-credential/);
});
