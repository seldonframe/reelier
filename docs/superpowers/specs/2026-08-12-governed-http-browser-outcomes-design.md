# Governed HTTP and Browser Outcomes Design

**Status:** Founder-approved design direction, pending written-spec review
**Date:** 2026-08-12
**Depends on:** Portable Path C evidence closure, packed cross-platform certification, and the frozen Adapter Contract v1

## Purpose

Reelier should govern consequential machine-caused state transitions that occur through more than MCP. Agents increasingly act through direct HTTP clients and authenticated browsers. Those actions need the same pre-execution grants, budgets, revocation, ambiguity handling, reconciliation, receipts, and offline verification as MCP-shaped writes.

The product must expand without claiming omniscient observation or becoming employee surveillance. Reelier governs writes that cross an explicit Reelier-controlled consequential exit. Arbitrary GUI actions, direct HTTP performed outside that exit, plugin traffic that bypasses it, and human actions in an ordinary browser remain outside coverage. Their existence keeps completeness `unchecked`.

The category boundary remains:

- Access, authentication, session possession, and payment do not grant scoped authority.
- Isolation constrains compute; it does not constrain authenticated effects on external systems.
- A repeatable skill or script grants no authority and can repeat a mistake reliably.
- Dispatch, acknowledgement, observation, reconciliation, and attestation are separate facts.
- Reelier certifies the scope and evidence of a covered transition, never safety, semantic correctness, delivery, or completeness.

## Decision

Build one **Governed Action Runtime** with three adapters behind the existing Path C authority and dispatch boundary:

1. MCP adapter: existing tool-call transport.
2. Native HTTPS adapter: the first expansion milestone and preferred path for services with an API.
3. Bounded browser adapter: a later fallback for consequential operations that genuinely require a browser.

Do not build desktop-wide interception in the first version. Do not accept arbitrary browser commands, URLs, selectors, JavaScript, cookies, headers, or credentials from an agent. Do not treat a browser plugin, screen recording, DOM snapshot, final URL, success banner, or HTTP status as proof of durable post-state.

## Seven independent layers

Every user-facing explanation and evidence artifact must keep these layers separate:

1. **Access:** provider account, authenticated session, credential reference, or payment/settlement rail.
2. **Execution confinement:** Linux Authority Cell, egress gateway, isolated browser profile, and network restrictions.
3. **Repeatability:** an immutable pack, skill, browser recipe, or script version.
4. **Authority:** human-approved task, root-to-child grant, principal/session, resource, operation, limits, expiry, and revocation.
5. **Dispatch:** one sealed effect crosses the consequential exit with idempotency semantics.
6. **Observation:** authoritative provider read-back produces a declared post-state projection or reports it pending/absent.
7. **Attestation:** signed receipts and a closed graph bind the covered facts for offline verification.

Evidence at one layer never upgrades another. Reviewer models may challenge or summarize evidence as defense in depth; they are not trust roots and cannot grant authority or turn missing evidence into a pass.

## Architecture

### Shared authority envelope

All adapters consume an internal, one-use dispatch capability derived from the same Path C ceremony. Before any consequential network action, the Cell verifies and binds:

- accountable root sponsor and acting child principal/session;
- signed Job Card, immutable task shape, declared trigger and intent;
- exact adapter, connector, account identity, resource, operation, and risk class;
- endpoint or browser-route configuration digest;
- effect budget and any provider-specific amount/blast-radius limits;
- grant and session expiry plus current revocation state;
- idempotency and reconciliation recipe;
- expected post-state projection and evidence confidence rules;
- the signed Outcome Contract policy bytes, digest, schema, and parse/load status without any claim that a rule fired; any separate local gate-policy digest remains `unchecked` until a real loader produces evidence;
- frozen Adapter Contract digest.

The agent supplies only explicitly non-authorizing content choices accepted by a reviewed deterministic compiler. A closed schema does not make a consequential value safe to source from the model. Account/tenant/resource identity, recipients, exact amounts and amount units, permission or role, destructive targets, credential slots, operation identity, and other world-changing values are derived from signed authority, authenticated context, and authoritative state—not agent choices. The agent cannot supply or alias authority fields, endpoints, credential values or references, redirect targets, session identities, scripts, selectors, or evidence conclusions. Closed-parser and compiler tests must reject casing, alias, duplicate, nested, accessor, and unknown-field attempts to smuggle those values through content choices.

### Authority-to-runtime configuration join

The current HTTPS runtime constructs host endpoints independently from the connector registration committed by authority. Before native HTTP or browser execution can make the strong account/route claim, dispatch must recompute one canonical runtime-route digest and compare it with the operator configuration digest accepted by the connector and sealed into the reserved handle.

