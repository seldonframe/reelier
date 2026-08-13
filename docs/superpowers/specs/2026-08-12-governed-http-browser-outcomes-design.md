# Governed HTTP and Browser Outcomes Design

**Status:** Founder-approved amended design; implementation remains sequenced and evidence-gated
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

Build one **Governed Action Runtime** with three strategic adapters behind the existing Path C authority and dispatch boundary:

1. MCP adapter: existing tool-call transport.
2. Native HTTPS adapter: the first expansion milestone and preferred path for services with an adequate API.
3. Bounded browser adapter: a strategic governed-exit class for consequential work that lives in authenticated interfaces, sequenced after native HTTPS, with every provider implementation admitted only through evidence gates.

Bounded browser governance is a strategic governed-exit class because personal agents derive substantial value from browsers, applications, saved sessions, carts, and other interfaces that do not expose an adequate API. That commitment does not pre-approve any provider recipe: each browser implementation is admitted only after its owner, painful job, provider terms, lack of an adequate API, authoritative read-back, and enforceable request boundary are evidenced. Each admitted browser Outcome remains a fixed, reviewed semantic transition through one named consequential exit. Native HTTPS comes first because it gives cleaner dispatch identity and authoritative read-back while strengthening the route binding, ambiguity, budget, and receipt primitives that every browser implementation must reuse.

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

## Product experience: one ceremony, useful autonomy

Reelier must not recreate the configuration burden that personal agents are removing. A user does not copy GitHub, Slack, merchant, browser, or other provider credentials into Reelier environment variables merely to govern an Outcome. For browser v1, the user authenticates an isolated Authority Cell profile through an explicit handoff and the profile retains the usable session. Any session reference or attenuated capability remains secret credential material even when short-lived and cryptographically bound. It receives secret-grade handling and never enters Outcome wire fields, logs, receipts, portable evidence, agent memory, or model-visible state. Reelier persists only non-secret issuer, audience, account, route, expiry, revocation, and digest commitments.

The intended setup is one concise natural-language authority ceremony whose deterministic compiler produces a closed, inspectable Job Card. Ambiguous or incomplete prose refuses rather than guessing. Authenticated account and resource identities are derived from the session probe and authoritative state, then shown for explicit confirmation; prose never makes them authoritative. For the first browser tracer bullet, the user-facing grant should be equivalent to:

> Allow Grocery Bot to maintain the quantity of this one approved grocery line in this merchant cart, up to this limit, once per week for 30 days. Never allow checkout, payment, orders, coupons, substitutions, or account changes. Require exact pre-read and authoritative cart read-back.

The approval surface shows the exact derived account, merchant, operation, product vocabulary, limits, trigger, expiry, child principal, cleanup behavior, and expected evidence before signature. Natural language is input to the ceremony, not the enforcement boundary: only the signed closed Job Card and derived grant authorize execution.

Once approved, repeat executions inside the same immutable scope run without per-run approval. Humans are interrupted only for a new or widened authority request, an authentication or presence challenge, ambiguity that cannot be reconciled, policy or route drift, revocation, exhausted budget, or failed evidence. Convenience never permits silent grant widening.

### Personal-agent concepts mapped to authority semantics

Personal-agent platforms remain responsible for the computer, interaction model, memory, orchestration, and integrations. Reelier assigns narrower meanings to those useful capabilities:

| Personal-agent capability | Reelier meaning |
|---|---|
| Saved browser session or connector | Access and credential material only. The platform must retain it or delegate a short-lived capability cryptographically bound to audience, account, route, reservation, and one-use channel; it grants no task or cross-agent authority. |
| Recorded routine or skill | Immutable repeatable task identity and version. Repeatability is never authorization or correctness. |
| Slack, GitHub, schedule, or agent trigger | A signed trigger fact and semantic request identity. A trigger cannot inherit its creator's authority. |
| User, agent, or project memory | Context only. Memory cannot supply or widen accounts, recipients, amounts, permissions, destructive targets, or evidence conclusions. |
| Orchestrator and collaborating agents | Accountable root sponsor plus distinct child principals, scoped sessions, conserved budgets, expiry, and cascading revocation. |
| Natural-language rule and reviewer agent | Guidance and defense in depth. Neither is deterministic enforcement nor a trust root, and neither may expand a grant. |
| Screen recording, screenshot, or DOM view | Supplemental UI observation. It does not prove durable provider post-state or graph completeness. |
| Login, SSO, 2FA, CAPTCHA, consent, or payment handoff | An authority-sensitive human ceremony. Completing access cannot silently create evergreen or shared authority. |

