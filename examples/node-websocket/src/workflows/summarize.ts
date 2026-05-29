import { createAgent, type FlueContext, type WorkflowWebSocketHandler } from '@flue/runtime';

export const websocket: WorkflowWebSocketHandler = async (_c, next) => next();

const agent = createAgent(() => ({
	model: 'anthropic/claude-haiku-4-5',
}));

export async function run({ init, payload }: FlueContext) {
	const harness = await init(agent);
	const session = await harness.session();
	const text = typeof payload === 'object' && payload !== null && 'text' in payload ? String(payload.text) : '';
	return session.prompt(`Summarize this text in one sentence: ${text}`);
}
