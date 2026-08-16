Files changed

- `src/bootstrap/initialize.ts`
- `src/cli.ts`
- `test/bootstrap-initialize.test.ts`
- `.superpowers/sdd/2026-08-14-one-command-agent-bootstrap/task-5-report.md`

What changed per file

- `initialize.ts` binds completed checkpoint IDs to fixed artifact names, rejects linked artifacts during restart validation, resolves the installed package root from the module rather than the project/process cwd, and reserves workload identity before checkpoint resume.
- `cli.ts` accepts only an internal host-provisioned governance reference override and forwards it to named initialization; no governance CLI flag was added.
- `bootstrap-initialize.test.ts` covers canonical checkpoint artifact binding and installed package provenance, and expects the admitted governance tenant.
- `bootstrap-install.test.ts` proves pre-existing legacy wrappers remain byte-for-byte unchanged while newly added wrappers are version pinned.

Deviations

- File-symlink creation is unavailable in this Windows test environment (`EPERM`); the linked-artifact witness executes where supported while canonical-name substitution is always tested.

Test results (verbatim tail)

```
✔ completed checkpoints bind their canonical artifact names and reject linked artifacts
ℹ tests 1
ℹ pass 1
ℹ fail 0

✔ installed build provenance comes from the Reelier package rather than the project cwd
ℹ tests 1
ℹ pass 1
ℹ fail 0

✔ named initialization rejects dot names, separators, and case-colliding workload identities before writes
ℹ tests 1
ℹ pass 1
ℹ fail 0

✔ named bootstrap plans an exact-version proxy without changing legacy wrapping
✔ named install applies only with explicit consent, backs up before replacement, and rolls back a partial failure
ℹ tests 26
ℹ pass 26
ℹ fail 0
```

Open risks

- The bootstrap-initialize portion of the aggregate runner emitted 21 passing tests before the 30-second command return window; the remaining four focused files independently completed 26/26 passing. TypeScript, all three frozen-contract checks, build, and diff/status checks passed.
