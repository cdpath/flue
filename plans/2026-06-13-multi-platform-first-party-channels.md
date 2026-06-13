# Multi-Platform First-Party Channels

## Status and relationship to prior work

This plan starts from the implemented channel model recorded in
`plans/2026-06-13-project-owned-channel-sdks-and-tools.md`.

The current branch already provides:

- discovered `channels/<name>.ts` modules;
- fixed provider-owned route suffixes beneath `/channels/<name>`;
- verified ingress packages for GitHub, Slack, and Discord;
- constructor-owned handlers receiving an extensible object containing the
  authentic Hono context;
- provider-specific acknowledgement and response handling;
- project-owned outbound SDK clients and application-owned tools;
- named `flue add` recipes, examples, documentation, Node tests, and workerd
  tests for the existing three providers.

This plan expands that model across the external platform adapters represented
in the Chat SDK repository at the reference commit below. It does not port Chat
SDK implementations or attempt to make Flue channel packages into full
bidirectional platform abstractions.

Publication remains outside this plan and requires a separate explicit release
request.

## Objective

Implement and validate first-party Flue channel support for these ten external
platforms:

| Platform | Flue package | Work in this plan |
| --- | --- | --- |
| GitHub | `@flue/github` | Audit and intentionally expand verified HTTP ingress where needed |
| Slack | `@flue/slack` | Audit existing surfaces and research additional signed HTTP ingress such as slash commands |
| Discord | `@flue/discord` | Audit HTTP interaction parity and document long-lived Gateway boundaries |
| Microsoft Teams | `@flue/teams` | Add a first-party channel package |
| Google Chat | `@flue/google-chat` | Add a first-party channel package |
| Linear | `@flue/linear` | Add a first-party channel package |
| Telegram | `@flue/telegram` | Add a first-party channel package |
| WhatsApp Business Cloud | `@flue/whatsapp` | Add a first-party channel package |
| Twilio Messaging | `@flue/twilio` | Add a first-party messaging channel package |
| Facebook Messenger | `@flue/messenger` | Add a first-party channel package |

For every platform, the completed product should include:

- a first-party ingress package where the provider has a stable verified HTTP
  protocol suitable for Flue channels;
- typed verified events or interactions and explicit unknown variants where
  the protocol permits useful forwarding;
- canonical conversation or destination identity helpers where a durable
  destination can be represented safely;
- a named `flue add <provider>` recipe;
- one buildable example showing a project-owned provider client and at least
  one narrow application-owned tool when an outbound operation is useful;
- a provider setup guide and package API reference;
- synthetic offline protocol tests, Node tests, and workerd tests;
- a canonical Cloudflare-compatible ingress and outbound project path for every
  provider;
- packed-package and clean-consumer validation;
- a recorded primary-source research brief, implementation log, deviations,
  and final capability audit.

The result is channel equivalence at the Flue ownership boundary: verified
provider ingress, identity, responses, and project integration guidance.
Outbound API breadth remains owned by provider SDKs and application code.

## Reference repository and clean-room boundary

The educational reference is:

```txt
/Users/fschott/Code/chat
commit 9c936f87960a968c9fa6070cd3188f68c989a7ac
dated 2026-06-09
```

The reference may be used to:

- enumerate external providers;
- learn that a broad capability or protocol surface exists;
- identify operational questions and hazards requiring independent research;
- create a high-level capability checklist for the final audit;
- compare completed behavior at the end to discover omissions.

The reference must not be used to:

- copy, translate, or mechanically derive source code;
- copy package architecture, route layouts, public types, normalized event
  models, schemas, algorithms, constants, or error behavior;
- copy README examples as implementation source;
- copy fixtures, payloads, snapshots, sample messages, test data, expected
  values, or test assertions;
- port tests one-for-one or use reference tests to drive implementation;
- preserve a reference behavior merely because it exists there.

The mandatory clean-room process for each provider is:

1. Record only a short capability and risk brief from the reference.
2. Stop consulting that provider's implementation and tests during design and
   coding.
3. Research the current official provider documentation, protocol
   specification, official SDK documentation, and official SDK source where
   necessary.
4. Design an original Flue API that follows Flue's existing channel contract.
5. Hand-author synthetic fixtures from official schemas or prose, using
   clearly distinct fake ids, text, timestamps, ordering, and optional fields.
6. Complete implementation and tests without reopening reference source or
   fixtures.
7. Use the reference only for a final independent capability-gap audit.
8. Resolve discovered gaps from primary sources, never by copying the
   reference.

Every provider implementation log must name the official sources used and
affirm that no reference implementation or fixture was copied.

## Scope boundary

### Included

- Official external platform adapters listed in the objective.
- Multiple HTTP methods and multiple provider-owned route suffixes when the
  official protocol requires them.
- Verification handshakes, signed requests, bearer-token/JWT validation,
  timestamp checks, replay-relevant metadata, exact-body handling, provider
  identity constraints, and response semantics.
- Provider-specific batching and retry metadata.
- Optional inbound surfaces whose callbacks publish routes only when enabled.
- Official provider SDKs or established maintained clients in project recipes,
  selected only when they execute on both Node and Cloudflare.
- Narrow direct `fetch` clients in project code when no suitable SDK exists.

### Excluded

- Chat SDK state adapters, shared packages, community adapters, and vendor
  adapters outside the official platform list.
