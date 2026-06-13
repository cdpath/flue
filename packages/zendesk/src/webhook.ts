import type { Env, Handler } from 'hono';
import { isInteger, isLosslessNumber, isSafeNumber, parse } from 'lossless-json';
import type { JsonObject, JsonValue, ZendeskChannelOptions, ZendeskWebhookEvent } from './index.ts';

const DEFAULT_BODY_LIMIT = 1024 * 1024;
const DEFAULT_HANDLER_TIMEOUT_MS = 11_000;
const RETRYABLE_FAILURE_STATUS = 409;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function createZendeskWebhookHandler<E extends Env>(
	options: ZendeskChannelOptions<E>,
): Handler<E> {
	const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;
	const handlerTimeoutMs = options.handlerTimeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS;
	if (!Number.isSafeInteger(bodyLimit) || bodyLimit <= 0) {
		throw new TypeError('Zendesk webhook bodyLimit must be a positive integer.');
	}
	if (
		!Number.isSafeInteger(handlerTimeoutMs) ||
		handlerTimeoutMs <= 0 ||
		handlerTimeoutMs > DEFAULT_HANDLER_TIMEOUT_MS
	) {
		throw new TypeError('Zendesk webhook handlerTimeoutMs must be between 1 and 11000.');
	}
	const key = importSigningKey(options.signingSecret);

	return (c) => {
		const deadlineAt = Date.now() + handlerTimeoutMs;
		return runRoute(async () => {
			const request = c.req.raw;
			if (!isJsonRequest(request)) return response(415);

			const contentLength = request.headers.get('content-length');
			if (contentLength !== null && !/^\d+$/.test(contentLength)) return response(400);
			if (contentLength !== null && Number(contentLength) > bodyLimit) return response(413);

			const signature = parseSignature(request.headers.get('x-zendesk-webhook-signature'));
			if (!signature) return response(401);

			const metadata = readMetadata(request.headers);
			if (!metadata) return response(400);

			const body = await readBody(request, bodyLimit);
			if (body.type === 'too-large') return response(413);
			if (body.type === 'invalid') return response(400);

			const signedBytes = concatenate(encoder.encode(metadata.signatureTimestamp), body.value);
			if (!(await verifySignature(await key, signedBytes, signature))) {
				return response(401);
			}

			let rawBody: string;
			try {
				rawBody = decoder.decode(body.value);
			} catch {
				return response(400);
			}

			const normalized = normalizeEvent(rawBody, metadata);
			if (!normalized) return response(400);
			if (normalized.accountId !== metadata.accountId) return response(403);
			if (options.accountId !== undefined && normalized.accountId !== options.accountId) {
				return response(403);
			}
			if (options.webhookId !== undefined && normalized.webhookId !== options.webhookId) {
				return response(403);
			}
			if (Date.now() >= deadlineAt) return response(RETRYABLE_FAILURE_STATUS);

			return serializeHandlerResult(await options.webhook({ c, event: normalized }));
		}, handlerTimeoutMs);
	};
}

interface ZendeskRequestMetadata {
	accountId: string;
	webhookId: string;
	invocationId: string;
	signatureTimestamp: string;
}

function readMetadata(headers: Headers): ZendeskRequestMetadata | undefined {
	const accountId = readRequiredHeader(headers, 'x-zendesk-account-id');
	const webhookId = readRequiredHeader(headers, 'x-zendesk-webhook-id');
	const invocationId = readRequiredHeader(headers, 'x-zendesk-webhook-invocation-id');
	const signatureTimestamp = readRequiredHeader(headers, 'x-zendesk-webhook-signature-timestamp');
	if (
		!accountId ||
		!/^[1-9]\d*$/.test(accountId) ||
		!webhookId ||
		!invocationId ||
		!signatureTimestamp
	) {
		return undefined;
	}
	return { accountId, webhookId, invocationId, signatureTimestamp };
}

function readRequiredHeader(headers: Headers, name: string): string | undefined {
	const value = headers.get(name);
	return value && value.trim() === value ? value : undefined;
}

