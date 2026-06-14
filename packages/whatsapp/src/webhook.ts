import type { Env, Handler } from 'hono';
import type {
	JsonValue,
	WhatsAppChannelOptions,
	WhatsAppConversationRef,
	WhatsAppErrorRef,
	WhatsAppHandlerResult,
	WhatsAppMedia,
	WhatsAppMessage,
	WhatsAppMessageContext,
	WhatsAppMessageSenderIdentity,
	WhatsAppReferral,
	WhatsAppSharedContact,
	WhatsAppStatusEvent,
	WhatsAppUserRef,
	WhatsAppWebhookDelivery,
	WhatsAppWebhookEvent,
} from './index.ts';

const DEFAULT_BODY_LIMIT = 3 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export function createWhatsAppVerificationHandler<E extends Env>(
	options: WhatsAppChannelOptions<E>,
): Handler<E> {
	const expectedTokenDigest = digest(options.verifyToken);
	return async (c) => {
		const url = new URL(c.req.url);
		const mode = readSingleQuery(url, 'hub.mode');
		const challenge = readSingleQuery(url, 'hub.challenge');
		const token = readSingleQuery(url, 'hub.verify_token');
		if (mode === undefined || challenge === undefined || token === undefined) {
			return response(400);
		}
		if (mode !== 'subscribe' || challenge.length === 0) return response(400);
		if (!(await secureEqual(await expectedTokenDigest, await digest(token)))) {
			return response(403);
		}
		return new Response(challenge, {
			status: 200,
			headers: { 'content-type': 'text/plain; charset=UTF-8' },
		});
	};
}

export function createWhatsAppWebhookHandler<E extends Env>(
	options: WhatsAppChannelOptions<E>,
): Handler<E> {
	const bodyLimit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;
	if (!Number.isSafeInteger(bodyLimit) || bodyLimit <= 0) {
		throw new TypeError('WhatsApp webhook bodyLimit must be a positive integer.');
	}
	const appSecret = encoder.encode(options.appSecret);

	return async (c) => {
		const request = c.req.raw;
		if (!isJsonRequest(request)) return response(415);
		const signature = parseSignature(request.headers.get('x-hub-signature-256'));
		if (!signature) return response(401);

		const body = await readBody(request, bodyLimit);
		if (body.type === 'too-large') return response(413);
		if (body.type === 'invalid') return response(400);
		if (!(await verifySignature(appSecret, body.value, signature))) {
			return response(401);
		}

		const raw = parseJson(body.value);
		if (!isRecord(raw)) return response(400);
		const normalized = normalizeDelivery(raw, options);
		if (normalized.type === 'forbidden') return response(403);
		if (normalized.type === 'invalid') return response(400);

		let result: WhatsAppHandlerResult;
		try {
			result = await options.webhook({ c, delivery: normalized.delivery });
		} catch {
			return response(500);
		}
		return serializeHandlerResult(result);
	};
}

type NormalizedDelivery =
	| { type: 'ok'; delivery: WhatsAppWebhookDelivery }
	| { type: 'forbidden' }
	| { type: 'invalid' };

