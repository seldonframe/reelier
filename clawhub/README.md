# Reelier on ClawHub

This directory is the [ClawHub](https://docs.openclaw.ai/clawhub)
(OpenClaw's skill registry) distribution artifact for Reelier. The
publishable bundle is `clawhub/reelier/` — a single `SKILL.md` with
Claude-compatible YAML frontmatter plus ClawHub's `metadata.openclaw`
runtime block (verified against
[docs.openclaw.ai/clawhub/skill-format](https://docs.openclaw.ai/clawhub/skill-format)).

It targets OpenClaw operators running recurring cron/heartbeat jobs:
record the job once, replay it on every heartbeat with
`npx -y reelier run` at 0 tokens, gate drift with `reelier diff`.

## Publish

One-time auth, then publish the bundle directory:

```sh
clawhub login

clawhub skill publish clawhub/reelier \
  --slug reelier \
  --name "Reelier" \
  --version 1.0.0 \
  --changelog "Initial release: record once, replay recurring OpenClaw jobs at 0 tokens." \
  --tags latest
```

Notes on the flags (per the [CLI reference](https://docs.openclaw.ai/clawhub/cli)):

- `--version` may be omitted — new skills default to `1.0.0` and changed
  skills default to the next patch version. Pin it explicitly anyway and
  keep it in sync with the `version:` field in `SKILL.md`.
- `--tags` defaults to `latest`; `--dry-run` resolves the publish without
  uploading if you want to sanity-check first.
- Headless environments: `clawhub login --device` (or
  `clawhub login --token clh_...`).

### The scan gate (VirusTotal)

ClawHub runs automated security checks on every published skill. The scan
report bundles `manifest.json`, `clawscan.json`, `skillspector.json`,
`static-analysis.json`, and **`virustotal.json`** — and a release that is
scan-held or blocked may be hidden from the public catalog until it
clears. After publishing, verify the release scanned clean:

```sh
clawhub scan --slug reelier                       # latest version
clawhub scan --slug reelier --output report.zip   # full report archive
```

The scanner also validates declared metadata against actual usage, so keep
the `metadata.openclaw` block honest — this bundle declares no required
env vars (Reelier needs no API key) and only `reelier`/`npx` as binaries.

### License note

Publishing to ClawHub releases the published bundle under **MIT-0**
(ClawHub does not honor per-skill license overrides). That covers only the
`clawhub/reelier/SKILL.md` documentation bundle — the Reelier source code
in this repository is MIT-licensed.