For HTTPS, that digest binds at least:

- provider and connector identity;
- account identity;
- endpoint ID and canonical HTTPS origin;
- exact method and normalized path-prefix constraints;
- credential slot identity, never credential value;
- response-semantics profile;
- reconciliation/read-back recipe;
- egress policy digest.

For browsers, it additionally binds:

- browser image/runtime digest;
- reviewed browser recipe and script digest;
- isolated session-profile commitment;
- initial, consequential, and allowed origins;
- allowed request classes and redirect policy;
- provider-specific post-state probe.

A mismatch refuses before budget consumption or network access.

## Native HTTPS Outcomes

### Execution

Reuse the existing sealed `TransportEffect`, `AuthorityGate`, one-use reservation, `DispatchCoordinator`, pinned JSON HTTPS driver, source-read adapter, egress gateway, reconciliation, and receipt machinery.

Harden the join and transport before calling this a certified native HTTP path:

- close and canonicalize host endpoint configuration at load time;
- use one shared public-address classifier that rejects private, loopback, link-local, multicast, unspecified, and IPv4-mapped bypass forms;
- use a total request deadline rather than socket-idle timeout alone;
- reject automatic redirects and classify redirect results as potentially applied, not automatically failed;
- confine and link-check file credential references before resolution;
- bind the materialized request projection—method, origin, normalized path/query, non-secret header projection, and body digest—not merely the body;
- never persist secret-bearing response headers or bodies outside reviewed projections/digests;
- require endpoint-specific response semantics and authoritative read-back for a demonstrated effect;
- never retry a consequential request automatically after an ambiguous result.

### Outcome classification

Generic HTTP status alone cannot establish application or failure:

- A reviewed provider-specific response contract may classify an acknowledgement.
- Unknown 3xx, 409, 5xx, disconnect, or timeout after send is ambiguous unless authoritative read-back proves applied or not applied.
- A 2xx is acknowledgement, not demonstrated post-state.
- `exact + matched` is available only for the complete declared projection when comparable authoritative pre- and post-state reads exist.
- `partial`, `pending`, and `absent` never pass.

### Evidence claim

The strongest permitted claim is:

> The Authority Cell authorized and dispatched this sealed non-secret request projection to this committed provider route. The provider response is committed separately. The declared post-state projection matched only when authoritative reconciliation verified it.

This does not prove semantic correctness, provider-wide state, delivery, universal routing, or that no bypass write occurred.

## Bounded Browser Outcomes

### Browser route model

The browser adapter is a Cell-owned fixed semantic runner, not a general browser remote control. One reviewed `browser-submit` Outcome maps closed agent choices to a preinstalled route definition.

An agent cannot supply:

- arbitrary URLs or origins;
- selectors or DOM paths;
- JavaScript or browser commands;
- cookies, tokens, passwords, or credential references;
- arbitrary headers, form keys, uploads, downloads, or redirect targets;
- popup, service-worker, WebSocket, extension, or native-application behavior.

The route definition pins:

- script/recipe and browser-image digests;
- account/profile identity commitment;
- starting and consequential origins;
- navigation and form recipe;
- exact choice schema and materialization rules;
- allowed read-only asset origins;
- a closed, deny-by-default request table containing the one permitted consequential request template and every permitted supporting request template;
- redirect and popup policy;
- authoritative provider/API read-back recipe.

### Session and human handoff

Cookies and authenticated browser state are credentials. The first version uses a dedicated isolated Cell-owned profile, never the user’s everyday browser profile. The profile is opaque to the agent and committed by identity/digest without serializing cookies.

A login, SSO, 2FA, consent, CAPTCHA, payment, or human-presence intervention is an authority-sensitive handoff. It must not silently create evergreen, cross-task, or cross-agent authority. Browser route grants are narrowly scoped and expiring; the Cell re-verifies the committed account through a reviewed read before each consequential action. Challenges requiring human presence are reported `manual` or `absent`; Reelier does not bypass them.

### Network enforcement and request classification

The enforcement trust boundary is a version-pinned Cell-owned browser broker that launches a clean browser process and owns its pre-network interception session. The browser cannot be attached to an existing user process. All browser traffic is forced through the Cell's restricted egress path, service workers and extensions are disabled, and the broker must remain connected for the route to proceed.

Browser pre-network interception is mandatory. Every attempted request is paused before send and classified against the signed route's exact request table using:

- normalized scheme, origin, method, path, and query policy;
- browser resource type and initiating frame identity;
- redirect predecessor and hop index;
- non-secret header-name/projection policy;
- canonical body projection and digest;
- a closed list of explicitly ephemeral fields, such as a CSRF token, whose values remain confidential but whose presence and materialization rules are committed.

