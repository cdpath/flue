---
title: GitHub
description: Receive signed GitHub webhooks and use Octokit from application-owned tools.
---

## Add GitHub

Run the GitHub recipe through your coding agent:

```sh
flue add github --print | codex
```

It installs `@flue/github` for verified ingress and the official
`@octokit/rest` SDK for outbound API calls. It creates
`src/channels/github.ts` with named `channel` and `client` exports.

Configure the GitHub webhook URL as:

```txt
https://example.com/channels/github/webhook
```

If `flue()` is mounted beneath an outer prefix, include that prefix. Configure
`application/json` or `application/x-www-form-urlencoded`, set a webhook
secret, and subscribe to the minimum event set the application handles. The
example uses **Issue comments** and **Pull request review comments**.

`GITHUB_WEBHOOK_SECRET` verifies inbound deliveries.
`GITHUB_TOKEN` authenticates outbound Octokit calls. Keep them in the
project's existing secret system.

## Channel module

```ts title="src/channels/github.ts"
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
      return JSON.stringify({ commentId: result.data.id });
    },
  });
}
```

The package forwards verified `issues.opened`, `issue_comment.created`,
`pull_request.opened`, and `pull_request_review_comment.created` variants.
Issue comments distinguish issue and pull-request conversations. Review
comments include the top-level thread comment id needed for an inline reply.
Verified unsupported deliveries arrive as `type: 'unknown'`. GitHub `ping` is
handled internally.

## Bind the tool

```ts title="src/agents/assistant.ts"
import { createAgent } from '@flue/runtime';
import { channel, commentOnIssue } from '../channels/github.ts';

export default createAgent(({ id }) => ({
  model: 'anthropic/claude-haiku-4-5',
  tools: [commentOnIssue(channel.parseConversationKey(id))],
}));
```

Pull requests use their issue number for issue comments. The model selects the
comment body; trusted code binds the repository and issue. The channel-agent
import cycle is supported because both imported bindings are read only inside
deferred callbacks or initializers.

GitHub requires a `2xx` response within ten seconds. The package's handler
deadline defaults to nine seconds. A timed-out handler may continue running, so
claim `deliveryId` in application storage before dispatch when duplicate
admission matters. GitHub does not automatically retry every failed webhook
delivery; use its delivery inspection and manual redelivery tools when needed.

Octokit's REST methods use Fetch and the example's typed
`issues.createComment()` operation is tested in workerd with Flue's required
`nodejs_compat` configuration. Cloudflare projects may initialize credentials
through `process.env` or typed Worker bindings and should verify their complete
target build.

See the [`@flue/github` API reference](/docs/api/github-channel/).
