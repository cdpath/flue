import type { Context, Env, Handler } from 'hono';
import { InvalidIntercomConversationKeyError, InvalidIntercomInputError } from './errors.ts';
import { createIntercomValidationHandler, createIntercomWebhookHandler } from './webhook.ts';

export { InvalidIntercomConversationKeyError, InvalidIntercomInputError } from './errors.ts';

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| JsonValue[]
	| { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export interface ChannelRoute<E extends Env = Env> {
	readonly method: string;
	readonly path: string;
	readonly handler: Handler<E>;
}

/** Ingress configuration for one Intercom developer app secret. */
export interface IntercomChannelOptions<E extends Env = Env> {
	/** Developer app client secret used to verify exact request bytes. */
	clientSecret: string;
	/** Optional fixed workspace id (`app_id`). Mismatches receive `403`. */
	workspaceId?: string;
	/** Maximum request-body size in bytes. Defaults to 1 MiB. */
	bodyLimit?: number;
	/**
	 * Complete route deadline, including body receipt, verification, parsing,
	 * and the application callback. Defaults to and may not exceed 4500ms.
	 *
	 * Timed-out work may continue after the failure response.
	 */
	handlerTimeoutMs?: number;
	/** Receives every verified Intercom topic, including `ping`. */
	webhook(input: IntercomWebhookHandlerInput<E>): IntercomHandlerResult;
}

/** Stable workspace-scoped Intercom conversation identity. */
export interface IntercomConversationRef {
	workspaceId: string;
	conversationId: string;
}

/**
 * One verified Intercom notification.
 *
 * Topic item schemas vary by API version and some deletion or ticket topics
 * use exceptional wrappers, so applications validate the fields they consume.
 */
export interface IntercomWebhookEvent<TItem extends JsonValue = JsonValue> {
	type: 'notification_event';
	topic: string;
	/** Workspace id supplied by Intercom as top-level `app_id`. */
	workspaceId: string;
	/** Notification id for application-owned deduplication. Pings may use null. */
	notificationId: string | null;
	createdAt: number;
	deliveryAttempts: number;
	firstSentAt: number;
	item: TItem;
	self?: string | null;
	/** Complete parsed provider envelope after signature verification. */
	raw: JsonObject;
	/** Exact UTF-8 request body after signature verification. */
	rawBody: string;
}

export interface IntercomWebhookHandlerInput<E extends Env = Env> {
	c: Context<E>;
	event: IntercomWebhookEvent;
}

type IntercomHandlerValue = undefined | JsonValue | Response;

/**
 * Returning no value or JSON acknowledges with `200`. A returned `Response`
 * passes through; use custom statuses only with Intercom retry semantics in
 * mind.
 */
export type IntercomHandlerResult = IntercomHandlerValue | Promise<IntercomHandlerValue>;

/** Verified Intercom ingress and canonical conversation identity helpers. */
export interface IntercomChannel<E extends Env = Env> {
	readonly routes: readonly ChannelRoute<E>[];
	/** Serializes a canonical identifier. It is not an authorization capability. */
	conversationKey(ref: IntercomConversationRef): string;
	/** Parses only canonical keys produced by `conversationKey()`. */
	parseConversationKey(id: string): IntercomConversationRef;
}

/**
 * Creates fixed Intercom endpoint-validation and webhook routes.
 *
 * The channel is stateless and does not deduplicate or reorder notifications.
 */
export function createIntercomChannel<E extends Env = Env>(
	options: IntercomChannelOptions<E>,
): IntercomChannel<E> {
	validateOptions(options);
	const channel: IntercomChannel<E> = {
		routes: [
			{
				method: 'HEAD',
				path: '/webhook',
				handler: createIntercomValidationHandler(),
			},
			{
				method: 'POST',
				path: '/webhook',
				handler: createIntercomWebhookHandler(options),
			},
		],
		conversationKey(ref) {
			assertConversationRef(ref);
			return [
				'intercom',
				'v1',
				'workspace',
				encodeURIComponent(ref.workspaceId),
				'conversation',
				encodeURIComponent(ref.conversationId),
			].join(':');
		},
		parseConversationKey(id) {
			try {
				const match = /^intercom:v1:workspace:([^:]+):conversation:([^:]+)$/.exec(id);
				if (!match?.[1] || !match[2]) {
					throw new InvalidIntercomConversationKeyError();
				}
				const ref: IntercomConversationRef = {
					workspaceId: decodeURIComponent(match[1]),
					conversationId: decodeURIComponent(match[2]),
				};
				assertConversationRef(ref);
				if (channel.conversationKey(ref) !== id) {
					throw new InvalidIntercomConversationKeyError();
				}
				return ref;
			} catch (error) {
				if (error instanceof InvalidIntercomConversationKeyError) throw error;
				throw new InvalidIntercomConversationKeyError();
			}
		},
	};
	return channel;
}

function validateOptions<E extends Env>(options: IntercomChannelOptions<E>): void {
	if (!options || typeof options !== 'object') {
		throw new TypeError('createIntercomChannel() requires an options object.');
	}
	if (typeof options.clientSecret !== 'string' || options.clientSecret.length === 0) {
		throw new TypeError('createIntercomChannel() requires a non-empty clientSecret.');
	}
	if (
		options.workspaceId !== undefined &&
		(typeof options.workspaceId !== 'string' || options.workspaceId.length === 0)
	) {
		throw new TypeError('Intercom workspaceId must be a non-empty string when provided.');
	}
	if (typeof options.webhook !== 'function') {
		throw new TypeError('createIntercomChannel() requires a webhook handler.');
	}
}

function assertConversationRef(ref: IntercomConversationRef): void {
	if (!ref || typeof ref !== 'object') {
		throw new InvalidIntercomInputError('conversation');
	}
	if (typeof ref.workspaceId !== 'string' || ref.workspaceId.length === 0) {
		throw new InvalidIntercomInputError('conversation.workspaceId');
	}
	if (typeof ref.conversationId !== 'string' || ref.conversationId.length === 0) {
		throw new InvalidIntercomInputError('conversation.conversationId');
	}
}