function normalizeEvent(
	rawBody: string,
	metadata: ZendeskRequestMetadata,
): ZendeskWebhookEvent | undefined {
	let parsed: unknown;
	try {
		parsed = parse(rawBody);
	} catch {
		return undefined;
	}
	if (!isPlainObject(parsed)) return undefined;

	const accountId = normalizeAccountId(parsed.account_id);
	const raw = normalizeJsonValue(parsed);
	if (!accountId || !isJsonObject(raw)) return undefined;
	raw.account_id = accountId;

	const eventId = readNonEmptyString(raw, 'id');
	const type = readNonEmptyString(raw, 'type');
	const schemaVersion = readNonEmptyString(raw, 'zendesk_event_version');
	const subject = readNonEmptyString(raw, 'subject');
	const time = readNonEmptyString(raw, 'time');
	const detail = readObject(raw, 'detail');
	const event = readObject(raw, 'event');
	if (!eventId || !type || !schemaVersion || !subject || !time || !detail || !event) {
		return undefined;
	}

	return {
		...metadata,
		accountId,
		eventId,
		type,
		schemaVersion,
		subject,
		time,
		detail,
		event,
		raw,
		rawBody,
	};
}

function normalizeAccountId(value: unknown): string | undefined {
	if (!isLosslessNumber(value) || !isInteger(value.value) || !/^[1-9]\d*$/.test(value.value)) {
		return undefined;
	}
	return value.value;
}

function normalizeJsonValue(value: unknown): JsonValue | undefined {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
	if (isLosslessNumber(value)) {
		return isSafeNumber(value.value) ? Number(value.value) : value.value;
	}
	if (Array.isArray(value)) {
		const result: JsonValue[] = [];
		for (const item of value) {
			const normalized = normalizeJsonValue(item);
			if (normalized === undefined) return undefined;
			result.push(normalized);
		}
		return result;
	}
	if (!isPlainObject(value)) return undefined;
	const result: JsonObject = {};
	for (const [key, item] of Object.entries(value)) {
		const normalized = normalizeJsonValue(item);
		if (normalized === undefined) return undefined;
		result[key] = normalized;
	}
	return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		!isLosslessNumber(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readObject(record: JsonObject, key: string): JsonObject | undefined {
	const value = record[key];
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function readNonEmptyString(record: JsonObject, key: string): string | undefined {
	const value = record[key];
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

async function importSigningKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['verify'],
	);
}

async function verifySignature(
	key: CryptoKey,
	signedBytes: Uint8Array,
	signature: Uint8Array,
): Promise<boolean> {
	try {
		return await crypto.subtle.verify(
			'HMAC',
			key,
			copyArrayBuffer(signature),
			copyArrayBuffer(signedBytes),
		);
	} catch {
		return false;
	}
}

function parseSignature(value: string | null): Uint8Array | undefined {
	if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return undefined;
	try {
		const decoded = atob(value);
		if (decoded.length !== 32) return undefined;
		return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
	} catch {
		return undefined;
	}
}

function concatenate(prefix: Uint8Array, body: Uint8Array): Uint8Array {
	const value = new Uint8Array(prefix.byteLength + body.byteLength);
	value.set(prefix);
	value.set(body, prefix.byteLength);
	return value;
}

async function runRoute(route: () => Promise<Response>, timeoutMs: number): Promise<Response> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const routePromise = Promise.resolve()
		.then(route)
		.catch(() => response(RETRYABLE_FAILURE_STATUS));
	const timeoutPromise = new Promise<Response>((resolve) => {
		timeout = setTimeout(() => resolve(response(RETRYABLE_FAILURE_STATUS)), timeoutMs);
	});
	const outcome = await Promise.race([routePromise, timeoutPromise]);
	if (timeout !== undefined) clearTimeout(timeout);
	return outcome;
}

function serializeHandlerResult(value: unknown): Response {
	if (value instanceof Response) return value;
	if (value === undefined) return response(200);
	if (!isJsonValue(value)) return response(RETRYABLE_FAILURE_STATUS);
	return Response.json(value);
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (typeof value !== 'object' || seen.has(value)) return false;
	if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false;
	seen.add(value);
	try {
		return Array.isArray(value)
			? value.every((item) => isJsonValue(item, seen))
			: Object.values(value).every((item) => isJsonValue(item, seen));
	} finally {
		seen.delete(value);
	}
}

function isJsonRequest(request: Request): boolean {
	return (
		request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ===
		'application/json'
	);
}

async function readBody(
	request: Request,
	bodyLimit: number,
): Promise<{ type: 'success'; value: Uint8Array } | { type: 'too-large' } | { type: 'invalid' }> {
	if (!request.body) return { type: 'success', value: new Uint8Array() };
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > bodyLimit) {
				void reader.cancel();
				return { type: 'too-large' };
			}
			chunks.push(value);
		}
	} catch {
		return { type: 'invalid' };
	} finally {
		reader.releaseLock();
	}
	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { type: 'success', value: body };
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy.buffer;
}

function response(status: number): Response {
	return new Response(null, { status });
}
