import type { FlueEvent } from '@flue/runtime';
import { flue, observe } from '@flue/runtime/app';
import { initLogger, type Span } from 'braintrust';
import { Hono } from 'hono';

const logger = process.env.BRAINTRUST_API_KEY
	? initLogger({
			projectName: process.env.BRAINTRUST_PROJECT_NAME ?? 'Flue',
			apiKey: process.env.BRAINTRUST_API_KEY,
			setCurrent: false,
		})
	: undefined;

const runs = new Map<string, Span>();
const operations = new Map<string, Span>();
const turns = new Map<string, Span>();
const tools = new Map<string, Span>();
const tasks = new Map<string, Span>();
const compactions = new Map<string, Span>();

observe((event) => {
	if (!logger) return;
	const at = timestamp(event);
	if (event.type === 'run_start') {
		runs.set(event.runId, logger.startSpan({
			name: `workflow:${event.workflowName}`,
			type: 'task',
			startTime: seconds(event.startedAt),
			event: { input: event.payload, metadata: identifiers(event) },
		}));
		return;
	}
	if (event.type === 'operation_start') {
		const args = {
			name: `flue.${event.operationKind}`,
			type: 'task' as const,
			startTime: at,
			event: { metadata: { ...identifiers(event), operationKind: event.operationKind } },
		};
		const parent = event.taskId ? tasks.get(event.taskId) : workflowSpan(event);
		operations.set(event.operationId, parent ? parent.startSpan(args) : logger.startSpan(args));
		return;
	}
	if (event.type === 'task_start') {
		const args = {
			name: event.agent ? `task:${event.agent}` : 'task',
			type: 'task' as const,
			startTime: at,
			event: { input: event.prompt, metadata: identifiers(event) },
		};
		const parent = operationSpan(event) ?? workflowSpan(event);
		tasks.set(event.taskId, parent ? parent.startSpan(args) : logger.startSpan(args));
		return;
	}
	if (event.type === 'compaction_start') {
		const args = {
			name: `compaction:${event.reason}`,
			type: 'task' as const,
			startTime: at,
			event: { metadata: { ...identifiers(event), reason: event.reason, estimatedTokens: event.estimatedTokens } },
		};
		const parent = operationSpan(event) ?? workflowSpan(event);
		compactions.set(compactionKey(event), parent ? parent.startSpan(args) : logger.startSpan(args));
		return;
	}
	if (event.type === 'turn_request') {
		const args = {
			name: event.purpose === 'agent' ? `llm:${event.model}` : `llm:${event.purpose}`,
			type: 'llm' as const,
			startTime: at,
			event: {
				input: event.input.messages,
				metadata: {
					...identifiers(event),
					purpose: event.purpose,
					model: event.model,
					provider: event.provider,
					api: event.api,
					reasoning: event.reasoning,
					systemPrompt: event.input.systemPrompt,
					tools: event.input.tools,
				},
			},
		};
		const parent = event.purpose === 'agent'
			? operationSpan(event) ?? workflowSpan(event)
			: compactions.get(compactionKey(event)) ?? operationSpan(event) ?? workflowSpan(event);
		turns.set(event.turnId, parent ? parent.startSpan(args) : logger.startSpan(args));
		return;
	}
	if (event.type === 'tool_start') {
		const args = {
			name: `tool:${event.toolName}`,
			type: 'tool' as const,
			startTime: at,
			event: { input: event.args, metadata: identifiers(event) },
		};
		const parent = (event.turnId ? turns.get(event.turnId) : undefined) ?? operationSpan(event) ?? workflowSpan(event);
		tools.set(toolKey(event), parent ? parent.startSpan(args) : logger.startSpan(args));
		return;
	}
	if (event.type === 'tool_call') {
		const key = toolKey(event);
		const span = tools.get(key);
		if (!span) return;
		span.log({ output: event.result, error: event.isError ? event.result : undefined, metrics: { duration_ms: event.durationMs } });
		span.end({ endTime: at });
		tools.delete(key);
		return;
	}
	if (event.type === 'turn') {
		const span = turns.get(event.turnId);
		if (!span) return;
		span.log({
			output: event.output,
			error: event.isError ? event.error : undefined,
			metadata: { model: event.model, provider: event.provider, api: event.api, stopReason: event.stopReason },
			metrics: usageMetrics(event),
		});
		span.end({ endTime: at });
		turns.delete(event.turnId);
		return;
	}
	if (event.type === 'compaction') {
		const span = compactions.get(compactionKey(event));
		if (!span) return;
		span.log({ metadata: { usage: event.usage }, metrics: { messages_before: event.messagesBefore, messages_after: event.messagesAfter, duration_ms: event.durationMs } });
		span.end({ endTime: at });
		compactions.delete(compactionKey(event));
		return;
	}
	if (event.type === 'task') {
		const span = tasks.get(event.taskId);
		if (!span) return;
		span.log({ output: event.result, error: event.isError ? event.result : undefined, metrics: { duration_ms: event.durationMs } });
		span.end({ endTime: at });
		tasks.delete(event.taskId);
		return;
	}
	if (event.type === 'operation') {
		const span = operations.get(event.operationId);
		if (!span) return;
		span.log({ output: event.result, error: event.isError ? event.error : undefined, metadata: { usage: event.usage }, metrics: { duration_ms: event.durationMs } });
		span.end({ endTime: at });
		operations.delete(event.operationId);
		const compaction = compactions.get(compactionKey(event));
		if (compaction) {
			compaction.log({ error: event.isError ? event.error : 'Compaction operation completed without a terminal compaction event.' });
			compaction.end({ endTime: at });
			compactions.delete(compactionKey(event));
		}
		return;
	}
	if (event.type === 'run_end') {
		const span = runs.get(event.runId);
		if (!span) return;
		span.log({ output: event.result, error: event.isError ? event.error : undefined, metrics: { duration_ms: event.durationMs } });
		span.end({ endTime: at });
		runs.delete(event.runId);
	}
});