- Chat SDK's `adapter-web`. It is a browser/AI SDK transport rather than an
  external provider webhook protocol. Flue already owns direct agent HTTP and
  WebSocket surfaces; any new browser transport should be planned separately.
- Copying or compatibility-layering Chat SDK APIs.
- A universal outbound provider client, universal tool collection, or universal
  channel event schema.
- OAuth installation flows, credential stores, tenant registries, app
  marketplaces, or dynamic multi-installation routing unless a provider cannot
  support a useful fixed-installation channel without them.
- Long-lived provider transports such as Slack Socket Mode, Discord Gateway,
  and Telegram polling in the initial channel packages.
- Twilio Voice. The initial `@flue/twilio` package is scoped to Messaging;
  voice should receive a separate explicit product decision.
- Live provider credentials or remote provider calls in automated tests.

## Product invariants

Every provider workstream must preserve these decisions:

1. **Ingress ownership:** Flue packages own provider request verification,
   parsing, identity checks, normalization, handshakes, and provider response
   constraints.
2. **Outbound ownership:** Applications initialize and export provider SDK
   clients. Flue packages do not wrap broad provider APIs.
3. **Tool ownership:** Applications define only the model-facing tools they
   need and bind trusted destinations in application code.
4. **Routing:** Immediate `channels/<name>.ts` files are discovered beneath the
   same `flue()` mount as agents and workflows.
5. **Namespaces:** The filename fixes `/channels/<name>`. Provider packages
   declare one or more non-empty suffixes such as `/webhook`, `/events`,
   `/interactions`, or another provider-native surface.
6. **Optional surfaces:** An omitted optional callback does not publish its
   route. Recipes show unused surfaces as commented examples rather than empty
   active handlers.
7. **Handler input:** Each callback receives one extensible object such as
   `{ c, event }`, `{ c, interaction }`, or another provider-appropriate name.
   The Hono `Context` remains intact under `c`.
8. **Responses:** Application handlers return `undefined`, a JSON-compatible
   provider response, or an ordinary Hono/Fetch `Response`. `undefined`
   becomes an empty `200` only when that provider protocol permits it.
9. **No eager callbacks:** Constructors store application handlers without
   invoking them during module evaluation.
10. **Identity:** Conversation keys are canonical identifiers, not
    authorization capabilities.
11. **Unknown inputs:** Verified but unsupported provider variants should be
    represented explicitly when forwarding them is safe and useful. Protocol
    control messages may instead be handled internally.
12. **Required targets:** Every channel package and canonical project
    integration must support both Node and Cloudflare Workers. Support must be
    demonstrated with the actual package and selected outbound client path,
    not inferred from a dependency's marketing, types, successful import, or
    successful bundle.
13. **Errors:** New Flue runtime errors follow the repository's structured
    error policy. Provider package errors follow the established package
    pattern and expose machine-testable classes or fields rather than requiring
    message matching.
14. **Project validity:** Channels do not replace the existing requirement for
    at least one agent or workflow.

Provider APIs should be internally consistent without forcing false
cross-provider uniformity. Constructor options, event names, trusted identity
inputs, required responses, and route counts may differ.

## Cloudflare compatibility baseline

Cloudflare is a required platform, not an optional target claim.

Use these current platform facts as the starting point, then verify them again
against current documentation during implementation:

- Workers provides standards-based Fetch, Web Crypto, URL, and Web Streams
  APIs suitable for most webhook verification and REST clients.
- Workers Web Crypto supports the major signing and verification algorithms
  these providers are likely to require, including HMAC, RSA, ECDSA, and
  Ed25519.
- `nodejs_compat` can expose supported Node APIs, but it may also make
  non-functional stubs importable. A successful import or bundle is therefore
  not a compatibility test.
- Google documents both client-library and direct HTTP service-account OAuth
  flows. Because direct JWT construction is security-sensitive, prefer a
  maintained cross-runtime authentication implementation when Google's own
  clients do not execute in Workers.
- Microsoft Bot Connector authentication is standards-based bearer JWT,
  OpenID/JWKS, OAuth, and HTTPS REST. If Microsoft's current JavaScript SDK is
  Node-oriented, independently validate a Workers implementation built from
  those official protocol surfaces and a proven cross-runtime JOSE library.

Initial compatibility findings on 2026-06-13:

- the current `google-auth-library` package declares a Node engine and brings
  Node-oriented authentication and transport dependencies. This does not prove
  that every operation fails in Workers, but it is not evidence of support and
  must not be selected without a complete workerd spike;
- the current `@microsoft/agents-hosting` package declares Node 20 and depends
  on packages including `@azure/msal-node`, `jsonwebtoken`, and `jwks-rsa`.
  Treat it as Node-oriented unless a complete Workers execution test proves
  otherwise;
- Microsoft's Bot Connector documentation explicitly states that no special
  SDK is required for its standard HTTPS/JSON authentication protocol;
- maintained Web-interoperable JOSE implementations exist with explicit
  Cloudflare Workers support, making JWT signing, verification, and remote
  JWKS a credible standards-based building block;
- Google recommends client libraries because service-account JWT construction
  is security-sensitive. The workstream should therefore investigate a
  maintained cross-runtime Google authentication implementation before
  considering direct JWT/OAuth code.

Primary starting points:

