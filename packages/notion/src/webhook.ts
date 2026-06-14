import type { Env, Handler } from 'hono';
import type {
	JsonValue,
	NotionChannelOptions,
	NotionHandlerResult,
	NotionKnownWebhookEvent,
	NotionUnknownWebhookEvent,
	NotionWebhookEvent,
	NotionWebhookPrincipal,
} from './index.ts';

const DEFAULT_BODY_LIMIT = 1024 * 1024;
const encoder = new TextEncoder();

const KNOWN_EVENT_TYPES = new Set([
	'comment.created',
	'comment.deleted',
	'comment.updated',
	'data_source.content_updated',
	'data_source.created',
	'data_source.deleted',
	'data_source.moved',
	'data_source.schema_updated',
	'data_source.undeleted',
	'database.content_updated',
	'database.created',
	'database.deleted',
	'database.moved',
	'database.schema_updated',
	'database.undeleted',
	'file_upload.completed',
	'file_upload.created',
	'file_upload.expired',
	'file_upload.upload_failed',
	'page.content_updated',
	'page.created',
	'page.deleted',
	'page.locked',
	'page.moved',
	'page.properties_updated',
	'page.transcription_block.transcript_deleted',
	'page.undeleted',
	'page.unlocked',
	'view.created',
	'view.deleted',
	'view.updated',
]);

const KNOWN_API_VERSIONS = new Set(['2022-06-28', '2025-09-03', '2026-03-11']);

export function createNotionWebhookHandler<E extends Env>(
	options: NotionChannelOptions<E>,
): Handler<E> {
	const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;
	if (!Number.isSafeInteger(bodyLimit) || bodyLimit <= 0) {
		throw new TypeError('Notion webhook bodyLimit must be a positive integer.');
	}
	const secret =
		options.verificationToken === undefined ? undefined : encoder.encode(options.verificationToken);

	return async (c) => {
		const request = c.req.raw;
		if (!isJsonRequest(request)) return response(415);
		const contentLength = request.headers.get('content-length');
		if (contentLength !== null && !/^\d+$/.test(contentLength)) return response(400);
		if (contentLength !== null && Number(contentLength) > bodyLimit) return response(413);

		const body = await readBody(request, bodyLimit);
		if (body.type === 'too-large') return response(413);
		if (body.type === 'invalid') return response(400);

		const signatureHeader = request.headers.get('x-notion-signature');
		if (!signatureHeader) {
			const raw = parseJson(body.value);
			const verificationToken =
				isRecord(raw) && Object.keys(raw).length === 1
					? readNonEmptyString(raw, 'verification_token')
					: undefined;
			if (!verificationToken) return response(401);
			if (options.verificationToken !== undefined) {
				return verificationToken === options.verificationToken ? response(200) : response(403);
			}
			if (options.verification) {
				return runHandler(() => options.verification?.({ c, verificationToken }));
			}
			return response(401);
		}

		if (!secret) return response(503);
		const signature = parseSignature(signatureHeader);
		if (!signature || !(await verifySignature(secret, body.value, signature))) {
			return response(401);
		}

		const raw = parseJson(body.value);
		const event = normalizeEvent(raw);
		if (!event) return response(400);
		const identity = eventIdentity(event);
		if (
			(options.workspaceId && identity.workspaceId !== options.workspaceId) ||
			(options.subscriptionId && identity.subscriptionId !== options.subscriptionId) ||
			(options.integrationId && identity.integrationId !== options.integrationId)
		) {
			return response(403);
		}
		return runHandler(() => options.webhook({ c, event }));
	};
}

