---
title: WhatsApp
description: Receive verified WhatsApp Business Cloud deliveries with a project-owned Fetch client.
---

## Add WhatsApp

Run the WhatsApp recipe through your coding agent:

```sh
flue add whatsapp --print | codex
```

It installs `@flue/whatsapp` for verified ingress and
`@kapso/whatsapp-cloud-api` for project-owned Graph API access. The client is
Fetch-based and runs in Node and workerd with Flue's required `nodejs_compat`
configuration.

Set the callback URL to:

```txt
https://example.com/channels/whatsapp/webhook
```

## Channel module

```ts title="src/channels/whatsapp.ts"
import { createWhatsAppChannel, type WhatsAppConversationRef } from '@flue/whatsapp';
import { defineTool, dispatch } from '@flue/runtime';
import { WhatsAppClient, type SendMessageResponse } from '@kapso/whatsapp-cloud-api';
import assistant from '../agents/assistant.ts';

export const client = new WhatsAppClient({
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN!,
  graphVersion: 'v25.0',
});

export const channel = createWhatsAppChannel({
  appSecret: process.env.WHATSAPP_APP_SECRET!,
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN!,
  businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID!,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,

  // Paths: GET and POST /channels/whatsapp/webhook
  async webhook({ delivery }) {
    for (const event of delivery.events) {
      if (event.type !== 'message' || event.message.kind !== 'text') continue;
      await dispatch(assistant, {
        id: channel.conversationKey(event.conversation),
        input: {
          type: 'whatsapp.text',
          messageId: event.message.id,
          sender: event.sender,
          text: event.message.text,
        },
      });
    }
  },
});

function sendTextMessage(ref: WhatsAppConversationRef, body: string): Promise<SendMessageResponse> {
  if (ref.type === 'group') {
    return client.messages.sendText({
      phoneNumberId: ref.phoneNumberId,
      recipientType: 'group',
      to: ref.groupId,
      body,
    });
  }
  if (ref.destination.type === 'phone-number') {
    return client.messages.sendText({
      phoneNumberId: ref.phoneNumberId,
      recipientType: 'individual',
      to: ref.destination.phoneNumber,
      body,
    });
  }
  return client.request<SendMessageResponse>('POST', `${ref.phoneNumberId}/messages`, {
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      recipient: ref.destination.userId,
      type: 'text',
      text: { body },
    },
    responseType: 'json',
  });
}

export function postMessage(ref: WhatsAppConversationRef) {
  return defineTool({
    name: 'post_whatsapp_message',
    description: 'Post to the WhatsApp conversation bound to this agent.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1, maxLength: 4096 },
      },
      required: ['text'],
      additionalProperties: false,
    },
    async execute({ text }) {
      const result = await sendTextMessage(ref, text);
      return JSON.stringify({ messageId: result.messages[0]?.id });
    },
  });
}
```

Bind the tool from the agent with
`postMessage(channel.parseConversationKey(id))`. Trusted application code
selects the destination; the model selects only message text.

## Configure the webhook

Configure the Meta app with the route above and a random
`WHATSAPP_VERIFY_TOKEN`. Subscribe the WhatsApp Business Account to the
`messages` field.

Meta sends GET requests for `hub.challenge` verification and signs POST bodies
with the app secret in `X-Hub-Signature-256`. The package verifies exact bytes,
then checks the configured business-account and phone-number ids before
invoking application code.

Use a system-user or business access token for production outbound calls. Keep
Graph API versions explicit and test an upgrade before changing them.

## Delivery behavior

One POST can contain many entries, changes, messages, and statuses. The callback
runs once with the complete verified delivery, and `delivery.events` preserves
provider order.

Returning nothing produces an empty `200`. Meta retries failed deliveries for
up to seven days, so claim message ids in durable application storage before
dispatch when duplicates are unacceptable.

Known message variants cover text, media, location, shared contacts,
interactive replies, buttons, reactions, revocations, unsupported payloads,
and future unknown types. Status variants preserve provider state and outbound
message identity.

## Conversation identity

Meta now supplies a Business-Scoped User ID in incoming message webhooks and
may omit the sender phone number. Individual conversation destinations
therefore distinguish `phone-number` from `user-id`, prefer the BSUID when both
are present, and use the matching `to` or `recipient` outbound field. Group
destinations use the provider group id.

The current SDK release exposes broad Graph API helpers but its high-level text
helper models only `to`. The example keeps the full exported SDK client and
uses its authenticated low-level `request()` method for the documented BSUID
`recipient` shape. Test each relied-on operation against fake Fetch in Node and
workerd.

Normalized media includes the stable asset id but omits bearer-authenticated
download URLs. Use the project-owned client for retrieval, and avoid forwarding
raw provider payloads into model context.

See the [`@flue/whatsapp` API reference](/docs/api/whatsapp-channel/).