function workflowSpan(event: FlueEvent): Span | undefined {
	return event.runId ? runs.get(event.runId) : undefined;
}

function operationSpan(event: FlueEvent): Span | undefined {
	return event.operationId ? operations.get(event.operationId) : undefined;
}

function compactionKey(event: FlueEvent): string {
	return `${event.instanceId ?? ''}:${event.session ?? ''}:${event.operationId ?? ''}`;
}

function toolKey(event: FlueEvent & { toolCallId: string }): string {
	return `${event.turnId ?? event.operationId ?? event.taskId ?? event.runId ?? ''}:${event.toolCallId}`;
}

function identifiers(event: FlueEvent): Record<string, string> {
	return Object.fromEntries(Object.entries({
		runId: event.runId,
		instanceId: event.instanceId,
		dispatchId: event.dispatchId,
		harness: event.harness,
		session: event.session,
		parentSession: event.parentSession,
		operationId: event.operationId,
		taskId: event.taskId,
		turnId: event.turnId,
	}).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

function usageMetrics(event: { usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number; cost: { total: number } }; durationMs?: number }): Record<string, number> {
	const usage = event.usage;
	return Object.fromEntries(Object.entries({
		prompt_tokens: usage?.input,
		completion_tokens: usage?.output,
		prompt_cached_tokens: usage?.cacheRead,
		prompt_cache_creation_tokens: usage?.cacheWrite,
		tokens: usage?.totalTokens,
		estimated_cost: usage?.cost.total,
		duration_ms: event.durationMs,
	}).filter((entry): entry is [string, number] => entry[1] !== undefined));
}

function timestamp(event: FlueEvent): number {
	return seconds(event.timestamp ?? new Date().toISOString());
}

function seconds(value: string): number {
	return Date.parse(value) / 1000;
}

const app = new Hono();
app.route('/', flue());

export default app;
