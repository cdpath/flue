---
title: Intercom Channel API
description: Reference for verified Intercom webhook ingress from @flue/intercom.
lastReviewedAt: 2026-06-13
---

Import from `@flue/intercom`.

## Exports

```ts
export {
  createIntercomChannel,
  InvalidIntercomConversationKeyError,
  InvalidIntercomInputError,
  type ChannelRoute,
  type IntercomChannel,
  type IntercomChannelOptions,
  type IntercomConversationRef,
  type IntercomHandlerResult,
  type IntercomWebhookEvent,
  type IntercomWebhookHandlerInput,
  type JsonObject,
  type JsonValue,
};
```

## `createIntercomChannel()`

```ts
function createIntercomChannel<E extends Env = Env>(
  options: IntercomChannelOptions<E>,
): IntercomChannel<E>;
```

Creates one stateless Intercom channel with endpoint-validation and signed
notification routes.

## `IntercomChannelOptions`

```ts
interface IntercomChannelOptions<E extends Env = Env> {
  clientSecret: string;
  workspaceId?: string;
  bodyLimit?: number;
  handlerTimeoutMs?: number;
  webhook(input: IntercomWebhookHandlerInput<E>): IntercomHandlerResult;
}
```

| Field              | Description                                                             |
| ------------------ | ----------------------------------------------------------------------- |
| `clientSecret`     | Developer app client secret used for exact-body HMAC-SHA1 verification. |
| `workspaceId`      | Optional expected top-level `app_id`. Signed mismatches receive `403`.  |
| `bodyLimit`        | Maximum request-body size in bytes. Defaults to 1 MiB.                  |
| `handlerTimeoutMs` | Complete route deadline. Defaults to 4500 ms and cannot exceed 4500 ms. |
| `webhook`          | Receives every verified, structurally valid topic, including `ping`.    |

The constructor throws `TypeError` for a missing options object, empty
`clientSecret`, empty configured `workspaceId`, missing callback, non-positive
body limit, or timeout outside 1 through 4500 milliseconds.

## Routes

```ts
interface IntercomChannel<E extends Env = Env> {
  readonly routes: readonly ChannelRoute<E>[];
  conversationKey(ref: IntercomConversationRef): string;
  parseConversationKey(id: string): IntercomConversationRef;
}
```

`routes` always contains:

- `HEAD /webhook`, which returns an empty `200` for Intercom endpoint
  validation without invoking application code;
- `POST /webhook`, which verifies and delivers one notification.

A file named `channels/intercom.ts` is served at
`HEAD /channels/intercom/webhook` and `POST /channels/intercom/webhook`
relative to the `flue()` mount.

## Handler input

```ts
interface IntercomWebhookHandlerInput<E extends Env = Env> {
  c: Context<E>;
  event: IntercomWebhookEvent;
}
```

`c` is the authentic Hono context. `webhook` runs only after content type, body
limit, signature, UTF-8, JSON envelope, and optional workspace checks pass.

## `IntercomWebhookEvent`

```ts
interface IntercomWebhookEvent<TItem extends JsonValue = JsonValue> {
  type: 'notification_event';
  topic: string;
  workspaceId: string;
  notificationId: string | null;
  createdAt: number;
  deliveryAttempts: number;
  firstSentAt: number;
  item: TItem;
  self?: string | null;
  raw: JsonObject;
  rawBody: string;
}
```

| Field              | Provider source         | Meaning                                                            |
| ------------------ | ----------------------- | ------------------------------------------------------------------ |
| `type`             | `type`                  | Always `notification_event` after envelope validation.             |
| `topic`            | `topic`                 | Open provider topic string.                                        |
| `workspaceId`      | `app_id`                | Intercom workspace identity in the notification envelope.          |
| `notificationId`   | `id`                    | Delivery identity for application-owned dedupe; pings may be null. |
| `createdAt`        | `created_at`            | Provider creation timestamp in Unix seconds.                       |
| `deliveryAttempts` | `delivery_attempts`     | Positive provider attempt count.                                   |
| `firstSentAt`      | `first_sent_at`         | First-send timestamp in Unix seconds.                              |
| `item`             | `data.item`             | Provider-native, API-versioned JSON payload.                       |
| `self`             | `self`                  | Optional provider notification URL.                                |
| `raw`              | Complete request object | Parsed verified notification envelope.                             |
| `rawBody`          | Exact request body      | UTF-8 text decoded only after exact-byte verification.             |

`topic` is deliberately not a closed union. Verified future topics remain
observable. `item` is JSON-typed because Intercom's catalog is broad and
versioned, deletion topics can contain minimal data, and some conversation,
ticket, and conversation-part topics use different wrappers. Applications
must validate the item fields consumed for each topic.

The package validates the common notification envelope. It does not claim that
every topic has a conversation id, ticket id, actor, or resource shape.

## Verification

`POST /webhook` requires `application/json` and:

```txt
X-Hub-Signature: sha1=<40 hexadecimal characters>
```

The package verifies HMAC-SHA1 over the exact request bytes with
`clientSecret` before decoding or parsing. Web Crypto verification executes in
Node and workerd.

Unsupported media types receive `415`; malformed `Content-Length`, UTF-8,
JSON, or envelopes receive `400`; oversized bodies receive `413`; missing,
malformed, or changed signatures receive `401`; and a configured workspace
mismatch receives `403`.

Intercom supplies no signed timestamp, nonce, or protocol replay window.
Verification does not deduplicate notifications or establish freshness.

## Handler result

```ts
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type IntercomHandlerResult =
  | undefined
  | JsonValue
  | Response
  | Promise<undefined | JsonValue | Response>;
```

Returning nothing produces an empty `200`. A JSON-compatible value becomes a
JSON response with status `200`. A normal Hono or Fetch `Response` passes
through unchanged. A thrown callback, unsupported return value, or route
timeout produces an empty `500`.

Intercom documentation conflicts between acknowledging any `2xx` and
requiring exactly `200` to avoid redelivery. Use the default exact `200` for
ordinary acknowledgment. Custom statuses pass through, but should be used only
with Intercom's retry semantics in mind. `410` disables a subscription and
`429` throttles it.

`handlerTimeoutMs` covers body receipt, verification, parsing, and the
application callback. Timed-out work is not cancelled and may continue after
the `500` response.

## Conversation identity

```ts
interface IntercomConversationRef {
  workspaceId: string;
  conversationId: string;
}
```

Intercom resource ids are not globally unique, so canonical conversation
identity includes both values. `conversationKey()` serializes the reference as
a canonical `intercom:v1:workspace:...:conversation:...` identifier, escaping
provider values. `parseConversationKey()` accepts only canonical keys produced
by that format.

These keys identify application state; they do not authorize an outbound API
request or select installation credentials.

## Errors

- `InvalidIntercomInputError`, with structured `field`, is thrown for an
  invalid conversation reference.
- `InvalidIntercomConversationKeyError` is thrown for a malformed or
  non-canonical key.

## Delivery and application boundary

The channel exposes notification identity and attempt metadata but does not
persist deduplication state or restore ordering. Pings may not have a
notification id.

App installation, OAuth, permissions, workspace token lookup, webhook
subscription setup, deduplication, replay persistence, inbox policy, ticket
workflows, outbound clients, and tools remain application concerns.

`@flue/intercom` depends only on Hono and standards-based Web Crypto. It does
not depend on `intercom-client` or `@flue/runtime`.

See [Intercom setup](/docs/guide/channels/intercom/) for official client
composition, API version and region selection, application-owned tools, and
Node/workerd testing guidance.
