import { createAgent, defineAgentProfile, http, type FlueContext } from '@flue/runtime';

export const channels = [http()];

const editor = defineAgentProfile({
	name: 'editor',
	instructions: 'Rewrite the supplied sentence in a clearer, shorter form.',
});

const agent = createAgent(() => ({ model: 'anthropic/claude-haiku-4-5', subagents: [editor] }));

export async function run({ init, payload }: FlueContext) {
	const harness = await init(agent);
	const session = await harness.session();
	const draft = typeof payload.draft === 'string' ? payload.draft : 'Our product helps teams work more efficiently together.';
	const response = await session.task(`Rewrite this sentence: ${draft}`, { agent: 'editor' });
	return { message: response.text };
}