function normalizeDelivery<E extends Env>(
	raw: Record<string, unknown>,
	options: WhatsAppChannelOptions<E>,
): NormalizedDelivery {
	if (raw.object !== 'whatsapp_business_account' || !Array.isArray(raw.entry)) {
		return { type: 'invalid' };
	}
	const events: WhatsAppWebhookEvent[] = [];
	for (let entryIndex = 0; entryIndex < raw.entry.length; entryIndex += 1) {
		const entry = raw.entry[entryIndex];
		if (!isRecord(entry)) return { type: 'invalid' };
		const businessAccountId = readNonEmptyString(entry, 'id');
		if (!businessAccountId || !Array.isArray(entry.changes)) {
			return { type: 'invalid' };
		}
		if (businessAccountId !== options.businessAccountId) {
			return { type: 'forbidden' };
		}
		for (let changeIndex = 0; changeIndex < entry.changes.length; changeIndex += 1) {
			const change = entry.changes[changeIndex];
			if (!isRecord(change)) return { type: 'invalid' };
			const field = readNonEmptyString(change, 'field');
			const value = readRecord(change, 'value');
			if (!field || !value) return { type: 'invalid' };
			if (field !== 'messages') {
				events.push({
					type: 'unknown',
					field,
					businessAccountId,
					entryIndex,
					changeIndex,
					raw: change,
				});
				continue;
			}
			if (value.messaging_product !== 'whatsapp') return { type: 'invalid' };
			const metadata = readRecord(value, 'metadata');
			const phoneNumberId = metadata ? readNonEmptyString(metadata, 'phone_number_id') : undefined;
			const displayPhoneNumber = metadata
				? readNonEmptyString(metadata, 'display_phone_number')
				: undefined;
			if (!phoneNumberId || !displayPhoneNumber) return { type: 'invalid' };
			if (phoneNumberId !== options.phoneNumberId) {
				return { type: 'forbidden' };
			}
			const contacts = normalizeSenderContacts(value.contacts);
			if (contacts === null) return { type: 'invalid' };

			if (value.messages !== undefined && !Array.isArray(value.messages)) {
				return { type: 'invalid' };
			}
			if (Array.isArray(value.messages)) {
				for (let itemIndex = 0; itemIndex < value.messages.length; itemIndex += 1) {
					const messageRaw = value.messages[itemIndex];
					if (!isRecord(messageRaw)) return { type: 'invalid' };
					const message = normalizeMessage(messageRaw);
					if (!message) return { type: 'invalid' };
					const sender = senderForMessage(message, contacts);
					if (!sender) return { type: 'invalid' };
					const conversation = conversationForMessage(message, businessAccountId, phoneNumberId);
					if (!conversation) return { type: 'invalid' };
					events.push({
						type: 'message',
						businessAccountId,
						phoneNumberId,
						displayPhoneNumber,
						entryIndex,
						changeIndex,
						itemIndex,
						sender,
						message,
						conversation,
						raw: messageRaw,
					});
				}
			}

			if (value.statuses !== undefined && !Array.isArray(value.statuses)) {
				return { type: 'invalid' };
			}
			if (Array.isArray(value.statuses)) {
				for (let itemIndex = 0; itemIndex < value.statuses.length; itemIndex += 1) {
					const statusRaw = value.statuses[itemIndex];
					if (!isRecord(statusRaw)) return { type: 'invalid' };
					const status = normalizeStatus(
						statusRaw,
						businessAccountId,
						phoneNumberId,
						displayPhoneNumber,
						entryIndex,
						changeIndex,
						itemIndex,
					);
					if (!status) return { type: 'invalid' };
					events.push(status);
				}
			}

			if (value.messages === undefined && value.statuses === undefined) {
				events.push({
					type: 'unknown',
					field,
					businessAccountId,
					phoneNumberId,
					displayPhoneNumber,
					entryIndex,
					changeIndex,
					raw: change,
				});
			}
		}
	}
	return {
		type: 'ok',
		delivery: {
			object: 'whatsapp_business_account',
			events,
			raw,
		},
	};
}

