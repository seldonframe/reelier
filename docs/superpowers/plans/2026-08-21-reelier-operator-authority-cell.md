# Reelier Operator + Authority Cell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Each task ends with a focused test and commit.

**Goal:** Add the first usable Reelier Operator surface: one-command local onboarding that detects Codex, Claude Code, and Grok Build, records only non-secret workspace state, and keeps every consequential provider write on the existing Authority Cell path.

**Architecture:** The Operator is a thin local supervisor for harness processes, workspaces, and review state. The Authority Cell remains the only writer of remote/provider consequences; the Operator receives opaque statuses and receipts. Harness adapters are transport adapters only: they may start/resume a harness and stream events, but they cannot mint authority, choose provider accounts, or report a successful Outcome.

**Tech Stack:** TypeScript/Node.js ESM, Node built-ins (`child_process`, `fs/promises`, `crypto`), Node test runner, existing Reelier CLI and authority contracts.

**Spec:** `docs/company/FOUNDATION.md`, `docs/company/BUILDING-COMPASS.md`, `docs/superpowers/plans/2026-08-16-managed-paid-user-yolo-launch.md`, and the reviewed OSS governed Outcome contract at `contract/authority/v1/`.

## Global Constraints

- Prompt text, model output, harness claims, and local task descriptions never authorize a provider write.
- `pending`, `ambiguous`, `unchecked`, `absent`, and `failed` are never rendered as success.
- No model API key is requested or stored; Codex, Claude Code, and Grok Build use the user’s installed/authenticated harness.
- No provider credential, bearer token, raw prompt, reasoning trace, or provider response body is written to Operator state.
- Existing `reelier init` behavior remains backward-compatible; the Operator onboarding is additive.
- All remote consequences continue through the existing signed Authority Cell and governed Outcome lifecycle.
- Free/local mode may report local completeness as `unchecked`; it must never claim managed completeness.
- Every implementation step is TDD: RED test, focused GREEN test, typecheck, `git diff --check`, commit.

---

### Task 1: Freeze the harness adapter contract

**Files:**
- Create: `src/operator/harness.ts`
- Test: `test/operator/harness.test.ts`

**Interfaces:**

```ts
export type OperatorHarnessIdV1 = "codex" | "claude-code" | "grok-build";

export interface OperatorHarnessDescriptorV1 {
  readonly v: "reelier.operator-harness/v1";
  readonly id: OperatorHarnessIdV1;
  readonly displayName: string;
  readonly executable: string;
  readonly resumeSupported: boolean;
  readonly jsonEventsSupported: boolean;
}

export interface OperatorHarnessProbeV1 {
  readonly descriptor: OperatorHarnessDescriptorV1;
  readonly installed: boolean;
  readonly version: string | null;
  readonly authMode: "installed-session" | "unavailable";
  readonly reason: string | null;
}

export interface OperatorHarnessRegistryV1 {
  probeAll(): Promise<readonly OperatorHarnessProbeV1[]>;
  probe(id: OperatorHarnessIdV1): Promise<OperatorHarnessProbeV1>;
}

export function createOperatorHarnessRegistryV1(input?: {
  readonly commandExists?: (executable: string) => Promise<boolean>;
  readonly runVersion?: (executable: string) => Promise<string>;
}): OperatorHarnessRegistryV1;
```

- [ ] Write RED tests for exact descriptors, stable ordering, missing executables, hostile version output, and no token/environment serialization.
- [ ] Implement command probing with bounded execution and sanitized version capture. Use `codex --version`, `claude --version`, and `grok --version`; Grok remains `unavailable` when the executable is absent.
- [ ] Ensure returned objects are detached/frozen and contain no environment values, command arguments, or auth material.
- [ ] Run `node --test dist-test/test/operator/harness.test.js` after test compilation.
- [ ] Commit `feat: add model-agnostic operator harness registry`.

### Task 2: Add local Operator workspace state

**Files:**
- Create: `src/operator/workspace.ts`
- Test: `test/operator/workspace.test.ts`

**Interfaces:**

