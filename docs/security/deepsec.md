# DeepSec security-review pilot

DeepSec is an optional, agent-powered vulnerability scanner. Reelier uses it as an advisory review layer; it is not a runtime dependency, a build step, or an authority that can certify a receipt.

## GitHub Actions pilot

The workflow is [.github/workflows/deepsec.yml](../../.github/workflows/deepsec.yml). Its analysis job runs only when:

- the pull request comes from this repository (forks are skipped); and
- the repository secret `AI_GATEWAY_API_KEY` is configured.

It compares the pull request with its base branch using `deepsec@2.3.5`, has a 30-minute limit, has `contents: read` permissions, and uploads a short-lived `deepsec-findings` artifact when the run produces findings. The job is intentionally informational and does not post comments or block merges.

A maintainer can run it manually from the Actions tab. The manual `base_ref` input defaults to `main`.

## Local or scheduled audits

Run DeepSec only on a trusted checkout and set an explicit budget. The tool creates a `.deepsec/` workspace; generated state and findings should remain local or in a controlled CI artifact store.

```sh
npx deepsec@2.3.5 init --max-cost-usd 100 --max-duration 2h
```

For an incremental review after setup:

```sh
cd .deepsec
pnpm deepsec process --diff origin/main
pnpm deepsec revalidate
pnpm deepsec export --format md-dir --out ./findings
```

Do not commit generated `.deepsec` data or findings to the Reelier repository.

## Reelier-specific review focus

When reviewing findings, prioritize:

- MCP recorder and proxy boundaries, including malformed policies and untrusted tool definitions/responses;
- skill parsing, manifest drift, replay gates, effect classification, and policy bypasses;
- redaction and accidental credential/receipt leakage;
- signature, timestamp, digest, and verification logic;
- path traversal, symlink/race conditions, atomic writes, locks, and authority-ledger state transitions;
- subprocess and HTTP boundary handling in the CLI, bridge, cloud clients, and LLM integrations;
- plugin-delivered MCP coverage and misleading claims about what a receipt observes.

## Interpretation and safety

DeepSec findings are hypotheses for human investigation. Confirm each finding against source, tests, and the threat model before changing behavior. A finding or a clean run does not prove semantic correctness, complete MCP coverage, absence of prompt injection, or safety of an agent workflow.

The analysis job executes an agent against checked-out code, so keep valuable write-capable credentials out of its environment. The workflow deliberately has no pull-request write permission and does not run for fork pull requests. DeepSec complements—not replaces—Reelier's deterministic build, cross-platform tests, fuzzing, mutation tests, dependency review, and secret scanning.
