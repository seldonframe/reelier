# Windows K1 FIFO admission

## Decision

Replace blind, exponential competition for the Windows K1 root named-pipe mutex with a durable,
non-barging ticket queue. The named pipe remains the exclusive root-epoch mutex. The queue decides
which one contender may attempt to acquire it.

This design is limited to the existing certified `local-fs`, same-network-namespace, isolated
Authority Cell topology on Windows. It does not claim to coordinate a network filesystem or
multiple hosts. Postgres deployments continue using database transactions and advisory locks.

## Problem and falsifier

On exact main commit `13ed819`, hosted Windows run `31596294603` twice showed that the current
listen/retry loop can starve a contender:

- job `94112526160` produced no committed N100 winner after 99 `busy` results and one `corruption`;
- job `94117665864` completed 99 duplicate operations but one child exhausted its fence budget and
  returned `busy` after 38.558 seconds.

The second run also proved that a 20 ms test could expire in real Windows fence acquisition before
reaching the housekeeping behavior it intended to test. That fixture is now exact-root-bound and
deterministic; it is separate from the production starvation defect.

The production falsifier remains: ten concurrently live contenders can repeatedly barge past one
of their peers until its bounded deadline expires, even though the mutex becomes available many
times during that interval.

## Safety properties

The queue must preserve all existing K1 guarantees and add fairness:

1. At most one process holds the root named-pipe mutex.
2. At most the oldest eligible ticket may attempt to acquire that mutex.
3. A later ticket cannot barge ahead of an earlier live, complete ticket.
4. A crashed or withdrawn ticket cannot block the queue forever.
5. No process can remove or replace another live ticket.
6. A malformed, substituted, linked, or identity-changing ticket is corruption, never absence.
7. Deadline exhaustion returns `busy`; it never widens write authority or downgrades corruption.
8. Queue state never authorizes a ledger callback. It only determines who may attempt the existing
   K1 operation fence.
9. Queue recovery performs no provider dispatch, budget mutation, or semantic ledger transition.
10. The public authority ABI and public fault-point union do not widen.

## Components

### Queue directory

The ledger owns one real, link-confined coordination directory beneath its already verified root.
It contains only ticket preparation directories, committed ticket directories, retirement markers,
and closed cleanup acknowledgements. Normal ledger records remain outside it.

The queue directory is created and verified by the same layout/confinement rules as other durable
ledger directories. Every traversal uses `lstat`, exact filesystem identities, single-link regular
files, canonical bytes, and directory synchronization.

### Ticket identity and ordering

Each contender draws the existing K1 admission ticket before touching the queue and combines it
with the existing host digest, PID, and a fresh 256-bit nonce. The total ordering key is:

`admission ticket → host digest → PID → nonce`

The admission ticket uses the already-reviewed host-monotonic K1 admission clock. The remaining
fields make collisions deterministic without granting priority. Invalid, zero, overflowing, or
noncanonical values refuse before publication.

### Ticket record

A closed ticket record contains:

- protocol version;
- exact K1 root material digest;
- admission ticket;
- host digest, PID, and nonce;
- liveness endpoint digest;
- canonical ticket-record digest.

It contains no tenant data, credential, request bytes, task contents, or provider identity.

### Liveness endpoint

Before publishing its ticket, a contender binds a private named-pipe liveness endpoint derived from
the root digest and ticket digest. The endpoint returns only the exact ticket identity response.
This prevents PID reuse from masquerading as the original waiter. PID probing is secondary evidence,
not sufficient removal authority.

The endpoint is closed only after the ticket is withdrawn, retired, or removed following successful
mutex acquisition. A missing or mismatched endpoint never grants immediate cleanup; cleanup still
requires a stable closed snapshot and exact ticket revalidation.

## Protocol

### 1. Prepare and publish

The contender:

1. verifies the exact ledger root and queue directory;
2. draws its admission ticket and binds its liveness pipe;
3. exclusively creates a uniquely named preparation directory;
4. exclusively creates and writes canonical `ticket.json`;
5. syncs the file and preparation directory;
6. exact-revalidates directory identity, file identity, bytes, and liveness response;
7. renames the preparation directory to its committed ticket name;
8. syncs the queue directory and performs final exact validation.

Any unexplained disappearance after exclusive creation is corruption. A process crash preserves its
partial artifact for bounded recovery; it is never eagerly deleted by the creator's exception path.

### 2. Elect

Every contender reads two identical, closed queue snapshots. It validates every reserved entry and
sorts committed tickets by the total ordering key.

- If its ticket is not first, it waits for bounded queue progress and re-elects.
- If its ticket is first, it alone may call the existing named-pipe mutex acquisition.
- A newly published later ticket cannot invalidate the current oldest ticket.
- Any membership or identity change between snapshots causes reclassification, not mutation.

No ticket may skip the queue and attempt the Windows root mutex directly.

### 3. Acquire and advance

The elected contender acquires the existing exact-root named-pipe mutex. After the mutex is bound and
the root is revalidated, it exact-revalidates its ticket, removes only its own ticket, synchronizes
the queue directory, and continues through the existing K1 operation capability.

