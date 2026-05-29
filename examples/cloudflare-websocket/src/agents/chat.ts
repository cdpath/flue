import { createAgent, type AgentWebSocketHandler } from '@flue/runtime';

export const websocket: AgentWebSocketHandler = async (_c, next) => next();

export default createAgent(() => ({
	model: 'cloudflare/@cf/moonshotai/kimi-k2.6',
}));