function normalizeMessage(raw: Record<string, unknown>): WhatsAppMessage | undefined {
	const id = readNonEmptyString(raw, 'id');
	const from = readNonEmptyString(raw, 'from');
	const fromUserId = readNonEmptyString(raw, 'from_user_id');
	const fromParentUserId = readNonEmptyString(raw, 'from_parent_user_id');
	const timestamp = readUnixTimestamp(raw, 'timestamp');
	const messageType = readNonEmptyString(raw, 'type');
	if (
		!id ||
		(!from && !fromUserId) ||
		(raw.from !== undefined && !from) ||
		(raw.from_user_id !== undefined && !fromUserId) ||
		(raw.from_parent_user_id !== undefined && !fromParentUserId) ||
		timestamp === undefined ||
		!messageType
	) {
		return undefined;
	}
	const groupId = readOptionalString(raw, 'group_id');
	if (raw.group_id !== undefined && !groupId) return undefined;
	const context = normalizeContext(raw.context);
	if (context === null) return undefined;
	const referral = normalizeReferral(raw.referral);
	if (referral === null) return undefined;
	let identity: WhatsAppMessageSenderIdentity;
	if (fromUserId) {
		identity = {
			...(from === undefined ? {} : { from }),
			fromUserId,
			...(fromParentUserId === undefined ? {} : { fromParentUserId }),
		};
	} else {
		if (!from) return undefined;
		identity = {
			from,
			...(fromParentUserId === undefined ? {} : { fromParentUserId }),
		};
	}
	const base = {
		id,
		...identity,
		timestamp,
		...(groupId === undefined ? {} : { groupId }),
		...(context === undefined ? {} : { context }),
		...(referral === undefined ? {} : { referral }),
	};

	if (messageType === 'text') {
		const text = readRecord(raw, 'text');
		const body = text ? readString(text, 'body') : undefined;
		return body === undefined ? undefined : { ...base, kind: 'text', text: body };
	}
	if (
		messageType === 'audio' ||
		messageType === 'document' ||
		messageType === 'image' ||
		messageType === 'sticker' ||
		messageType === 'video'
	) {
		const media = normalizeMedia(messageType, readRecord(raw, messageType));
		return media ? { ...base, kind: 'media', media } : undefined;
	}
	if (messageType === 'location') {
		const location = readRecord(raw, 'location');
		const latitude = location ? readFiniteNumber(location, 'latitude') : undefined;
		const longitude = location ? readFiniteNumber(location, 'longitude') : undefined;
		if (!location || latitude === undefined || longitude === undefined) {
			return undefined;
		}
		return {
			...base,
			kind: 'location',
			location: {
				latitude,
				longitude,
				...optionalStringProperty(location, 'name'),
				...optionalStringProperty(location, 'address'),
				...optionalStringProperty(location, 'url'),
			},
		};
	}
	if (messageType === 'contacts') {
		const contacts = normalizeSharedContacts(raw.contacts);
		return contacts ? { ...base, kind: 'contacts', contacts } : undefined;
	}
	if (messageType === 'interactive') {
		const interactive = readRecord(raw, 'interactive');
		const replyType = interactive ? readNonEmptyString(interactive, 'type') : undefined;
		if (!interactive || (replyType !== 'button_reply' && replyType !== 'list_reply')) {
			return undefined;
		}
		const reply = readRecord(interactive, replyType);
		const replyId = reply ? readNonEmptyString(reply, 'id') : undefined;
		const title = reply ? readString(reply, 'title') : undefined;
		if (!reply || !replyId || title === undefined) return undefined;
		const description = readOptionalString(reply, 'description');
		return {
			...base,
			kind: 'interactive',
			reply: {
				type: replyType,
				id: replyId,
				title,
				...(description === undefined ? {} : { description }),
			},
		};
	}
	if (messageType === 'button') {
		const button = readRecord(raw, 'button');
		const payload = button ? readString(button, 'payload') : undefined;
		const text = button ? readString(button, 'text') : undefined;
		return payload === undefined || text === undefined
			? undefined
			: { ...base, kind: 'button', button: { payload, text } };
	}
	if (messageType === 'reaction') {
		const reaction = readRecord(raw, 'reaction');
		const messageId = reaction ? readNonEmptyString(reaction, 'message_id') : undefined;
		if (!reaction || !messageId) return undefined;
		const emoji = readOptionalString(reaction, 'emoji');
		return {
			...base,
			kind: 'reaction',
			reaction: {
				messageId,
				action: emoji === undefined ? 'remove' : 'add',
				...(emoji === undefined ? {} : { emoji }),
			},
		};
	}
	if (messageType === 'revoke') {
		const revoke = readRecord(raw, 'revoke');
		const originalMessageId = revoke
			? readNonEmptyString(revoke, 'original_message_id')
			: undefined;
		return originalMessageId ? { ...base, kind: 'revoke', originalMessageId } : undefined;
	}
	if (messageType === 'unsupported') {
		const unsupported = readRecord(raw, 'unsupported');
		const unsupportedType = unsupported ? readOptionalString(unsupported, 'type') : undefined;
		const errors = normalizeErrors(raw.errors);
		if (!errors) return undefined;
		return {
			...base,
			kind: 'unsupported',
			...(unsupportedType === undefined ? {} : { unsupportedType }),
			errors,
		};
	}
	return { ...base, kind: 'unknown', messageType };
}

