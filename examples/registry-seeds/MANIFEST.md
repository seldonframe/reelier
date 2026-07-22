# Registry seed manifest — task 12 (SEEDS)

Executed 2026-07-22 against the live pipeline (`reelier push --public --share`,
`REELIER_CLOUD_URL=https://www.reelier.com`), under the `reelier` house
namespace. Every row below replayed green (`reelier run`) immediately before
its push; the receipt permalink is the real, cross-tenant-visible proof of
that run — not a claimed result.

## Portfolio 4 (through the real pipeline, dogfooding the auto-list gate)

| Name | Page URL | Status | Receipt permalink |
| --- | --- | --- | --- |
| github-repo-health | https://www.reelier.com/skills/reelier/github-repo-health | listed | https://www.reelier.com/r/29jW7dOH-KirwINJqGsXkiZp |
| hn-mention-radar | https://www.reelier.com/skills/reelier/hn-mention-radar | listed | https://www.reelier.com/r/-sQLv5cZUwqFNv1fynCjcXq1 |
| npm-download-radar | https://www.reelier.com/skills/reelier/npm-download-radar | listed | https://www.reelier.com/r/nN8aUXKQi97t6hVO8K8Q25YI |
| vendor-status-sweep | https://www.reelier.com/skills/reelier/vendor-status-sweep | listed | https://www.reelier.com/r/Cm8w2wa10NC0XXrgQ9GxxFEv |

`registry-latest` was already listed under `reelier/` before this task ran
and is not re-pushed here.

## New seeds (19 of a planned ~20 — 1 dropped, see below)

| Name | Page URL | Status | Receipt permalink |
| --- | --- | --- | --- |
| cloudflare-status-sweep | https://www.reelier.com/skills/reelier/cloudflare-status-sweep | listed | https://www.reelier.com/r/4pplMZNy2SlfCnPEyuL3wdSn |
| endoflife-node-support-check | https://www.reelier.com/skills/reelier/endoflife-node-support-check | listed | https://www.reelier.com/r/Csu0rduHd4WRokmrctA_AjBK |
| endoflife-python-support-check | https://www.reelier.com/skills/reelier/endoflife-python-support-check | listed | https://www.reelier.com/r/JWeQ-rt2oy1kwq1WkyEZdxLP |
| endoflife-ubuntu-lts-check | https://www.reelier.com/skills/reelier/endoflife-ubuntu-lts-check | listed | https://www.reelier.com/r/SuTUW0GEYbPyWOBBvm0hkfFx |
| github-release-radar-nodejs | https://www.reelier.com/skills/reelier/github-release-radar-nodejs | listed | https://www.reelier.com/r/fZnAu7AeiBMxt25rfDxpyAsG |
| github-repo-metadata-nextjs | https://www.reelier.com/skills/reelier/github-repo-metadata-nextjs | listed | https://www.reelier.com/r/D0F5kO4uVGsDGkAE05u0dnx4 |
| github-search-repos-shape | https://www.reelier.com/skills/reelier/github-search-repos-shape | listed | https://www.reelier.com/r/bSkkOnEmZkotNPBUts6r3YAk |
| google-dns-over-https-lookup | https://www.reelier.com/skills/reelier/google-dns-over-https-lookup | listed | https://www.reelier.com/r/82lo9snYogFie8Y0biNLoLDc |
| httpbin-echo-check | https://www.reelier.com/skills/reelier/httpbin-echo-check | listed | https://www.reelier.com/r/e7zbgQXLuY4zCzhecktxtOHA |
| ipify-public-ip-echo | https://www.reelier.com/skills/reelier/ipify-public-ip-echo | listed | https://www.reelier.com/r/dSGVI5IWXjpzPgVAAzxt6uFn |
| jsdelivr-npm-package-stats | https://www.reelier.com/skills/reelier/jsdelivr-npm-package-stats | listed | https://www.reelier.com/r/Kk_5qKgIenEnZdzBVGqBgfSR |
| npm-deprecation-check | https://www.reelier.com/skills/reelier/npm-deprecation-check | listed | https://www.reelier.com/r/-b4w48BT0o17Q87UVsoYaHam |
| npm-latest-version-typescript | https://www.reelier.com/skills/reelier/npm-latest-version-typescript | listed | https://www.reelier.com/r/9U6effZ6rVhZgAR5GTJqlt8h |
| open-meteo-current-weather | https://www.reelier.com/skills/reelier/open-meteo-current-weather | listed | https://www.reelier.com/r/xDMS8CIQvH0OCcnanhItm0l8 |
| openlibrary-search-shape | https://www.reelier.com/skills/reelier/openlibrary-search-shape | listed | https://www.reelier.com/r/Q5y0Z-QTk7QhDHhzFWdYLtHE |
| pypi-latest-version | https://www.reelier.com/skills/reelier/pypi-latest-version | listed | https://www.reelier.com/r/gK78LjzphSSiNM0xFSKlnqTg |
| rubygems-latest-version | https://www.reelier.com/skills/reelier/rubygems-latest-version | listed | https://www.reelier.com/r/rBUNNWzBi1e6V40VQTuz9rCM |
| unpkg-package-metadata | https://www.reelier.com/skills/reelier/unpkg-package-metadata | listed | https://www.reelier.com/r/YIyZXcHUuWcbkZFr3CS4PIYE |
| worldbank-country-metadata | https://www.reelier.com/skills/reelier/worldbank-country-metadata | listed | https://www.reelier.com/r/YpzrWF-S5a8-OyAnwHazKatg |

Every listing above came back `status: listed` immediately (auto-listed,
triage-clean read-only path) — none entered the manual `pending` queue, so
there is nothing pending or dropped-for-moderation to record.

## Dropped

| Name | Reason |
| --- | --- |
| mcp-registry-servers-shape | `registry.modelcontextprotocol.io/v0/servers` timed out twice in a row on real `reelier run` (15s abort both times; a bare `curl --max-time 20` also failed to connect). Never published — a skill must replay green before it ships. Not retried further; the endpoint may be worth revisiting later. |

## Totals

- 4 portfolio skills pushed through the real pipeline (dogfooding the gate).
- 19 of a planned ~20 new seeds pushed, all auto-listed, all green.
- 24 total listings under `reelier/` on the live hub (23 pushed this task +
  the pre-existing `registry-latest`), confirmed via
  `curl https://www.reelier.com/skills` and per-page `curl -o /dev/null -w
  "%{http_code}"` checks — every one of the 23 pages this task touched
  returned 200.
