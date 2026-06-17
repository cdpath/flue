import { registerProvider } from '@flue/runtime';
import { flue } from '@flue/runtime/routing';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

// Drive the chat with a real model. The endpoint is Anthropic Messages-API
// compatible (Zhipu GLM via its /api/anthropic gateway), so we override the
// catalog `anthropic` provider's transport and point it at that base URL.
// The base URL omits a trailing `/v1` on purpose: the Anthropic SDK that pi-ai
// uses appends `/v1/messages` itself. Secrets are injected at runtime via the
// docker-compose env_file, never baked into the image.
registerProvider('anthropic', {
	baseUrl: process.env.ANTHROPIC_BASE_URL ?? 'https://open.bigmodel.cn/api/anthropic',
	apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
	// glm-5.2 isn't in pi-ai's catalog, so it resolves with zeroed token
	// budgets; supply non-zero values or requests would send max_tokens: 0.
	contextWindow: 128_000,
	maxTokens: 8_192,
});

const app = new Hono();
app.route('/api', flue());
app.use('*', serveStatic({ root: './dist/client' }));
app.get('*', serveStatic({ path: './dist/client/index.html' }));

export default app;
