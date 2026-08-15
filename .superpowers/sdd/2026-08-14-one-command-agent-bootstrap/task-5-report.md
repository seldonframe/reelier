Files changed

- `src/bootstrap/initialize.ts`
- `src/cli.ts`
- `test/bootstrap-initialize.test.ts`
- `.superpowers/sdd/2026-08-14-one-command-agent-bootstrap/task-5-report.md`

What changed per file

- `initialize.ts` binds completed checkpoint IDs to fixed artifact names, rejects linked artifacts during restart validation, resolves the installed package root from the module rather than the project/process cwd, and reserves workload identity before checkpoint resume.
- `cli.ts` accepts only an internal host-provisioned governance reference override and forwards it to named initialization; no governance CLI flag was added.
- `bootstrap-initialize.test.ts` covers canonical checkpoint artifact binding and installed package provenance, and expects the admitted governance tenant.

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
```

Open risks

- The full focused runner was started but exceeded the 30-second command return window before its final aggregate summary. All emitted named-bootstrap cases passed.
- Install post-apply rollback/read-back canary and legacy-wrapper preservation still require their requested RED/GREEN cycle.
