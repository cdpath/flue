import { describe, expect, it } from 'vitest';
import { CloudflarePlugin } from '../src/lib/build-plugin-cloudflare.ts';
import type { BuildContext } from '../src/lib/types.ts';

describe('CloudflarePlugin', () => {
	it('generates distinct Flue-owned Durable Object identities for agents and workflows', async () => {
		const entry = await new CloudflarePlugin().generateEntryPoint(
			testBuildContext({
				agents: [{ name: 'draft-workflow', filePath: '/fixture/agents/draft-workflow.ts' }],
				workflows: [{ name: 'draft', filePath: '/fixture/workflows/draft.ts' }],
			}),
		);

		expect(entry).toContain('class FlueDraftWorkflowAgent');
		expect(entry).toContain('class FlueDraftWorkflow');
		expect(entry).toContain('bindingName: "FLUE_DRAFT_WORKFLOW_AGENT"');
		expect(entry).toContain('bindingName: "FLUE_DRAFT_WORKFLOW"');
	});

	it('initializes durable agent execution stores without changing workflow run-store behavior', async () => {
		const entry = await new CloudflarePlugin().generateEntryPoint(
			testBuildContext({
				agents: [{ name: 'assistant', filePath: '/fixture/agents/assistant.ts' }],
				workflows: [{ name: 'draft', filePath: '/fixture/workflows/draft.ts' }],
			}),
		);

		expect(entry).toContain('createCloudflareAgentRuntime');
		expect(entry).toContain('createSqlSessionStore');
		expect(entry).toContain(
			`constructor(ctx, env) {
    const prepared = cloudflareAgents.prepare({ storage: ctx.storage, className: "FlueAssistantAgent", agentName: "assistant" });
    super(ctx, env);
    cloudflareAgents.attach(this, prepared);
  }`,
		);
		expect(entry).not.toContain('createSqlAgentExecutionStore');
		expect(entry).toContain('submissionStore: executionStore.submissions');
		expect(entry).not.toContain('sessionDeletionCoordinator');
		expect(entry).not.toContain('beginSessionDeletion');
		expect(entry).not.toContain('finishSessionDeletion');
		expect(entry).not.toContain('InMemorySessionStore');
		expect(entry).not.toContain('InMemoryRunStore');
		expect(entry).toContain('const defaultStore = createSqlSessionStore(doInstance.ctx.storage);');
		expect(entry).toContain('createSqlRunStore(sql)');
		expect(entry).toContain('const eventStreamStores = new WeakMap();');
		expect(entry).not.toContain('function createDOStore(sql)');
		expect(entry).not.toContain('CREATE TABLE IF NOT EXISTS flue_sessions');
	});

	it('delegates durable agent execution to the typed Cloudflare coordinator', async () => {
		const entry = await new CloudflarePlugin().generateEntryPoint(
			testBuildContext({
				agents: [{ name: 'assistant', filePath: '/fixture/agents/assistant.ts' }],
			}),
		);

		expect(entry).toContain('const cloudflareAgents = createCloudflareAgentRuntime({');
		expect(entry).toContain(
			'const prepared = cloudflareAgents.prepare({ storage: ctx.storage, className: "FlueAssistantAgent", agentName: "assistant" });',
		);
		expect(entry).toContain('cloudflareAgents.attach(this, prepared);');
		expect(entry).toContain(
			"return cloudflareAgents.onStart(this, () => typeof super.onStart === 'function' ? super.onStart(props) : undefined);",
		);
		expect(entry).toContain('return cloudflareAgents.wakeSubmissions(this);');
		expect(entry).toContain('return cloudflareAgents.onRequest(this, request);');
		expect(entry).toContain(
			"return cloudflareAgents.onFiberRecovered(this, ctx, () => typeof super.onFiberRecovered === 'function' ? super.onFiberRecovered(ctx) : undefined);",
		);
		expect(entry).toContain(
			"if (request.method === 'GET' && url.searchParams.has('meta')) return { action: 'get', runId };",
		);
		expect(entry).not.toContain('cloudflareAgents.fetch');
		expect(entry).not.toContain('webSocketMessage');
		expect(entry).not.toContain('webSocketClose');
		expect(entry).not.toContain('webSocketError');
		expect(entry).not.toContain('reconcileFlueAgentSubmissions');
		expect(entry).not.toContain('cf_agents_runs');
		expect(entry).not.toContain('cf_agents_fibers');
		expect(entry).not.toContain('scheduleEvery');
		expect(entry).not.toContain("runFiber('flue:direct'");
		expect(entry).not.toContain("startFiber('flue:dispatch'");
		expect(entry).not.toContain('ctx.storage.setAlarm');
	});

	it('uses explicit Flue routing instead of the Agents SDK router', async () => {
		const entry = await new CloudflarePlugin().generateEntryPoint(
			testBuildContext({
				agents: [{ name: 'assistant', filePath: '/fixture/agents/assistant.ts' }],
			}),
		);

		expect(entry).toContain('class FlueAssistantAgent');
		expect(entry).toContain('bindingName: "FLUE_ASSISTANT_AGENT"');
		expect(entry).toContain("import { Agent, getAgentByName } from 'agents'");
		expect(entry).toContain('return fetchAgent(binding, target.instanceId, request)');
		expect(entry).toContain('(await getAgentByName(binding, instanceId)).fetch(request)');
		expect(entry).not.toContain("routeAgentRequest } from 'agents'");
		expect(entry).not.toContain('  handleAgentRequest,');
		expect(entry).not.toContain('function isInternalDispatchRequest(request)');
	});
});

function testBuildContext(overrides: Partial<BuildContext> = {}): BuildContext {
	return {
		agents: [],
		workflows: [],
		root: '/fixture',
		output: '/fixture/dist',
		runtimeVersion: '0.0.0-test',
		...overrides,
	};
}
