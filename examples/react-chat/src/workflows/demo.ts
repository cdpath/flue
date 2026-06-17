import type { FlueContext, WorkflowRouteHandler } from '@flue/runtime';

// Opt the workflow into the HTTP transport so the UI can start it at
// POST /api/workflows/demo. A workflow that only exports `run` is
// dispatch-only; exporting a (pass-through) route is what flips on http.
export const route: WorkflowRouteHandler = async (_c, next) => next();

export async function run({ id, log, payload }: FlueContext) {
	log.info('workflow started', { runId: id });
	await new Promise((resolve) => setTimeout(resolve, 500));
	log.info('workflow received payload', { payload });
	await new Promise((resolve) => setTimeout(resolve, 500));
	log.info('workflow completed');
	return { ok: true, payload };
}
