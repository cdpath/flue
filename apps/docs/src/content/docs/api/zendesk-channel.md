---
title: Zendesk Channel API
description: Reference for verified Zendesk event-subscription ingress from @flue/zendesk.
lastReviewedAt: 2026-06-13
---

Import from `@flue/zendesk`.

## Exports

```ts
export {
  createZendeskChannel,
  InvalidZendeskInputError,
  InvalidZendeskTicketKeyError,
  type ChannelRoute,
  type JsonObject,
  type JsonValue,
  type ZendeskChannel,
  type ZendeskChannelOptions,
  type ZendeskHandlerResult,
  type ZendeskTicketRef,
  type ZendeskWebhookEvent,
  type ZendeskWebhookHandlerInput,
};
```

## `createZendeskChannel()`

```ts
function createZendeskChannel<E extends Env = Env>(
  options: ZendeskChannelOptions<E>,
): ZendeskChannel<E>;
```

Creates one stateless signed Zendesk event-subscription channel.

## `ZendeskChannelOptions`

```ts
interface ZendeskChannelOptions<E extends Env = Env> {
  signingSecret: string;
  accountId?: string;
  webhookId?: string;
  bodyLimit?: number;
  handlerTimeoutMs?: number;
  webhook(input: ZendeskWebhookHandlerInput<E>): ZendeskHandlerResult;
}
```

| Field              | Description                                                             |
| ------------------ | ----------------------------------------------------------------------- |
| `signingSecret`    | Zendesk webhook signing secret used for exact-body HMAC verification.   |
| `accountId`        | Optional expected payload and header account id.                        |
| `webhookId`        | Optional expected `X-Zendesk-Webhook-Id`.                               |
| `bodyLimit`        | Maximum request-body size in bytes. Defaults to 1 MiB.                  |
| `handlerTimeoutMs` | Complete route deadline. Defaults to 11000 ms; maximum 11000 ms.        |
| `webhook`          | Receives every verified, structurally valid event-subscription payload. |

Configured secrets and ids must be non-empty. `bodyLimit` must be a positive
integer. `handlerTimeoutMs` must be a positive integer no greater than 11000.

## Routes

```ts
interface ZendeskChannel<E extends Env = Env> {
  readonly routes: readonly ChannelRoute<E>[];
  ticketKey(ref: ZendeskTicketRef): string;
  parseTicketKey(id: string): ZendeskTicketRef;
}
```

`routes` contains one `POST /webhook` declaration. A file named
`channels/zendesk.ts` is served at `POST /channels/zendesk/webhook` relative to
the `flue()` mount.

## Handler input

```ts
interface ZendeskWebhookHandlerInput<E extends Env = Env> {
  c: Context<E>;
  event: ZendeskWebhookEvent;
}
```

`c` is the authentic Hono context. The callback runs only after content type,
body limit, exact-body signature, UTF-8, JSON envelope, account consistency,
and optional configured identity checks pass.

## `ZendeskWebhookEvent`

```ts
interface ZendeskWebhookEvent {
  accountId: string;
  webhookId: string;
  invocationId: string;
  signatureTimestamp: string;
  eventId: string;
  type: string;
  schemaVersion: string;
  subject: string;
  time: string;
  detail: JsonObject;
  event: JsonObject;
  raw: JsonObject;
  rawBody: string;
}
```

| Field                | Provider source                         | Meaning                                                |
| -------------------- | --------------------------------------- | ------------------------------------------------------ |
| `accountId`          | Body `account_id` and account header    | Normalized Zendesk account identity.                   |
| `webhookId`          | `X-Zendesk-Webhook-Id`                  | Webhook configuration identity.                        |
| `invocationId`       | `X-Zendesk-Webhook-Invocation-Id`       | Unsigned provider attempt-correlation identity.        |
| `signatureTimestamp` | `X-Zendesk-Webhook-Signature-Timestamp` | Exact timestamp included in the HMAC input.            |
| `eventId`            | Body `id`                               | Provider event identity.                               |
| `type`               | Body `type`                             | Open provider event type.                              |
| `schemaVersion`      | Body `zendesk_event_version`            | Open provider event schema version.                    |
| `subject`            | Body `subject`                          | Provider resource subject such as `zen:ticket:<id>`.   |
| `time`               | Body `time`                             | Provider event occurrence timestamp.                   |
| `detail`             | Body `detail`                           | Provider-native resource object.                       |
| `event`              | Body `event`                            | Provider-native change object.                         |
| `raw`                | Complete request object                 | Parsed verified envelope.                              |
| `rawBody`            | Exact request body                      | UTF-8 text decoded only after exact-byte verification. |

