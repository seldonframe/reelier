# Provider cleanup runbook

Cleanup is part of certification, not an afterthought. Each scenario must declare a cleanup reference before it can run.

- GitHub: delete the disposable issue labels and restore the original label set.
- Vercel: restore the previous production deployment and domain state.
- Neon: drop only the disposable rehearsal branch; production migrations are restored through a separately approved migration.
- Cloudflare: remove disposable DNS records and revoke any newly created test token through a separate exact approval.
- HubSpot: restore modified test ticket/contact fields.
- Slack: restore the private test channel topic and remove test messages.

If a connection cut leaves the provider state ambiguous, inspect and reconcile first. Never resend automatically. Record the cleanup result and any stranded resource as an exception.
