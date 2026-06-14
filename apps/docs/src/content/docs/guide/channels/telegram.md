---
title: Telegram
description: Receive verified Telegram Bot API Updates with a project-owned grammY client.
---

## Add Telegram

Run the Telegram recipe through your coding agent:

```sh
flue add telegram --print | codex
```

It installs `@flue/telegram` for verified ingress and grammY for project-owned
Bot API access. grammY publishes a browser/Fetch build that runs in both Node
and workerd with Flue's required `nodejs_compat` configuration.

Set the webhook URL to:

```txt
https://example.com/channels/telegram/webhook
```

## Channel module

```ts title="src/channels/telegram.ts"
import { createTelegramChannel, type TelegramConversationRef } from '@flue/telegram';
import { defineTool, dispatch } from '@flue/runtime';
import { Api } from 'grammy';
import assistant from '../agents/assistant.ts';

export const client = new Api(process.env.TELEGRAM_BOT_TOKEN!);

export const channel = createTelegramChannel({
  secretToken: process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN!,

  // Path: /channels/telegram/webhook
  async webhook({ update }) {
    switch (update.type) {
      case 'message': {
        if (!update.conversation || update.kind !== 'message') return;
        await dispatch(assistant, {
          id: channel.conversationKey(update.conversation),
          input: {
            type: 'telegram.message',
            updateId: update.updateId,
            message: update.message,
          },
        });
        return;
      }
      case 'callback_query': {
        await client.answerCallbackQuery(update.callback.id);
        if (!update.conversation) return;
        await dispatch(assistant, {
          id: channel.conversationKey(update.conversation),
          input: {
            type: 'telegram.callback_query',
            updateId: update.updateId,
            data: update.callback.data,
          },
        });
        return;
      }
      default:
        return;
    }
  },
});

export function postMessage(ref: TelegramConversationRef) {
  return defineTool({
    name: 'post_telegram_message',
    description: 'Post to the Telegram conversation bound to this agent.',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', minLength: 1 } },
      required: ['text'],
      additionalProperties: false,
    },
    async execute({ text }) {
      const message = await client.sendMessage(ref.chatId, text, {
        ...(ref.type === 'business-chat'
          ? { business_connection_id: ref.businessConnectionId }
          : {}),
        ...(ref.messageThreadId ? { message_thread_id: ref.messageThreadId } : {}),
        ...(ref.directMessagesTopicId
          ? { direct_messages_topic_id: ref.directMessagesTopicId }
          : {}),
      });
      return JSON.stringify({ messageId: message.message_id });
    },
  });
}
```

## Bind the tool

```ts title="src/agents/assistant.ts"
import { createAgent } from '@flue/runtime';
import { channel, postMessage } from '../channels/telegram.ts';

export default createAgent(({ id }) => ({
  model: 'anthropic/claude-haiku-4-5',
  tools: [postMessage(channel.parseConversationKey(id))],
}));
```

Trusted code binds the chat, business connection, and optional topic. The model
selects only message text.

## Configure the webhook

Generate an independent random webhook secret using only letters, numbers,
underscores, and hyphens. Configure it with the full route:

```ts
await client.setWebhook('https://example.com/channels/telegram/webhook', {
  secret_token: process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN!,
  allowed_updates: [
    'message',
    'edited_message',
    'channel_post',
    'edited_channel_post',
    'business_message',
    'edited_business_message',
    'guest_message',
    'callback_query',
    'message_reaction',
    'message_reaction_count',
  ],
});
```

Telegram sends the secret in `X-Telegram-Bot-Api-Secret-Token`.
`@flue/telegram` rejects a missing or changed value before parsing the Update.
Telegram does not sign the body or include a signed timestamp, so do not reuse
one secret across bots.

Webhook delivery and `getUpdates` polling are mutually exclusive. Polling is
outside the HTTP channel package.

## Update behavior

Each delivery contains one Update and invokes the callback once. Known message,
callback, and reaction families receive typed normalized variants. Other
verified variants remain available as `type: 'unknown'`.

`updateId` is Telegram's ordering and duplicate-detection key. The package does
not persist it; claim it in application storage before dispatch when duplicate
admission is unacceptable.

Telegram retries unsuccessful webhook requests. Returning nothing produces an
empty `200`. Return JSON to use Telegram's webhook-reply method format, or use
the Hono context for explicit status control.

## Conversation identity

Regular chats, business chats, forum threads, and channel direct-message topics
produce distinct canonical keys. Business identity includes
`businessConnectionId` because Telegram warns that business chat ids can match
ordinary bot chat ids.

Guest messages are typed but do not expose `conversation`. Their
`capabilities.guestQueryId` authorizes one short-lived `answerGuestQuery`
response and must not enter model context, logs, durable session data, or agent
identity. Inline callback queries likewise omit a conversation when Telegram
provides no accessible chat message.

See the [`@flue/telegram` API reference](/docs/api/telegram-channel/).
