import { type AgentRouteHandler, createAgent } from '@flue/runtime';

// Opt the agent into the HTTP transport so the React UI can reach it at
// POST /api/agents/assistant/:id. A bare createAgent default export is
// dispatch-only; exporting a (pass-through) route is what flips on http.
export const route: AgentRouteHandler = async (_c, next) => next();

// Model id comes from ~/.claude/settings.json (ANTHROPIC_DEFAULT_SONNET_MODEL = glm-5.2).
// Transport (base URL + API key) is configured on the `anthropic` provider in app.ts.
export default createAgent(() => ({
	model: process.env.FLUE_MODEL ?? 'anthropic/glm-5.2',
	instructions: 'You are a helpful assistant. Reply clearly and concisely.',
}));
