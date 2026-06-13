# `@flue/zendesk`

Verified Zendesk event-subscription webhook ingress for Flue.

The package exposes one fixed `POST /webhook` route and verifies Zendesk's
base64 HMAC-SHA256 over the signature timestamp concatenated directly with the
exact request bytes before parsing the payload or calling application code.

```ts
import { createZendeskChannel } from '@flue/zendesk';

export const channel = createZendeskChannel({
  signingSecret: process.env.ZENDESK_WEBHOOK_SIGNING_SECRET!,
  accountId: process.env.ZENDESK_ACCOUNT_ID!,

  // Path: /channels/zendesk/webhook
  webhook({ event }) {
    if (event.type.startsWith('zen:event-type:ticket.')) {
      // Validate the ticket event fields you consume, then dispatch work.
    }
  },
});
```

Place this export in `channels/zendesk.ts`. Flue discovers it and serves
`POST /channels/zendesk/webhook` relative to the `flue()` mount.

The callback receives account, webhook, invocation, signature timestamp, event,
schema-version, subject, time, detail, and event metadata together with the
complete parsed envelope and exact verified body. Zendesk's event catalog
remains open, so provider-specific detail and event objects are JSON-typed.
Numeric literals outside JavaScript's safe range are represented as strings.
The HMAC authenticates only the signature timestamp concatenated with the exact
body. Account, webhook, and invocation headers are provider metadata; the
package matches the signed body `account_id` against the account header and can
apply configured account and webhook restrictions, but does not claim the
headers are independently signed.

Returning no value or a JSON-compatible value acknowledges the delivery with
`200`. A returned Hono or Fetch `Response` passes through unchanged. Complete
route processing defaults to an 11-second deadline so Flue can respond before
Zendesk's 12-second delivery timeout. Channel-owned failures and timeouts use
retryable `409`. A callback is not started after body processing has already
exhausted the deadline; already-started work cannot be forcibly cancelled.

Zendesk documents no signature freshness window, may redeliver or omit events,
and does not guarantee ordering. Persist the signed `event.eventId` for
application-owned deduplication. Use unsigned `event.invocationId` only to
correlate provider delivery attempts.

`ticketKey({ accountId, ticketId })` and `parseTicketKey(id)` provide canonical
account-scoped ticket identifiers. They do not authorize access and the package
does not infer a ticket from event families the application has not validated.

Webhook creation, triggers and automations, destination authentication, OAuth,
token storage, deduplication, ticket policy, Sunshine Conversations, AI Agent
webhooks, and outbound Zendesk API behavior remain application-owned or outside
this package.