- <https://developers.cloudflare.com/workers/runtime-apis/nodejs/>
- <https://developers.cloudflare.com/workers/runtime-apis/web-crypto/>
- <https://developers.google.com/identity/protocols/oauth2/service-account>
- <https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication>
- <https://github.com/panva/jose>

## Shared implementation process

Each provider should be owned as an end-to-end workstream. The implementor is
responsible for research, design, implementation, documentation, testing, and
the final audit rather than receiving a prematurely fixed event model from this
plan.

### 1. Establish the primary-source research brief

Record:

- official protocol and security documentation;
- official event, activity, update, or payload schemas;
- official acknowledgement deadlines and retry behavior;
- official verification, signing, issuer, audience, and replay rules;
- handshakes or challenge-response behavior;
- content types and body encodings;
- batch cardinality and ordering guarantees;
- delivery, interaction, update, or activity ids;
- stable tenant, application, workspace, account, page, bot, or installation
  identity available on verified requests;
- provider capabilities that must never enter model context or durable
  dispatch input;
- official or established JavaScript SDK candidates for application-owned
  outbound behavior;
- current Node and Cloudflare compatibility evidence.

Treat official examples as protocol documentation, not copyable fixtures.

### 2. Write a threat and trust model

Before designing types, state:

- which bytes or parameters are authenticated;
- which headers and payload fields become trusted after verification;
- which identity claims require explicit configuration;
- how request age, replay, duplicate delivery, and provider retries are
  represented;
- what public URL or proxy information participates in verification;
- which short-lived response URLs, tokens, or capabilities must be redacted;
- whether key discovery, JWKS caching, or key rotation is required;
- how verification behaves when network access to a key source is unavailable.

Do not parse and dispatch before verification unless the official protocol
requires limited parsing to locate verification material and that exception is
documented.

### 3. Inventory provider HTTP surfaces

Propose the smallest useful set of route suffixes and methods.

For each surface define:

- whether it is required or optional;
- whether configuration without a callback still needs the route for a
  handshake;
- its body encoding and body limit;
- its callback input;
- its default response;
- whether a response body is mandatory;
- whether it shares verification and event normalization with another route.

Do not combine semantically distinct protocols merely to reduce route count.
Do not publish unused optional surfaces.

### 4. Propose the normalized event and identity model

Design from Flue use cases and official provider semantics:

- normalize the fields applications routinely need for dispatch and routing;
- retain a `raw: unknown` escape hatch only after verification;
- use discriminated unions for meaningful variants;
- provide an explicit unknown variant where appropriate;
- preserve provider delivery and retry identifiers;
- represent one provider delivery containing multiple events without silently
  dropping entries;
- define canonical conversation or destination identity only where it remains
  stable enough for agent-instance selection;
- keep outbound capabilities and credentials out of canonical identity.

Review the proposal before implementation when it introduces a consequential
public constraint, such as collapsing a batch, choosing one conversation
boundary among several plausible boundaries, or requiring one installation
model.

### 5. Decide constructor and response contracts

Provider constructors may accept:

- secrets, public keys, tokens, expected identity, or verification URLs;
- a provider SDK object when the official SDK is the best verifier;
- injected verification dependencies needed for deterministic tests;
- one callback per enabled protocol surface;
- provider-specific body limits and bounded deadlines.

Do not require a provider SDK merely for consistency. Prefer Web Crypto and
small package-owned protocol code when that is clearer and more portable.

Use normal Hono and Fetch responses. Add a provider-specific JSON response type
only where it improves static correctness without recreating a large provider
SDK. Validate JSON compatibility at runtime.

### 6. Spike runtime and SDK compatibility

Before building the full package:

- prove the verification strategy in Node and workerd;
- bundle the selected project-owned outbound SDK through Flue's Node and
  Cloudflare targets;
- exercise one representative outbound SDK method against an injected or fake
  Fetch transport in both Node and workerd without contacting the provider;
- identify required compatibility flags, Node built-ins, dynamic imports,
  socket assumptions, or unsupported transports;
- choose the first viable option in this order:
  1. the official SDK when it explicitly supports Workers or passes the
     complete workerd execution spike;
  2. a well-maintained community client with demonstrated Workers support;
  3. a narrow project-owned Fetch client over the provider's official REST API,
     using a proven cross-runtime authentication or signing library where
     needed;
- reject a Node-only client as the canonical recipe dependency, even if it can
  be made to type-check or bundle;
- treat `nodejs_compat` as an implementation aid, not evidence of support.
  Cloudflare documents that some Node modules are partial implementations or
  non-functional import stubs, so the representative runtime operation must
  execute successfully;
- prefer Fetch, Web Crypto, URL, Web Streams, and cross-runtime JOSE/OAuth
  building blocks over Node-specific transports and filesystem-based
  credential discovery.

Record target-specific recipe branches. Do not weaken ingress ownership because
an outbound SDK is inconvenient.

Cloudflare support is a hard phase gate. If the research ladder above produces
no defensible Workers path, stop that provider before public API finalization,
record the evidence and attempted options, and bring the blocker to the user.
Do not silently ship a Node-only provider, omit the Cloudflare example, or mark
the provider complete with a target caveat.

### 7. Implement the package

Follow the existing `packages/github`, `packages/slack`, and
`packages/discord` package shape where it expresses the shared Flue contract,
but allow provider-specific modules and internal organization.

At minimum:

- export one `create<Provider>Channel()` constructor;
- export public verified input, event, response, identity, and structured error
  types needed by consumers;
- expose structural routes consumed by discovered channel routing;
- verify before invoking application callbacks;
- normalize provider inputs once;
- enforce documented limits and deadlines;
- handle protocol control messages internally where appropriate;
- serialize default and application responses deterministically;
- avoid any dependency on `@flue/runtime` unless a true ingress requirement is
  discovered and recorded;
- depend directly on Hono for public context and handler types.

Do not extract shared cross-provider verification infrastructure until at least
two implementations demonstrate the same stable internal need. Similar-looking
Meta protocols may begin with local code; shared code is justified only when it
reduces real complexity without coupling public APIs.

### 8. Design original synthetic coverage

Build fixtures independently from official schemas and prose:

- use obviously synthetic provider ids, names, text, URLs, and timestamps;
- alter object ordering and optional fields from official examples;
- generate valid signatures, tokens, and keys locally;
- include invalid signatures, stale timestamps, wrong audiences, wrong
  application identities, malformed bodies, oversized bodies, and wrong
  content types as applicable;
- cover batches, retries, duplicates, and unknown variants when the protocol
  supports them;
- avoid broad module mocking;
- intercept outbound SDK Fetch calls at a narrow transport boundary;
- never copy reference fixtures, payloads, snapshots, or expected outputs.

Tests should assert observable package behavior through mounted Hono routes,
not private helper implementation.

### 9. Add Node and workerd validation

For every package:

- run focused Node tests through its public constructor and routes;
- run workerd tests for exact-body handling, cryptography, JWT/JWKS logic,
  form parsing, response serialization, and other claimed behavior;
- type-check and build emitted declarations;
- pack the package and compile a clean strict TypeScript consumer;
- confirm the package contains no outbound client or tool implementation;
- confirm no accidental Node-only dependency is hidden by the local workspace.

Every provider must pass its workerd gate before it is complete. If the
canonical official SDK fails, replace it with a proven cross-runtime client or
narrow Fetch implementation and test the real authentication, serialization,
and request-construction path against a fake transport. If no sound path exists,
defer the provider for user review rather than weakening the required platform
matrix.

### 10. Add the project integration

Create:

- `connectors/channel--<provider>.md`;
- `examples/<provider>-channel/`;
- `apps/docs/src/content/docs/guide/channels/<provider>.md`;
- `apps/docs/src/content/docs/api/<provider>-channel.md`;
- package README content generated or prepared through existing repository
  conventions;
- navigation, channel overview, CLI examples, and changelog updates.

The recipe and example should:

- export `channel` and a project-owned `client`;
- put an accurate `// Path: ...` comment above every handler;
- show grouped event handling where it improves the example;
- dispatch only normalized, non-sensitive input;
- define one narrow tool justified by the example;
- bind trusted destinations outside model arguments;
- distinguish ingress verification credentials from outbound credentials;
- follow existing Node or Cloudflare secret conventions;
- keep optional unused surfaces commented out;
- type-check and build without real credentials.

The guide should teach the recommended setup. The API reference should document
the package-visible ingress contract, not duplicate the provider's API
reference.

### 11. Perform provider artifact review

Before the reference-repository audit:

- inspect the package tarball and declarations;
- inspect generated recipe output through the actual `flue add` path;
- run a locally signed or authenticated request against the built example;
- exercise handshakes and mandatory response bodies;
- exercise the deferred channel-agent import cycle;
- search docs, examples, and exports for accidental outbound abstractions,
  unrestricted tools, secrets in model-visible input, and unsupported runtime
  claims.

### 12. Perform the final reference gap audit

Only after implementation and tests are complete:

1. Reopen the high-level Chat SDK adapter documentation at the pinned commit.
2. Compare broad supported capability categories with the completed Flue
   channel, recipe, and example.
3. Record missing capabilities and classify each as:
   - applicable verified HTTP ingress;
   - outbound project behavior already enabled by the recipe;
   - long-lived transport outside channel scope;
   - installation/state concern outside the fixed-installation package;
   - deliberately unsupported provider feature.
4. Validate applicable gaps against current official provider documentation.
5. Implement justified gaps from primary sources.
6. Record remaining differences explicitly.

Do not use reference implementation or test files during this audit.

## Initial provider research briefs

These briefs identify likely questions. They are not final route, type, or SDK
specifications.

### GitHub

Existing Flue support verifies webhook deliveries and normalizes a small set of
issue and pull-request events.

Research and audit:

- identify the intentional event set needed for agent-driven GitHub workflows;
- preserve a useful unknown verified delivery rather than attempting an
  exhaustive webhook registry without product value;
- verify installation, repository, organization, enterprise, and hook identity
  boundaries;
- preserve ping handling, exact-body signatures, delivery ids, replay behavior,
  and form-encoded payload support where still official;
- decide whether additional normalized events materially improve the canonical
  recipe and example.

Primary starting points:

- <https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries>
- <https://docs.github.com/en/webhooks/webhook-events-and-payloads>

### Slack

Existing Flue support covers the Events API and interactions for one configured
application and workspace.

Research and audit:

- signed slash-command requests as a likely additional optional HTTP surface;
- Events API envelopes, retries, URL verification, app/workspace identity, and
  enterprise or organization installation constraints;