This division preserves the platform's magic: bots can use familiar sessions, routines, memory, triggers, and collaborators while Reelier independently answers who authorized the named transition, what was allowed to leave, what budget it consumed, and what authoritative post-state was observed.

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

### Integration shapes

The browser design recognizes two deployment shapes, but browser v1 implements only the Cell-owned shape so the first tracer bullet has one enforcement boundary:

1. **Standalone Authority Cell browser—selected for v1.** A dedicated Cell-owned isolated profile is authenticated through an explicit human handoff. The Cell-owned broker performs pre-send enforcement and is the execution-evidence issuer. It is never the user's everyday profile and is not shared merely because multiple bots inhabit the same VM.
2. **Platform-hosted governed exit—design-only after v1.** A personal-agent platform could retain the authenticated session and browser, pause the exact consequential request before send, and atomically consume a Cell-issued one-use grant. Because that platform is an interested execution party, its signature proves only who asserted the release facts. Platform evidence remains an attributed assertion and cannot alone produce `guiParticipation: verified`, `exact`, independently reconciled Outcome evidence, or an exclusive-enforcement claim. Promotion requires a separately trusted authoritative reconciliation source and independent corroboration of the governed exit or an equivalent Reelier-controlled enforcement boundary.

Each receipt names `executionEvidenceIssuer`, `reconciliationEvidenceIssuer`, and their relationship as `same-enforcement-party | independent`. Same-enforcement-party observation is retained with provenance but remains `unchecked` as corroboration and cannot justify `exact`. The selected Cell-owned shape still requires authoritative provider read-back through a separately controlled read adapter or provider-native version, event, or state identity. The standalone shape does not imply coverage of other browsers on the Cell. A later platform-hosted implementation requires its own reviewed spec and cannot inherit v1 certification.

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

### Proposed tracer bullet: set one cart line, never purchase

Subject to the selection gates below, the proposed first browser Outcome sets the quantity of one declared grocery cart line in one committed merchant account and store. It tests a high-value personal-agent job without granting purchase authority.

The signed Job Card fixes the exact merchant, account, store, cart, SKU, permitted target quantity, cadence, expiry, effect budget, trigger identity, child principal/session, exact pre-read projection, expected cart-line projection, and separately authorized cleanup operation. One `browser-submit` Outcome releases exactly one consequential request and consumes one unit of conserved effect budget. It performs an exact authoritative pre-read before reservation, then reads back the declared cart-line projection after release through the separately trusted source named in the route. A batch must not hide multiple provider writes behind one dispatch identity.

The route must technically refuse, even if the model, memory, routine, reviewer, page, or user prompt requests otherwise:

- checkout, order submission, or purchase confirmation;
- payment entry, payment-selection changes, tips, or financial authorization;
- coupons or promotion application;
- substitutions, alternate products, or another SKU;
- delivery or billing address changes, subscriptions, memberships, or any account-setting changes;
- navigation or writes outside the fixed cart route.

Cleanup is never an implicit compensating click: it is a separate signed `restore committed pre-state` effect with its own reservation, budget, dispatch, ambiguity, read-back, and receipt. Its target bytes come from the signed pre-state commitment, not a runtime model choice. Cart price, product suitability, delivery availability, hidden provider side effects, and the wisdom of a product choice remain outside Reelier's claim. `exact` means only that the complete declared cart-line projection matched the authorized expectation at authoritative read-back. It does not prove no analytics, inventory hold, recommendation, notification, or other hidden state changed. The final purchase remains a separate human action outside browser v1. Any future purchase Outcome requires a separately designed and approved authority ceremony; payment or settlement alone would still not prove Reelier authorization.

The cart tracer is selected only if all gates pass: a named owner provides a measured repeated-supervision trace; no adequate reviewed API performs the job; provider terms and operator permission allow the automation; a complete authoritative cart-line pre/post read-back exists; and the fixed request table can be enforced without copying provider credentials. Otherwise select a different genuinely UI-bound transition or stop the browser milestone.

