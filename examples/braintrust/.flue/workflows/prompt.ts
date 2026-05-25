import { createAgent, http, type FlueContext } from '@flue/runtime';

export const channels = [http()];

const agent = createAgent(() => ({ model: 'anthropic/claude-haiku-4-5' }));

export async function run({ init, payload }: FlueContext) {
	const harness = await init(agent);
	const session = await harness.session();
	const name = typeof payload.name === 'string' ? payload.name : 'Developer';
	const response = await session.prompt(`Write a one-sentence welcome for ${name}.`);
	return { message: response.text };
}
