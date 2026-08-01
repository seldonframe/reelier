# Security

## Reporting a vulnerability

**Please do not open a public issue for a suspected vulnerability.**

Use GitHub's private reporting — [Report a vulnerability](https://github.com/seldonframe/reelier/security/advisories/new) — which notifies the maintainers without disclosing anything publicly.

This is a small project. Expect an acknowledgement within a few days rather than within hours, and a fix timeline that depends on severity. If you have not heard back in a week, please assume the message was missed and ping the issue tracker asking someone to check their advisories — without describing the issue.

If you would like credit in the release notes, say so and how you want to be named. If you would rather not be named, that is equally fine.

## Scope

In scope: the `reelier` CLI, the file formats described in [SPEC.md](./SPEC.md), the bundled GitHub Action, and the published npm and container artifacts.

Out of scope, and stated so you do not spend time on them:

- **Prompt injection and model behavior.** Reelier does not inspect prompts and makes no claim about what a model will do. It constrains what a tool call may do.
- **Semantic correctness of a change.** A receipt proves what changed and whether it stayed in declared scope — never that the change was right. See [docs/security/threat-model.md](./docs/security/threat-model.md) §3.6.
- **Sandboxing.** Reelier is not a sandbox and does not replace one.
- **The hosted ledger's infrastructure.** Report those to the same address; they are simply not covered by this repo's threat model.

## What we consider a vulnerability here

Because this is a trust tool, the interesting bugs are not only the classic ones. Any of the following is worth reporting:

- A path that renders `absent`, `pending`, `unchecked`, or `unevaluated` as a pass.
- A way to make a receipt claim more than it proves, including a signature appearing to cover a field it does not (see [SPEC.md](./SPEC.md) §4.6).
- A way to execute an approved write step whose tool or arguments have drifted since approval, or to override an approval mismatch with a flag.
- A way to make the recorder fail *closed* (breaking the agent) or the gate fail *open* (permitting a refused write).
- Secret material reaching a trace, record, or receipt that redaction should have removed.

The first two matter as much as the rest. A trust tool that overstates once is worse than one that crashes.

## Known limitations

These are documented rather than hidden, and are not vulnerabilities:

- **No key revocation feed.** A compromised signing key produces valid receipts until noticed out of band. This is the largest known gap.
- **Redaction is pattern-based** and cannot be complete for novel secret formats.
- **The state check is check-then-act**, not compare-and-swap at the resource. A window exists; where a tool supports `If-Match`, use it.

The full picture, including trust boundaries and residual risk per boundary, is in [docs/security/threat-model.md](./docs/security/threat-model.md) — which carries its own review-status disclosure, because it has not been independently audited.
