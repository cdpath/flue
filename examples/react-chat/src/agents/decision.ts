import {
	type AgentRouteHandler,
	connectMcpServer,
	createAgent,
	type ToolDefinition,
} from '@flue/runtime';

// Opt the agent into the HTTP transport so the UI can reach it at
// POST /api/agents/decision/:id (see agents/assistant.ts for the rationale).
export const route: AgentRouteHandler = async (_c, next) => next();

const DATAPRO_MCP_URL = 'https://datapro.hqd.cn-beijing.volces.com/mcp';
const FIRECRAWL_SEARCH_URL = 'https://api.firecrawl.dev/v1/search';

// Discover the datapro MCP tools once per process. The connection is memoized
// on success; a failed attempt is not cached so a transient outage can recover
// on the next prompt. The plan key authenticates the tenant and is supplied via
// the X-Agent-Plan-Key header, mirroring `claude mcp add --header ...`.
let dataproToolsPromise: Promise<ToolDefinition[]> | undefined;
function dataproTools(): Promise<ToolDefinition[]> {
	if (!dataproToolsPromise) {
		const planKey = process.env.AGENT_PLAN_KEY;
		if (!planKey) {
			return Promise.reject(
				new Error('AGENT_PLAN_KEY is not set; the decision agent cannot reach the datapro MCP.'),
			);
		}
		dataproToolsPromise = connectMcpServer('datapro', {
			url: DATAPRO_MCP_URL,
			transport: 'streamable-http',
			headers: { 'X-Agent-Plan-Key': planKey },
		})
			.then((connection) => connection.tools)
			.catch((error) => {
				dataproToolsPromise = undefined;
				throw error;
			});
	}
	return dataproToolsPromise;
}

// Firecrawl-backed web search, exposed as an ordinary tool so the model can
// fetch fresh qualitative context the structured datapro feeds don't cover.
const webSearch: ToolDefinition = {
	name: 'web_search',
	description:
		'Search the public web (via Firecrawl) for recent news or qualitative context that the structured ' +
		'datapro company/market data does not cover. Returns the top results as a Markdown list of titles and URLs.',
	parameters: {
		type: 'object',
		properties: {
			query: { type: 'string', description: 'The search query.' },
		},
		required: ['query'],
	},
	async execute(args) {
		const query = String((args as { query?: unknown }).query ?? '').trim();
		if (!query) throw new Error('web_search requires a non-empty "query".');
		const apiKey = process.env.FIRECRAWL_API_KEY;
		if (!apiKey) throw new Error('FIRECRAWL_API_KEY is not set; web_search is unavailable.');
		const response = await fetch(FIRECRAWL_SEARCH_URL, {
			method: 'POST',
			headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
			body: JSON.stringify({ query, limit: 5 }),
		});
		if (!response.ok) {
			throw new Error(`Firecrawl search failed (${response.status}): ${await response.text()}`);
		}
		const body = (await response.json()) as {
			data?: { url: string; title?: string; description?: string }[];
		};
		const results = body.data ?? [];
		if (results.length === 0) return `No web results for "${query}".`;
		return results
			.map((r, i) => `${i + 1}. ${r.title ?? r.url}\n   ${r.url}\n   ${r.description ?? ''}`.trimEnd())
			.join('\n\n');
	},
};

// Business-decision agent. Transport (GLM base URL + key) is configured on the
// `anthropic` provider in app.ts; the model id matches the chat assistant.
export default createAgent(async () => {
	let tools: ToolDefinition[] = [webSearch];
	try {
		tools = [...(await dataproTools()), webSearch];
	} catch (error) {
		// Degrade to web-only rather than failing the whole agent when the
		// datapro MCP is unreachable or unconfigured.
		console.warn(
			'[decision] datapro MCP unavailable, continuing with web search only:',
			error instanceof Error ? error.message : error,
		);
	}
	return {
		model: process.env.FLUE_MODEL ?? 'anthropic/glm-5.2',
		instructions: [
			'You are a business decision analyst. Help the user reason about companies, markets, and investment or strategy decisions.',
			'Prefer the datapro MCP tools (named mcp__datapro__*) as your primary source for structured business data: company profiles, financials, stock prices, and similar figures.',
			'Use web_search for recent news or qualitative context the structured data lacks.',
			'Ground every numeric claim in tool output, state the data\'s as-of date when known, cite sources, and be explicit about uncertainty. Never fabricate figures.',
		].join('\n'),
		tools,
	};
});
