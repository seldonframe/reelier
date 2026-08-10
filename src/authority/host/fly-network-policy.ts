import { authorityDigest } from "../wire.js";

export interface FlyNetworkPolicyPortV1 {
  readonly protocol: "tcp" | "udp";
  readonly port: number;
}

export interface FlyNetworkPolicyRuleV1 {
  readonly action: "allow";
  readonly direction: "egress" | "ingress";
  readonly ports: readonly FlyNetworkPolicyPortV1[];
}

export interface FlyNetworkPolicyV1 {
  readonly name: string;
  readonly selector: Readonly<{ all: true }>;
  readonly rules: readonly FlyNetworkPolicyRuleV1[];
}

/** Parse the deliberately narrow reference subset of Fly network policies. */
export function parseFlyNetworkPolicies(value: unknown): readonly FlyNetworkPolicyV1[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) throw new TypeError("Fly network policies must be a bounded array");
  const policies = value.map((item, policyIndex) => {
    const raw = object(item, `Fly network policy ${policyIndex}`);
    closed(raw, ["name", "selector", "rules"], `Fly network policy ${policyIndex}`);
    const name = identifier(raw.name, "Fly network policy name");
    const selector = object(raw.selector, "Fly network policy selector");
    closed(selector, ["all"], "Fly network policy selector");
    if (selector.all !== true) throw new TypeError("Fly network policy selector must target all Machines in the dedicated app");
    if (!Array.isArray(raw.rules) || raw.rules.length === 0 || raw.rules.length > 16) throw new TypeError("Fly network policy rules must be bounded");
    const rules = raw.rules.map((entry, ruleIndex) => {
      const rule = object(entry, `Fly network policy rule ${ruleIndex}`);
      closed(rule, ["action", "direction", "ports"], `Fly network policy rule ${ruleIndex}`);
      if (rule.action !== "allow") throw new TypeError("Fly network policy action must be allow");
      if (rule.direction !== "egress" && rule.direction !== "ingress") throw new TypeError("Fly network policy direction is invalid");
      if (!Array.isArray(rule.ports) || rule.ports.length === 0 || rule.ports.length > 32) throw new TypeError("Fly network policy ports must be bounded");
      const ports = rule.ports.map((entry, portIndex) => {
        const port = object(entry, `Fly network policy port ${portIndex}`);
        closed(port, ["protocol", "port"], `Fly network policy port ${portIndex}`);
        if (port.protocol !== "tcp" && port.protocol !== "udp") throw new TypeError("Fly network policy protocol is invalid");
        if (!Number.isSafeInteger(port.port) || (port.port as number) < 1 || (port.port as number) > 65535) throw new TypeError("Fly network policy port is invalid");
        return Object.freeze({ protocol: port.protocol, port: port.port as number });
      }).sort(comparePorts);
      if (new Set(ports.map(port => `${port.protocol}:${port.port}`)).size !== ports.length) throw new TypeError("Fly network policy ports must be unique");
      return Object.freeze({ action: "allow" as const, direction: rule.direction, ports: Object.freeze(ports) });
    }).sort(compareRules);
    return Object.freeze({ name, selector: Object.freeze({ all: true as const }), rules: Object.freeze(rules) });
  }).sort((left, right) => compareText(left.name, right.name));
  if (new Set(policies.map(policy => policy.name)).size !== policies.length) throw new TypeError("Fly network policy names must be unique");
  return Object.freeze(policies);
}

export function digestFlyNetworkPolicies(value: unknown): string {
  return authorityDigest({ v: "reelier.fly-network-policies/v1", policies: parseFlyNetworkPolicies(value) });
}

function object(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value as Record<string, unknown>; }
function closed(raw: Record<string, unknown>, keys: readonly string[], label: string): void { if (Object.keys(raw).length !== keys.length || Object.keys(raw).some(key => !keys.includes(key))) throw new TypeError(`${label} is closed`); }
function identifier(value: unknown, label: string): string { if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(value)) throw new TypeError(`${label} is invalid`); return value; }
function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function comparePorts(left: FlyNetworkPolicyPortV1, right: FlyNetworkPolicyPortV1): number { return compareText(left.protocol, right.protocol) || left.port - right.port; }
function compareRules(left: FlyNetworkPolicyRuleV1, right: FlyNetworkPolicyRuleV1): number { return compareText(left.direction, right.direction) || compareText(JSON.stringify(left.ports), JSON.stringify(right.ports)); }
