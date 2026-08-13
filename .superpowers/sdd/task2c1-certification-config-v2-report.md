# Files changed

- `.superpowers/sdd/task2c1-certification-config-v2-report.md`
- `authority/certification.example.json`
- `docs/runbooks/live-certification.md`
- `src/authority/certification/config.ts`
- `src/authority/certification/scenarios.ts`
- `src/authority/host/certification-config.ts`
- `test/authority/certification-config.test.ts`
- `test/authority/certification-scenarios.test.ts`

# What changed per file

- `.superpowers/sdd/task2c1-certification-config-v2-report.md`: records the exact Task 2C1 scope, implementation, verification evidence, review outcome, deviations, and risks.
- `authority/certification.example.json`: adds a minimal v2 template selecting only `github-issue-labels`, with placeholder non-secret resource identifiers, one cleanup commitment, and the named `githubCredential` reference.
- `docs/runbooks/live-certification.md`: documents the private-estate v2 format, its exact seven named operator secret slots, and the temporary boundary between the new parser/migration and legacy-v1 live commands.
- `src/authority/certification/config.ts`: adds the closed, deep-frozen scenario-scoped v2 parser and types; selected-only resource/cleanup/metadata/secret validation; exact provider API and topology URL boundaries; path, digest, DNS, semver, list, Fly identity, Codex/Fly, and cross-scenario account/project invariants; RFC 8785 canonicalization; and deterministic v1-to-v2/v2-idempotent migration. It never resolves `env:` or `file:` references and drops HubSpot, legacy egress bearer input, and manual generated identity fields from migration output.
- `src/authority/certification/scenarios.ts`: adds the runtime-frozen declarative registry for the exact eight scenario IDs and their resource sections, cleanup commitments, metadata sections, and named secret slots. It contains no runner, adapter, provider, filesystem, environment, or network I/O.
- `src/authority/host/certification-config.ts`: preserves the existing v1 parser/inspection ABI and re-exports the internal v2 parser, migration, canonicalization, constants, and types without widening the package root.
- `test/authority/certification-config.test.ts`: retains v1 compatibility coverage and adds v2 selected-only closure, HubSpot/manual-identity refusal, named-secret coherence/non-disclosure/no-I/O, mutation isolation, canonical stability, migration, path safety, exact provider/topology URL, runtime freeze, Fly uniqueness, shared provider-scope, example, and idempotence coverage.
- `test/authority/certification-scenarios.test.ts`: binds the exact eight runtime-frozen scenario IDs and verifies the registry is declarative, closed, and mapped to the intended selected requirements.

# Deviations from the plan

None. The slice does not implement certify init, preflight, readiness, export, verify, runners, provider I/O, root exports, or generated identity values.

The first baseline `npm test` attempt hit the initial 120-second command cap without emitting a result. It was not treated as a pass or assertion failure. Two later complete full-suite runs exited 0; the final run below is from final implementation head `f9ee5bd359da5f4ffd981b00d95677e4b3698acd`.

# Test results

## RED evidence

Initial test compile, before the new modules existed:

```text
test/authority/certification-config.test.ts(7,131): error TS2307: Cannot find module '../../src/authority/certification/config.js' or its corresponding type declarations.
test/authority/certification-scenarios.test.ts(3,69): error TS2307: Cannot find module '../../src/authority/certification/scenarios.js' or its corresponding type declarations.
```

Subsequent RED cycles demonstrated missing Codex-home isolation, exact provider API pinning, runtime-frozen ABI lists, Fly identity uniqueness, Cloudflare/Vercel cross-scenario coherence, Codex/Fly endpoint coherence, and exact topology endpoint ports before each fix.

## Test compile

Command: `npx tsc -p tsconfig.test.json --pretty false`

```text
Exit code: 0
Wall time: 19.5 seconds
Output: (none)
```

## Focused tests

Command: `node --test --test-concurrency=1 dist-test/test/authority/certification-config.test.js dist-test/test/authority/certification-scenarios.test.js`

Verbatim tail:

```text
✔ the closed certification scenario registry contains eight unique sorted declarative scenarios (1.4206ms)
✔ scenario requirements declare selected-only resources, cleanup, metadata, and named secret slots (0.1734ms)
ℹ tests 21
ℹ suites 0
ℹ pass 21
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 173.4437
```

## Build

Command: `npm run build`

Verbatim tail:

```text
> reelier@0.32.1 build
> tsc -p tsconfig.json && node scripts/build-authority-contract.mjs --copy-schemas && node scripts/build-packs.mjs

built cloudflare_api_token, cloudflare_dns, github_issue_labels, gmail, gmail_labels, hubspot_slack_information_flow, neon_database, slack_channel_topic, stripe, vercel_deployment
```

Exit code: 0.

## Full suite

Command: `npm test`

Verbatim tail:

```text
ℹ tests 2780
ℹ suites 0
ℹ pass 2779
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 362031.1544
```

Exit code: 0. Wall time: 375.1 seconds.

## Independent review

The independent reviewer re-reviewed final hardening through `f9ee5bd` and reported:

```text
Blocking issues: None.
Non-blocking issues: None.
Verdict: Ship.
```

# Open risks

- Existing live certify commands intentionally remain on the v1 compatibility path until the separately scoped init/preflight/readiness slice lands; the runbook explicitly says not to pass the v2 example to those commands yet.
- Migration treats a valid v1 file as the old complete private certification estate and therefore selects all eight non-HubSpot v2 scenarios. Malformed or incomplete v1 inputs refuse rather than synthesizing missing values.
- The parser validates and preserves opaque secret references but deliberately does not test their existence or read their values; readiness owns that later responsibility.