- interaction variants and provider-required immediate responses;
- response URLs and interaction capabilities that must not enter durable or
  model-visible data;
- whether the fixed-workspace v1 constraint remains the right initial product
  boundary;
- Socket Mode and OAuth as explicit non-goals unless separate evidence changes
  the scope.

Primary starting points:

- <https://docs.slack.dev/authentication/verifying-requests-from-slack/>
- <https://docs.slack.dev/apis/events-api/>
- <https://docs.slack.dev/interactivity/implementing-slash-commands>

### Discord

Existing Flue support covers signed HTTP interactions and provider responses.

Research and audit:

- command, component, autocomplete, modal, and future interaction variants;
- PING/PONG, response deadlines, deferred responses, application identity, and
  sensitive interaction tokens;
- whether additional HTTP interaction types should be normalized;
- the boundary between HTTP interactions and Gateway-delivered message events;
- Cloudflare behavior of the selected project-owned REST client.

Primary starting points:

- <https://discord.com/developers/docs/interactions/overview>
- <https://discord.com/developers/docs/interactions/receiving-and-responding>

### Microsoft Teams

Teams bot ingress is based on Bot Framework activities rather than an ordinary
shared-secret webhook.

Research and audit:

- Bot Connector bearer-token validation, OpenID/JWKS discovery, issuer,
  audience, service URL, tenant, and app identity;
- message, conversation update, invoke, Adaptive Card action, and other
  activity variants useful to agents;
- response and acknowledgement behavior for ordinary and invoke activities;
- stable conversation, tenant, team, channel, chat, and reply-chain identity;
- the current Microsoft 365 Agents SDK direction versus older Bot Framework
  JavaScript packages;
- outbound SDK and Cloudflare compatibility;
- a standards-based Workers fallback using Fetch for OAuth and Bot Connector
  REST plus a proven cross-runtime JOSE implementation when Microsoft's SDKs
  remain Node-oriented.

Primary starting points:

- <https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication>
- <https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/conversation-basics>
- <https://learn.microsoft.com/en-us/microsoft-365/agents-sdk/>

### Google Chat

Google Chat supports direct interaction events and may also deliver Workspace
Events through Pub/Sub.

Research and audit:

- Google-signed bearer-token verification, issuer, audience, app URL, and
  project-number expectations for direct Chat requests;
- differences between HTTP endpoint authentication and Pub/Sub push
  authentication;
- direct messages, mentions, added-to-space events, card actions, dialogs, and
  synchronous response objects;
- whether direct interactions and Workspace Events belong in one package with
  separate optional surfaces;
- space, thread, user, and app identity;
- service-account, delegated-user, and outbound Chat API client options for
  Node and Cloudflare;
- an edge-compatible service-account JWT assertion, OAuth token exchange, and
  Chat REST path when Google's Node client libraries do not execute in
  workerd. Prefer a maintained cross-runtime auth library; implement the
  standards-based flow directly only when the security contract is small,
  auditable, and thoroughly tested.

Primary starting points:

- <https://developers.google.com/workspace/chat/receive-respond-interactions>
- <https://developers.google.com/workspace/chat/verify-requests-from-chat>
- <https://developers.google.com/workspace/events/guides/auth>

### Linear

Linear exposes ordinary webhooks and agent-specific session events with
different application semantics.

Research and audit:

- official webhook signature verification and request-age requirements;
- comment, issue, project, and other resource events useful for dispatch;
- agent session event types, acknowledgement deadlines, stop signals, prompt
  context, and session identity;
- whether webhooks and agent sessions require separate optional route surfaces;
- workspace, organization, actor, issue, comment, and agent-session identity;
- the boundary between a fixed workspace integration and OAuth installation
  state;
- use of `@linear/sdk` for outbound project behavior and any official
  verification helpers for ingress.

Primary starting points:

- <https://linear.app/developers/sdk-webhooks>
- <https://linear.app/developers/agents>
- <https://linear.app/developers/agent-session-events>

### Telegram

Telegram's Bot API webhook uses an optional secret token header rather than a
body signature.

Research and audit:

- `setWebhook` secret-token validation and the security implications of an
  equality token;
- update ids, retries, duplicate delivery, allowed update types, and response
  expectations;
- messages, edited messages, callback queries, commands, reactions, and other
  update variants useful for agents;
- chats, message threads, users, and forum topics as conversation identity;
- whether one update can safely map to one callback invocation;
- direct Bot API Fetch versus a maintained SDK for outbound project code;
- prefer direct typed Fetch when a bot SDK introduces Node-only runtime
  assumptions;
- polling as an explicit non-goal.

Primary starting point:

- <https://core.telegram.org/bots/api#setwebhook>

### WhatsApp Business Cloud

WhatsApp Cloud API uses Meta webhook verification and signed batched POST
deliveries.

Research and audit:

- GET challenge verification with a configured verify token;
- POST `X-Hub-Signature-256` verification with the Meta app secret;
- account, app, business, phone-number, and recipient identity constraints;
- messages, statuses, reactions, media, locations, contacts, and interactive
  replies;
- multiple entries, changes, and messages in one delivery;
- response deadline and retry behavior;
- direct Graph API Fetch or an established client for outbound project code;
- treat Graph API Fetch as the baseline Cloudflare path rather than requiring a
  Node-oriented Meta SDK.

Primary starting points:

