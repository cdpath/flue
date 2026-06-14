import type { WhatsAppConversationRef } from '@flue/whatsapp';
import type { SendMessageResponse, WhatsAppClient } from '@kapso/whatsapp-cloud-api';

export function sendTextMessage(
	client: WhatsAppClient,
	ref: WhatsAppConversationRef,
	body: string,
): Promise<SendMessageResponse> {
	if (ref.type === 'group') {
		return client.messages.sendText({
			phoneNumberId: ref.phoneNumberId,
			recipientType: 'group',
			to: ref.groupId,
			body,
		});
	}
	if (ref.destination.type === 'phone-number') {
		return client.messages.sendText({
			phoneNumberId: ref.phoneNumberId,
			recipientType: 'individual',
			to: ref.destination.phoneNumber,
			body,
		});
	}
	return client.request<SendMessageResponse>('POST', `${ref.phoneNumberId}/messages`, {
		body: {
			messaging_product: 'whatsapp',
			recipient_type: 'individual',
			recipient: ref.destination.userId,
			type: 'text',
			text: { body },
		},
		responseType: 'json',
	});
}
