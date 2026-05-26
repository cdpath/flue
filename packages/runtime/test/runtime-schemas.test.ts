import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { RunEventListResponseSchema } from '../src/runtime/schemas.ts';

describe('rich model-turn event schemas', () => {
	it('accepts normalized model-turn request and output content', () => {
		const result = v.safeParse(RunEventListResponseSchema, {
			events: [
				{
					type: 'turn_request',
					turnId: 'turn_1',
					purpose: 'agent',
					model: 'model',
					provider: 'provider',
					api: 'api',
					input: {
						messages: [
							{ role: 'user', content: [{ type: 'text', text: 'Hello' }] },
							{ role: 'toolResult', toolCallId: 'call_1', toolName: 'lookup', content: [{ type: 'image', data: 'data', mimeType: 'image/png' }], isError: false },
						],
						tools: [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object' } }],
					},
				},
				{
					type: 'turn',
					turnId: 'turn_1',
					purpose: 'agent',
					durationMs: 1,
					output: { role: 'assistant', content: [{ type: 'thinking', thinking: 'checking' }, { type: 'toolCall', id: 'call_1', name: 'lookup', arguments: { query: 'hello' } }] },
					isError: false,
				},
			],
		});

		expect(result.success).toBe(true);
	});

	it('accepts delegation operation lifecycle events', () => {
		const result = v.safeParse(RunEventListResponseSchema, {
			events: [
				{ type: 'operation_start', operationId: 'op_1', operationKind: 'delegate' },
				{ type: 'delegation_start', delegationId: 'delegation_1', targetAgent: 'reviewer', targetInstanceId: 'reviewer', prompt: 'Review.' },
				{ type: 'delegation', delegationId: 'delegation_1', targetAgent: 'reviewer', targetInstanceId: 'reviewer', isError: false, result: 'ok', durationMs: 1 },
				{ type: 'operation', operationId: 'op_1', operationKind: 'delegate', durationMs: 1, isError: false },
			],
		});

		expect(result.success).toBe(true);
	});

	it('rejects malformed normalized model-turn content', () => {
		const invalidRequest = v.safeParse(RunEventListResponseSchema, {
			events: [{
				type: 'turn_request',
				turnId: 'turn_1',
				purpose: 'agent',
				model: 'model',
				provider: 'provider',
				api: 'api',
				input: { messages: [{ role: 'user', content: [{ type: 'text' }] }] },
			}],
		});
		const invalidOutput = v.safeParse(RunEventListResponseSchema, {
			events: [{
				type: 'turn',
				turnId: 'turn_1',
				purpose: 'agent',
				durationMs: 1,
				output: { role: 'assistant', content: [{ type: 'toolCall', id: 'call_1', name: 'lookup', arguments: 'not-an-object' }] },
				isError: false,
			}],
		});

		expect(invalidRequest.success).toBe(false);
		expect(invalidOutput.success).toBe(false);
	});
});
