import { createGitHubChannel } from '@flue/github';
import { defineTool, dispatch } from '@flue/runtime';
import { Octokit } from '@octokit/rest';
import assistant from '../agents/assistant.ts';

export const client = new Octokit({
	auth: requiredEnv('GITHUB_TOKEN'),
});

export const channel = createGitHubChannel({
	webhookSecret: requiredEnv('GITHUB_WEBHOOK_SECRET'),

	// Path: /channels/github/webhook
	async webhook({ event }) {
		switch (event.type) {
			case 'issue_comment.created':
			case 'pull_request_review_comment.created': {
				const issue = {
					owner: event.repository.owner,
					repo: event.repository.name,
					issueNumber:
						event.type === 'issue_comment.created'
							? event.payload.issue.number
							: event.payload.pullRequest.number,
				};
				await dispatch(assistant, {
					id: channel.conversationKey(issue),
					input: {
						type: `github.${event.type}`,
						deliveryId: event.deliveryId,
						installationId: event.installationId,
						issue,
						sender: event.sender,
						title:
							event.type === 'issue_comment.created'
								? event.payload.issue.title
								: event.payload.pullRequest.title,
						comment: event.payload.comment,
					},
				});
				return;
			}
			default:
				return;
		}
	},
});

export function commentOnIssue(ref: { owner: string; repo: string; issueNumber: number }) {
	return defineTool({
		name: 'comment_on_github_issue',
		description: 'Post a comment to the GitHub issue or pull request bound to this agent.',
		parameters: {
			type: 'object',
			properties: {
				body: { type: 'string', minLength: 1 },
			},
			required: ['body'],
			additionalProperties: false,
		},
		async execute({ body }) {
			const result = await client.rest.issues.createComment({
				owner: ref.owner,
				repo: ref.repo,
				issue_number: ref.issueNumber,
				body,
			});
			return JSON.stringify({ commentId: result.data.id, url: result.data.html_url });
		},
	});
}

function requiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required.`);
	return value;
}