Types and schema versions remain open strings. Verified future events reach
the handler. Applications validate fields consumed for each selected type.

JSON is parsed with `lossless-json`: safe numeric literals remain numbers,
while unsafe integer literals retain their exact decimal strings. The required
integer `account_id` is normalized to a positive decimal string and checked
against the provider account header.

## Verification

`POST /webhook` requires `application/json` and non-empty:

- `X-Zendesk-Account-Id`;
- `X-Zendesk-Webhook-Id`;
- `X-Zendesk-Webhook-Invocation-Id`;
- `X-Zendesk-Webhook-Signature`;
- `X-Zendesk-Webhook-Signature-Timestamp`.

The signature must be base64 HMAC-SHA256 over the exact signature timestamp
concatenated directly with the exact request bytes. Verification occurs before
decoding or parsing.

The HMAC covers the timestamp and body, not the identity headers. The package
requires the headers, checks body and header account identity for consistency,
and applies configured account and webhook restrictions. Header metadata is
not an authorization capability.

Zendesk documents no signature timestamp age or clock-skew rule. The package
does not reject an otherwise valid signature based on age.

Unsupported media types receive `415`; malformed input, identity metadata, or
signature-timestamp metadata receives `400`; oversized bodies receive `413`;
missing, malformed, or changed signatures receive `401`; configured identity
mismatches receive `403`.

## Handler result

```ts
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type ZendeskHandlerResult =
  | undefined
  | JsonValue
  | Response
  | Promise<undefined | JsonValue | Response>;
```

Returning nothing produces an empty `200`. A JSON-compatible value becomes a
JSON response. A normal Hono or Fetch `Response` passes through unchanged. A
thrown callback, unsupported return value, or route timeout produces an empty
`409`, which Zendesk retries.

Zendesk's request timeout is 12 seconds. `handlerTimeoutMs` covers body receipt,
verification, parsing, identity checks, and application code and is capped at 11000. If body processing exhausts the deadline, application code is not
started. Already-started work is not cancelled.

## Ticket identity

```ts
interface ZendeskTicketRef {
  accountId: string;
  ticketId: string;
}
```

`ticketKey()` serializes canonical account-scoped identity.
`parseTicketKey()` accepts only keys produced by the canonical format. The
application must derive and validate `ticketId` from a ticket event it handles;
the package does not claim every Zendesk event refers to a ticket.

Ticket keys identify application state. They do not authorize an outbound API
request or select account credentials.

## Errors

- `InvalidZendeskInputError`, with structured `field`, is thrown for an invalid
  ticket reference.
- `InvalidZendeskTicketKeyError` is thrown for a malformed or non-canonical
  ticket key.

## Delivery and application boundary

Zendesk can duplicate or omit delivery. It retries selected statuses and
timeouts and can pause failing endpoints through its circuit breaker. Persist
the signed `eventId` in application-owned storage when duplicate admission is
unacceptable. `invocationId` is unsigned metadata for attempt correlation.

This package supports provider-defined JSON event subscriptions. Custom
trigger and automation payloads, Sunshine Conversations, and Zendesk AI Agent
webhooks have different or incomplete contracts and are not accepted by this
route.

Webhook creation, subscription selection, destination authentication, OAuth,
token lookup, deduplication, persistence, ticket policy, outbound clients, and
tools remain application concerns.

`@flue/zendesk` depends on Hono and `lossless-json`. It does not depend on a
Zendesk SDK or `@flue/runtime`.

See [Zendesk setup](/docs/guide/channels/zendesk/) for project-owned Fetch
composition, ticket-bound tools, retry behavior, and Node/workerd testing.
