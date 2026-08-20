# Mandate-Native Agent Creation — Implementation Plan

## Goal

Implement the portable mandate, environment activation lock, automatic attenuated mission derivation, reconciled Outcome record, and a hermetic Eve tracer proving two consecutive Outcomes under one human confirmation.

## Files in scope — OSS

- `docs/superpowers/specs/2026-08-20-mandate-native-agent-creation-design.md`
- `docs/superpowers/plans/2026-08-20-mandate-native-agent-creation.md`
- `src/authority/agent-mandate.ts`
- `src/authority/index.ts`
- `examples/agents/eve-release-tracer/AGENT.md`
- `test/authority/agent-mandate.test.ts`
- `test/authority/package.test.ts`
- `.superpowers/sdd/2026-08-20-mandate-native-agent-creation/oss-report.md`

## Files in scope — Cloud

- `.superpowers/sdd/2026-08-20-mandate-native-agent-creation/cloud-brief.md`
- `src/lib/ambient-agent-tracer.ts`
- `test/ambient-agent-tracer.test.ts`
- `.superpowers/sdd/2026-08-20-mandate-native-agent-creation/cloud-report.md`

## Tasks

1. RED: specify closed `AGENT.md`, canonical mandate digest, prose separation, hostile input refusal, lock verification, mission attenuation, and Outcome honesty.
2. GREEN: implement the OSS contract as inert, closed, detached, frozen values with no provider access.
3. RED: specify one-confirmation agent creation and two Eve release rehearsals with fresh identities, bounded fan-out, ambiguity/restart reconciliation, zero routine approvals, and out-of-mandate refusal.
4. GREEN: compose the tracer with host-supplied confirmation, durable agent store, authority check, Eve provider, and Outcome store ports. No credentials cross into Eve.
5. Verify focused tests, typechecks, build/package boundaries, and full suites. Preserve and report inherited baseline failures separately.

## Gates

- One activation confirmation for the exact mandate digest.
- Two consecutive disposable Outcomes, each with fresh mission/grant/allocation/session identities.
- No confirmation after creation unless the mandate digest changes.
- No provider dispatch before lock and subset checks.
- Ambiguous writes use exact readback and are not resent.
- All wire objects are closed and four-state honest.
- No live external writes.
