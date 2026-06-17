import {
	FlueProvider,
	type UIMessagePart,
	useFlueAgent,
	useFlueClient,
	useFlueWorkflow,
} from '@flue/react';
import { createFlueClient } from '@flue/sdk';
import { type FormEvent, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const client = createFlueClient({ baseUrl: '/api' });

// Selectable agents. Each conversation is bound to one agent name; the server
// addresses them at /api/agents/<name>/<id>.
const AGENTS = {
	assistant: 'Assistant',
	decision: 'Decision agent',
} as const;
type AgentName = keyof typeof AGENTS;

interface Conversation {
	id: string;
	agent: AgentName;
	title: string;
	updatedAt: number;
}

// The conversation index lives in localStorage; the transcripts themselves are
// durable in Postgres and replay from the agent event stream. Clearing storage
// only forgets the list, not the underlying data.
const STORAGE_KEY = 'flue-chat-conversations';
const ACTIVE_KEY = 'flue-chat-active';

function loadConversations(): Conversation[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		const parsed = raw ? (JSON.parse(raw) as Conversation[]) : [];
		return Array.isArray(parsed) ? parsed.filter((c) => c.id && c.agent in AGENTS) : [];
	} catch {
		return [];
	}
}

function newConversation(agent: AgentName): Conversation {
	return { id: crypto.randomUUID(), agent, title: '', updatedAt: Date.now() };
}

interface ResearchResult {
	query: string;
	sources: { n: number; title: string; url: string }[];
	report: string;
}

function isResearchResult(value: unknown): value is ResearchResult {
	return (
		typeof value === 'object' &&
		value !== null &&
		'report' in value &&
		typeof (value as ResearchResult).report === 'string'
	);
}

