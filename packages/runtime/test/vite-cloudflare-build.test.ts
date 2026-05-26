import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createServer } from 'vite';
import { describe, expect, it } from 'vitest';
import { build, cloudflareViteConfigPath, cloudflareViteInputDir, createCloudflareViteConfig } from '../../cli/src/lib/build.ts';

describe('Cloudflare Vite production Worker', () => {
	it('builds deployable official-plugin output from the production Cloudflare target', async () => {
		const { root, output } = await createGeneratedFixture('build');
		const inputConfig = JSON.parse(fs.readFileSync(cloudflareViteConfigPath(root), 'utf8')) as { main?: string; durable_objects?: { bindings?: Array<{ class_name: string }> } };
		expect(inputConfig.main).toBe('.flue-vite/_entry.ts');
		expect(inputConfig.durable_objects?.bindings?.map((binding) => binding.class_name)).toEqual(expect.arrayContaining(['Assistant', 'Reviewer', 'SelfReviewer', 'FailingReviewer', 'SmokeWorkflow', 'FlueRegistry']));
		const outputConfigs = fs.readdirSync(output, { recursive: true }).filter((entry) => String(entry).endsWith('wrangler.json'));
		expect(outputConfigs).not.toHaveLength(0);
		const deployRedirect = JSON.parse(fs.readFileSync(path.join(root, '.wrangler', 'deploy', 'config.json'), 'utf8')) as { configPath?: string };
		expect(deployRedirect.configPath).toContain('wrangler.json');
		expect(deployRedirect.configPath).not.toContain('wrangler.jsonc');
	}, 90000);

	it('does not retain Cloudflare environment selection after building', async () => {
		const previous = process.env.CLOUDFLARE_ENV;
		delete process.env.CLOUDFLARE_ENV;
		try {
			await createGeneratedFixture('development');
			expect(process.env.CLOUDFLARE_ENV).toBeUndefined();
		} finally {
			if (previous === undefined) delete process.env.CLOUDFLARE_ENV;
			else process.env.CLOUDFLARE_ENV = previous;
		}
	}, 90000);

	it('serves workflows and activates packaged skills through workerd in Vite development', async () => {
		const { root } = await createGeneratedFixture('development');
		const entryPath = path.join(cloudflareViteInputDir(root), '_entry.ts');
		const viteConfig = createCloudflareViteConfig(root, cloudflareViteConfigPath(root), [entryPath], { persistState: false });
		const server = await createServer({
			...viteConfig,
			logLevel: 'silent',
			server: { host: '127.0.0.1', port: 0 },
		});
		try {
			await server.listen();
			const localUrl = server.resolvedUrls?.local[0];
			if (!localUrl) throw new Error('Vite server URL unavailable');
			const response = await fetch(new URL('/workflows/smoke?wait=result', localUrl), { method: 'POST' });
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({
				result: {
					ok: true,
					reference: { __flueSkillReference: true, name: 'review', description: 'Reviews requested work.' },
					hasBody: false,
					hasFiles: false,
				},
			});
			const skillResponse = await fetch(new URL('/workflows/use-skill?wait=result', localUrl), { method: 'POST' });
			expect(skillResponse.status).toBe(200);
			expect(await skillResponse.json()).toMatchObject({ result: { text: 'License terms.\n' } });
			const namedSkillResponse = await fetch(new URL('/workflows/use-named-skill?wait=result', localUrl), { method: 'POST' });
			expect(namedSkillResponse.status).toBe(200);
			expect(await namedSkillResponse.json()).toMatchObject({ result: { text: 'License terms.\n' } });
			const delegatedResponse = await fetch(new URL('/workflows/delegate?wait=result', localUrl), { method: 'POST' });
			expect(delegatedResponse.status).toBe(200);
			expect(await delegatedResponse.json()).toMatchObject({ result: { text: 'review complete', model: 'reviewer' } });
			const selfDelegatedResponse = await fetch(new URL('/workflows/delegate-same-identity?wait=result', localUrl), { method: 'POST' });
			expect(selfDelegatedResponse.status).toBe(200);
			expect(await selfDelegatedResponse.json()).toMatchObject({ result: { text: 'self review complete', model: 'reviewer' } });
			const publicTargetResponse = await fetch(new URL('/agents/reviewer/review-instance', localUrl), { method: 'POST', body: JSON.stringify({ message: 'Review this.' }), headers: { 'content-type': 'application/json' } });
			expect(publicTargetResponse.status).toBe(404);
			const caughtFailedDelegationResponse = await fetch(new URL('/workflows/delegate-catch-failure?wait=result', localUrl), { method: 'POST' });
			expect(caughtFailedDelegationResponse.status).toBe(200);
			expect(await caughtFailedDelegationResponse.json()).toMatchObject({ result: { error: expect.stringContaining('No model configured') } });
			const failedDelegationResponse = await fetch(new URL('/workflows/delegate-failure?wait=result', localUrl), { method: 'POST' });
			expect(failedDelegationResponse.status).toBe(500);
			expect(await failedDelegationResponse.json()).toMatchObject({ error: { type: 'internal_error' } });
			const undiscoveredResponse = await fetch(new URL('/workflows/delegate-undiscovered?wait=result', localUrl), { method: 'POST' });
			expect(undiscoveredResponse.status).toBe(500);
			expect(await undiscoveredResponse.json()).toMatchObject({ error: { type: 'internal_error' } });
		} finally {
			await server.close();
		}
	}, 90000);
});