function normalizeEvent(raw: unknown): NotionWebhookEvent | undefined {
	if (!isRecord(raw)) return undefined;
	const eventType = readNonEmptyString(raw, 'type');
	const id = readNonEmptyString(raw, 'id');
	const timestamp = readIsoTimestamp(raw, 'timestamp');
	const workspaceId = readNonEmptyString(raw, 'workspace_id');
	const workspaceName = readString(raw, 'workspace_name');
	const subscriptionId = readNonEmptyString(raw, 'subscription_id');
	const integrationId = readNonEmptyString(raw, 'integration_id');
	const authors = normalizePrincipals(raw.authors);
	const accessibleBy =
		raw.accessible_by === undefined ? undefined : normalizePrincipals(raw.accessible_by);
	const attemptNumber = readPositiveInteger(raw, 'attempt_number');
	const apiVersion = readNonEmptyString(raw, 'api_version');
	if (
		!eventType ||
		!id ||
		!timestamp ||
		!workspaceId ||
		workspaceName === undefined ||
		!subscriptionId ||
		!integrationId ||
		!authors ||
		(raw.accessible_by !== undefined && !accessibleBy) ||
		attemptNumber === undefined ||
		!apiVersion
	) {
		return undefined;
	}
	if (!isEntity(raw.entity)) return undefined;

	if (KNOWN_EVENT_TYPES.has(eventType) && KNOWN_API_VERSIONS.has(apiVersion)) {
		if (!isKnownEventPayload(eventType, raw)) return undefined;
		return raw as NotionKnownWebhookEvent;
	}
	return {
		type: 'unknown',
		eventType,
		id,
		timestamp,
		workspaceId,
		workspaceName,
		subscriptionId,
		integrationId,
		authors,
		...(accessibleBy === undefined ? {} : { accessibleBy }),
		attemptNumber,
		apiVersion,
		raw,
	} satisfies NotionUnknownWebhookEvent;
}

function eventIdentity(event: NotionWebhookEvent): {
	workspaceId: string;
	subscriptionId: string;
	integrationId: string;
} {
	if (event.type === 'unknown') {
		return {
			workspaceId: event.workspaceId,
			subscriptionId: event.subscriptionId,
			integrationId: event.integrationId,
		};
	}
	return {
		workspaceId: event.workspace_id,
		subscriptionId: event.subscription_id,
		integrationId: event.integration_id,
	};
}

function normalizePrincipals(value: unknown): NotionWebhookPrincipal[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const principals: NotionWebhookPrincipal[] = [];
	for (const principal of value) {
		if (!isRecord(principal)) return undefined;
		const id = readNonEmptyString(principal, 'id');
		const type = principal.type;
		if (!id || (type !== 'agent' && type !== 'bot' && type !== 'person')) return undefined;
		principals.push({ id, type });
	}
	return principals;
}

function isEntity(value: unknown): boolean {
	if (!isRecord(value)) return false;
	return (
		readNonEmptyString(value, 'id') !== undefined && readNonEmptyString(value, 'type') !== undefined
	);
}

function isKnownEventPayload(eventType: string, raw: Record<string, unknown>): boolean {
	const entity = raw.entity;
	if (!isRecord(entity)) return false;

	if (eventType.startsWith('comment.')) {
		return (
			entity.type === 'comment' &&
			isRecord(raw.data) &&
			isExternalBlock(raw.data.parent) &&
			readNonEmptyString(raw.data, 'page_id') !== undefined
		);
	}

	if (eventType.startsWith('data_source.') || eventType.startsWith('database.')) {
		if (
			(entity.type !== 'block' && entity.type !== 'database' && entity.type !== 'data_source') ||
			!isRecord(raw.data) ||
			!isParentBlock(raw.data.parent)
		) {
			return false;
		}
		if (eventType.endsWith('content_updated')) {
			return isEntityArray(raw.data.updated_blocks);
		}
		if (eventType.endsWith('schema_updated')) {
			return (
				raw.data.updated_properties === undefined ||
				isUpdatedPropertyArray(raw.data.updated_properties)
			);
		}
		return true;
	}

	if (eventType.startsWith('file_upload.')) {
		if (entity.type !== 'file_upload') return false;
		if (eventType !== 'file_upload.upload_failed') return true;
		return isFileUploadFailureData(raw.data);
	}

	if (eventType.startsWith('page.')) {
		if (entity.type !== 'page' || !isRecord(raw.data)) return false;
		if (eventType === 'page.transcription_block.transcript_deleted') {
			return (
				isExternalBlock(raw.data.target) &&
				(raw.data.transcript_id === null || typeof raw.data.transcript_id === 'string')
			);
		}
		if (!isParentBlock(raw.data.parent)) return false;
		if (eventType === 'page.content_updated') {
			return isEntityArray(raw.data.updated_blocks);
		}
		if (eventType === 'page.properties_updated') {
			return isStringArray(raw.data.updated_properties);
		}
		return true;
	}

	if (eventType.startsWith('view.')) {
		if (entity.type !== 'view' || !isRecord(raw.data) || !isParentBlock(raw.data.parent)) {
			return false;
		}
		if (eventType === 'view.created') {
			return typeof raw.data.view_type === 'string';
		}
		if (eventType === 'view.updated') {
			return (
				Array.isArray(raw.data.updated_fields) &&
				raw.data.updated_fields.every(
					(field) =>
						field === 'name' ||
						field === 'filter' ||
						field === 'sorts' ||
						field === 'configuration',
				)
			);
		}
		return true;
	}

	return false;
}