- <https://developers.facebook.com/docs/graph-api/webhooks/getting-started>
- <https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks>

### Twilio Messaging

Twilio signs requests using the configured public URL and request parameters,
and inbound messaging commonly uses form-encoded bodies and TwiML responses.

Research and audit:

- exact public URL reconstruction behind proxies and whether configuration
  should require an explicit webhook URL;
- signature handling for form parameters and any JSON webhook variants;
- inbound SMS/MMS fields, messaging-service identity, opt-out behavior, and
  media metadata;
- status callbacks as a distinct optional surface;
- empty acknowledgement versus TwiML response semantics;
- account, subaccount, messaging service, sender, recipient, and conversation
  identity;
- Cloudflare viability of the official Twilio helper library versus a small
  package-owned verifier and project-owned Fetch client;
- use direct REST Fetch for outbound messaging when the official Twilio client
  is Node-only; do not sacrifice Cloudflare support to preserve SDK symmetry;
- voice as an explicit non-goal.

Primary starting points:

- <https://www.twilio.com/docs/usage/security#validating-requests>
- <https://www.twilio.com/docs/messaging/guides/webhook-request>

### Facebook Messenger

Messenger uses Meta webhook verification and signed batched Page events.

Research and audit:

- GET challenge verification and POST app-secret signature validation;
- Page, app, recipient, sender, thread, and message identity;
- messages, quick replies, postbacks, reactions, delivery receipts, reads, and
  opt-in or referral events useful to agents;
- multiple entries and messaging events in one delivery;
- app/page subscription and installation concerns that remain outside a fixed
  channel;
- direct Graph API Fetch or a maintained client for outbound project code;
- treat Graph API Fetch as the baseline Cloudflare path rather than requiring a
  Node-oriented Meta SDK.

Primary starting points:

- <https://developers.facebook.com/docs/graph-api/webhooks/getting-started>
- <https://developers.facebook.com/docs/messenger-platform/webhooks>

## Cross-provider test contract

Every package should intentionally cover applicable behavior from this list.
Tests should be added only where the behavior is a durable public contract.

### Verification and parsing

- exact unconsumed request bytes or official parameter canonicalization;
- valid, missing, malformed, and changed signatures or tokens;
- locally generated JWTs with valid and invalid issuer, audience, expiry, key,
  and identity;
- key rotation and bounded JWKS caching where required;
- request age and replay-window rejection where specified;
- expected provider/application/tenant/workspace/account identity;
- content type, encoding, body limits, malformed payloads, and Unicode;
- GET verification handshakes and POST delivery verification;
- public URL configuration and proxy behavior where the signature depends on
  the URL.

### Event behavior

- one representative known event for every intentional normalized family;
- explicit unknown verified variants;
- grouped switch cases in consumer code;
- batches with zero, one, and multiple applicable entries;
- retry and delivery metadata;
- duplicate ids forwarded without falsely claiming package deduplication;
- stable conversation-key round trips and invalid-key rejection;
- sensitive capability redaction from normalized input.

### Responses

- empty `200` defaults only where valid;
- plain JSON serialization;
- Hono `Response` passthrough and status control;
- provider-specific required response bodies;
- handshakes, challenge responses, PING/PONG, TwiML, invoke results, or card
  responses as applicable;
- thrown handlers and invalid return values;
- bounded handler deadlines where the provider imposes one.

### Routing and composition

- fixed filename-derived namespace and provider-owned suffix;
- every route has a non-empty suffix;
- multiple methods on one suffix where required;
- multiple optional surfaces and omitted-route behavior;
- wrong method and unknown suffix behavior through Flue runtime routing;
- root and prefixed `flue()` mounts;
- no authored `app.ts` requirement;
- channel-agent ESM cycles evaluated only through deferred callbacks.

### Target and artifact behavior

- Node build, types, and tests;
- workerd cryptography, parsing, route execution, and responses;
- actual outbound client import and one fake-transport operation in both Node
  and workerd;
- no acceptance based only on a successful Cloudflare bundle;
- explicit exercise of required authentication or request-signing logic in
  workerd;
- documented compatibility date and flags used by the test;
- clean packed-package TypeScript consumer;
- generated recipe registry behavior;
- example Node and Cloudflare builds for every provider;
- no provider network access in tests.

## Shared repository work

In addition to per-provider packages:

1. Expand the channel overview table and navigation for all supported
   providers.
2. Add named connector recipes and regenerate the connector registry.
3. Add focused `flue add` tests for every new recipe and alias.
4. Choose one canonical slug per provider. Use `google-chat` as the initial
   public proposal; record and review any naming deviation before package
   publication.
5. Add examples using the repository's existing `<provider>-channel` naming.
6. Update Knip entry patterns and workspace validation only where new
   discovered example modules require it.
7. Update release preparation so every public package's prepared docs and
   tarball are generated from canonical sources.
8. Keep the generic channel recipe provider-neutral and update it only when a
   cross-provider lesson improves unsupported-provider implementation.
9. Search for stale claims that only GitHub, Slack, and Discord are supported.
10. Keep packages independently releasable and avoid a shared runtime package
    unless repeated implementation evidence justifies one.

## Parallel ownership and commit sequencing

Provider research and implementation may proceed independently after the shared
contract is confirmed. Each workstream should own disjoint package, example,
recipe, guide, and API-reference files.

Recommended sequence:

1. **Research checkpoint**
   - Commit provider research briefs, package names, likely route surfaces,
     target spikes, and consequential deferrals.
2. **Provider commits**
   - Prefer a coherent commit after completing each provider so its
     implementation remains independently understandable and reviewable.
   - Split a provider across commits or group closely related provider work
     when shared research, infrastructure, or validation makes that history
     clearer.
   - Avoid commits that mix unrelated partial provider implementations merely
     to follow a fixed sequence.
   - Existing GitHub, Slack, and Discord audits may be separate commits.
3. **Recipe and example commits**
   - May travel with each provider when focused validation is easier.
4. **Shared documentation and navigation**
   - Land after package APIs are stable enough to document.
5. **Final audit fixes**
   - Record reference-gap findings and primary-source resolutions.
6. **Validation and artifact commit**
   - Regenerate prepared docs, connector indexes, and other intentional
     generated outputs.

The implementation goal for this plan should authorize commits as work reaches
coherent review points. Before each commit, inspect the worktree and stage only
the intended provider or shared changes. Never absorb unrelated user edits
merely to satisfy a preferred commit boundary.

## Consequential decisions and deferrals

Implementors should proceed autonomously on ordinary provider-specific details.
Defer for user review only when evidence leaves multiple materially different
product directions, including:

- a provider cannot support a useful fixed-installation channel without
  Flue-owned OAuth or installation storage;
- Cloudflare support would require a Node-only runtime, remote proxy, or a
  substantial compatibility layer after official, community, and
  standards-based Fetch paths have been investigated;
- an official protocol depends on a long-lived socket or polling transport and
  no equivalent verified HTTP ingress exists;
- a batch can plausibly map to either one callback or many callbacks with
  materially different acknowledgement, ordering, or failure semantics;
- choosing conversation identity would irreversibly collapse distinct provider
  destinations;
- signature verification requires trusting proxy headers or reconstructed URLs
  without a defensible configuration contract;
- provider response deadlines conflict with Flue dispatch or handler behavior;
- a public package name or route suffix would create a likely long-term naming
  mistake;
- official documentation and official SDK behavior materially disagree.

When a consequential decision can be deferred without blocking unrelated work:

1. record the evidence and alternatives;
2. implement no accidental public commitment;
3. continue other provider workstreams;
4. leave a concrete review question in the implementation log.

## Deviations

This plan is directional, not immutable. Implementors may deviate when genuinely
new evidence from official provider sources, the codebase, target-runtime
testing, or review shows that another approach better satisfies the product
invariants.

Record every material deviation with:

- the planned assumption;
- the new evidence;
- alternatives considered;
- the chosen direction and reasoning;
- public API, documentation, test, and target impact;
- whether user review is still required.

Do not use deviation permission for unrecorded feature expansion, copying the
reference repository, or unrelated refactors.

## Implementation log

### GitHub — 2026-06-13

Status:

- Complete.

Reference capability brief:

- The high-level adapter documentation describes issue and pull-request
  conversation comments, inline pull-request review comments, mentions, and
  broad outbound message operations.
- No reference implementation, architecture, types, fixtures, payloads,
  snapshots, or tests were consulted.

Primary sources:

- GitHub webhook signature validation documentation.
- GitHub webhook best practices and ten-second response requirement.
- GitHub webhook event and payload documentation.
- Official `@octokit/webhooks-types` declarations for current required payload
  fields.
- Official Octokit REST declarations and package metadata.

Clean-room affirmation:

- All normalized types, synthetic payloads, fake ids, assertions, and tests
  were designed from GitHub's official documentation and Flue's existing
  channel contract. Nothing was copied or translated from Chat SDK source or
  tests.

Decisions:

- Keep one `POST /webhook` surface and the existing fixed-webhook constructor.
- Add `pull_request_review_comment.created` as the missing message-like inbound
  family.
- Add typed sender information and enough issue, pull-request, and comment
  context to implement mention-driven dispatch without reading `raw`.
- Keep inline review comments in the containing pull request's existing
  canonical Flue conversation identity. Expose the top-level review-comment id
  so applications that need inline replies can bind that capability
  explicitly.
- Add a default and maximum nine-second application handler deadline, leaving
  one second before GitHub's documented ten-second connection deadline.
- Continue accepting both official JSON and form-encoded webhook payloads.
- Keep Octokit as the project-owned outbound client. Its typed
  `issues.createComment()` path executes in workerd through Fetch without
  `nodejs_compat`.

Tests:

- Existing exact-byte HMAC, malformed input, response, identity, and workerd
  coverage retained.
- Added original synthetic issue-comment and pull-request-review-comment
  payloads with distinct ids and text, including top-level and reply thread-id
  behavior.
- Added handler deadline coverage.
- Added a permanent workerd test for Octokit's real typed request construction
  against a fake Fetch transport.

Validation:

- Package build, strict typecheck, Node tests, and workerd tests pass.
- Example strict typecheck, workerd outbound-client test, Node build, and
  Cloudflare build pass.
- A built Node server returns an empty `200` for an original valid signed
  delivery and `401` for an invalid signature.
- Documentation check and production build pass.
- The real `flue add` CLI test suite passes.
- Prepared publish docs were regenerated.
- The packed package contains the intended runtime declarations, JavaScript,
  README, license, and prepared docs without an outbound client or tool.
