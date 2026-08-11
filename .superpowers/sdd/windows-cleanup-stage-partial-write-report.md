Files changed

- `test/authority/ledger.test.ts`
- `.superpowers/sdd/windows-cleanup-stage-partial-write-report.md`

What changed per file

- `test/authority/ledger.test.ts`: the cleanup-stage hard-exit recovery fixture now injects steady monotonic runtimes for both the K1 operation fence and prep housekeeper. It retains `lockTimeoutMs: 200`, exercises the same real filesystem recovery, and still requires `recovered.ok === true`; `busy` and `corruption` remain failures. The assertion now includes the actual recovery result when it fails.
- `.superpowers/sdd/windows-cleanup-stage-partial-write-report.md`: records diagnosis, red/green evidence, verification, deviations, and open risks for CI run `31499545345`.

Root cause

Windows CI failed child `after-coordination-cleanup-stage-partial-write` in `coordination cleanup stage write hooks are live and recover their exact crash windows` after 611.5338ms. The assertion at compiled line 3922 was `recovered.ok`; diagnostic reproduction established the actual result was `{ok:false,reason:"busy"}`.

This is a fixture timing issue, not a production recovery or classification defect. The fixture used a real monotonic 200ms recovery deadline even though its purpose is to prove the exact partial-write and file-sync crash topologies recover. A partial stage requires an additional append transition, making that row more likely to cross the short real deadline on a loaded Windows runner.

Production correctly refuses a later operation after that deadline. `prep-only over-budget continuation stays bound to the initiated file identity and operation lifetime` explicitly pins that a later operation cannot inherit the initiating operation's exact-file capability, while peer replacement tests preserve corruption precedence. Recording a continuation for an adopted partial file, increasing the deadline, or accepting `busy` would weaken those invariants.

The fixture now makes only its monotonic clocks deterministic. The K1 fence still executes, the real partial stage is read and extended in place, the marker and lifecycle files must drain, exact validation remains production-owned, and every refusal still fails the test.

TDD red/green evidence

The original fixture passed ten unconstrained local repetitions, confirming the intermittent CI shape. Pinning the test and children to one core beside a continuous same-core CPU hog deterministically produced the missing diagnostic:

```text
✖ after-coordination-cleanup-stage-partial-write (15287.2514ms)
AssertionError [ERR_ASSERTION]: after-coordination-cleanup-stage-partial-write recovery result: {"ok":false,"reason":"busy"}

false !== true
```

With the fixture-only clock injection, the identical stress command passed both crash rows:

```text
✔ after-coordination-cleanup-stage-partial-write (14701.5531ms)
✔ after-coordination-cleanup-stage-file-sync (32132.8974ms)
✔ coordination cleanup stage write hooks are live and recover their exact crash windows (46876.4242ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
ℹ duration_ms 51194.156
```

Deviations from the plan and why

- No production file changed. Systematic comparison showed that extending continuation authority to a pre-existing partial stage would contradict the already committed operation-lifetime and exact-identity contract. The minimal correct fix is confined to the nondeterministic fixture.
- No deadline was widened: `lockTimeoutMs` remains 200ms. The test-only monotonic sources are steady because this test measures crash-topology recovery, while separate deadline tests continue to use advancing clocks and require `busy`.

Commands run

```powershell
npx tsc -p tsconfig.test.json

$self=[System.Diagnostics.Process]::GetCurrentProcess()
$originalAffinity=$self.ProcessorAffinity
$hog=Start-Process powershell -WindowStyle Hidden -PassThru -ArgumentList '-NoProfile','-Command','while($true){}'
try {
  $self.ProcessorAffinity=[IntPtr]1
  $hog.ProcessorAffinity=[IntPtr]1
  node --test --test-concurrency=1 --test-name-pattern="coordination cleanup stage write hooks are live" dist-test/test/authority/ledger.test.js
} finally {
  $self.ProcessorAffinity=$originalAffinity
  if(!$hog.HasExited){Stop-Process -Id $hog.Id -Force}
}

node --test --test-concurrency=1 --test-name-pattern="coordination cleanup stage write hooks are live|prep-only over-budget continuation|prep-only progress respects the original deadline|option-gated cleanup-pass hard exits|foreign-dead-slot drainage" dist-test/test/authority/ledger.test.js
node --test --test-concurrency=1 dist-test/test/authority/ledger.test.js
npm run build
```

Test results (verbatim tails)

Twenty-five silent repetitions followed by a displayed twenty-sixth Windows run:

```text
PASS ATTEMPT 23
PASS ATTEMPT 24
PASS ATTEMPT 25
▶ coordination cleanup stage write hooks are live and recover their exact crash windows
  ✔ after-coordination-cleanup-stage-partial-write (256.4039ms)
  ✔ after-coordination-cleanup-stage-file-sync (224.9499ms)
✔ coordination cleanup stage write hooks are live and recover their exact crash windows (482.4395ms)
ℹ tests 3
ℹ suites 0
ℹ pass 3
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 632.2138
```

Related deadline, identity, and crash-recovery tests:

```text
✔ foreign-dead-slot drainage retires and drains the granted shapes (2882.4943ms)
ℹ tests 31
ℹ suites 0
ℹ pass 31
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6325.4362
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
ℹ duration_ms 113031.3292
```

Build:

```text
> reelier@0.32.1 build
> tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Open risks

- CI run `31499545345` has not been rerun from this commit. The deterministic same-core red/green reproduction and repeated Windows runs cover the observed mechanism locally.
- A runner can still honestly return `busy` before acquiring the operation fence under extreme starvation or real contention. This fixture removes scheduler time only from the crash-recovery transition budget; it does not change production behavior or claim availability without CPU time.
- The hard-exit child still uses real process scheduling and filesystem writes. That is intentional because the test must prove the real hook and residue, but it means the test can become slow on a severely starved host even though the recovery classification is deterministic.