function normalizeMedia(
	type: WhatsAppMedia['type'],
	raw: Record<string, unknown> | undefined,
): WhatsAppMedia | undefined {
	if (!raw) return undefined;
	const id = readNonEmptyString(raw, 'id');
	if (!id) return undefined;
	return {
		type,
		id,
		...optionalRenamedStringProperty(raw, 'mime_type', 'mimeType'),
		...optionalStringProperty(raw, 'sha256'),
		...optionalStringProperty(raw, 'caption'),
		...optionalStringProperty(raw, 'filename'),
		...(typeof raw.voice === 'boolean' ? { voice: raw.voice } : {}),
	};
}

function normalizeStatus(
	raw: Record<string, unknown>,
	businessAccountId: string,
	phoneNumberId: string,
	displayPhoneNumber: string,
	entryIndex: number,
	changeIndex: number,
	itemIndex: number,
): WhatsAppStatusEvent | undefined {
	const messageId = readNonEmptyString(raw, 'id');
	const providerState = readNonEmptyString(raw, 'status');
	const timestamp = readUnixTimestamp(raw, 'timestamp');
	const recipientId = readNonEmptyString(raw, 'recipient_id');
	const recipientUserId = readNonEmptyString(raw, 'recipient_user_id');
	const recipientParentUserId = readNonEmptyString(raw, 'recipient_parent_user_id');
	if (
		!messageId ||
		!providerState ||
		timestamp === undefined ||
		(!recipientId && !recipientUserId) ||
		(raw.recipient_id !== undefined && !recipientId) ||
		(raw.recipient_user_id !== undefined && !recipientUserId) ||
		(raw.recipient_parent_user_id !== undefined && !recipientParentUserId)
	) {
		return undefined;
	}
	const recipientType = readOptionalString(raw, 'recipient_type');
	if (recipientType !== undefined && recipientType !== 'group' && recipientType !== 'individual') {
		return undefined;
	}
	let conversation: WhatsAppConversationRef;
	if (recipientType === 'group') {
		if (!recipientId) return undefined;
		conversation = { type: 'group', businessAccountId, phoneNumberId, groupId: recipientId };
	} else if (recipientUserId) {
		conversation = {
			type: 'individual',
			businessAccountId,
			phoneNumberId,
			destination: { type: 'user-id', userId: recipientUserId },
		};
	} else {
		if (!recipientId) return undefined;
		conversation = {
			type: 'individual',
			businessAccountId,
			phoneNumberId,
			destination: { type: 'phone-number', phoneNumber: recipientId },
		};
	}
	const conversationObject = readRecord(raw, 'conversation');
	const origin = conversationObject ? readRecord(conversationObject, 'origin') : undefined;
	const errors = normalizeErrors(raw.errors);
	if (!errors) return undefined;
	const knownStates = new Set(['delivered', 'failed', 'played', 'read', 'sent']);
	return {
		type: 'status',
		businessAccountId,
		phoneNumberId,
		displayPhoneNumber,
		entryIndex,
		changeIndex,
		itemIndex,
		status: {
			messageId,
			state: knownStates.has(providerState)
				? (providerState as 'delivered' | 'failed' | 'played' | 'read' | 'sent')
				: 'unknown',
			providerState,
			timestamp,
			...(recipientId === undefined ? {} : { recipientId }),
			...(recipientUserId === undefined ? {} : { recipientUserId }),
			...(recipientParentUserId === undefined ? {} : { recipientParentUserId }),
			...optionalRenamedStringProperty(raw, 'recipient_participant_id', 'recipientParticipantId'),
			...optionalRenamedStringProperty(
				raw,
				'recipient_participant_user_id',
				'recipientParticipantUserId',
			),
			...optionalRenamedStringProperty(
				raw,
				'recipient_participant_parent_user_id',
				'recipientParticipantParentUserId',
			),
			...optionalRenamedStringProperty(raw, 'biz_opaque_callback_data', 'opaqueCallbackData'),
			...(conversationObject
				? optionalRenamedStringProperty(conversationObject, 'id', 'conversationId')
				: {}),
			...(origin ? optionalRenamedStringProperty(origin, 'type', 'conversationCategory') : {}),
			errors,
		},
		conversation,
		raw,
	};
}