HTTP verbs are not used as an effect classifier: a `GET` is permitted only when its exact supporting-request template was reviewed. The table is deny-by-default. The one consequential template has a single-use counter initialized to one; every matching attempt, including a redirect replay, spends that counter before release. Supporting asset/read templates have explicit bounded counts. Any unclassified request, excess count, unexpected initiator, or unmatched body is blocked.

Immediately before the consequential request leaves the browser, the broker compares the materialized request with the authorized projection. Only the route's explicitly declared ephemeral fields may differ.

The browser boundary must block:

- a second consequential request or any request after the single-use counter is spent;
- unlisted origins, schemes, redirect hops, initiating frames, popups, and downloads;
- WebSockets and service workers unless a future reviewed route explicitly requires them;
- extension/native messaging and local filesystem access;
- unexpected query/form fields, same-origin background fetches or beacons, mutated request bodies, or supporting requests beyond their bounded table entries;
- execution after account, grant, session, route, or policy drift.

If enforcement cannot establish the outgoing request projection, dispatch refuses before the request. Once the single-use counter is spent and the request is released, failures are ambiguous until reconciled. The evidence claim is one released consequential request within this brokered browser run—not provider-side exactly-once execution and not coverage of another browser or network path.

### Browser evidence

The portable evidence binds:

- route, script, and browser image digests;
- isolated profile/account commitment, never cookies;
- initial and final origins;
- materialized consequential request projection digest;
- redirect and response projection digests;
- optional redacted DOM/screenshot projection digests;
- provider acknowledgement classification;
- the expected projection commitment plus comparable authoritative pre-state and observed post-state projection digests;
- independent authoritative post-state reconciliation and its separately justified `exact | partial | pending | absent` confidence;
- budget consumption, ambiguity, cleanup, and receipt lineage.

DOM text, screenshots, a success banner, or final URL are observations of UI state only. Without authoritative provider read-back, post-state confidence remains `partial`, `pending`, or `absent`.
`exact` is available only when the reviewed route defines the complete declared projection, the Cell obtains comparable authoritative pre-state and post-state reads for that projection, and the observed post-state matches the pre-authorized expectation. It does not describe the whole page, account, provider, or causal delta outside that projection.

## Coverage and non-claims

The runtime reports coverage rather than inferring completeness:

- MCP calls are covered only when routed through a supported Reelier boundary.
- Native HTTPS is covered only when dispatched through the committed Cell route.
- Browser actions are covered only inside the Cell-owned bounded browser route.
- Direct agent HTTP, arbitrary GUI/computer use, ordinary user-browser actions, remote plugin traffic, and bypass egress remain outside coverage.

The system must expose at least:

- `guiParticipation`: `verified | failed | unchecked | absent` for the declared bounded route only;
- `rawWriteReachability`: the existing four-state topology claim;
- `universalWriteCompleteness`: always `unchecked` until a separate completeness-attestation design exists;
- `externalDelivery`: `absent` unless independently attested;
- post-state confidence: `exact | partial | pending | absent`, separate from four-state claim status.

No marketing or CLI copy may say Reelier governs an agent, browser, employee, desktop, or account “as a whole.” It governs named consequential exits and produces evidence about named transitions.

## Failure and recovery semantics

- Refusal before possible send returns budget only when non-application is proven.
- Any cut after a request might leave retains consumption and becomes pending reconciliation.
- A browser/HTTP request is never resent automatically after ambiguity.
- Recovery reads signed append-only journal state, revalidates current authority, and performs only authoritative read-back.
- Cleanup is a separate authorized effect with its own budget, dispatch, post-state evidence, and receipt.
- Duplicate requests create durable zero-effect decisions and do not imply global exactly-once execution.
- Conflicting bytes are recorded and refused without additional effect.

## Privacy

Evidence is transition-specific and data-minimized. Reelier does not continuously capture the screen, browser history, keystrokes, meetings, or unrelated network traffic. Screenshots, DOM, requests, and responses are persisted only as reviewed projections or content digests. Secret canaries, cookie values, authorization headers, CSRF values, passwords, and bearer references must never enter portable evidence.

## Delivery order

1. Complete certification-local portable evidence so Path C can prove the human task-to-dispatch-to-post-state chain honestly.
2. Certify and package the current Linux Cell/Windows client flow.
3. Harden and certify one native HTTPS Outcome, including route/configuration join and authoritative read-back.
4. Implement one bounded Cell-owned browser Outcome for a site that lacks an adequate API.
5. Extend the governed Outcome tour to teach and demonstrate the HTTP and browser layers with synthetic or hermetic fixtures.
6. Consider broader computer-use observation only after an enforceable interception boundary and explicit completeness model exist.

