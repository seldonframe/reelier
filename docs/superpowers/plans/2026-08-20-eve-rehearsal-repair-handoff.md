# Eve Rehearsal Repair Handoff

## Governing decision

The next irreversible release ceremony must start from a fresh session after the
Authority Cell is quiescent and the rehearsal repair has passed review and Linux
CI. This follows the project constitution: agents may work widely, but signed,
deterministic authority governs consequential exits. The metric remains verified
Outcomes per human review, not agent count or speed.

Do not publish a production branch, merge, tag, npm version, MCP Registry version,
or GHCR manifest from this branch. `pending`, `absent`, `unchecked`, ambiguity, and
missing evidence are not success.

## Verified state at handoff

- Repair branch: `codex/eve-rehearsal-driver`, based on
  `origin/main` at `9f59d1afe63a92bc5365ebc3779122783d7736c7`.
- Three disposable rehearsal attempts were archived as failed evidence. None
  created a rehearsal branch, pull request, merge, tag, or registry publication.
- The third attempt exposed a real substrate defect: an internal prepared release
  saga had no external route authority, so durable receipt publication failed
  before the provider boundary.
- The repair persists a closed, host-owned prepared-dispatch binding, preserves it
  through ledger restart, and uses it to derive the durable publication identity.
- Reservation-publication failures are classified before provider dispatch. The
  public response remains the closed `dispatch-unavailable`; a separate immutable
  internal diagnostic is redacted and is explicitly not a receipt.
- Focused verification covers real ledger-minted IDs, crash after `send-started`,
  restart recovery, no resend, redacted diagnostics, all four GitHub release
  transitions, and rehearsal tooling.
- The live Authority Cell was left empty and unauthenticated probes return 401.
- Pull requests #126 and #128 are stale carriers: equivalent/rebased content is
  already on `main`. They should be closed as superseded, not merged.

## Required next session

1. Review the repair diff and require green Ubuntu CI. Treat a badge mismatch or
   any new failure as a stop, not as ceremony noise.
2. Merge only the reviewed repair commit set. Close #126 and #128 as superseded.
3. Redeploy the Authority Cell from the exact reconciled `main` commit and verify
   unauthenticated 401 plus authenticated read-only 200 behavior.
4. Generate a fresh root grant, allocations, session, candidate artifacts, and
   signed rehearsal authorization. Do not reuse any archived mission authority.
5. Run two consecutive disposable rehearsals, including injected ambiguity and
   restart recovery. Require zero routine human intervention, zero duplicate
   writes, and a fully verified receipt graph for each run.
6. Stop again for the human pre-publication review. Only a separately signed,
   exact production authorization may unlock the real repository and registries.

The old live-smoke token and the prior continuation prompt are historical context,
not executable authority. Reusing either would erase the very restart and expiry
boundaries the mission is intended to prove.
