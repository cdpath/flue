---
title: Twilio
description: Receive verified Twilio SMS and MMS webhooks with a project-owned Fetch client.
---

## Add Twilio

Run the Twilio recipe through your coding agent:

```sh
flue add twilio --print | codex
```

It installs `@flue/twilio` for verified ingress and creates an editable Fetch
client for outbound Programmable Messaging. The official Twilio Node helper is
not the canonical path because it is Node-only; the generated REST client runs
in Node and workerd with Flue's required `nodejs_compat` configuration.

Set the inbound webhook URL to:

```txt
https://example.com/channels/twilio/webhook
```

## Channel module

```ts title="src/channels/twilio.ts"
import { createTwilioChannel, type TwilioConversationRef } from '@flue/twilio';
import { defineTool, dispatch } from '@flue/runtime';
import assistant from '../agents/assistant.ts';
import { TwilioClient } from '../twilio-client.ts';

export const client = new TwilioClient({
  accountSid: process.env.TWILIO_ACCOUNT_SID!,
  authToken: process.env.TWILIO_AUTH_TOKEN!,
});

export const channel = createTwilioChannel({
  accountSid: process.env.TWILIO_ACCOUNT_SID!,
  authToken: process.env.TWILIO_AUTH_TOKEN!,
  webhookUrl: process.env.TWILIO_WEBHOOK_URL!,
  destination: {
    type: 'address',
    address: process.env.TWILIO_PHONE_NUMBER!,
  },

  // Path: /channels/twilio/webhook
  async webhook({ message }) {
    if (message.optOut?.type === 'stop') return;
    await dispatch(assistant, {
      id: channel.conversationKey(message.conversation),
      input: {
        type: 'twilio.message',
        messageSid: message.sid,
        from: message.from,
        text: message.body,
        media: message.media.map(({ index, contentType }) => ({
          index,
          contentType,
        })),
      },
    });
  },
});

export function postMessage(ref: TwilioConversationRef) {
  return defineTool({
    name: 'post_twilio_message',
    description: 'Post to the Twilio conversation bound to this agent.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', minLength: 1 },
      },
      required: ['text'],
      additionalProperties: false,
    },
    async execute({ text }) {
      const result = await client.messages.create({
        to: ref.participant,
        body: text,
        ...(ref.type === 'messaging-service'
          ? { messagingServiceSid: ref.messagingServiceSid }
          : { from: ref.address }),
      });
      return JSON.stringify({ messageSid: result.sid });
    },
  });
}
```

The recipe creates `src/twilio-client.ts` with the Fetch client used above.
Bind the tool from the agent with
`postMessage(channel.parseConversationKey(id))`.

## Configure signatures

Set the account SID, auth token, destination, and exact public webhook URL.
Twilio signs the external configured URL plus every form parameter. An
application behind a proxy cannot reliably reconstruct that URL from the
request, so `webhookUrl` is required and must include any outer mount prefix or
query string.

A trusted proxy may strip an external path prefix before the request reaches
Flue. Signature validation still uses `webhookUrl`; the fixed channel route
owns the internal path, and the package requires the incoming query string to
match the configured URL.

Connection-override fragments may remain in the configured URL. They are
excluded from signature validation because Twilio does not send or sign URL
fragments.

For a Messaging Service, configure:

```ts
destination: {
  type: 'messaging-service',
  messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID!,
},
```

The package rejects signed requests for another account or destination.

## Message behavior

Verified messages expose text, segment count, ordered MMS metadata, Advanced
Opt-Out state, optional geographic and rich-message fields, retry identity,
canonical conversation identity, and the complete signed form.

Treat `STOP` as control input rather than dispatching it to an agent or sending
an application reply.

Returning nothing produces an empty TwiML `<Response/>` with status `200`.
Return an ordinary Hono or Fetch `Response` for explicit TwiML, status, or
headers.

MMS URLs require Twilio credentials. Fetch media only in trusted application
code and avoid placing authenticated content or raw forms into model context.

## Delivery status

Add `statusCallbackUrl` and `statusCallback` together to publish:

```txt
https://example.com/channels/twilio/status
```

Set the same URL as `StatusCallback` on outbound messages. Status callbacks
preserve Twilio's exact provider state and normalize known lifecycle values,
errors, sender and recipient addresses, Messaging Service identity, retry
identity, and canonical conversation identity when enough data is available.

Twilio may duplicate callbacks or deliver statuses out of order. Persist
transitions idempotently by message SID.

Twilio does not guarantee `MessagingServiceSid` in every status callback. For
a Messaging Service channel, the configured account and exact signed callback
URL scope the route. A different service SID is rejected when Twilio includes
one, and canonical identity continues to use the authored service.

See the [`@flue/twilio` API reference](/docs/api/twilio-channel/).
