# Channel Audit Matrix

Use this matrix as evidence guidance, not a demand for identical provider
implementations. Mark inapplicable rows with the provider-specific reason.

## Research And Eligibility

- Use current official protocol, security, retry, SDK, and API sources.
- Record useful stateless HTTP surfaces and excluded transport classes.
- Record authentication inputs, exact-byte requirements, replay window, and
  handshake behavior.
- Record response deadlines, retry behavior, delivery ids, ordering, and
  batching.
- Record tenant, application, actor, destination, thread, and resource
  identity.
- Prove a Node and Cloudflare Workers path before substantial implementation.
- Identify whether the package needs Hono only, a Web API authentication
  library, or the provider SDK for ingress.
- Select an official or well-maintained cross-runtime outbound client for the
  editable example. Prefer standards-based Fetch when official SDKs are
  Node-only.
- Record a clean-room affirmation and the origin of synthetic fixtures.

## Package Contract

- Public constructor options match provider semantics.
- At least one fixed non-root route is declared.
- Optional handler omission has explicit route-publication semantics.
- Callbacks use one extensible object containing Hono `c` and the typed
  provider event or interaction.
- Verification occurs before parsing-dependent application behavior.
- Exact raw bytes are retained when authentication requires them.
- Known variants are typed and verified unsupported variants remain
  observable when useful.
- Mandatory provider handshakes are internal.
- Handler result behavior is documented and tested.
- Provider deadlines are bounded and documented.
- Body limits are enforced with and without `Content-Length`.
- Authentication and application errors do not leak secrets.
- Configured provider/application/tenant identity is checked when protocol
  evidence permits it.
- Delivery ids and retry metadata are exposed without claiming built-in
  deduplication.
- Conversation keys are canonical, round-trip tested, and documented as
  identifiers rather than capabilities.
- Runtime dependencies are minimal and execute in workerd.
- Errors follow the package's established exported error pattern.

## Provider Tests

Cover durable public behavior in `packages/<provider>/test/`:

- valid authenticated request;
- tampered body, signature, token, timestamp, or identity;
- missing and malformed authentication;
- malformed request body and wrong content type;
- body over limit, including streaming without a trusted length;
- handshake or challenge;
- each intentionally supported event family;
- verified unknown event behavior;
- batching or multiple entries when the provider supports them;
- handler success with no return value;
- JSON-compatible return value;
- Hono or Fetch `Response` passthrough;
- invalid return, thrown handler, and deadline behavior;
- conversation-key round trip and rejection;
- optional route presence or absence.

Run the meaningful crypto, parser, route, and response cases in
`packages/<provider>/test-workerd/`. Do not reduce workerd coverage to a bundle
test.

Typical focused commands:

```sh
pnpm --filter @flue/<provider> run build
pnpm --filter @flue/<provider> run check:types
pnpm --filter @flue/<provider> run test
pnpm --filter @flue/<provider> run test:workerd
```

Adapt to the package's actual scripts.

## Example

- `examples/<provider>-channel` exports `channel` from
  `src/channels/<provider>.ts`.
- The module exports the recommended project-owned `client`.
- The callback dispatches a useful event using canonical identity.
- Grouped event cases are shown when they improve ordinary provider code.
- A narrow project-owned tool demonstrates outbound composition when useful.
- Trusted code binds credentials and destination; model parameters do not
  select arbitrary accounts, URLs, or credentials.
- Route comments show complete discovered URLs.
- Optional surfaces are documented without silently publishing unwanted
  routes.
- The real client constructs and authenticates a request against a fake Fetch
  endpoint.
- Client execution passes in Node and workerd.
- Strict type checking, Node build, and Cloudflare build pass.
- A locally signed or authenticated request reaches the built route and
  produces the expected response without provider access.

Typical focused commands:

```sh
pnpm --filter <provider>-channel-example run check:types
pnpm --filter <provider>-channel-example run test
pnpm --filter <provider>-channel-example run build
pnpm --dir packages/cli exec flue build --target cloudflare
```

Run the Cloudflare build from the example directory or use its configured
equivalent. Follow the repository's dependency build order.

## Connector And Documentation

- `connectors/channel--<provider>.md` has valid registry frontmatter.
- The recipe inspects the target project and adapts source root, environment,
  agent, and target conventions.
- It installs the channel package and project-owned client.
- It creates named `channel` and `client` exports.
- It explains ingress and outbound credentials separately.
- It instructs local synthetic verification and fake-transport client tests.
- It never tells the coding agent to contact the provider.
- `flue add <provider> --print` returns the intended recipe.
- The channel guide teaches setup, route URL, callback, client, tool binding,
  retries, and Cloudflare caveats without claiming turnkey deployment.
- The API page matches package-visible exports and response behavior.
- Navigation, channel overview tables, CLI docs, package README, publish-doc
  mapping, and changelog include the provider where applicable.
- `apps/docs` and `apps/www` build successfully.

## Artifact And Consumer Checks

- Run `node scripts/prepare-publish.mjs`.
- Pack the provider package without publishing.
- Inspect that the tarball contains only intended public files.
- Confirm generated declarations expose the intended Hono generics and event
  types.
- Install the tarball into a clean strict TypeScript consumer.
- Typecheck a custom Hono environment and import the constructor at runtime.
- Confirm no accidental `@flue/runtime` or provider SDK runtime dependency.
- Confirm every declared runtime dependency executes under Flue's required
  Workers `nodejs_compat` configuration and does not call unsupported stubs.

## Security And Quality Review

- Search for hard-coded credentials, fixture secrets, private keys, and logged
  authentication values.
- Check timing-safe or cryptographic verification behavior in both runtimes.
- Check attacker-controlled URL fetches, redirects, JWKS endpoints, and token
  audiences.
- Check replay timestamps when the provider supplies them.
- Check timeout behavior and whether timed-out work can continue.
- Check JSON recursion, unsupported values, and response header behavior.
- Check route method/path collisions and optional-surface publication.
- Check that provider metadata is not documented as authorization.
- Check fake transports fail if a real network request escapes.
- Run formatting, lint, type, test, whitespace, and stale-claim searches
  relevant to changed files.

## Cross-Provider Reflection

Answer after focused validation:

1. What was genuinely provider-specific?
2. What code or testing friction repeated across existing channels?
3. Did this provider invalidate a shared routing, handler, identity, response,
   dependency, example, documentation, or Cloudflare assumption?
4. Is there a concrete failure scenario that justifies a shared change?
5. Which existing providers are affected, and which checks must be rerun?
6. Should the improvement be implemented now, suggested for later, or rejected
   as premature abstraction?

Record the answer in the active plan even when no shared change is warranted.

## Completion Evidence

Before committing, record:

- primary sources and eligibility conclusion;
- implemented and intentionally omitted surfaces;
- package and example test results;
- actual workerd execution evidence;
- built-example signed or authenticated smoke result;
- recipe and docs build results;
- packed artifact and clean consumer result;
- clean-room fixture affirmation;
- independent review findings and resolutions;
- foundation reflection, deviations, deferrals, and remaining risks.