### Browser route model

The browser adapter is a fixed semantic governed exit, not a general browser remote control. Browser v1 maps one reviewed `browser-submit` Outcome from closed agent choices to a preinstalled route definition enforced by the Cell-owned broker. A later platform-hosted mode remains a separate design target, not a v1 execution path.

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

Cookies and authenticated browser state are credentials. Browser v1 uses a dedicated isolated Cell-owned profile, never the user's everyday browser profile. The session/profile remains secret and opaque to the agent; portable evidence commits only its non-secret issuer/account/audience/expiry identity and digest without serializing cookies or usable capability material.

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
- Browser v1 actions are covered only inside the Cell-owned bounded browser route whose issuer and independently controlled read-back source are explicit. A future platform-hosted route remains outside verified coverage until separately certified.
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

## Engineering evaluation and private evidence boundary

This public specification defines protocol and engineering evaluation measures, not the company headline metric or a public GTM plan. Browser-route selection, named third-party research, pilot thresholds, supervision traces, and market falsifiers stay in the private evidence register. A selected route carries only the approved evidence-register decision digest and maturity; private source material does not enter the public contract or authorize execution.

The browser evaluation asks whether one authority ceremony produces more reconciled governed Outcomes without weakening the boundary. Supporting engineering and usability measures are:

- time to first governed Outcome;
- setup steps and elapsed setup time to first governed Outcome;
- percentage of repeated executions completed without per-run intervention;
- cross-model, cross-harness, and cross-runtime success for the same signed Outcome Contract;
- percentage of certified integrations requiring zero manually copied provider credential values;
- `exact | partial | pending | absent` post-state distribution;
- exception, ambiguity, and unreconciled-result rate;
- unauthorized or out-of-scope attempts refused before release;
- authority changes per routine and measured operator-intervention time.

Before a browser implementation plan, the private evidence register must pre-register numerical thresholds and a stop decision for setup, repeated supervision, cross-runtime reproduction, credential-copying burden, and reconciled Outcomes per ceremony. Public engineering success cannot promote an unverified market claim.

## Delivery order

1. Complete certification-local portable evidence so Path C can prove the human task-to-dispatch-to-post-state chain honestly.
2. Certify and package the current Linux Cell/Windows client flow.
3. Harden and certify one native HTTPS Outcome, including route/configuration join and authoritative read-back.
4. Run the browser selection gates and, only if they pass, implement the proposed one-cart-line tracer in the Cell-owned isolated browser without checkout, payment, orders, coupons, substitutions, address changes, or account changes. Keep platform-hosted governed exits design-only until a separate reviewed spec closes independent enforcement and corroboration.
5. Extend the governed Outcome tour to teach and demonstrate the HTTP and browser layers with synthetic or hermetic fixtures.
6. Consider broader computer-use observation only after an enforceable interception boundary and explicit completeness model exist.

## Building Compass check

**Painful supervised job and owner.** The first native tracer bullet targets a repository maintainer who repeatedly supervises an agent changing the exact label set on one GitHub issue and then manually checks whether the intended set actually persisted. The proposed browser tracer must not proceed until a named grocery-cart owner contributes a measured repeated-supervision trace and confirms unwillingness to grant unattended purchase authority. Each tracer must show that one narrow authority ceremony fixes the account, resource, allowed choices, effect count, expiry, cleanup, and accountable principal while actually removing repeated approval/read-back work.

**Evidence and maturity.** The present public evidence is engineering evidence only: the hermetic GitHub-label lifecycle has reproduced the authority, root-to-child delegation, budget, ambiguity, reconciliation, cleanup, receipts, and offline-verification mechanisms in focused tests. The claim that direct HTTP or browser governance removes meaningful supervision remains unverified. This document is a design, not production readiness or demand evidence. Browser selection requires an approved private evidence-register decision digest; that decision cannot authorize a write.

**Smallest transition.** Native HTTPS milestone one is exactly: replace the complete declared label projection on one authority-derived GitHub issue, then authoritatively read the same projection and reconcile it. GitHub account, repository, issue number, permissible label identities, method/route, credential slot, budget, and cleanup target are derived outside model fields. If selected, browser milestone one is exactly one budgeted request setting one authority-derived SKU quantity in one authority-derived merchant/store/cart, with exact pre-read, authoritative post-read, and separately authorized cleanup. Checkout, orders, payment, coupons, substitutions, address changes, and account changes are excluded. In both milestones, the model may propose only non-authorizing choices from the pre-authorized vocabulary.