function App() {
	const [conversations, setConversations] = useState<Conversation[]>(() => {
		const existing = loadConversations();
		return existing.length > 0 ? existing : [newConversation('assistant')];
	});
	const [activeId, setActiveId] = useState<string>(() => {
		const stored = localStorage.getItem(ACTIVE_KEY);
		const existing = loadConversations();
		const fallback = existing[0]?.id;
		return stored && existing.some((c) => c.id === stored) ? stored : (fallback ?? '');
	});
	const [newAgent, setNewAgent] = useState<AgentName>('assistant');

	useEffect(() => {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
	}, [conversations]);
	useEffect(() => {
		if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
	}, [activeId]);

	const active = conversations.find((c) => c.id === activeId) ?? conversations[0];
	useEffect(() => {
		if (active && active.id !== activeId) setActiveId(active.id);
	}, [active, activeId]);

	function startConversation() {
		const conversation = newConversation(newAgent);
		setConversations((prev) => [conversation, ...prev]);
		setActiveId(conversation.id);
	}

	// Title a conversation from its first user message, and float it to the top
	// of the list on activity.
	function noteUserMessage(id: string, text: string) {
		setConversations((prev) =>
			prev.map((c) =>
				c.id === id
					? { ...c, title: c.title || text.slice(0, 60), updatedAt: Date.now() }
					: c,
			),
		);
	}

	return (
		<main>
			<header>
				<p className="eyebrow">Flue React hooks</p>
				<h1>Chat and workflow test bed</h1>
			</header>
			<div className="layout">
				<aside className="sidebar">
					<div className="new-chat">
						<select
							aria-label="Agent for new chat"
							onChange={(event) => setNewAgent(event.target.value as AgentName)}
							value={newAgent}
						>
							{Object.entries(AGENTS).map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</select>
						<button onClick={startConversation} type="button">
							New chat
						</button>
					</div>
					<ul className="conversations">
						{conversations.map((conversation) => (
							<li key={conversation.id}>
								<button
									className={conversation.id === active?.id ? 'active' : ''}
									onClick={() => setActiveId(conversation.id)}
									type="button"
								>
									<span className="conversation-title">
										{conversation.title || 'New conversation'}
									</span>
									<span className="conversation-agent">{AGENTS[conversation.agent]}</span>
								</button>
							</li>
						))}
					</ul>
				</aside>
				<div className="panels">
					{active && (
						<Chat
							key={`${active.agent}:${active.id}`}
							agent={active.agent}
							id={active.id}
							onUserMessage={(text) => noteUserMessage(active.id, text)}
						/>
					)}
					<WorkflowPanel />
				</div>
			</div>
		</main>
	);
}

function Chat({
	agent,
	id,
	onUserMessage,
}: {
	agent: AgentName;
	id: string;
	onUserMessage: (text: string) => void;
}) {
	const [input, setInput] = useState('');
	const [actionError, setActionError] = useState<string>();
	const session = useFlueAgent({ name: agent, id });

	async function submit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const message = input.trim();
		if (!message) return;
		setInput('');
		setActionError(undefined);
		onUserMessage(message);
		try {
			await session.sendMessage(message);
		} catch (error) {
			setInput(message);
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}

	return (
		<section>
			<div className="section-heading">
				<h2>{AGENTS[agent]}</h2>
				<span className={`status ${session.status}`}>{session.status}</span>
			</div>
			<div className="messages" aria-live="polite">
				{session.messages.length === 0 && <p className="empty">Send a message to begin.</p>}
				{session.messages.map((message) => (
					<article className={`message ${message.role}`} key={message.id}>
						<strong>{message.role}</strong>
						{message.parts.map((part) => (
							<MessagePart key={partKey(part)} part={part} />
						))}
					</article>
				))}
			</div>
			<form onSubmit={submit}>
				<input
					aria-label="Message"
					autoComplete="off"
					onChange={(event) => setInput(event.target.value)}
					placeholder={agent === 'decision' ? 'Ask about a company or the market' : 'Say hello'}
					value={input}
				/>
				<button disabled={!input.trim()} type="submit">
					Send
				</button>
			</form>
			{(actionError || session.error) && (
				<p className="error">{actionError ?? session.error?.message}</p>
			)}
		</section>
	);
}

function WorkflowPanel() {
	const [topic, setTopic] = useState('');
	const [runId, setRunId] = useState<string>();
	const [actionError, setActionError] = useState<string>();
	const workflow = useFlueWorkflow({ runId });
	const flue = useFlueClient();
	const research = isResearchResult(workflow.result) ? workflow.result : undefined;

	async function triggerWorkflow() {
		setActionError(undefined);
		try {
			const result = await flue.workflows.invoke('demo', {
				payload: { requestedAt: new Date().toISOString() },
			});
			setRunId(result.runId);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}

	async function runResearch(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const query = topic.trim();
		if (!query) return;
		setActionError(undefined);
		try {
			const result = await flue.workflows.invoke('research', { payload: { query } });
			setRunId(result.runId);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		}
	}

	return (
		<section>
			<div className="section-heading">
				<h2>Workflow</h2>
				<span className={`status ${workflow.status}`}>{workflow.status}</span>
			</div>
			<button onClick={triggerWorkflow} type="button">
				Trigger demo workflow
			</button>
			<form onSubmit={runResearch}>
				<input
					aria-label="Research topic"
					autoComplete="off"
					onChange={(event) => setTopic(event.target.value)}
					placeholder="Research a topic on the web"
					value={topic}
				/>
				<button disabled={!topic.trim()} type="submit">
					Run research
				</button>
			</form>
			<div className="logs" aria-live="polite">
				{workflow.logs.length === 0 && <p className="empty">Workflow logs appear here.</p>}
				{workflow.logs.map((log) => (
					<div className="log" key={`${log.timestamp}-${log.eventIndex}`}>
						<time>{new Date(log.timestamp).toLocaleTimeString()}</time>
						<span>{log.message}</span>
					</div>
				))}
			</div>
			{research && (
				<div className="report">
					<h3>Research briefing</h3>
					<pre>{research.report}</pre>
					<ol>
						{research.sources.map((source) => (
							<li key={source.n}>
								<a href={source.url} rel="noreferrer" target="_blank">
									{source.title}
								</a>
							</li>
						))}
					</ol>
				</div>
			)}
			{actionError && <p className="error">{actionError}</p>}
		</section>
	);
}

function MessagePart({ part }: { part: UIMessagePart }) {
	if (part.type === 'text') return <p>{part.text}</p>;
	if (part.type === 'reasoning')
		return (
			<details>
				<summary>Reasoning</summary>
				{part.text}
			</details>
		);
	if (part.type === 'file') return <a href={part.url}>Attachment</a>;
	return (
		<pre>
			{part.toolName}: {part.state}
		</pre>
	);
}

function partKey(part: UIMessagePart): string {
	if (part.type === 'dynamic-tool') return `tool:${part.toolCallId}`;
	if (part.type === 'file') return `file:${part.mediaType}:${part.url}`;
	return `${part.type}:${part.text}`;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing React root element');

createRoot(root).render(
	<FlueProvider client={client}>
		<App />
	</FlueProvider>,
);
