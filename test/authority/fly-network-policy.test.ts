import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { digestFlyNetworkPolicies, parseFlyNetworkPolicies } from "../../src/authority/host/fly-network-policy.js";

async function policy(name: string) {
  const raw = JSON.parse(await readFile(path.resolve(`infra/fly/authority-cell/${name}.network-policy.json`), "utf8"));
  return parseFlyNetworkPolicies([raw])[0];
}

test("agent and Authority Cell policies default-deny direct provider HTTPS", async () => {
  for (const name of ["agent-runtime", "authority-cell"]) {
    const parsed = await policy(name);
    assert.equal(parsed.selector.all, true);
    assert.equal(parsed.rules.every(rule => rule.direction === "egress" && rule.action === "allow"), true);
    assert.equal(parsed.rules.flatMap(rule => rule.ports).some(port => port.protocol === "tcp" && port.port === 443), false);
  }
});

test("only the Authority Cell can reach the private gateway port", async () => {
  const agent = await policy("agent-runtime");
  const cell = await policy("authority-cell");
  const permitsGateway = (value: Awaited<ReturnType<typeof policy>>) => value.rules.some(rule => rule.direction === "egress" && rule.ports.some(port => port.protocol === "tcp" && port.port === 8443));
  assert.equal(permitsGateway(agent), false);
  assert.equal(permitsGateway(cell), true);
});

test("only the egress gateway policy permits public HTTPS", async () => {
  const parsed = await policy("egress-gateway");
  assert.equal(parsed.rules.flatMap(rule => rule.ports).some(port => port.protocol === "tcp" && port.port === 443), true);
  assert.equal(parsed.rules.some(rule => rule.direction === "ingress" && rule.ports.some(port => port.protocol === "tcp" && port.port === 8443)), true);
});

test("Fly policy digest is canonical and the parser is closed", () => {
  const left = [{ name: "b", selector: { all: true }, rules: [{ action: "allow", direction: "egress", ports: [{ protocol: "udp", port: 53 }] }] }, { name: "a", selector: { all: true }, rules: [{ action: "allow", direction: "egress", ports: [{ protocol: "tcp", port: 443 }] }] }];
  const right = [left[1], left[0]];
  assert.equal(digestFlyNetworkPolicies(left), digestFlyNetworkPolicies(right));
  assert.throws(() => parseFlyNetworkPolicies([{ ...left[0], token: "secret" }]), /closed/);
  assert.throws(() => parseFlyNetworkPolicies([{ ...left[0], rules: [{ action: "deny", direction: "egress", ports: [{ protocol: "tcp", port: 443 }] }] }]), /action/);
});