## Building Compass check

**Painful supervised job and owner.** The first tracer bullet targets a repository maintainer who repeatedly supervises an agent changing the exact label set on one GitHub issue and then manually checks whether the intended set actually persisted. It removes repeated per-attempt approval and read-back work while preserving the one authority ceremony that fixes repository, issue, allowed label set, effect count, expiry, cleanup, and accountable principal.

**Evidence and maturity.** The present evidence is engineering evidence only: the hermetic GitHub-label lifecycle has reproduced the authority, root-to-child delegation, budget, ambiguity, reconciliation, cleanup, receipts, and offline-verification mechanisms in focused tests. The claim that direct HTTP or browser governance removes paid user supervision is a thesis signal and remains unmeasured. This document is a design, not production readiness or demand evidence. Market promotion requires a paid trace or two independent user sources under the Compass evidence rule.

**Smallest transition.** Native HTTPS milestone one is exactly: replace the complete declared label projection on one authority-derived GitHub issue, then authoritatively read the same projection and reconcile it. GitHub account, repository, issue number, permissible label identities, method/route, credential slot, budget, and cleanup target are derived outside model fields. The model may propose only non-authorizing content from the pre-authorized label vocabulary.

**What is postponed.** Generic HTTP, arbitrary browser control, desktop interception, payments, universal plugins, completeness attestation, and provider-independent browser recipes are deleted from the first increment. The bounded browser milestone is contingent, not promised: select one supervised transition only after evidence shows no adequate reviewed API can perform it and the browser broker can enforce its complete request table.

**Durable primitives strengthened.** The native tracer bullet must strengthen the runtime-route/connector join, sealed materialized request identity, effect budget, ambiguity handling, authoritative projection reconciliation, portable task/effect evidence, and offline verification. The browser tracer bullet proceeds only if it strengthens the same primitives without creating a parallel authority model.

**Bypasses and portability.** Direct agent HTTP, ordinary browsers, arbitrary GUI activity, plugin traffic, and other egress remain explicit bypasses, so universal completeness stays `unchecked`. The authority envelope and evidence graph must remain model-, harness-, provider-, and substrate-neutral; endpoint and browser implementations remain pinned adapters.

**Safety, liveness, and maker/checker.** Retry, concurrency, redirects, and delegation may not multiply effect or budget. Ambiguity retains consumption and reconciles without resend. The compiler/dispatcher is the maker; authoritative provider read-back and offline verification are distinct checkers. A reviewer model is optional defense in depth only.

**Falsifiers and exit criteria.** Stop or narrow the native milestone if the live route cannot be cryptographically joined to signed connector/account authority, if authoritative comparable read-back is unavailable, or if a hermetic fault corpus can multiply writes/budget. Do not build the browser milestone if adequate APIs cover the selected jobs, the broker cannot deny every unlisted request before send, session/account identity cannot be bound without exposing secrets, or measured trials do not reduce repeated human supervision. Do not promote either milestone if reconciled Outcomes per authority ceremony do not improve, or if receipt claims require upgrading `unchecked`, `pending`, or `absent` evidence.

**Evidence register.** Before implementation, record every load-bearing claim as explained, traced, reproduced, or certified with its executable test/report location. Native HTTPS starts at `traced` because the existing gate, driver, connector, reconciliation, and receipt seams have been code-traced; it becomes `reproduced` only after the exact tracer bullet and fault corpus pass, and `certified` only after the packed Ubuntu/Windows evidence gate. Browser starts at `explained` and cannot advance on screenshots or demos alone.

## Acceptance criteria

Native HTTPS is complete when one reviewed provider operation proves: exact route/account join, one-use dispatch, total-deadline/SSRF/redirect controls, no automatic resend, authoritative post-state evidence, cleanup, portable receipts, offline verification, and raw-route topology status.

Bounded browser v1 is complete when one reviewed operation proves: isolated profile/account binding, fixed route/script/runtime, request-time network enforcement, exactly one permitted consequential request, ambiguity without read-back, authoritative reconciliation when available, separate cleanup authority, portable evidence, secret-free export, and explicit bypass/non-completeness disclosures. Acceptance tests must prove that broker/interception tamper or enforcement failure yields `guiParticipation: failed`, never `verified`; missing enforcement evidence yields `unchecked` or `absent`; and a false `exact` claim without comparable committed pre-state and post-state is rejected offline.

Neither milestone may claim universal browser control, universal agent compatibility, complete interception, semantic correctness, safety, payment authorization, or external delivery.
