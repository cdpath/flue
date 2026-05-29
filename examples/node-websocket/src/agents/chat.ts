import { createAgent, type AgentWebSocketHandler } from '@flue/runtime';

export const websocket: AgentWebSocketHandler = async (_c, next) => next();

export default createAgent(() => ({
	model: 'anthropic/claude-haiku-4-5',
}));