**What is postponed.** Generic HTTP, arbitrary browser control, desktop interception, purchases and payments, universal plugins, completeness attestation, provider-independent browser recipes, and platform-hosted browser enforcement are deleted from the first increment. Bounded browser governance is a strategic governed-exit class, but every implementation remains sequenced after HTTPS and evidence-gated. The cart route cannot proceed until owner/evidence/API/terms/read-back gates pass, the shared authority/runtime join is reproduced, and the Cell-owned exit denies every unlisted request before send.

**Durable primitives strengthened.** The native tracer bullet must strengthen the runtime-route/connector join, sealed materialized request identity, effect budget, ambiguity handling, authoritative projection reconciliation, portable task/effect evidence, and offline verification. The browser tracer bullet proceeds only if it strengthens the same primitives without creating a parallel authority model.

**Bypasses and portability.** Direct agent HTTP, ordinary browsers, arbitrary GUI activity, plugin traffic, and other egress remain explicit bypasses, so universal completeness stays `unchecked`. The authority envelope and evidence graph must remain model-, harness-, provider-, and substrate-neutral; endpoint and browser implementations remain pinned adapters.

**Safety, liveness, and maker/checker.** Retry, concurrency, redirects, and delegation may not multiply effect or budget. Ambiguity retains consumption and reconciles without resend. The compiler/dispatcher is the maker; authoritative provider read-back and offline verification are distinct checkers. A reviewer model is optional defense in depth only.

**Falsifiers and exit criteria.** Stop or narrow the native milestone if the live route cannot be cryptographically joined to signed connector/account authority, if authoritative comparable read-back is unavailable, or if a hermetic fault corpus can multiply writes/budget. Stop, narrow, or change the browser tracer if the broker cannot deny every unlisted request before send, session/account identity cannot be bound without exposing secret material, cart mutations cannot remain individually budgeted, authoritative cart read-back is unavailable, or the approved private evidence gate expires or fails its pre-registered thresholds. If adequate APIs cover cart preparation, retain browser as a strategic governed-exit class but select a genuinely UI-bound supervised job rather than manufacturing browser need. Do not promote either milestone if receipt claims require upgrading `unchecked`, `pending`, or `absent` evidence.

**Evidence register.** Before implementation, record every load-bearing claim as explained, traced, reproduced, or certified with its executable test/report location. Native HTTPS starts at `traced` because the existing gate, driver, connector, reconciliation, and receipt seams have been code-traced; it becomes `reproduced` only after the exact tracer bullet and fault corpus pass, and `certified` only after the packed Ubuntu/Windows evidence gate. Browser starts at `explained` and cannot advance on screenshots or demos alone.

## Acceptance criteria

Native HTTPS is complete when one reviewed provider operation proves: exact route/account join, one-use dispatch, total-deadline/SSRF/redirect controls, no automatic resend, authoritative post-state evidence, cleanup, portable receipts, offline verification, and raw-route topology status.

Bounded browser v1 is complete only after the selection gates pass and the Cell-owned isolated-browser operation proves: fresh session-version/account binding; fixed route/script/runtime; request-time network enforcement; atomic consumption of one Cell grant; exactly one permitted consequential request; signed release evidence naming the Cell-owned issuer; ambiguity without read-back; authoritative reconciliation from the separately controlled issuer named in the route; a separately signed cleanup restoring committed pre-state; portable evidence; secret-free export; and explicit bypass/non-completeness disclosures. Acceptance tests must prove that broker detach/crash, interception bypass, QUIC/direct-socket escape, redirect replay, request-count exhaustion, or enforcement tamper yields `guiParticipation: failed`, never `verified`; missing enforcement evidence yields `unchecked` or `absent`; and a false `exact` claim without comparable committed pre-state and post-state is rejected offline. Platform-hosted execution is not a v1 acceptance path.

Neither milestone may claim universal browser control, universal agent compatibility, complete interception, semantic correctness, safety, payment authorization, or external delivery.
