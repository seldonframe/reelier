# DeepSec Security Pilot Design

## Goal

Add an optional DeepSec security-review pilot for Reelier pull requests without making DeepSec a runtime dependency or changing the deterministic build and test path.

## Scope

- Run DeepSec only for same-repository pull requests and manual dispatch.
- Review the PR diff against its base branch.
- Pin the DeepSec CLI version in the workflow.
- Keep the check informational and upload findings as a short-lived artifact.
- Skip cleanly when the repository has not configured the required model credential.
- Document setup, threat-model context, cost limits, credential isolation, and human adjudication.
- Do not commit generated `.deepsec` state or findings.

## Safety constraints

The workflow must not grant write permissions to the job that executes PR-controlled code. It must not run for fork pull requests, where repository secrets are unavailable and untrusted code is in scope. DeepSec findings are advisory until manually confirmed; they do not certify Reelier behavior or replace deterministic tests, fuzzing, mutation testing, or dependency review.

## Acceptance criteria

1. `package.json` and the production dependency graph remain unchanged.
2. Existing CI build/test jobs remain unchanged.
3. The new workflow has read-only repository permissions, is non-required, and has a bounded timeout.
4. The workflow can be enabled with one repository secret and produces an artifact when findings exist.
5. Documentation names Reelier-specific review areas and the security limitations of agent-powered scanning.
