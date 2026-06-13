---
{
  "category": "channel",
  "website": "https://github.com"
}
---

# Add a GitHub Channel to Flue

You are an AI coding agent adding verified GitHub webhook ingress and
application-owned GitHub API behavior to a Flue project.

## Inspect the project

Read local instructions, detect the package manager and target, and select the
first existing source root: `<root>/.flue/`, then `<root>/src/`, then
`<root>/`. Inspect existing agents, environment types, secret conventions, and
whether the application responds to issue comments, pull-request conversation
comments, inline review comments, opened issues, or another verified delivery.

Install `@flue/github` and the official `@octokit/rest` SDK with the project's
package manager. Do not add a generic GitHub tool collection.

## Create the channel

Create `<source-dir>/channels/github.ts`. Adapt the imported agent and dispatched
input to the application, but preserve this ownership and routing shape:

```ts
import { createGitHubChannel } from '@flue/github';
import { defineTool, dispatch } from '@flue/runtime';
import { Octokit } from '@octokit/rest';
import assistant from '../agents/assistant.ts';

export const client = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

export const channel = createGitHubChannel({
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,

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
    description: 'Comment on the GitHub issue or pull request bound to this agent.',
    parameters: {
      type: 'object',
      properties: { body: { type: 'string', minLength: 1 } },
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
```

For Cloudflare projects, follow the project's typed binding convention and use
`env` from `cloudflare:workers` when a module-level client needs Worker
bindings. Do not assume `process.env` is the project's chosen Worker secret
interface. Octokit's typed REST request path is Fetch-based and executes in
workerd without `nodejs_compat`, but the completed project must still pass its
actual Cloudflare build.

If the user did not ask for issue comments, replace or omit the example tool.
Never let the model choose arbitrary owners, repositories, issue numbers, API
paths, or credentials unless the application has explicitly authorized that.

## Wire the agent

Bind the trusted conversation destination inside the agent initializer:

```ts
import { createAgent } from '@flue/runtime';
import { channel, commentOnIssue } from '../channels/github.ts';

export default createAgent(({ id }) => ({
  model: 'anthropic/claude-haiku-4-5',
  tools: [commentOnIssue(channel.parseConversationKey(id))],
}));
```

The channel-agent import cycle is supported only because these imported
bindings are read inside deferred callbacks and initializers. Do not read the
agent binding while constructing `channel`.

## Credentials and verification

`GITHUB_WEBHOOK_SECRET` verifies inbound webhook bytes.
`GITHUB_TOKEN` authenticates outbound Octokit calls. They serve different
purposes. Follow existing project secret conventions and never invent values.

Run the project's typecheck and configured Flue build. Create a local JSON
payload and `X-Hub-Signature-256` HMAC to test success, invalid signatures,
issue and pull-request comment variants, grouped cases,
`/channels/github/webhook`, the nine-second handler deadline, and the empty
`200` default. Exercise one Octokit call through a fake Fetch transport in
workerd. Do not contact GitHub.