Removing the ticket after mutex acquisition allows the next ticket to become eligible, but that next
contender still cannot acquire the mutex until the current owner releases it. This pipelines waiting
without permitting concurrent root transitions.

### 4. Withdraw

A contender whose deadline expires before mutex acquisition may remove only its own exact ticket.
It revalidates the ticket and liveness endpoint, renames to an owner-withdrawal marker, syncs, writes
the closed cleanup acknowledgement, and removes the marker. If withdrawal cannot complete exactly,
the artifact remains for recovery and the operation returns `busy` or `corruption` according to the
observed state.

### 5. Recover dead tickets

Any contender may retire an earlier ticket only after:

1. two identical closed queue snapshots;
2. exact ticket directory, file, and canonical-byte revalidation;
3. two exact `vacant` observations for the ticket's liveness pipe, separated by a bounded delay;
4. same-host PID evidence recorded only as supporting evidence; `unverifiable`, access-denied,
   foreign, or otherwise ambiguous pipe observations refuse cleanup;
5. one final unchanged snapshot immediately before mutation.

Recovery atomically renames the ticket to a typed retired marker, syncs, emits a content-bound cleanup
acknowledgement, and removes the marker. The exact liveness pipe—not a reusable PID—is the owner-instance
proof. Replacement, reappearance, ambiguous liveness, or concurrent progress causes reclassification
or refusal, never cleanup.

## Crash behavior

| Boundary | Durable observation | Recovery |
|---|---|---|
| Before liveness bind | No ticket | None |
| After liveness bind, before preparation | No filesystem authority | Pipe disappears with process |
| Preparation directory/file partial | Typed partial preparation | Stable dead-owner retirement |
| Committed ticket before election | Complete queued ticket | Owner withdraws or dead-owner recovery |
| Elected before mutex acquisition | Complete oldest ticket | Ticket retains priority |
| Mutex acquired before ticket removal | Oldest ticket plus live mutex | Others wait; crash removes pipe and enables recovery |
| Ticket removed while mutex held | Mutex is sole transition authority | Next ticket may queue but cannot enter root transition |
| Withdrawal/retirement partial | Typed marker plus exact lineage | Idempotent cleanup continuation |
| Cleanup acknowledgement final | No live ticket authority | Idempotent removal/export |

A reboot drops all liveness pipes. Durable tickets remain and are recovered as dead-owner artifacts
after the root and queue are revalidated. No wall-clock ordering or wall-clock expiry is trusted.

## Rejected approaches

### Longer timeout or faster polling

Rejected. It changes failure probability, not fairness, and would conceal the hosted falsifier.

### Connect-and-wake-all on owner close

Rejected. It replaces polling with a thundering herd; all waiters race to listen and a later contender
can still barge repeatedly.

### In-memory or owner-side FIFO broker

Rejected for the first implementation. The queue disappears with its owner and requires socket-state
transfer or queue reconstruction during every crash. Durable tickets make recovery inspectable and
testable with the existing filesystem evidence model.

### PID-only dead-owner cleanup

Rejected. Windows may reuse a PID. The exact ticket liveness endpoint and ticket digest bind the
owner instance.

## Testing and acceptance

### Protocol tests

- closed schemas and canonical ticket vectors;
- duplicate ticket-order collision and total-order determinism;
- ticket/file/directory substitution, hardlink, symlink, junction, and root replacement;
- partial write, shrink, growth, same-identity mutation, and same-name replacement;
- liveness endpoint mismatch, PID reuse, dead owner, unverifiable owner, and endpoint rebinding;
- owner withdrawal and dead-ticket cleanup idempotency;
- crash injection at every boundary in the crash table;
- no callback, budget mutation, or provider operation before the existing K1 capability is acquired.

### Concurrency tests

- ten real Windows processes publish before any may acquire; observed acquisition order equals ticket
  order;
- a continuous stream of later arrivals cannot overtake the oldest live ticket;
- predecessor crash hands progress to exactly one successor;
- successor crash before and after mutex acquisition remains recoverable;
- 100 identical reservations converge to one committed reservation and exactly one dispatch-eligible
  result, with every child returning a successful existing-or-created reservation;
- 100-way tests repeat under CPU and filesystem pressure without timeout expansion.

### Release gate

The gate closes only when the exact packed branch passes repeated hosted Windows N100 runs, the full
Windows suite, focused crash/fuzz tests, Linux regressions, and independent review. Local passes alone
cannot close the hosted falsifier.

## Non-goals and honest claims

- This does not make local filesystem coordination safe across hosts or network filesystems.
- This does not prove universal write completeness or goal correctness.
- This does not change provider dispatch, reconciliation, budgets, receipts, or topology claims.
- This does not authorize managed dispatch; it only makes the Windows local-fs admission primitive
  fair and recoverable.
- A verified queue proves bounded ordering and exclusive admission, not that the requested Outcome is
  wise, safe, or correct.