function conversationForMessage(
	message: WhatsAppMessage,
	businessAccountId: string,
	phoneNumberId: string,
): WhatsAppConversationRef | undefined {
	if (message.groupId) {
		return {
			type: 'group',
			businessAccountId,
			phoneNumberId,
			groupId: message.groupId,
		};
	}
	if (message.fromUserId) {
		return {
			type: 'individual',
			businessAccountId,
			phoneNumberId,
			destination: { type: 'user-id', userId: message.fromUserId },
		};
	}
	if (!message.from) return undefined;
	return {
		type: 'individual',
		businessAccountId,
		phoneNumberId,
		destination: { type: 'phone-number', phoneNumber: message.from },
	};
}

interface SenderContact {
	phoneNumber?: string;
	userId?: string;
	parentUserId?: string;
	profileName?: string;
	username?: string;
}

function normalizeSenderContacts(value: unknown): readonly SenderContact[] | null {
	if (value === undefined) return [];
	if (!Array.isArray(value)) return null;
	const contacts: SenderContact[] = [];
	for (const raw of value) {
		if (!isRecord(raw)) return null;
		const phoneNumber = readNonEmptyString(raw, 'wa_id');
		const userId = readNonEmptyString(raw, 'user_id');
		const parentUserId = readNonEmptyString(raw, 'parent_user_id');
		const profile = readRecord(raw, 'profile');
		if (
			(!phoneNumber && !userId) ||
			(raw.wa_id !== undefined && !phoneNumber) ||
			(raw.user_id !== undefined && !userId) ||
			(raw.parent_user_id !== undefined && !parentUserId) ||
			(raw.profile !== undefined && !profile)
		) {
			return null;
		}
		const profileName = profile ? readOptionalString(profile, 'name') : undefined;
		const username = profile ? readOptionalString(profile, 'username') : undefined;
		if (
			(profile?.name !== undefined && profileName === undefined) ||
			(profile?.username !== undefined && username === undefined)
		) {
			return null;
		}
		contacts.push({
			...(phoneNumber === undefined ? {} : { phoneNumber }),
			...(userId === undefined ? {} : { userId }),
			...(parentUserId === undefined ? {} : { parentUserId }),
			...(profileName === undefined ? {} : { profileName }),
			...(username === undefined ? {} : { username }),
		});
	}
	return contacts;
}

function senderForMessage(
	message: WhatsAppMessage,
	contacts: readonly SenderContact[],
): WhatsAppUserRef | undefined {
	const contact = contacts.find((candidate) => {
		const sharesIdentity =
			(message.from !== undefined && candidate.phoneNumber === message.from) ||
			(message.fromUserId !== undefined && candidate.userId === message.fromUserId);
		if (!sharesIdentity) return false;
		if (
			message.from !== undefined &&
			candidate.phoneNumber !== undefined &&
			message.from !== candidate.phoneNumber
		) {
			return false;
		}
		if (
			message.fromUserId !== undefined &&
			candidate.userId !== undefined &&
			message.fromUserId !== candidate.userId
		) {
			return false;
		}
		if (
			message.fromParentUserId !== undefined &&
			candidate.parentUserId !== undefined &&
			message.fromParentUserId !== candidate.parentUserId
		) {
			return false;
		}
		return true;
	});
	if (contacts.length > 0 && !contact) return undefined;
	const phoneNumber = contact?.phoneNumber ?? message.from;
	const userId = contact?.userId ?? message.fromUserId;
	const parentUserId = contact?.parentUserId ?? message.fromParentUserId;
	if (!phoneNumber && !userId) return undefined;
	const metadata = {
		...(parentUserId === undefined ? {} : { parentUserId }),
		...(contact?.profileName === undefined ? {} : { profileName: contact.profileName }),
		...(contact?.username === undefined ? {} : { username: contact.username }),
	};
	if (userId) {
		return {
			...metadata,
			...(phoneNumber === undefined ? {} : { phoneNumber }),
			userId,
		};
	}
	if (!phoneNumber) return undefined;
	return {
		...metadata,
		phoneNumber,
	};
}

function normalizeContext(value: unknown): WhatsAppMessageContext | null | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) return null;
	const messageId = readOptionalString(value, 'id');
	const from = readOptionalString(value, 'from');
	if (
		(value.id !== undefined && messageId === undefined) ||
		(value.from !== undefined && from === undefined) ||
		(value.forwarded !== undefined && typeof value.forwarded !== 'boolean') ||
		(value.frequently_forwarded !== undefined && typeof value.frequently_forwarded !== 'boolean')
	) {
		return null;
	}
	return {
		...(messageId === undefined ? {} : { messageId }),
		...(from === undefined ? {} : { from }),
		...(typeof value.forwarded === 'boolean' ? { forwarded: value.forwarded } : {}),
		...(typeof value.frequently_forwarded === 'boolean'
			? { frequentlyForwarded: value.frequently_forwarded }
			: {}),
	};
}

