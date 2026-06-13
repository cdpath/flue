import type { Context, Env, Handler } from 'hono';
import { InvalidZendeskInputError, InvalidZendeskTicketKeyError } from './errors.ts';
import { createZendeskWebhookHandler } from './webhook.ts';

export { InvalidZendeskInputError, InvalidZendeskTicketKeyError } from './errors.ts';

/** JSON-compatible channel value. Unsafe parsed integers are represented as strings. */
export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

/** JSON object used for provider-native Zendesk payload fields. */
export type JsonObject = { [key: string]: JsonValue };

/** Fixed route declaration consumed by Flue channel discovery. */
export interface ChannelRoute<E extends Env = Env> {
	readonly method: string;
	readonly path: string;
	readonly handler: Handler<E>;
}

/** Ingress configuration for one Zendesk webhook signing secret. */
export interface ZendeskChannelOptions<E extends Env = Env> {
	/** Signing secret used to verify the timestamp and exact request bytes. */
	signingSecret: string;
	/**
	 * Optional fixed account id for the signed body and matched header metadata.
	 * Mismatches receive `403`.
	 */
	accountId?: string;
	/**
	 * Optional fixed webhook id from provider header metadata. Mismatches
	 * receive `403`; Zendesk's HMAC does not cover this header.
	 */
	webhookId?: string;
	/** Maximum request-body size in bytes. Defaults to 1 MiB. */
	bodyLimit?: number;
	/**
	 * Complete route deadline, including body receipt, verification, parsing,
	 * and the application callback. Defaults to and may not exceed 11 seconds,
	 * leaving time before Zendesk's 12-second delivery timeout.
	 *
	 * Timed-out work may continue running after the failure response.
	 */
	handlerTimeoutMs?: number;
	/** Receives every verified Zendesk event-subscription delivery. */
	webhook(input: ZendeskWebhookHandlerInput<E>): ZendeskHandlerResult;
}

/** Stable account-scoped Zendesk ticket identity. */
export interface ZendeskTicketRef {
	/** Positive decimal Zendesk account id. */
	accountId: string;
	/** Positive decimal ticket id within the account. */
	ticketId: string;
}

/**
 * One verified Zendesk webhook event.
 *
 * Zendesk's event catalog and schema versions remain open, so applications
 * validate the provider-native `detail` and `event` fields they consume.
 */
export interface ZendeskWebhookEvent<
	TDetail extends JsonObject = JsonObject,
	TEvent extends JsonObject = JsonObject,
> {
	/**
	 * Account id from the signed body, matched against provider header metadata.
	 *
	 * Zendesk's HMAC does not independently cover the account header.
	 */
	accountId: string;
	/**
	 * Webhook configuration id from provider header metadata.
	 *
	 * Zendesk's HMAC does not independently cover this header.
	 */
	webhookId: string;
	/**
	 * Delivery invocation id from provider header metadata for attempt
	 * correlation.
	 *
	 * Zendesk's HMAC does not independently cover this header. Use the signed
	 * `eventId` rather than this value as a replay-resistant deduplication key.
	 */
	invocationId: string;
	/** Timestamp string included in Zendesk's signature input. */
	signatureTimestamp: string;
	/** Provider event id from the common event envelope. */
	eventId: string;
	/** Open provider event type. */
	type: string;
	/** Open provider schema version from `zendesk_event_version`. */
	schemaVersion: string;
	/** Provider resource subject. */
	subject: string;
	/** Provider event time. */
	time: string;
	/** Provider-native resource object. Validate fields for the selected event type. */
	detail: TDetail;
	/** Provider-native change object. Validate fields for the selected event type. */
	event: TEvent;
	/**
	 * Complete parsed provider envelope. Unsafe numeric literals are strings
	 * rather than rounded JavaScript numbers.
	 */
	raw: JsonObject;
	/** Exact UTF-8 body after successful signature verification. */
	rawBody: string;
}

export interface ZendeskWebhookHandlerInput<E extends Env = Env> {
	/** Authentic Hono context for the discovered route. */
	c: Context<E>;
	/** Verified and normalized Zendesk event. */
	event: ZendeskWebhookEvent;
}

