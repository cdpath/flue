import { describe, expect, it } from 'vitest';
import { CloudflarePlugin } from '../../cli/src/lib/build-plugin-cloudflare.ts';
import type { BuildContext } from '../../cli/src/lib/types.ts';

describe('Cloudflare build plugin', () => {
	it('forwards dispatch admissions to the target agent Durable Object', async () => {
		const entry = await new CloudflarePlugin().generateEntryPoint(testBuildContext());

		expect(entry).toContain("const INTERNAL_DISPATCH_PATH = '/__flue/internal/dispatch';");
		expect(entry).toContain('const createdAgents = {};');
		expect(entry).toContain('const deployedAgentNames = new Map();');
		expect(entry).toContain('deployedAgentNames.set(mod.default, name);');
		expect(entry).toContain('async enqueue(input) {');
		expect(entry).toContain('getAgentByName(binding, input.id)');
		expect(entry).toContain('if (isInternalDispatchRequest(request)) {');
		expect(entry).toContain('validateAgentDispatchAdmission({');
		expect(entry).toContain("doInstance.startFiber('flue:dispatch'");
		expect(entry).toContain("const idempotencyKey = 'flue:dispatch:' + input.dispatchId;");
		expect(entry).toContain('const prior = await doInstance.inspectFiberByKey(idempotencyKey);');
		expect(entry).toContain('processManagedAgentDispatch(input, doInstance, agentName, fiberCtx.id)');
		expect(entry).toContain('waitForEarlierManagedDispatch(doInstance, input, fiberId)');
		expect(entry).toContain('assertNoPendingDispatchForDirectSession(doInstance, agentName, session)');
		expect(entry).toContain("if (ctx.name === 'flue:dispatch') {");
		expect(entry).toContain('return handleFlueDispatchRecovered(ctx, this, "moderator");');
		expect(entry).toContain('const ctx = createContextForRequest(doInstance.name, undefined, input, doInstance, request, undefined, input.dispatchId);');
		expect(entry).toContain('createDispatchAgentHandler(agent, input)(ctx)');
		expect(entry).toContain('resolveDispatchAgentName: (agent) => deployedAgentNames.get(agent),');
		expect(entry).not.toContain('runId: input.dispatchId');
		expect(entry).not.toContain('createDurableDispatchRunStore');
		expect(entry).not.toContain('Cloudflare external-channel dispatch processing is not supported yet');
		expect(entry).not.toContain('createAgentDispatchProcessor');
	});

	it('routes awaited delegation privately to discovered target Durable Objects', async () => {
		const entry = await new CloudflarePlugin().generateEntryPoint(testBuildContext());

		expect(entry).toContain('invokeAgentDelegation,');
		expect(entry).toContain("const INTERNAL_DELEGATION_PATH = '/__flue/internal/delegation';");
		expect(entry).toContain('function resolveDeployedAgentDelegation(agent)');
		expect(entry).toContain('const targetAgent = deployedAgentNames.get(agent);');
		expect(entry).toContain('async invoke(input, signal)');
		expect(entry).toContain('agentBindingNameFromAgentName(targetAgent)');
		expect(entry).toContain("stub.fetch(new Request('https://flue.invalid' + INTERNAL_DELEGATION_PATH");
		expect(entry).toContain('function createContextForRequest(id, runId, payload, doInstance, req, initialEventIndex, dispatchId, delegationId)');
		expect(entry).toContain('delegationId,');
		expect(entry).toContain('resolveAgentDelegation: resolveDeployedAgentDelegation,');
		expect(entry).toContain('if (isInternalDelegationRequest(request)) {');
		expect(entry).toContain('const agent = createdAgents[agentName];');
		expect(entry).toContain("assertAgentsDurabilityApi(doInstance, 'keepAliveWhile');");
		expect(entry).toContain('doInstance.keepAliveWhile(() => invokeAgentDelegation({');
		expect(entry).toContain('signal: request.signal,');
		expect(entry).toContain('return Response.json({ ok: true, result });');
		expect(entry).toContain("return Response.json({ ok: false, error: { name: error instanceof Error ? error.name : 'Error', message: error instanceof Error ? error.message : String(error) } }, { status: 500 });");
		const delegationBranch = entry.slice(entry.indexOf('if (isInternalDelegationRequest(request)) {'), entry.indexOf('const payload = await request.clone().json().catch(() => null);'));
		expect(delegationBranch).not.toContain("startFiber('flue:dispatch'");
		expect(delegationBranch).not.toContain('validateAgentDispatchAdmission');
		expect(delegationBranch).not.toContain('createDispatchAgentHandler');
	});

	it('threads generated Durable Object identity through Cloudflare context', async () => {
		const entry = await new CloudflarePlugin().generateEntryPoint(testBuildContext());

		expect(entry).toContain('const agentClassNames = {');
		expect(entry).toContain('"moderator": "Moderator"');
		expect(entry).toContain('const workflowClassNames = {');
		expect(entry).toContain('"daily-report": "DailyReportWorkflow"');
		expect(entry).toContain('durableObjectIdentity: createDurableObjectIdentity(doInstance, identity)');
		expect(entry).toContain('bindingName: workflowBindingNameFromWorkflowName(workflowName)');
		expect(entry).toContain('bindingName: agentBindingNameFromAgentName(agentName)');
		expect(entry).not.toContain('createRegistryIdentity');
	});

	it('recovers interrupted Flue workflows without recovering agent prompt runs', async () => {
		const entry = await new CloudflarePlugin().generateEntryPoint(testBuildContext());

		expect(entry).toContain('failRecoveredRun');
		expect(entry).toContain("ctx.name !== 'flue:workflow:' + doInstance.name");
		expect(entry).toContain('const restartRunId = generateWorkflowRunId(workflowName);');
		expect(entry).toContain("'x-flue-restarted-from-run-id': interruptedRunId");
		expect(entry).toContain('restartedAsRunId: restartRunId');
		expect(entry).toContain('Flue workflow execution was interrupted and restarted as run');
		expect(entry).toContain("return doInstance.runFiber('flue:workflow:' + runId");
		expect(entry).not.toContain('recoverAgentRun');
		expect(entry).not.toContain('reserveRecoveredAgentSession');
		expect(entry).not.toContain('flue:webhook:');
		expect(entry).not.toContain("owner: { kind: 'agent', agentName, instanceId: id }");
		expect(entry).not.toContain('flue_fiber_recovery');
		expect(entry).not.toContain('fiber?.stash?.');
		expect(entry).toContain("runId = decodeURIComponent(segments[1] || '');");
		expect(entry).toContain('createContext: (id_, runId, payload, req, initialEventIndex, dispatchId)');
		expect(entry).toContain("assertAgentsDurabilityApi(doInstance, 'startFiber');");
	});

	it('generates exclusive hibernating WebSocket handling inside owning Durable Objects', async () => {
		const entry = await new CloudflarePlugin().generateEntryPoint(testBuildContext());

		expect(entry).toContain('const websocketAgentHandlers = {};');
		expect(entry).toContain('const websocketWorkflowHandlers = {};');
		expect(entry).toContain('const agentRouteMiddleware = {};');
		expect(entry).toContain('const workflowWebSocketMiddleware = {};');
		expect(entry).toContain('agentWebSocketMiddleware,');
		expect(entry).toContain('workflowWebSocketMiddleware,');
		expect(entry).toContain('connectCloudflareAgentWebSocket');
		expect(entry).toContain('messageCloudflareWorkflowWebSocket');
		expect(entry).toContain('if (isWebSocketUpgrade(request)) {');
		expect(entry).toContain('await this.__unsafe_ensureInitialized();');
		expect(entry).toContain("if (isFlueSocket(socket, 'agent', \"moderator\"))");
		expect(entry).toContain("if (isFlueSocket(socket, 'workflow', \"daily-report\"))");
		expect(entry).toContain('doInstance.ctx.acceptWebSocket(server);');
		expect(entry).toContain("if (code === 1005 || code === 1006 || code === 1015) return;");
		expect(entry).toContain("return closeFlueSocket(socket, code, reason);");
		expect(entry).toContain("return closeFlueSocket(socket, 1011, 'WebSocket error');");
		expect(entry).toContain('connectCloudflareAgentWebSocket(server, { name: agentName, id: doInstance.name, requestUrl: socketRequestUrl(request) });');
		expect(entry).toContain("url.search = '';");
		expect(entry).toContain('request: socketRequest(connection)');
		const agentSocketBody = entry.slice(entry.indexOf('async function messageAgentSocket'), entry.indexOf('async function messageWorkflowSocket'));
		expect(agentSocketBody).not.toContain('runStore:');
		expect(agentSocketBody).not.toContain('runSubscribers');
		expect(agentSocketBody).not.toContain('runRegistry:');
		expect(entry).not.toContain('shouldSendProtocolMessages()');
	});

	it('imports discovered channel applications for worker-level mounted routes', async () => {
		const entry = await new CloudflarePlugin().generateEntryPoint(testBuildContext());

		expect(entry).toContain("import * as channel_github_0 from '/tmp/github.ts';");
		expect(entry).toContain('const channelModules = {');
		expect(entry).toContain('const channelApps = {};');
		expect(entry).toContain('mod.default.__flueDefinedChannel !== true');
		expect(entry).toContain('const normalized = normalizeBuiltModules(agentModules, workflowModules, channelModules);');
		expect(entry).toContain('channelApps,');
	});

	it('allows custom app routing to own Cloudflare WebSocket middleware and mounts', async () => {
		const entry = await new CloudflarePlugin().generateEntryPoint({ ...testBuildContext(), appEntry: '/tmp/app.ts' });

		expect(entry).toContain("import userApp from '/tmp/app.ts';");
		expect(entry).toContain('return app.fetch(request, env, ctx);');
		expect(entry).not.toContain('Custom app.ts WebSocket mounting is not yet supported.');
	});

	it('emits packaged skill wiring for the production Worker graph', async () => {
		const entry = await new CloudflarePlugin().generateEntryPoint(testBuildContext());
		expect(entry).toContain("import { getPackagedSkills } from 'virtual:flue/packaged-skills';");
		expect(entry).toContain('const packagedSkills = getPackagedSkills();');
		expect(entry).toContain('systemPrompt, skills, packagedSkills, model: undefined, resolveModel');
		expect(entry).toContain('Bash,\n  InMemoryFs,\n  createFlueContext,');
		expect(entry).not.toContain("from 'just-bash'");
	});

});

function testBuildContext(): BuildContext {
	return {
		agents: [{ name: 'moderator', filePath: '/tmp/moderator.ts' }],
		workflows: [{ name: 'daily-report', filePath: '/tmp/daily-report.ts' }],
		channels: [{ name: 'github', filePath: '/tmp/github.ts' }],
		root: '/tmp/flue-test',
		output: '/tmp/flue-test/dist',
		runtimeVersion: '0.0.0-test',
		options: { root: '/tmp/flue-test', target: 'cloudflare' },
	};
}