function normalizeReferral(value: unknown): WhatsAppReferral | null | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) return null;
	return {
		...optionalRenamedStringProperty(value, 'source_type', 'sourceType'),
		...optionalRenamedStringProperty(value, 'source_id', 'sourceId'),
		...optionalRenamedStringProperty(value, 'source_url', 'sourceUrl'),
		...optionalStringProperty(value, 'body'),
		...optionalStringProperty(value, 'headline'),
		...optionalRenamedStringProperty(value, 'media_type', 'mediaType'),
	};
}

function normalizeSharedContacts(value: unknown): readonly WhatsAppSharedContact[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const contacts: WhatsAppSharedContact[] = [];
	for (const raw of value) {
		if (!isRecord(raw)) return undefined;
		const name = readRecord(raw, 'name');
		const formattedName = name ? readNonEmptyString(name, 'formatted_name') : undefined;
		if (!name || !formattedName) return undefined;
		const phones = normalizeOptionalArray(raw.phones, (phone) => {
			if (!isRecord(phone)) return undefined;
			const value = {
				...optionalStringProperty(phone, 'phone'),
				...optionalRenamedStringProperty(phone, 'wa_id', 'userId'),
				...optionalStringProperty(phone, 'type'),
			};
			return Object.keys(value).length === 0 ? undefined : value;
		});
		const emails = normalizeOptionalArray(raw.emails, (email) => {
			if (!isRecord(email)) return undefined;
			const address = readNonEmptyString(email, 'email');
			return address ? { email: address, ...optionalStringProperty(email, 'type') } : undefined;
		});
		const addresses = normalizeOptionalArray(raw.addresses, (address) => {
			if (!isRecord(address)) return undefined;
			const normalized = {
				...optionalStringProperty(address, 'street'),
				...optionalStringProperty(address, 'city'),
				...optionalStringProperty(address, 'state'),
				...optionalStringProperty(address, 'zip'),
				...optionalStringProperty(address, 'country'),
				...optionalRenamedStringProperty(address, 'country_code', 'countryCode'),
				...optionalStringProperty(address, 'type'),
			};
			return Object.keys(normalized).length === 0 ? undefined : normalized;
		});
		const urls = normalizeOptionalArray(raw.urls, (url) => {
			if (!isRecord(url)) return undefined;
			const href = readNonEmptyString(url, 'url');
			return href ? { url: href, ...optionalStringProperty(url, 'type') } : undefined;
		});
		if (!phones || !emails || !addresses || !urls) return undefined;
		const organizationRaw = readRecord(raw, 'org');
		const organization = organizationRaw
			? {
					...optionalStringProperty(organizationRaw, 'company'),
					...optionalStringProperty(organizationRaw, 'department'),
					...optionalStringProperty(organizationRaw, 'title'),
				}
			: undefined;
		const birthday = readOptionalString(raw, 'birthday');
		contacts.push({
			name: {
				formattedName,
				...optionalRenamedStringProperty(name, 'first_name', 'firstName'),
				...optionalRenamedStringProperty(name, 'last_name', 'lastName'),
				...optionalRenamedStringProperty(name, 'middle_name', 'middleName'),
				...optionalStringProperty(name, 'prefix'),
				...optionalStringProperty(name, 'suffix'),
			},
			...(birthday === undefined ? {} : { birthday }),
			phones,
			emails,
			...(organization && Object.keys(organization).length > 0 ? { organization } : {}),
			addresses,
			urls,
		});
	}
	return contacts;
}

function normalizeOptionalArray<T>(
	value: unknown,
	normalize: (value: unknown) => T | undefined,
): readonly T[] | undefined {
	if (value === undefined) return [];
	if (!Array.isArray(value)) return undefined;
	const result: T[] = [];
	for (const item of value) {
		const normalized = normalize(item);
		if (normalized === undefined) return undefined;
		result.push(normalized);
	}
	return result;
}

