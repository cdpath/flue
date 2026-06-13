---
title: Intercom
description: Receive verified Intercom notifications and use a workspace-bound official client from application-owned tools.
---

## Add Intercom

Run the Intercom recipe through your coding agent:

```sh
flue add intercom --print | codex
```

It installs `@flue/intercom` and the official
`intercom-client@7.0.3`. The recipe creates named `channel` and project-owned
`client` exports.

Configure one URL in Intercom's Developer Hub:

```txt
https://example.com/channels/intercom/webhook
```

Intercom validates that URL with `HEAD` and sends notifications to it with
`POST`.

`INTERCOM_CLIENT_SECRET` verifies inbound notifications.
`INTERCOM_ACCESS_TOKEN` authenticates outbound API calls. They are separate
credentials.

## Channel module

```ts title="src/channels/intercom.ts"
import {
  createIntercomChannel,
  type IntercomConversationRef,
  type JsonValue,
} from '@flue/intercom';
import { defineTool, dispatch } from '@flue/runtime';
import assistant from '../agents/assistant.ts';
import { createIntercomClient, type IntercomRegion } from '../intercom-client.ts';

const workspaceId = requiredEnv('INTERCOM_WORKSPACE_ID');

export const client = createIntercomClient(requiredEnv('INTERCOM_ACCESS_TOKEN'), {
  region: intercomRegion(),
});

export const channel = createIntercomChannel({
  clientSecret: requiredEnv('INTERCOM_CLIENT_SECRET'),
  workspaceId,

  // Path: /channels/intercom/webhook (HEAD, POST)
  async webhook({ event }) {
    switch (event.topic) {
      case 'conversation.user.created':
      case 'conversation.user.replied': {
        const conversationId = conversationIdFromItem(event.item);
        if (!conversationId) return;

        const conversation: IntercomConversationRef = {
          workspaceId: event.workspaceId,
          conversationId,
        };
        await dispatch(assistant, {
          id: channel.conversationKey(conversation),
          input: {
            type: `intercom.${event.topic}`,
            notificationId: event.notificationId,
            createdAt: event.createdAt,
            deliveryAttempts: event.deliveryAttempts,
            conversation: event.item,
          },
        });
        return;
      }
      default:
        return;
    }
  },
});

export function retrieveConversation(ref: IntercomConversationRef) {
  if (ref.workspaceId !== workspaceId) {
    throw new TypeError('Expected the configured Intercom workspace.');
  }
  return defineTool({
    name: 'retrieve_intercom_conversation',
    description: 'Retrieve the current Intercom conversation bound to this agent.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async execute() {
      const conversation = await client.conversations.find({
        conversation_id: ref.conversationId,
        display_as: 'plaintext',
      });
      return JSON.stringify(conversation);
    },
  });
}

function conversationIdFromItem(item: JsonValue): string | undefined {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
  return typeof item.id === 'string' && item.id.length > 0 ? item.id : undefined;
}

function intercomRegion(): IntercomRegion {
  const value = process.env.INTERCOM_REGION || 'us';
  if (value === 'us' || value === 'eu' || value === 'au') return value;
  throw new Error('INTERCOM_REGION must be us, eu, or au.');
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}
```

The example handles two conversation topics with one grouped switch branch.
Intercom's topic catalog is broad and API-versioned, so the channel keeps
`event.topic` open and represents `event.item` as JSON. Validate the fields
used by each selected topic. Verified `ping` and future topics reach the same
callback.

The optional `workspaceId` setting constrains signed notifications to the
configured top-level `app_id`. Resource ids are not globally unique across
Intercom workspaces, so the example combines workspace and conversation ids.
Use application-owned installation state to select credentials when one
deployment serves multiple workspaces.

## Official client

Keep the REST client in project code:

```ts title="src/intercom-client.ts"
import { IntercomClient, IntercomEnvironment } from 'intercom-client';

export type IntercomRegion = 'us' | 'eu' | 'au';

export interface IntercomClientOptions {
  region?: IntercomRegion;
  fetch?: typeof globalThis.fetch;
  maxRetries?: number;
}

export function createIntercomClient(
  token: string,
  options: IntercomClientOptions = {},
): IntercomClient {
  if (!token) throw new TypeError('Intercom access token must be non-empty.');
  return new IntercomClient({
    token,
    version: '2.14',
    environment: environmentForRegion(options.region ?? 'us'),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
  });
}

function environmentForRegion(
  region: IntercomRegion,
): (typeof IntercomEnvironment)[keyof typeof IntercomEnvironment] {
  switch (region) {
    case 'us':
      return IntercomEnvironment.UsProduction;
    case 'eu':
      return IntercomEnvironment.EuProduction;
    case 'au':
      return IntercomEnvironment.AuProduction;
  }
}
```

The SDK supports US, EU, and AU API environments. Select the region in trusted
configuration instead of accepting an API host from a model or webhook field.