- A clean strict TypeScript consumer compiles against the packed tarball and
  sees the named review-comment reference type.

Focused review:

- Reviewed the complete provider diff for verification ordering, malformed
  payload handling, normalized event narrowing, response deadlines, response
  serialization, public declarations, Cloudflare execution, and documentation.
- Replaced an awkward emitted nested-property comment with a named public
  review-comment reference and added the missing top-level thread-id contract
  test.
- No unresolved correctness findings remain.

Deviations:

- The initial brief left event expansion open. Official GitHub and high-level
  reference documentation showed that inline review comments are a distinct
  webhook family required for the intended comment-driven channel, so the
  package now normalizes that family.

Deferrals:

- None.

Final reference gap audit:

- Reopened only the pinned high-level GitHub adapter README and capability
  matrix after implementation; no reference source or test files were used.
- Issue and pull-request conversation comments and inline review comments are
  represented as verified ingress.
- Flue deliberately keeps one canonical conversation identity at the
  containing issue or pull request rather than creating a separate agent
  identity for each inline review-comment thread. The normalized top-level
  review-comment id still enables application-owned inline replies.
- Mention detection and response policy remain application behavior over the
  normalized sender and comment fields.
- Posting, editing, deleting, reactions, history, enterprise API endpoints, and
  other broad outbound capabilities remain available through the
  project-owned Octokit client rather than a Flue abstraction.
- PAT and GitHub App credential selection, installation-client caching,
  multi-tenant installation lookup, OAuth, and durable installation state are
  outside this fixed-installation ingress package. Signed payload installation
  ids are exposed for applications that need them.
- No justified ingress gap remains.

## Implementation log template

Append one section per provider while implementing:

```md
### <Provider> — YYYY-MM-DD

Status:

- Research / design / implementation / docs / audit / complete

Reference capability brief:

- High-level capabilities observed without consulting implementation or tests

Primary sources:

- Official protocol docs
- Official security docs
- Official SDK docs/source

Clean-room affirmation:

- No source, types, fixtures, payloads, snapshots, or tests copied or translated

Decisions:

- Package and recipe name
- Routes and optional surfaces
- Constructor inputs
- Event and identity model
- Response behavior
- Outbound SDK/client recommendation
- Node and Cloudflare support

Tests:

- Synthetic fixture origin and how it differs from official examples
- Node coverage
- workerd coverage
- example fake-transport coverage
- signed built-example smoke result

Deviations:

- Evidence, alternatives, choice, and impact

Deferrals:

- Consequential unresolved question and why unrelated work can continue

Final reference gap audit:

- Applicable gaps resolved from primary sources
- Deliberate non-goals and remaining differences
```

## Validation

Run focused validation during each provider workstream, then the complete
repository gates in dependency order.

Per package, adapt:

```sh
pnpm --filter @flue/<provider> run build
pnpm --filter @flue/<provider> run check:types
pnpm --filter @flue/<provider> run test
pnpm --filter @flue/<provider> run test:workerd
```

Per example, adapt:

```sh
pnpm --filter <provider>-channel-example run check:types
pnpm --filter <provider>-channel-example run build
pnpm --filter <provider>-channel-example run test:workerd
```

Shared gates:

```sh
pnpm --dir packages/runtime run build
pnpm --dir packages/runtime run check:types
pnpm --dir packages/runtime run test

pnpm --dir packages/cli run build
pnpm --dir packages/cli run check:types
pnpm --dir packages/cli run test

pnpm --dir apps/docs run check
pnpm --dir apps/docs run build

pnpm run check
git diff --check
```

Also:

- run `scripts/prepare-publish.mjs`;
- pack every channel package and inspect its contents;
- compile clean strict consumers from packed artifacts;
- exercise every named recipe through the real `flue add` output path;
- send synthetic valid and invalid requests to every built example without
  contacting a provider;
- execute one representative outbound request-construction and authentication
  path for every example in workerd against a fake Fetch endpoint;
- run scoped stale-claim and secret/capability searches;
- perform one focused review of the completed cross-provider work and
  independently evaluate each concrete finding.

## Completion criteria

This plan is complete when:

- all ten external providers have an intentional Flue channel outcome;
- the seven net-new packages are implemented unless primary-source research
  produces a recorded consequential blocker;
- GitHub, Slack, and Discord are audited and expanded where applicable;
- every supported HTTP surface verifies requests before application behavior;
- provider identity, batching, retries, handshakes, and mandatory responses are
  represented correctly;
- every package follows the established discovered-channel and Hono handler
  contract without unnecessary cross-provider abstraction;
- project-owned outbound clients and application-owned tools remain the only
  outbound model;
- named `flue add` recipes, examples, guides, API references, navigation, and
  changelog entries exist for every supported provider;
- all fixtures and tests are original, synthetic, offline, and derived from
  primary provider specifications rather than the reference repository;
- Node and Cloudflare behavior are exercised for every completed provider;
- Cloudflare is supported for every completed provider; no canonical recipe
  depends on a Node-only client;
- official SDKs that fail the workerd execution gate are replaced by proven
  cross-runtime clients or narrow standards-based Fetch implementations;
- package tarballs and clean consumers contain only the intended public
  contract;
- the final pinned-reference gap audit is recorded for every provider;
- deviations and unresolved consequential decisions are explicit;
- repository-wide validation and focused review pass;
- no live provider API or credential is required for automated validation.
