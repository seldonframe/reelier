# Mandate-Native Agent Creation — Eve Tracer

## Constitutional order

`FOUNDATION.md` and `BUILDING-COMPASS.md` govern this design. The product metric is reconciled Outcomes per human review. Reelier bounds consequential state transitions; it does not supervise agent reasoning.

## User contract

A human describes a persistent agent once, reviews its proposed powers, and performs one platform-native confirmation. The resulting agent can accept ordinary prompts and create attenuated mission and subagent grants without further human approval while it stays inside that mandate.

The user-facing concepts are only:

- Create agent
- Change powers
- Review Outcomes
- Revoke

“Passkey” is an implementation detail of Create/Change powers. A prompt is intent, not durable authority. The portable `AGENT.md` declares the powers; the environment-specific `.reelier/agents/<agentId>/mandate.lock` proves that this environment activated the exact declaration.

## Portable document

`AGENT.md` contains a frontmatter block delimited by `---`. The frontmatter body is one closed, compact, unambiguous JSON object (JSON is valid YAML) so duplicate keys or alternate wire spellings cannot gain a second meaning. Prose follows the frontmatter and is instruction, not authority.

The v1 mandate binds:

- stable agent ID and revision;
- reviewed role pack;
- allowed harnesses;
- exact connector accounts;
- allowed Outcome kinds and destinations;
- concurrency, fan-out, changed-file, and changed-byte maxima;
- creation-only human confirmation and stop-and-report exception behavior;
- validity interval and revocation generation.

The mandate digest covers only the closed frontmatter. Editing prose cannot silently widen powers. Editing any authority field changes the digest and requires Change powers.

## Activation lock

The lock is a closed, environment-bound record containing the mandate digest, trust-domain and authority digests, activation-proof digest, environment ID, validity interval, and revocation generation. It contains no credential or provider secret. Verification requires exact identity/digest equality, current validity, and a host-supplied proof verifier. A lock never self-attests.

## Mission derivation

Prompts trigger missions; they do not authorize them. A mission request is accepted only when its requested Outcome, harness, connector, destination, and limits are subsets of the active mandate. Eve may select fan-out up to the mandate maximum. Each mission receives fresh mission, grant, allocation, and session identities. An out-of-mandate request stops and emits an exception; it never asks for a routine mid-run approval or widens itself.

## Outcome honesty

Every terminal mission yields one `ReconciledOutcomeV1`. `verified`, `failed`, `unchecked`, and `absent` remain distinct. A verified Outcome binds a receipt-graph digest; the other states cannot impersonate one. Verification proves the declared transition and observed result, not semantic correctness, safety, completeness, or business wisdom.

## Eve tracer acceptance

The first tracer creates one `github_patch_release_operator_v1` agent with one confirmation, then runs two disposable release Outcomes under the same mandate. Each run uses fresh derived identities, permits Eve-selected bounded fan-out, requires no further confirmation, injects ambiguity/restart behavior, reconciles by readback without resend, and ends in one reviewable Outcome.

## Inversion and falsifiers

The phase fails if any of these occur:

- a prompt alone creates or widens durable authority;
- prose edits change authority;
- the lock is portable across environments or contains credentials;
- any mission or subagent requests a routine human approval;
- a requested scope outside the mandate dispatches;
- ambiguity is resent instead of reconciled;
- `pending`, `absent`, or `unchecked` is rendered as success;
- the second Outcome needs another platform confirmation;
- agent count grows without independent work or human review falls behind Outcomes.

## Explicit nonclaims

This phase does not publish v0.32.1, touch production registries, enable general customer billing, prove completeness, judge content correctness, or decide team and organization monetization.