Pin `version: '2.14'`. `intercom-client@7.0.3` generates its REST request and
response types for API version 2.14. Newer webhook topic documentation does not
make those generated REST types compatible with a manually forced 2.15 header.
Use a narrow Fetch client for a genuinely 2.15-only operation until the
official SDK supports it.

## Bind the tool

```ts title="src/agents/assistant.ts"
import { createAgent } from '@flue/runtime';
import { channel, retrieveConversation } from '../channels/intercom.ts';

export default createAgent(({ id }) => {
  const conversation = channel.parseConversationKey(id);
  return {
    model: 'anthropic/claude-haiku-4-5',
    tools: [retrieveConversation(conversation)],
  };
});
```

The tool retrieves only the conversation already selected from a verified
notification. It accepts no workspace, conversation id, token, or API host
from the model.

`channel.conversationKey()` creates canonical workspace-scoped identity.
Conversation keys remain identifiers, not authorization capabilities. Apply
the project's normal access control to direct agent routes, and verify the
workspace again before selecting an installation token.

## Endpoint validation and signatures

The discovered channel serves both:

```txt
HEAD /channels/intercom/webhook
POST /channels/intercom/webhook
```

The unsigned `HEAD` route returns an empty `200` for Intercom's endpoint
validation and never invokes application code.

Notifications require:

```txt
X-Hub-Signature: sha1=<40 hexadecimal characters>
```

Intercom computes HMAC-SHA1 over the exact request body using the developer app
client secret. `@flue/intercom` retains and verifies those bytes before UTF-8
decoding or JSON parsing. A changed body, missing or malformed signature, or
wrong secret is rejected before `webhook` runs.

The callback receives `{ c, event }`. The event contains:

- `topic` and workspace-scoped `workspaceId`;
- nullable `notificationId`;
- `createdAt`, `deliveryAttempts`, and `firstSentAt`;
- provider-native JSON `item`;
- optional `self`;
- complete parsed `raw` and exact decoded `rawBody`.

The envelope is structurally checked, but item fields remain provider-native.
Deletion, ticket, conversation-part, and future topics may have different
shapes. Do not assume every conversation-related topic has `item.id` without
validating that topic's documented payload.

Intercom supplies no signed timestamp or protocol replay window. Signature
verification authenticates delivery bytes but does not provide deduplication
or freshness.

## Responses and delivery

Returning nothing produces an empty `200`. A JSON-compatible value becomes a
JSON response with status `200`. A normal Hono or Fetch `Response` passes
through unchanged.

Intercom's current documentation conflicts between accepting any `2xx` and
requiring exactly `200` to prevent redelivery. Use exactly `200` for ordinary
acknowledgment. Return another status only when its provider behavior is
intentional: `410` disables the subscription, while `429` throttles it.
Ordinary failures or timeouts are retried once after approximately one minute.

Intercom allows five seconds for a delivery and gives higher priority to fast
responses. `handlerTimeoutMs` defaults to 4500 and cannot exceed 4500. It
covers body receipt, signature verification, parsing, and application code,
leaving time to write the response. A timeout or thrown callback returns
`500`. Promise timeouts cannot cancel arbitrary JavaScript work, so defer
long-running processing beyond the acknowledgment path.

Notifications can be duplicated and arrive out of order. Use a non-null
`event.notificationId` in application-owned durable storage when duplicate
admission is unacceptable, and consider `createdAt` when ordering matters.
Setup or periodic pings may have a null id.

The package does not install an app, perform OAuth, select permissions, create
subscriptions, store tokens, deduplicate notifications, persist conversations,
or define outbound inbox policy.

## Cloudflare Workers

The verifier uses Web Crypto. The official `intercom-client@7.0.3` uses Fetch,
has no runtime dependencies, and executes in workerd with Flue's required
`nodejs_compat` configuration. The example's workerd test performs a real
`client.conversations.find()` request through injected fake Fetch and confirms
the expected EU URL, bearer token, `Intercom-Version: 2.14`, and workerd runtime
header.

That execution proves the client operation shown here, not every SDK method.
Test each additional operation used by the application against its actual
Worker target. Cloudflare projects may use typed bindings instead of
`process.env`; `nodejs_compat` is already part of Flue's Worker configuration.

Create original synthetic notification bodies and local HMAC-SHA1 signatures.
Exercise valid and tampered exact bytes, `HEAD`, workspace mismatch, ping,
future topics, malformed JSON, body limits, handler results, timeout, and
conversation-key round trips in Node and workerd.

For outbound tests, inject fail-closed Fetch into the actual official client,
disable retries, assert the exact host, path, method, authorization, version,
and region, and reject every unexpected destination. Do not register a webhook,
perform OAuth, obtain a real token, or contact Intercom.

See the [`@flue/intercom` API reference](/docs/api/intercom-channel/).
