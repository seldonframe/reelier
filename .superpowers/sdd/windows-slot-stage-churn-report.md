Files changed

- `test/authority/ledger.test.ts`
- `.superpowers/sdd/windows-slot-stage-churn-report.md`

What changed per file

- `test/authority/ledger.test.ts`: `K1 construction churn distinguishes same-identity canonical progress from corruption` now runs its shared classification helper with steady test-only K1-fence and prep-housekeeper monotonic clocks. The configured `lockTimeoutMs: 20` remains unchanged. Every real filesystem mutation, exact-identity assertion, canonical-prefix restart assertion, `busy` expectation, and corruption-precedence assertion remains strict.
- `.superpowers/sdd/windows-slot-stage-churn-report.md`: records the diagnosis, deterministic red/green evidence, exact commands, verification, and residual risk for CI run `31507444038`.

Root cause

On Windows CI, child `typed slot-retired stage zero growth is bounded construction` failed `typed slot-retired stage progress restarts classification` with `false !== true`. The child completed in about 40ms while the shared helper configured a real 20ms acquisition/classification deadline.

The mutation itself was accepted correctly: it appended the canonical slot-retired acknowledgment to the same zero-stage inode, the operation returned the expected `{ok:false,reason:"busy"}`, and no authority write was granted. The count stayed at one because the real monotonic deadline elapsed after the first closed snapshot and before the classifier could re-enter. Thus the fixture conflated scheduler timing with the semantic property it intended to test.

This is not a production defect. Separate tests require the real deadline to stop later transitions, forbid a later operation from inheriting an initiated file capability, preserve exact identity through allowed canonical growth, and give corruption precedence to identity replacement/non-prefix mutation. Widening production continuation or accepting a one-snapshot result would weaken those contracts.

The minimal correction makes only this semantic-classification helper's monotonic clocks steady. The operation fence still binds the real root, the real filesystem graph is mutated, `lockTimeoutMs` stays 20, and every result assertion remains unchanged.

TDD red/green evidence

Thirty unconstrained pre-fix Windows repetitions passed, confirming the hosted failure was intermittent. A continuous same-core CPU hog drove the existing strict parent red. Before the change, 27 of 28 children failed because the real 20ms clock expired before their intended seam or restart; the target failed in the same run:

```text
✖ typed slot-retired stage zero growth is bounded construction (1283.5597ms)
AssertionError [ERR_ASSERTION]: after-coordination-cleanup-marker-enumeration is a live closed-snapshot seam

false !== true
```

With the fixture-only clocks injected, the identical stress passed all semantic cases, including the target and its corruption twin:

```text
✔ typed slot-retired stage zero growth is bounded construction (331.793ms)
✔ typed slot-retired stage same-identity non-prefix mutation is terminal corruption (19.7368ms)
✔ K1 construction churn distinguishes same-identity canonical progress from corruption (43388.2233ms)
ℹ tests 28
ℹ suites 0
ℹ pass 28
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 46303.6421
```

Deviations from the plan and why

- No production file changed. Root-cause tracing showed production honored its deadline and returned the already expected `busy`; only the fixture's snapshot-count oracle was coupled to wall time.
- No timeout was widened and no refusal was accepted. The test-only clocks isolate semantic classification, while dedicated tests continue to advance their clocks and require deadline exhaustion.

Commands run

```powershell
npx tsc -p tsconfig.test.json

$self=[System.Diagnostics.Process]::GetCurrentProcess()
$originalAffinity=$self.ProcessorAffinity
$hog=Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile','-Command','while($true){}'
try {
  $self.ProcessorAffinity=[IntPtr]1
  $hog.ProcessorAffinity=[IntPtr]1
  node --test --test-concurrency=1 --test-name-pattern="K1 construction churn distinguishes same-identity canonical progress from corruption" dist-test/test/authority/ledger.test.js
} finally {
  $self.ProcessorAffinity=$originalAffinity
  if(!$hog.HasExited){Stop-Process -Id $hog.Id -Force}
}

for($attempt=1;$attempt -le 30;$attempt++){
  node --test --test-concurrency=1 --test-name-pattern="K1 construction churn distinguishes same-identity canonical progress from corruption" dist-test/test/authority/ledger.test.js *> $null
  if($LASTEXITCODE -ne 0){
    Write-Output "FAILED ATTEMPT $attempt"
    exit $LASTEXITCODE
  }
  Write-Output "PASS ATTEMPT $attempt"
}
node --test --test-concurrency=1 --test-name-pattern="K1 construction churn distinguishes same-identity canonical progress from corruption" dist-test/test/authority/ledger.test.js

node --test --test-concurrency=1 --test-name-pattern="K1 construction churn distinguishes|prep-only progress respects the original deadline|prep-only over-budget continuation|prep-only cleanup finalization reclassifies|slot-only cleanup reclassifies|slot-only stale stage authority|k1-operation-fence-only endpoint collision and wait" dist-test/test/authority/ledger.test.js
node --test --test-concurrency=1 dist-test/test/authority/ledger.test.js
npm run build
```

Test results (verbatim tails)

Thirty silent repetitions followed by a displayed thirty-first Windows run:

```text
PASS ATTEMPT 28
PASS ATTEMPT 29
PASS ATTEMPT 30
▶ K1 construction churn distinguishes same-identity canonical progress from corruption
  ✔ typed slot-retired stage zero growth is bounded construction (16.6918ms)
  ✔ typed slot-retired stage same-identity non-prefix mutation is terminal corruption (16.2643ms)
✔ K1 construction churn distinguishes same-identity canonical progress from corruption (362.4739ms)
ℹ tests 28
ℹ suites 0
ℹ pass 28
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 509.725
```

Related semantic, identity, continuation, and deadline tests:

```text
✔ k1-operation-fence-only endpoint collision and wait retain one original deadline without filesystem mutation (75.8407ms)
ℹ tests 38
ℹ suites 0
ℹ pass 38
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1203.904
```

Full ledger suite:

```text
ℹ tests 718
ℹ suites 0
ℹ pass 718
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 93766.0183
```

Build:

```text
> reelier@0.32.1 build
> tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Open risks

- CI run `31507444038` has not been rerun from this commit. The controlled same-core red/green and repeated native Windows runs cover the observed timing mechanism locally.
- The fixture still uses real filesystem and endpoint operations. Severe starvation can make it slow, but its classification semantics no longer depend on consuming fewer than 20 milliseconds of wall time.
- Production still honestly returns `busy` when its real deadline expires. This change neither retries nor extends that deadline and does not claim availability without scheduler time.
