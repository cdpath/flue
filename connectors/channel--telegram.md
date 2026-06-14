---
{
  "category": "channel",
  "website": "https://core.telegram.org/bots/api"
}
---

# Add a Telegram Channel to Flue

You are an AI coding agent adding verified Telegram Bot API webhook ingress
with project-owned outbound Telegram access to a Flue project.

## Inspect the project

Read local instructions, detect the package manager and target, and select the
first existing source root: `<root>/.flue/`, then `<root>/src/`, then
`<root>/`. Inspect existing agents, environment types, secret conventions, and
which Telegram Update families the application handles.

Install `@flue/telegram` and `grammy@^1.43.0`. Flue owns verified webhook
ingress. The project owns grammY's full `Api` client, update policy, durable
deduplication, and every outbound tool.

grammY's browser/Fetch export executes in Node and workerd with Flue's required
`nodejs_compat` configuration. Keep a workerd fake-transport test for every Bot
API operation the project relies on.

## Create the channel

Create `<source-dir>/channels/telegram.ts`. Adapt the imported agent,
dispatched input, handled update kinds, and tool:

```ts
import {
  createTelegramChannel,
  type TelegramConversationRef,
} from '@flue/telegram';
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
        if (
          !update.conversation ||
          (update.kind !== 'message' &&
            update.kind !== 'business_message' &&
            update.kind !== 'channel_post')
        ) {
          return;
        }
        await dispatch(assistant, {
          id: channel.conversationKey(update.conversation),
          input: {
            type: `telegram.${update.kind}`,
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
            from: update.callback.from,
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
    description: 'Post a message to the Telegram conversation bound to this agent.',
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
        ...(ref.messageThreadId
          ? { message_thread_id: ref.messageThreadId }
          : {}),
        ...(ref.directMessagesTopicId
          ? { direct_messages_topic_id: ref.directMessagesTopicId }
          : {}),
      });
      return JSON.stringify({ messageId: message.message_id });
    },
  });
}
```

## Wire the agent

```ts
import { createAgent } from '@flue/runtime';
import { channel, postMessage } from '../channels/telegram.ts';

export default createAgent(({ id }) => ({
  model: 'anthropic/claude-haiku-4-5',
  tools: [postMessage(channel.parseConversationKey(id))],
}));
```

The channel-agent import cycle is supported because imported bindings are read
inside deferred callbacks and initializers.

## Configure Telegram

Create a random `TELEGRAM_WEBHOOK_SECRET_TOKEN` containing only letters,
numbers, underscores, and hyphens. Do not reuse it across bots. Register the
route and the secret:

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

Telegram sends the configured value in
`X-Telegram-Bot-Api-Secret-Token`. The package requires it before parsing.
Telegram does not sign request bodies or supply a signed timestamp.

Each webhook body contains exactly one Update. Telegram retries unsuccessful
requests. Returning nothing produces an empty `200`; a JSON-compatible value
becomes the response body and may contain a Bot API method call; return a
normal Hono or Fetch `Response` for explicit status control.

The package forwards `updateId` but does not persist deduplication state. Claim
the id in durable application storage before dispatch when duplicate admission
is unacceptable.

Webhook delivery and `getUpdates` polling are mutually exclusive. Do not add
polling lifecycle behavior to the Flue channel.

## Respect identity boundaries

Regular and business chats use different conversation types. Preserve
`businessConnectionId`, `messageThreadId`, and `directMessagesTopicId` when
posting so replies reach the same destination.

Guest messages intentionally omit a conversation key.
`update.capabilities.guestQueryId` is a short-lived capability for
`answerGuestQuery`, not durable identity. Inline callback queries also omit
conversation identity when Telegram supplies no accessible message. Do not
place either capability in model context, logs, durable session data, or
persistent agent ids.

## Test without Telegram

Create original synthetic Update objects from the current Bot API schema and
cover:

- correct, missing, and changed webhook secret headers;
- messages, edits, channel posts, business messages, guest messages, callback
  queries, and reactions;
- commands with Telegram's UTF-16 entity offsets;
- unsupported verified update variants;
- malformed multi-field Update envelopes and body limits;
- regular, business, thread, and direct-topic conversation keys;
- empty, JSON, Hono, thrown, and invalid handler responses;
- real grammY `Api` calls against an injected fake Fetch transport in workerd;
- Node and Cloudflare project builds.

Do not contact Telegram or copy third-party fixtures.
