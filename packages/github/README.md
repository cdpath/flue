# `@flue/github`

Verified GitHub webhook ingress for Flue applications.

```ts
import { createGitHubChannel } from '@flue/github';

export const channel = createGitHubChannel({
  webhookSecret: process.env.GITHUB_WEBHOOK_SECRET!,

  // Path: /channels/github/webhook
  async webhook({ c, event }) {
    switch (event.type) {
      case 'issue_comment.created':
      case 'pull_request_review_comment.created':
        await handleComment(event);
        return;
      default:
        return c.body(null, 200);
    }
  },
});
```

Place this export in `channels/github.ts`. Flue discovers it and serves
`POST /channels/github/webhook` relative to the `flue()` mount.

The package verifies exact request bytes before parsing, handles GitHub `ping`
internally, and normalizes issue, pull-request, issue-comment, and review-comment
deliveries. Returning nothing produces an empty `200`; JSON values and ordinary
Hono responses are also supported. Application handlers have a default
nine-second deadline.

This package does not include an outbound GitHub client or model tools. Run
`flue add github` to generate editable project code using the official
`@octokit/rest` SDK and application-owned `defineTool(...)` values.

Conversation keys are stable issue or pull-request identifiers, not
authorization capabilities. The package is stateless and does not deduplicate
delivery ids.
