# Universal Agent Channel and Pre-Freeze Conformance Design

## Decision

Reelier will expose one channel-neutral authority boundary to Grok Bot, Grok Build, Codex, Claude Code, Eve, Hermes, OpenClaw, and future agent runtimes. Agents keep broad native reads, research, planning, coding, browser preparation, and orchestration. Consequential state transitions use dynamically discovered Reelier Outcomes.

Grok is the flagship consumer, not a privileged authority implementation. Refunds are one later certification scenario, not the product architecture.

The active Path C implementation owns principals, delegation, conserved budgets, jobs, provider runners, topology, reconciliation, and receipts. This branch must not copy or reinterpret those mechanisms. Until Path C freezes Adapter Contract v1, this branch builds only a fixture-driven adapter contract and conformance harness. It performs no provider read, provider write, credential access, reservation, or receipt signing.

## First-principles boundary

The model may select a deployed job, supply opaque source references and bounded definition choices, and request a consequential Outcome. It may not supply authenticated identity, tenant, provider account, credential, raw endpoint, recipient, amount, or other authority that the signed contract and fresh provider state must determine.

Reelier is not a general tool router. Native agent tools remain available for non-consequential work. A tool or task is governed only when a reviewed Outcome definition can deterministically compile its consequential exit and authoritatively reconcile the resulting provider state. Unsupported and partially attestable transitions remain explicit; they are never described as universally governed.

## Universal adapter surface

Every agent adapter must support the same semantic operations, independent of transport:

- search the signed job catalog;
- load one job and its bounded Outcome schemas;
- request and inspect narrower child delegation;
- inspect a task's redacted principal and budget graph;
- invoke a dynamically loaded Outcome;
- inspect the Outcome lifecycle and receipt reference.

MCP, authenticated HTTP, an Outcome Console, or a future native xAI Bot API may carry these operations. Transport adapters may translate envelopes but may not invent authority, hard-code provider tasks, change Outcome inputs, collapse lifecycle states, or upgrade evidence claims.

Each Bot and subagent has a distinct host-authenticated principal session. Delegation may attenuate definitions, accounts, audiences, projection pointers, risk classes, duration, fan-out, and conserved effect budget. It may never amplify authority. Pricing, bidding, reputation, escrow, and settlement remain outside the trust kernel; signed jobs, grants, budgets, and receipt graphs are market-ready primitives but not a marketplace.

## Coverage modes

Observed and enforced operation are separate product modes.

In observed mode, existing agent connections and writable browser sessions may remain reachable. Reelier proves only the Outcomes it handled. Topology and completeness remain `unchecked` or `absent`.

In enforced mode, fresh topology evidence must verify that the declared consequential surface is reachable only through the Authority Cell: the agent lacks provider credentials, equivalent raw provider-write egress, and writable provider browser sessions. If any required topology claim is not verified, enforced activation refuses. It never silently falls back to observed mode while preserving a successful completeness claim.

Neither mode claims content correctness, wisdom, fairness, safety, or universal traffic completeness.

## Pre-freeze harness

The pre-freeze harness consumes a closed JSON candidate containing an adapter descriptor and a hermetic interaction transcript. It validates behavior, not source text.

The descriptor binds:

- adapter ID, agent host, and transport;
- host-authenticated identity binding;
- no provider credential access;
- observed and enforced coverage support with observed as the default;
- the required universal semantic operations;
- `fixture-only` execution;
- `pending-freeze` authority contract status with no claimed contract digest.

The transcript proves:

- job references come from catalog discovery rather than the descriptor;
- a loaded job reference is preserved into invocation;
- only request ID, opaque source references, and choices cross the Outcome boundary;
- authenticated identity cannot be overridden in the request body;
- a child agent has a distinct principal and narrower requested effect budget;
- the pre-freeze invocation refuses with `adapter-contract-pending` and dispatch remains absent;
- observed mode cannot report verified topology or completeness;
- enforced mode remains unavailable without verified topology;
- absent, unchecked, refused, and pending states never render as pass.

The harness has no network or provider adapter. Passing it means only that a candidate transcript conforms to this pre-freeze channel contract. It does not mean the adapter is integrated, secure, live, or covered by Path C.

## Post-freeze transition

When the Path C session publishes Adapter Contract v1 and golden vectors, replace the pending contract marker with the exact nonzero contract digest and add active black-box probes over the public MCP and HTTP ingress. Do not import private runner, ledger, signer, credential, or topology internals.

The first executable integration must be a reversible record-state Outcome such as GitHub issue labels or a Slack topic. Certification then expands through communication, money, deployments, infrastructure, database changes, confidential information flow, and multi-agent contention. Every scenario includes duplicate requests, concurrency, revocation, ambiguity, partial completion, reconciliation failure, and offline receipt verification.

## Grok channel shape

Grok Build will consume the public MCP adapter through an xAI-compatible plugin or skill. Grok Bot will initially consume the same semantic surface through an authenticated Outcome Console; a future native Bot transport replaces only the adapter.

In observed mode, Grok Bot may retain its ordinary app sessions and the UI must label bypass coverage honestly. In enforced mode, its runtime profile contains no writable provider session or raw provider credential.

Official xAI evidence observed 2026-08-11:

- Grok Bot is an always-on agent operating a persistent cloud computer across websites and applications: <https://x.ai/news/introducing-grok-bot>
- Grok Build supports plugins, skills, hooks, MCP, `AGENTS.md`, subagents, and headless operation: <https://x.ai/build>
- xAI's plugin marketplace uses skills, commands, agents, hooks, and `.mcp.json`: <https://github.com/xai-org/plugin-marketplace>

These sources justify treating Grok as a first-class channel. They do not establish a native Grok Bot authority API or prove that browser actions can be intercepted.

## Compass result

This design removes repeated human supervision at the consequential exit while keeping agent intelligence broad. It preserves the canonical transition from authenticated context through signed authority, deterministic effect, conserved reservation, bounded attempt, authoritative read-back, reconciliation, and honest receipt.

The design's falsifier is an adapter that passes while it can inject identity or provider authority, hard-code a task surface, report verified completeness in observed mode, or imply live Path C execution before the frozen contract and topology evidence exist.
