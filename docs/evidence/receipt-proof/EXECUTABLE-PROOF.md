# Executable receipt proof

## Purpose and boundary

This is a local reproduction using the released `reelier@0.32.0` package and immutable skill bytes. It creates evidence about one run only. It does not establish safety, semantic correctness, complete observation, authorship, intent, trusted execution time, active policy, or a write-state delta.

## Prerequisites

- Node 20 or later
- PowerShell
- Outbound HTTPS access to `https://httpbin.org`
- A clean temporary directory

## Released-package reproduction

The npm package is `reelier@0.32.0`; its expected integrity is `sha512-XFrsLKdPuw7R0+gNcvduUIHDj2RE4m9j6eLgmRPKLOKS+Z1SiQEj0sLEmIkxaUujoM8NUfyzeUgIOXL1kAihrQ==`. The retained skill is fetched from the immutable commit `bd44bf81bbd41915543fb647f433ddb386cc6a1d`, not a branch or floating tag: [registry metadata](https://registry.npmjs.org/reelier/0.32.0) and [pinned skill bytes](https://raw.githubusercontent.com/seldonframe/reelier/bd44bf81bbd41915543fb647f433ddb386cc6a1d/examples/registry-seeds/httpbin-echo-check.skill.md).

```powershell
$expectedPackageIntegrity = "sha512-XFrsLKdPuw7R0+gNcvduUIHDj2RE4m9j6eLgmRPKLOKS+Z1SiQEj0sLEmIkxaUujoM8NUfyzeUgIOXL1kAihrQ=="
$actualPackageIntegrity = (npm view reelier@0.32.0 dist.integrity).Trim()
if ($LASTEXITCODE -ne 0) { throw "npm view failed: $LASTEXITCODE" }
if ($actualPackageIntegrity -ne $expectedPackageIntegrity) { throw "Unexpected package integrity: $actualPackageIntegrity" }
npx --yes reelier@0.32.0 --version
if ($LASTEXITCODE -ne 0) { throw "npx version failed: $LASTEXITCODE" }
$proofDir = Join-Path $env:TEMP ("reelier-receipt-proof-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $proofDir | Out-Null
Push-Location $proofDir
try {
$skill = Join-Path $proofDir "httpbin-echo-check.skill.md"
Invoke-WebRequest -ErrorAction Stop -Uri "https://raw.githubusercontent.com/seldonframe/reelier/bd44bf81bbd41915543fb647f433ddb386cc6a1d/examples/registry-seeds/httpbin-echo-check.skill.md" -OutFile $skill
$expectedSkillSha256 = "04748fc814f8a983f941ea2f97e66a6f38ba472e62bab0fe2cbd774a8dfc49df"
$actualSkillSha256 = (Get-FileHash -Algorithm SHA256 $skill).Hash.ToLowerInvariant()
if ($actualSkillSha256 -ne $expectedSkillSha256) { throw "Unexpected skill SHA-256: $actualSkillSha256" }
npx --yes reelier@0.32.0 run $skill
if ($LASTEXITCODE -ne 0) { throw "reelier run failed: $LASTEXITCODE" }
$receipt = Join-Path $proofDir ".reelier\runs\httpbin-echo-check.jsonl"
$record = Get-Content -Raw $receipt | ConvertFrom-Json
if ($record.skill -ne "httpbin-echo-check") { throw "Unexpected receipt skill: $($record.skill)" }
if ($record.passed -ne $true) { throw "Receipt did not pass" }
if ($record.steps.Count -ne 1) { throw "Unexpected receipt step count: $($record.steps.Count)" }
if ($record.steps[0].title -ne "Echo check via httpbin") { throw "Unexpected receipt step title: $($record.steps[0].title)" }
if ($record.steps[0].outcome -ne "passed") { throw "Unexpected receipt step outcome: $($record.steps[0].outcome)" }
if ($record.steps[0].failures.Count -ne 0) { throw "Receipt step has failures" }
if ($record.policy.status -ne "absent") { throw "Unexpected policy status: $($record.policy.status)" }
if ($record.totals.steps -ne 1) { throw "Unexpected total steps: $($record.totals.steps)" }
if ($record.totals.passed -ne 1) { throw "Unexpected passed steps: $($record.totals.passed)" }
if ($record.totals.unchecked -ne 0) { throw "Unexpected unchecked steps: $($record.totals.unchecked)" }
if ($record.totals.failed -ne 0) { throw "Unexpected failed steps: $($record.totals.failed)" }
if ($record.totals.llmInputTokens -ne 0) { throw "Unexpected LLM input tokens: $($record.totals.llmInputTokens)" }
if ($record.totals.llmOutputTokens -ne 0) { throw "Unexpected LLM output tokens: $($record.totals.llmOutputTokens)" }
if ($record.skillContentSha256 -ne $expectedSkillSha256) { throw "Unexpected receipt skill SHA-256: $($record.skillContentSha256)" }
$record | Select-Object skill, passed, skillContentSha256, @{n="stepOutcome";e={$_.steps[0].outcome}}, @{n="policyStatus";e={$_.policy.status}}, @{n="passedSteps";e={$_.totals.passed}}, @{n="unchecked";e={$_.totals.unchecked}}, @{n="llmInputTokens";e={$_.totals.llmInputTokens}}, @{n="llmOutputTokens";e={$_.totals.llmOutputTokens}}
npx --yes reelier@0.32.0 verify $receipt
if ($LASTEXITCODE -ne 0) { throw "reelier verify failed: $LASTEXITCODE" }
} finally {
Pop-Location
}
```

## Expected observation

The run and its single step pass. The printed record shows one passed step, zero unchecked steps, zero recorded LLM input tokens, zero recorded LLM output tokens, and a present `skillContentSha256` content hash. The retained raw observation is [PROOF-RECEIPT.jsonl](PROOF-RECEIPT.jsonl): its step is titled `Echo check via httpbin` and has no failures. The separately retained example skill contains three skill assertions. The receipt retains the skill identity, ordered step number, title, outcome, totals, and any failure text; it does not reproduce the full skill source, action tool or args, an explicit intent field, or every successful assertion expression. It also shows `policy.status=absent`: no active policy claim is present in this run.

Local `verify` reports the receipt as unsigned and untimestamped. Its exit code 0 means only that **No present claim failed**. It does not promote absent fields into verified evidence, establish a trusted execution time, or make a claim about safety, semantic correctness, complete observation, authorship, intent, active policy, or a write-state delta.

## Separate public signed-receipt command

A key supplied by the same server is not independent verification. Independent verification requires a separately sourced PEM passed with `--key`; preserve the PEM's provenance separately from the receipt.

## What this proof supports

The reproduction supports the printed record's bounded claims: the released runner produced a receipt bound by `skillContentSha256` to separately retained skill bytes, the observed step outcome passed, and local verification found no failed present claim. The skill file retains its three assertions; the receipt retains only the observed fields described above. It does not establish that every relevant action was observed, that the action was authorized in every system, or that any wider system reached a correct state.