function isExternalBlock(value: unknown): boolean {
	if (!isRecord(value) || readNonEmptyString(value, 'id') === undefined) return false;
	return value.type === 'page' || value.type === 'database' || value.type === 'block';
}

function isParentBlock(value: unknown): boolean {
	if (!isRecord(value) || readNonEmptyString(value, 'id') === undefined) return false;
	if (
		value.type !== 'space' &&
		value.type !== 'block' &&
		value.type !== 'page' &&
		value.type !== 'database' &&
		value.type !== 'team' &&
		value.type !== 'agent'
	) {
		return false;
	}
	return value.data_source_id === undefined || typeof value.data_source_id === 'string';
}

function isEntityArray(value: unknown): boolean {
	if (!Array.isArray(value)) return false;
	return value.every((item) => {
		if (!isRecord(item) || readNonEmptyString(item, 'id') === undefined) return false;
		return item.type === 'page' || item.type === 'database' || item.type === 'block';
	});
}

function isUpdatedPropertyArray(value: unknown): boolean {
	if (!Array.isArray(value)) return false;
	return value.every(
		(item) =>
			isRecord(item) &&
			readNonEmptyString(item, 'id') !== undefined &&
			(item.name === null || typeof item.name === 'string') &&
			(item.action === 'created' || item.action === 'updated' || item.action === 'deleted'),
	);
}

function isStringArray(value: unknown): boolean {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isFileUploadFailureData(value: unknown): boolean {
	if (!isRecord(value) || !isRecord(value.file_import_result)) return false;
	const result = value.file_import_result;
	if (typeof result.imported_time !== 'string') return false;
	if (result.type === 'success') return isRecord(result.success);
	if (result.type !== 'error' || !isRecord(result.error)) return false;
	return (
		(result.error.type === 'validation_error' ||
			result.error.type === 'internal_system_error' ||
			result.error.type === 'download_error' ||
			result.error.type === 'upload_error') &&
		typeof result.error.code === 'string' &&
		typeof result.error.message === 'string' &&
		(result.error.parameter === null || typeof result.error.parameter === 'string') &&
		(result.error.status_code === null ||
			(typeof result.error.status_code === 'number' && Number.isFinite(result.error.status_code)))
	);
}

async function runHandler(handler: () => NotionHandlerResult | undefined): Promise<Response> {
	try {
		return serializeHandlerResult(await handler());
	} catch {
		return response(500);
	}
}

function serializeHandlerResult(value: unknown): Response {
	if (value instanceof Response) return value;
	if (value === undefined) return response(200);
	if (!isJsonValue(value)) return response(500);
	return Response.json(value);
}

function parseSignature(value: string): Uint8Array | undefined {
	const match = /^sha256=([0-9a-fA-F]{64})$/.exec(value);
	const hex = match?.[1];
	if (!hex) return undefined;
	const bytes = new Uint8Array(32);
	for (let index = 0; index < bytes.length; index += 1) {
		bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
	}
	return bytes;
}

async function verifySignature(
	secret: Uint8Array,
	body: Uint8Array,
	signature: Uint8Array,
): Promise<boolean> {
	const key = await crypto.subtle.importKey(
		'raw',
		toArrayBuffer(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['verify'],
	);
	return crypto.subtle.verify('HMAC', key, toArrayBuffer(signature), toArrayBuffer(body));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.slice().buffer;
}

function parseJson(body: Uint8Array): unknown {
	try {
		const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (typeof value !== 'object') return false;
	if (seen.has(value)) return false;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonEmptyString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === 'string' ? value : undefined;
}

function readIsoTimestamp(record: Record<string, unknown>, key: string): string | undefined {
	const value = readNonEmptyString(record, key);
	return value && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function readPositiveInteger(record: Record<string, unknown>, key: string): number | undefined {
	const value = record[key];
	return Number.isSafeInteger(value) && (value as number) >= 1 ? (value as number) : undefined;
}

function response(status: number): Response {
	return new Response(null, { status });
}