function normalizeErrors(value: unknown): readonly WhatsAppErrorRef[] | undefined {
	if (value === undefined) return [];
	if (!Array.isArray(value)) return undefined;
	const errors: WhatsAppErrorRef[] = [];
	for (const raw of value) {
		if (!isRecord(raw)) return undefined;
		const code = readSafeInteger(raw, 'code');
		if (code === undefined) return undefined;
		const errorData = readRecord(raw, 'error_data');
		errors.push({
			code,
			...optionalStringProperty(raw, 'title'),
			...optionalStringProperty(raw, 'message'),
			...(errorData ? optionalRenamedStringProperty(errorData, 'details', 'details') : {}),
			...optionalStringProperty(raw, 'href'),
		});
	}
	return errors;
}

function readSingleQuery(url: URL, name: string): string | undefined {
	const values = url.searchParams.getAll(name);
	return values.length === 1 ? values[0] : undefined;
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
): Promise<{ type: 'ok'; value: Uint8Array } | { type: 'too-large' } | { type: 'invalid' }> {
	const contentLength = request.headers.get('content-length');
	if (contentLength !== null) {
		if (!/^\d+$/.test(contentLength)) return { type: 'invalid' };
		if (Number(contentLength) > bodyLimit) return { type: 'too-large' };
	}
	if (!request.body) return { type: 'ok', value: new Uint8Array() };
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
	return { type: 'ok', value: body };
}

function parseJson(body: Uint8Array): unknown {
	try {
		return JSON.parse(decoder.decode(body));
	} catch {
		return undefined;
	}
}

function parseSignature(value: string | null): Uint8Array | undefined {
	const match = /^sha256=([0-9a-fA-F]{64})$/.exec(value ?? '');
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

async function digest(value: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

function secureEqual(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) return false;
	let difference = 0;
	for (let index = 0; index < left.byteLength; index += 1) {
		difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
	}
	return difference === 0;
}

function serializeHandlerResult(value: unknown): Response {
	if (value instanceof Response) return value;
	if (value === undefined) return response(200);
	if (!isJsonValue(value)) return response(500);
	return Response.json(value);
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') {
		return true;
	}
	if (typeof value === 'number') return Number.isFinite(value);
	if (typeof value !== 'object') return false;
	if (seen.has(value)) return false;
	if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
		return false;
	}
	seen.add(value);
	try {
		return Array.isArray(value)
			? value.every((item) => isJsonValue(item, seen))
			: Object.values(value).every((item) => isJsonValue(item, seen));
	} finally {
		seen.delete(value);
	}
}

function optionalStringProperty(
	value: Record<string, unknown>,
	key: string,
): Record<string, string> {
	const item = readOptionalString(value, key);
	return item === undefined ? {} : { [key]: item };
}

function optionalRenamedStringProperty(
	value: Record<string, unknown>,
	key: string,
	output: string,
): Record<string, string> {
	const item = readOptionalString(value, key);
	return item === undefined ? {} : { [output]: item };
}

function readRecord(
	value: Record<string, unknown>,
	key: string,
): Record<string, unknown> | undefined {
	const item = value[key];
	return isRecord(item) ? item : undefined;
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
	return typeof value[key] === 'string' ? value[key] : undefined;
}

function readNonEmptyString(value: Record<string, unknown>, key: string): string | undefined {
	const item = readString(value, key);
	return item && item.trim() === item ? item : undefined;
}

function readOptionalString(value: Record<string, unknown>, key: string): string | undefined {
	const item = value[key];
	return item === undefined || typeof item !== 'string' ? undefined : item;
}

function readSafeInteger(value: Record<string, unknown>, key: string): number | undefined {
	const item = value[key];
	return Number.isSafeInteger(item) ? (item as number) : undefined;
}

function readFiniteNumber(value: Record<string, unknown>, key: string): number | undefined {
	const item = value[key];
	return typeof item === 'number' && Number.isFinite(item) ? item : undefined;
}

function readUnixTimestamp(value: Record<string, unknown>, key: string): number | undefined {
	const item = value[key];
	if (typeof item !== 'string' || !/^\d+$/.test(item)) return undefined;
	const parsed = Number(item);
	return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return (
		typeof value === 'object' &&
		value !== null &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return bytes.slice().buffer;
}

function response(status: number): Response {
	return new Response(null, { status });
}