async function createGeneratedFixture(mode: 'build' | 'development'): Promise<{ root: string; output: string }> {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flue-vite-cloudflare-'));
	const output = path.join(root, 'generated');
	fs.mkdirSync(path.join(root, 'node_modules', '@flue'), { recursive: true });
	fs.mkdirSync(path.join(root, 'node_modules', '@earendil-works'), { recursive: true });
	fs.symlinkSync(process.cwd(), path.join(root, 'node_modules', '@flue', 'runtime'), 'dir');
	fs.symlinkSync(path.resolve(process.cwd(), 'node_modules/@earendil-works/pi-ai'), path.join(root, 'node_modules', '@earendil-works', 'pi-ai'), 'dir');
	fs.symlinkSync(
		path.resolve(process.cwd(), '../../examples/cloudflare-websocket/node_modules/agents'),
		path.join(root, 'node_modules', 'agents'),
		'dir',
	);
	fs.mkdirSync(path.join(root, 'agents'));
	fs.mkdirSync(path.join(root, 'workflows'));
	fs.mkdirSync(path.join(root, 'skills', 'review'), { recursive: true });
	fs.writeFileSync(path.join(root, 'wrangler.jsonc'), JSON.stringify({ name: 'vite-cloudflare-integration', compatibility_date: '2026-04-01', compatibility_flags: ['nodejs_compat'] }));
	fs.writeFileSync(path.join(root, mode === 'development' ? '.env.development' : '.env.production'), 'CLOUDFLARE_ENV=fixture-env\n');
	fs.writeFileSync(path.join(root, 'skills', 'review', 'SKILL.md'), `---\nname: review\ndescription: Reviews requested work.\n---\nReview it.\n`);
	fs.writeFileSync(path.join(root, 'skills', 'review', 'LICENSE.txt'), 'License terms.\n');
	fs.writeFileSync(path.join(root, 'agents', 'assistant.ts'), `import { createAgent } from '@flue/runtime';\nimport review from '../skills/review/SKILL.md' with { type: 'skill' };\nexport default createAgent(() => ({ model: 'fixture/reader', skills: [review] }));\n`);
	fs.writeFileSync(path.join(root, 'agents', 'reviewer.ts'), `import { fauxAssistantMessage, registerFauxProvider } from '@earendil-works/pi-ai';\nimport { createAgent } from '@flue/runtime';\nimport { registerProvider } from '@flue/runtime/app';\nconst faux = registerFauxProvider({ api: 'fixture-reviewer-api', provider: 'delegation-fixture' });\nregisterProvider('delegation-fixture', { api: faux.api, baseUrl: 'https://fixture.invalid' });\nfaux.setResponses([fauxAssistantMessage('review complete')]);\nexport default createAgent(() => ({ model: 'delegation-fixture/reviewer' }));\n`);
	fs.writeFileSync(path.join(root, 'agents', 'self-reviewer.ts'), `import { fauxAssistantMessage, registerFauxProvider } from '@earendil-works/pi-ai';\nimport { createAgent } from '@flue/runtime';\nimport { registerProvider } from '@flue/runtime/app';\nconst faux = registerFauxProvider({ api: 'fixture-self-reviewer-api', provider: 'self-delegation-fixture' });\nregisterProvider('self-delegation-fixture', { api: faux.api, baseUrl: 'https://fixture.invalid' });\nfaux.setResponses([fauxAssistantMessage('self review complete')]);\nexport default createAgent(() => ({ model: 'self-delegation-fixture/reviewer' }));\n`);
	fs.writeFileSync(path.join(root, 'agents', 'failing-reviewer.ts'), `import { createAgent } from '@flue/runtime';\nexport default createAgent(() => ({ model: false }));\n`);
	fs.writeFileSync(path.join(root, 'workflows', 'smoke.ts'), `import { http } from '@flue/runtime';\nimport review from '../skills/review/SKILL.md' with { type: 'skill' };\nexport const channels = [http()];\nexport async function run() { return { ok: true, reference: review, hasBody: 'body' in review, hasFiles: 'files' in review }; }\n`);
	fs.writeFileSync(path.join(root, 'workflows', 'use-skill.ts'), `import { fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider } from '@earendil-works/pi-ai';\nimport { createAgent, http, type FlueContext } from '@flue/runtime';\nimport { registerProvider } from '@flue/runtime/app';\nimport review from '../skills/review/SKILL.md' with { type: 'skill' };\nexport const channels = [http()];\nconst agent = createAgent(() => ({ model: 'fixture/reader' }));\nexport async function run({ init }: FlueContext) { const faux = registerFauxProvider({ api: 'fixture-skill-api', provider: 'fixture' }); registerProvider('fixture', { api: faux.api, baseUrl: 'https://fixture.invalid' }); faux.setResponses([fauxAssistantMessage(fauxToolCall('read', { path: '/.flue/packaged-skills/' + encodeURIComponent(review.id) + '/LICENSE.txt' }), { stopReason: 'toolUse' }), (context) => { const toolResult = context.messages[context.messages.length - 1]; const content = toolResult?.role === 'toolResult' && toolResult.content[0]?.type === 'text' ? toolResult.content[0].text : 'missing packaged content'; return fauxAssistantMessage(fauxText(content)); }]); const harness = await init(agent); const session = await harness.session(); const result = await session.skill(review); faux.unregister(); return { text: result.text }; }\n`);
	fs.writeFileSync(path.join(root, 'workflows', 'use-named-skill.ts'), `import { fauxAssistantMessage, fauxText, fauxToolCall, registerFauxProvider } from '@earendil-works/pi-ai';\nimport { createAgent, http, type FlueContext } from '@flue/runtime';\nimport { registerProvider } from '@flue/runtime/app';\nimport review from '../skills/review/SKILL.md' with { type: 'skill' };\nexport const channels = [http()];\nconst agent = createAgent(() => ({ model: 'fixture/reader', skills: [review] }));\nexport async function run({ init }: FlueContext) { const faux = registerFauxProvider({ api: 'fixture-named-skill-api', provider: 'fixture' }); registerProvider('fixture', { api: faux.api, baseUrl: 'https://fixture.invalid' }); faux.setResponses([fauxAssistantMessage(fauxToolCall('read', { path: '/.flue/packaged-skills/' + encodeURIComponent(review.id) + '/LICENSE.txt' }), { stopReason: 'toolUse' }), (context) => { const toolResult = context.messages[context.messages.length - 1]; const content = toolResult?.role === 'toolResult' && toolResult.content[0]?.type === 'text' ? toolResult.content[0].text : 'missing packaged content'; return fauxAssistantMessage(fauxText(content)); }]); const harness = await init(agent); const session = await harness.session(); const result = await session.skill('review'); faux.unregister(); return { text: result.text }; }\n`);
	fs.writeFileSync(path.join(root, 'workflows', 'delegate.ts'), `import { createAgent, http, type FlueContext } from '@flue/runtime';\nimport reviewer from '../agents/reviewer.ts';\nexport const channels = [http()];\nconst orchestrator = createAgent(() => ({ model: false }));\nexport async function run({ init }: FlueContext) { const harness = await init(orchestrator); const session = await harness.session(); const result = await session.delegate('Review this.', { agent: reviewer, id: 'review-instance' }); return { text: result.text, model: result.model.id }; }\n`);
	fs.writeFileSync(path.join(root, 'workflows', 'delegate-same-identity.ts'), `import { http, type FlueContext } from '@flue/runtime';\nimport reviewer from '../agents/self-reviewer.ts';\nexport const channels = [http()];\nexport async function run({ init, id }: FlueContext) { const harness = await init(reviewer); const session = await harness.session(); const result = await session.delegate('Review this.', { agent: reviewer, id }); return { text: result.text, model: result.model.id }; }\n`);
	fs.writeFileSync(path.join(root, 'workflows', 'delegate-failure.ts'), `import { createAgent, http, type FlueContext } from '@flue/runtime';\nimport reviewer from '../agents/failing-reviewer.ts';\nexport const channels = [http()];\nconst orchestrator = createAgent(() => ({ model: false }));\nexport async function run({ init }: FlueContext) { const harness = await init(orchestrator); const session = await harness.session(); return session.delegate('Review this.', { agent: reviewer, id: 'failing-review-instance' }); }\n`);
	fs.writeFileSync(path.join(root, 'workflows', 'delegate-catch-failure.ts'), `import { createAgent, http, type FlueContext } from '@flue/runtime';\nimport reviewer from '../agents/failing-reviewer.ts';\nexport const channels = [http()];\nconst orchestrator = createAgent(() => ({ model: false }));\nexport async function run({ init }: FlueContext) { const harness = await init(orchestrator); const session = await harness.session(); try { await session.delegate('Review this.', { agent: reviewer, id: 'caught-failing-review-instance' }); return { error: 'missing failure' }; } catch (error) { return { error: error instanceof Error ? error.message : String(error) }; } }\n`);
	fs.writeFileSync(path.join(root, 'workflows', 'delegate-undiscovered.ts'), `import { createAgent, http, type FlueContext } from '@flue/runtime';\nexport const channels = [http()];\nconst orchestrator = createAgent(() => ({ model: false }));\nconst localTarget = createAgent(() => ({ model: false }));\nexport async function run({ init }: FlueContext) { const harness = await init(orchestrator); const session = await harness.session(); return session.delegate('Review this.', { agent: localTarget, id: 'review-instance' }); }\n`);
	await build({ root, output, target: 'cloudflare', mode });
	return { root, output };
}
