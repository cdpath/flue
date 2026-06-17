import { createAgent, type FlueContext, type WorkflowRouteHandler } from '@flue/runtime';

// Expose POST /api/workflows/research over HTTP (pass-through route), same as
// the demo workflow. Without a `route` export the workflow is dispatch-only.
export const route: WorkflowRouteHandler = async (_c, next) => next();

// Synthesis agent. Transport (GLM base URL + key) comes from the `anthropic`
// provider registered in app.ts; the model id matches the chat assistant.
const researcher = createAgent(() => ({
	model: process.env.FLUE_MODEL ?? 'anthropic/glm-5.2',
	instructions:
		'You are a research analyst. Using only the numbered web sources you are given, write a ' +
		'concise briefing in Markdown that answers the question. Cite claims inline as [n] and end ' +
		'with a "Sources" list mapping each [n] to its URL. Do not invent facts beyond the sources.',
}));

interface ResearchPayload {
	query?: string;
}

interface FirecrawlResult {
	url: string;
	title?: string;
	description?: string;
	markdown?: string;
}

const FIRECRAWL_SEARCH_URL = 'https://api.firecrawl.dev/v1/search';
const SOURCE_LIMIT = 4;
// Trim each scraped page so a handful of sources comfortably fit the model's
// context window without spending the whole budget on boilerplate.
const SOURCE_CHARS = 4_000;

/**
 * A two-phase research workflow: imperative code drives a Firecrawl web search
 * (the "research" phase), then an agent synthesizes the gathered sources into a
 * cited briefing (the "synthesis" phase). Each `log.info` is streamed to the
 * run's event stream, so the UI's workflow panel shows live progress.
 */
export async function run({ payload, log, init }: FlueContext<ResearchPayload>) {
	const query = payload?.query?.trim() || 'What is the Flue agent framework?';
	const apiKey = process.env.FIRECRAWL_API_KEY;
	if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not set; cannot run the research phase.');

	log.info('research started', { query });
	const sources = await search(query, apiKey);
	if (sources.length === 0) throw new Error(`No web sources found for query: ${query}`);
	log.info('gathered sources', { count: sources.length, urls: sources.map((s) => s.url) });

	const harness = await init(researcher);
	const session = await harness.session();
	log.info('synthesizing briefing', { sources: sources.length });
	const response = await session.prompt(buildPrompt(query, sources));
	log.info('research complete', { report: response.text });

	return {
		query,
		sources: sources.map((source, index) => ({
			n: index + 1,
			title: source.title ?? source.url,
			url: source.url,
		})),
		report: response.text,
	};
}

async function search(query: string, apiKey: string): Promise<FirecrawlResult[]> {
	const response = await fetch(FIRECRAWL_SEARCH_URL, {
		method: 'POST',
		headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
		body: JSON.stringify({ query, limit: SOURCE_LIMIT, scrapeOptions: { formats: ['markdown'] } }),
	});
	if (!response.ok) {
		throw new Error(`Firecrawl search failed (${response.status}): ${await response.text()}`);
	}
	const body = (await response.json()) as { data?: FirecrawlResult[] };
	return (body.data ?? []).filter((result) => Boolean(result.url));
}

function buildPrompt(query: string, sources: FirecrawlResult[]): string {
	const blocks = sources.map((source, index) => {
		const content = (source.markdown ?? source.description ?? '').slice(0, SOURCE_CHARS);
		return `## Source [${index + 1}] ${source.title ?? source.url}\nURL: ${source.url}\n\n${content}`;
	});
	return [
		`Question: ${query}`,
		'',
		'Write a briefing that answers the question using only the sources below.',
		'',
		blocks.join('\n\n---\n\n'),
	].join('\n');
}
