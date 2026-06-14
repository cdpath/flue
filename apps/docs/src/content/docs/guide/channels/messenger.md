---
title: Facebook Messenger
description: Receive verified Messenger Page events with a project-owned Graph API client.
---

## Add Messenger

Run the Messenger recipe through your coding agent:

```sh
flue add messenger --print | codex
```

It installs `@flue/messenger` for verified Page ingress and creates an editable
Graph API Fetch client for outbound messages. The same client runs in Node and
workerd with Flue's required `nodejs_compat` configuration.

Configure Meta to use:

```txt
https://example.com/channels/messenger/webhook
```

## Channel module

```ts title="src/channels/messenger.ts"
import { createMessengerChannel, type MessengerConversationRef } from '@flue/messenger';
import { defineTool, dispatch } from '@flue/runtime';
import assistant from '../agents/assistant.ts';
import { MessengerClient } from '../messenger-client.ts';

export const client = new MessengerClient({
  pageId: process.env.MESSENGER_PAGE_ID!,
  pageAccessToken: process.env.MESSENGER_PAGE_ACCESS_TOKEN!,
  graphVersion: 'v25.0',
});

export const channel = createMessengerChannel({
  appSecret: process.env.MESSENGER_APP_SECRET!,
  verifyToken: process.env.MESSENGER_VERIFY_TOKEN!,
  pageId: process.env.MESSENGER_PAGE_ID!,

  // Paths: GET and POST /channels/messenger/webhook
  async webhook({ delivery }) {
    for (const event of delivery.events) {
      if (event.type !== 'message' || event.message.text === undefined) {
        continue;
      }
      await dispatch(assistant, {
        id: channel.conversationKey(event.conversation),
        input: {
          type: 'messenger.message',
          messageId: event.message.id,
          text: event.message.text,
          attachmentTypes: event.message.attachments.map((attachment) => attachment.type),
        },
      });
    }
  },
});

export function postMessage(ref: MessengerConversationRef) {
  return defineTool({
    name: 'post_messenger_message',
    description: 'Post to the Messenger conversation bound to this agent.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1 },
      },
      required: ['text'],
      additionalProperties: false,
    },
    async execute({ text }) {
      const result = await client.messages.sendText({
        to: ref.participant,
        text,
      });
      return JSON.stringify({ messageId: result.messageId });
    },
  });
}
```

The recipe creates `src/messenger-client.ts` with the Fetch client used above.
Bind the tool from the agent with
`postMessage(channel.parseConversationKey(id))`.

## Configure verification

Set the app secret, your chosen verify token, the fixed Page id, and a Page
access token. The GET route answers Meta's verification challenge. The POST
route validates the exact body with `X-Hub-Signature-256` before parsing any
events.

Connect the app to the Page and subscribe only to fields the application
handles. Common fields include messages, echoes, edits, postbacks, reactions,
delivery receipts, reads, opt-ins, and referrals.

The app secret is an inbound verification credential. The Page access token is
an outbound Graph credential. Keep both in trusted server configuration.

## Delivery behavior

One signed POST can contain several entries and events. The callback runs once
with ordered `delivery.events`, preserving entry, collection, and item
positions. Supported event families include messages, echoes, edits,
postbacks, reactions, deliveries, reads, opt-ins, referrals, and explicit
unknown events.

Returning nothing produces Meta's documented `EVENT_RECEIVED` response with
status `200`. Return an ordinary Hono or Fetch `Response` for explicit control.
Meta requires acknowledgement within five seconds; the package limits handler
execution to 4500 ms by default.

Failed deliveries may be retried, and ordering can change after failures.
Claim stable message ids before dispatch when duplicate admission is
unacceptable.

## Identity and capabilities

Conversation keys combine the fixed Page with either a Page-scoped person id
or a `user_ref`. Those participant types are not interchangeable. Parse the
key in trusted code and bind the destination to application-owned tools.

Marketing opt-ins may expose a notification token under `capabilities`. Keep
capabilities and complete `raw` payloads out of dispatch input, model context,
logs, and durable session history.

## Outbound behavior

The generated client exposes a generic Graph request method plus message and
sender-action helpers. Add rich templates, attachments, reactions, typing, or
other operations in project code as needed.

Messenger policy still applies. Ordinary replies use the standard messaging
window; tags, marketing messages, and other outbound surfaces have separate
permission and content requirements.

Messenger does not provide historical webhook notifications. Store the events
your application needs rather than treating process memory as provider
history.

See the
[`@flue/messenger` API reference](/docs/api/messenger-channel/).
