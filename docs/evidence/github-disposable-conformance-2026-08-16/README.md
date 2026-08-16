# Disposable GitHub conformance — 2026-08-16

This is a real GitHub substrate test against the approved disposable repository
[`fixlyai/soloproof`](https://github.com/fixlyai/soloproof).

Proved:

- one predetermined file pushed to a unique branch;
- exact branch commit, tree, and content readback;
- retry was `Everything up-to-date`, with no duplicate commit;
- direct push to protected `main` was rejected;
- normal PR merge was blocked when one approval was required;
- an explicit temporary zero-approval PR policy profile merged the PR through the
  protected pull-request path;
- `main` content was read back and protection was restored to administrator
  enforcement with one required approval.

The merge was not a reviewed merge. The final evidence therefore does not claim
that Reelier supplied a GitHub review, status check, or universal merge policy.