```ts
export interface OperatorWorkspaceStateV1 {
  readonly v: "reelier.operator-workspace/v1";
  readonly workspaceId: string;
  readonly root: string;
  readonly mode: "local-cell" | "managed-cell";
  readonly selectedHarnesses: readonly OperatorHarnessIdV1[];
  readonly authorityCell: "local" | "managed" | "unconfigured";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function readOperatorWorkspaceV1(root: string): Promise<OperatorWorkspaceStateV1 | null>;
export function initializeOperatorWorkspaceV1(input: {
  readonly root: string;
  readonly selectedHarnesses: readonly OperatorHarnessIdV1[];
  readonly now?: string;
}): Promise<OperatorWorkspaceStateV1>;
```

- [ ] Write RED tests for absent state, exact idempotent retry, path normalization, duplicate harness rejection, unknown keys, symlink traversal, and token/prompt leakage.
- [ ] Implement atomic JSON persistence at `.reelier/operator.json` using a closed parser and detached frozen values.
- [ ] Keep the default mode `local-cell`; managed mode is an explicit future browser-auth choice, never inferred from a subscription or harness presence.
- [ ] Run focused workspace tests and typecheck.
- [ ] Commit `feat: persist non-secret operator workspace state`.

### Task 3: Make `init` produce the one-command Operator handoff

**Files:**
- Modify: `src/init.ts`
- Modify: `src/cli.ts`
- Test: `test/operator/init.test.ts`
- Test: existing init test file covering CLI dispatch

**Interfaces:**

```ts
export interface OperatorInitSummaryV1 {
  readonly workspace: OperatorWorkspaceStateV1;
  readonly harnesses: readonly OperatorHarnessProbeV1[];
  readonly next: readonly ("open-browser-auth" | "run-local-cell" | "install-harness" | "review-authority")[];
}

export async function initializeOperatorV1(input: {
  readonly cwd: string;
  readonly home: string;
  readonly now?: string;
}): Promise<OperatorInitSummaryV1>;
```

- [ ] Write RED CLI tests proving `npx reelier init` preserves the existing MCP setup path while returning an Operator summary.
- [ ] Add a bounded `operator init` orchestration helper in `src/init.ts`; it calls the harness registry, creates local workspace state, and computes next steps from observed facts only.
- [ ] Add a concise CLI rendering section: detected harnesses, Cell mode, and one next action. Do not print credentials, raw environment values, or claim a provider write occurred.
- [ ] Keep browser auth as a URL handoff placeholder until the Cloud init/session API is complete; represent it as `open-browser-auth`, never as authenticated.
- [ ] Run focused init tests, build, and the existing init/CLI suite.
- [ ] Commit `feat: expose one-command operator onboarding`.

### Task 4: Document the product boundary and launch gate

**Files:**
- Create: `docs/superpowers/sdd/2026-08-21-reelier-operator-authority-cell/task-1-report.md`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-16-managed-paid-user-yolo-launch.md`

- [ ] Document the exact local UX: `npx reelier@latest init`, then `reelier operator status`; no model API key entry.
- [ ] State clearly that local mode is free, customer-controlled, and completeness is `unchecked`; paid managed authority is a separate Cell-backed product.
- [ ] Record the three-harness support matrix as probe evidence, not as a claim of universal provider coverage.
- [ ] Add launch gates: Codex/Claude/Grok probe passes, first local Cell governed Outcome, restart/no-resend test, and no-secret state audit.
- [ ] Run build, focused Operator suite, `git diff --check`, and commit `docs: record operator authority-cell launch slice`.

## Review Gates

Before expanding into managed billing or customer-hosted executors, the branch must prove:

1. One clean workspace can detect all three harnesses without requiring a model API key.
2. The Operator can start/resume a harness but cannot produce a verified Outcome itself.
3. A local Authority Cell can execute one reviewed GitHub/Linear Outcome with authoritative readback.
4. Killing and reopening the Operator produces readback-only recovery with zero duplicate provider writes.
5. The serialized local state contains no credentials, raw prompts, reasoning, provider bodies, or model output.
6. The Cloud Task 0–5 foundation is clean and reviewed before managed mode, billing, or enterprise IAM is enabled.

## Explicit Non-Goals

- No new LLM gateway or model inference billing.
- No provider credential migration into Reelier for local mode.
- No broad agent fleet scheduler in this slice.
- No claim that MCP wrapping covers plugin-native tools or arbitrary direct HTTP calls.
- No settlement, reputation, payments, or machine-to-machine delegation until governed Outcomes are durable and independently verifiable.
