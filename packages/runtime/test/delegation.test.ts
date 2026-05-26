import { fauxAssistantMessage, registerFauxProvider } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { createAgent } from '../src/agent-definition.ts';
import { createFlueContext, InMemorySessionStore, invokeAgentDelegation, type AgentDelegationInput } from '../src/internal.ts';
import type { FlueEvent, PromptResponse, SessionEnv } from '../src/types.ts';

function createEnv(): SessionEnv {
	return {
		cwd: '/',
		resolvePath: (path) => (path.startsWith('/') ? path : `/${path}`),
		exec: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
		readFile: async () => '',
		readFileBuffer: async () => new Uint8Array(),
		writeFile: async () => {},
		stat: async () => ({ isFile: false, isDirectory: false, isSymbolicLink: false, size: 0, mtime: new Date(0) }),
		readdir: async () => [],
		exists: async () => false,
		mkdir: async () => {},
		rm: async () => {},
	};
}

describe('agent delegation', () => {
	it('delegates through the injected target boundary and cleans up the target session', async () => {
		const provider = `faux-${crypto.randomUUID()}`;
		const modelId = 'reviewer';
		const modelString = `${provider}/${modelId}`;
		const registration = registerFauxProvider({ provider, models: [{ id: modelId }] });
		registration.setResponses([fauxAssistantMessage('review complete')]);
		const parentEvents: FlueEvent[] = [];
		const targetEvents: FlueEvent[] = [];
		const targetStore = new InMemorySessionStore();
		let delegatedInput: AgentDelegationInput | undefined;

		try {
			const target = createAgent(({ id, payload }) => {
				expect(id).toBe('review-instance');
				expect(payload).toBeUndefined();
				return { model: modelString };
			});
			const parentCtx = createFlueContext({
				id: 'parent-instance',
				runId: undefined,
				payload: {},
				env: {},
				agentConfig: { systemPrompt: '', skills: {}, model: undefined, resolveModel: () => undefined },
				createDefaultEnv: async () => createEnv(),
				defaultStore: new InMemorySessionStore(),
				resolveAgentDelegation: (agent) => agent === target ? ({
					targetAgent: 'reviewer',
					invoke: async (input, signal) => {
						delegatedInput = input;
						return invokeAgentDelegation({
							agentName: 'reviewer',
							agent,
							input,
							signal,
							createContext: (id, runId, payload, req, initialEventIndex, dispatchId, delegationId) => {
								const ctx = createFlueContext({
									id,
									runId,
									dispatchId,
									delegationId,
									payload,
									env: {},
									req,
									initialEventIndex,
									agentConfig: { systemPrompt: '', skills: {}, model: undefined, resolveModel: (model) => model === modelString ? registration.getModel(modelId) : undefined },
									createDefaultEnv: async () => createEnv(),
									defaultStore: targetStore,
								});
								ctx.subscribeEvent((event) => { targetEvents.push(event); });
								return ctx;
							},
						});
					},
				}) : undefined,
			});
			parentCtx.subscribeEvent((event) => { parentEvents.push(event); });
			const parent = await (await parentCtx.init(createAgent(() => ({ model: false })))).session();

			const result = await parent.delegate('Review this change.', { agent: target, id: 'review-instance' });

			expect(result.text).toBe('review complete');
			expect(delegatedInput).toMatchObject({
				targetAgent: 'reviewer',
				id: 'review-instance',
				message: 'Review this change.',
			});

			expect(delegatedInput?.delegationId).toEqual(expect.any(String));
			expect(delegatedInput?.session).toBe(`delegation:${delegatedInput?.delegationId}`);
			expect(parentEvents.find((event) => event.type === 'delegation_start')).toMatchObject({
				delegationId: delegatedInput?.delegationId,
				targetAgent: 'reviewer',
				targetInstanceId: 'review-instance',
				prompt: 'Review this change.',
			});
			expect(parentEvents.find((event) => event.type === 'delegation')).toMatchObject({
				delegationId: delegatedInput?.delegationId,
				targetAgent: 'reviewer',
				isError: false,
				result: 'review complete',
			});

			expect(parentEvents.find((event) => event.type === 'operation_start')).toMatchObject({ operationKind: 'delegate' });
			expect(parentEvents.find((event) => event.type === 'operation')).toMatchObject({ operationKind: 'delegate', isError: false });
			expect(parentEvents.every((event) => event.runId === undefined)).toBe(true);
			expect(targetEvents.find((event) => event.type === 'turn_request')).toMatchObject({
				delegationId: delegatedInput?.delegationId,
				instanceId: 'review-instance',
				session: delegatedInput?.session,
			});
			expect(await targetStore.load(`agent-session:["review-instance","default","${delegatedInput?.session}"]`)).toBeNull();
		} finally {
			registration.unregister();
		}
	});

	it('fails clearly without a configured delegation invoker or valid target id', async () => {
		const parentCtx = createFlueContext({
			id: 'parent-instance',
			runId: undefined,
			payload: {},
			env: {},
			agentConfig: { systemPrompt: '', skills: {}, model: undefined, resolveModel: () => undefined },
			createDefaultEnv: async () => createEnv(),
			defaultStore: new InMemorySessionStore(),
		});
		const parent = await (await parentCtx.init(createAgent(() => ({ model: false })))).session();
		const target = createAgent(() => ({ model: false }));

		await expect(parent.delegate('Review.', { agent: target, id: 'reviewer' })).rejects.toThrow('cannot delegate to deployed agents');

		const withInvokerCtx = createFlueContext({
			id: 'parent-instance-2',
			runId: undefined,
			payload: {},
			env: {},
			agentConfig: { systemPrompt: '', skills: {}, model: undefined, resolveModel: () => undefined },
			createDefaultEnv: async () => createEnv(),
			defaultStore: new InMemorySessionStore(),
			resolveAgentDelegation: (agent) => agent === target ? ({
				targetAgent: 'reviewer',
				invoke: async () => ({ text: '', usage: {} as never, model: { id: 'test' } } satisfies PromptResponse),
			}) : undefined,
		});
		const withInvoker = await (await withInvokerCtx.init(createAgent(() => ({ model: false })))).session();
		await expect(withInvoker.delegate('Review.', { agent: target, id: '' })).rejects.toThrow('non-empty "id"');
		await expect(withInvoker.delegate('Review.', undefined as never)).rejects.toThrow('requires an agent created with createAgent');
		await expect(withInvoker.delegate('Review.', { agent: createAgent(() => ({ model: false })), id: 'unknown' })).rejects.toThrow('not a discovered default-exported agent');
	});

	it('releases delegated target locks when target context creation fails', async () => {
		const agent = createAgent(() => ({ model: false }));
		const input = {
			delegationId: 'delegation-lock',
			targetAgent: 'reviewer',
			id: 'review-instance',
			session: 'delegation:lock',
			message: 'Review.',
			requestedAt: '2026-05-25T00:00:00.000Z',
		};
		const createContext = () => {
			throw new Error('context failed');
		};

		await expect(invokeAgentDelegation({ agentName: 'reviewer', agent, input, createContext })).rejects.toThrow('context failed');
		await expect(invokeAgentDelegation({ agentName: 'reviewer', agent, input, createContext })).rejects.toThrow('context failed');
	});

	it('cleans up a generated target session when target session construction fails', async () => {
		const targetStore = new InMemorySessionStore();
		const agent = createAgent(() => ({
			model: false,
			sandbox: {
				createSessionEnv: async () => createEnv(),
				tools: () => [{ name: 'task', label: 'task', description: 'Invalid.', parameters: {}, execute: async () => ({ content: [] }) }],
			} as never,
		}));
		const input = {
			delegationId: 'delegation-construction-failure',
			targetAgent: 'reviewer',
			id: 'review-instance',
			session: 'delegation:construction-failure',
			message: 'Review.',
			requestedAt: '2026-05-25T00:00:00.000Z',
		};
		const createContext = (id: string, runId: string | undefined, payload: unknown, req: Request | undefined, initialEventIndex?: number, dispatchId?: string, delegationId?: string) =>
			createFlueContext({
				id,
				runId,
				payload,
				req,
				initialEventIndex,
				dispatchId,
				delegationId,
				env: {},
				agentConfig: { systemPrompt: '', skills: {}, model: undefined, resolveModel: () => undefined },
				createDefaultEnv: async () => createEnv(),
				defaultStore: targetStore,
			});

		await expect(invokeAgentDelegation({ agentName: 'reviewer', agent, input, createContext })).rejects.toThrow('framework-reserved');
		expect(await targetStore.load('agent-session:["review-instance","default","delegation:construction-failure"]')).toBeNull();
	});

	it('propagates abort through the delegated call handle', async () => {
		let delegatedSignal: AbortSignal | undefined;
		const ctx = createFlueContext({
			id: 'parent-abort',
			runId: undefined,
			payload: {},
			env: {},
			agentConfig: { systemPrompt: '', skills: {}, model: undefined, resolveModel: () => undefined },
			createDefaultEnv: async () => createEnv(),
			defaultStore: new InMemorySessionStore(),
			resolveAgentDelegation: () => ({
				targetAgent: 'target',
				invoke: async (_input, signal) => {
					delegatedSignal = signal;
					return new Promise((_resolve, reject) => {
						signal?.addEventListener('abort', () => reject(new Error('target aborted')), { once: true });
					});
				},
			}),
		});
		const session = await (await ctx.init(createAgent(() => ({ model: false })))).session();
		const handle = session.delegate('Wait.', { agent: createAgent(() => ({ model: false })), id: 'target' });

		handle.abort('stop');

		await expect(handle).rejects.toMatchObject({ name: 'AbortError' });
		expect(delegatedSignal?.aborted).toBe(true);
	});
});