type ZendeskHandlerValue = undefined | JsonValue | Response;

/**
 * Returning no value or JSON acknowledges with `200`. A returned `Response`
 * passes through. Channel-owned failures use retryable `409`.
 */
export type ZendeskHandlerResult = ZendeskHandlerValue | Promise<ZendeskHandlerValue>;

/** Verified Zendesk ingress and canonical ticket identity helpers. */
export interface ZendeskChannel<E extends Env = Env> {
	/** Fixed route declarations published beneath the discovered channel path. */
	readonly routes: readonly ChannelRoute<E>[];
	/** Serializes a canonical identifier. It is not an authorization capability. */
	ticketKey(ref: ZendeskTicketRef): string;
	/** Parses only canonical keys produced by `ticketKey()`. */
	parseTicketKey(id: string): ZendeskTicketRef;
}

/**
 * Creates one verified Zendesk event-subscription webhook route.
 *
 * The route is fixed at `POST /webhook`. The channel is stateless and does not
 * deduplicate, reorder, or apply an undocumented timestamp freshness window.
 */
export function createZendeskChannel<E extends Env = Env>(
	options: ZendeskChannelOptions<E>,
): ZendeskChannel<E> {
	validateOptions(options);
	const channel: ZendeskChannel<E> = {
		routes: [
			{
				method: 'POST',
				path: '/webhook',
				handler: createZendeskWebhookHandler(options),
			},
		],
		ticketKey(ref) {
			assertTicketRef(ref);
			return [
				'zendesk',
				'v1',
				'account',
				encodeURIComponent(ref.accountId),
				'ticket',
				encodeURIComponent(ref.ticketId),
			].join(':');
		},
		parseTicketKey(id) {
			try {
				const match = /^zendesk:v1:account:([^:]+):ticket:([^:]+)$/.exec(id);
				if (!match?.[1] || !match[2]) throw new InvalidZendeskTicketKeyError();
				const ref: ZendeskTicketRef = {
					accountId: decodeURIComponent(match[1]),
					ticketId: decodeURIComponent(match[2]),
				};
				assertTicketRef(ref);
				if (channel.ticketKey(ref) !== id) throw new InvalidZendeskTicketKeyError();
				return ref;
			} catch (error) {
				if (error instanceof InvalidZendeskTicketKeyError) throw error;
				throw new InvalidZendeskTicketKeyError();
			}
		},
	};
	return channel;
}

function validateOptions<E extends Env>(options: ZendeskChannelOptions<E>): void {
	if (!options || typeof options !== 'object') {
		throw new TypeError('createZendeskChannel() requires an options object.');
	}
	if (typeof options.signingSecret !== 'string' || options.signingSecret.length === 0) {
		throw new TypeError('createZendeskChannel() requires a non-empty signingSecret.');
	}
	if (options.accountId !== undefined && !isPositiveDecimal(options.accountId)) {
		throw new TypeError('Zendesk accountId must be a positive decimal string when provided.');
	}
	if (
		options.webhookId !== undefined &&
		(typeof options.webhookId !== 'string' ||
			options.webhookId.length === 0 ||
			options.webhookId.trim() !== options.webhookId)
	) {
		throw new TypeError('Zendesk webhookId must be a non-empty trimmed string when provided.');
	}
	if (typeof options.webhook !== 'function') {
		throw new TypeError('createZendeskChannel() requires a webhook handler.');
	}
}

function assertTicketRef(ref: ZendeskTicketRef): void {
	if (!ref || typeof ref !== 'object') {
		throw new InvalidZendeskInputError('ticket');
	}
	if (!isPositiveDecimal(ref.accountId)) {
		throw new InvalidZendeskInputError('ticket.accountId');
	}
	if (!isPositiveDecimal(ref.ticketId)) {
		throw new InvalidZendeskInputError('ticket.ticketId');
	}
}

function isPositiveDecimal(value: unknown): value is string {
	return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}
