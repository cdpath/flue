import type { FlueContext, WorkflowWebSocketHandler } from '@flue/runtime';

export const websocket: WorkflowWebSocketHandler = async (_c, next) => next();

export async function run({ payload, log }: FlueContext) {
	const marker = typeof payload === 'object' && payload !== null && 'marker' in payload ? String(payload.marker) : '';
	log.info('cloudflare websocket live smoke', { marker });
	return { echoed: marker };
}
