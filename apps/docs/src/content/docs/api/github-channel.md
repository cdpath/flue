---
title: GitHub Channel API
description: Reference for verified GitHub webhook ingress from @flue/github.
lastReviewedAt: 2026-06-13
---

Import from `@flue/github`.

## `createGitHubChannel()`

```ts
function createGitHubChannel<E extends Env = Env>(
  options: GitHubChannelOptions<E>,
): GitHubChannel<E>;
```

Creates one stateless GitHub webhook channel. The callback is stored during
construction and runs only for a verified non-ping delivery.

## `GitHubChannelOptions`

```ts
interface GitHubChannelOptions<E extends Env = Env> {
  webhookSecret: string;
  bodyLimit?: number;
  handlerTimeoutMs?: number;
  webhook(input: {
    c: Context<E>;
    event: GitHubEvent;
  }): void | JsonValue | Response | Promise<void | JsonValue | Response>;
}
```

| Field              | Description                                               |
| ------------------ | --------------------------------------------------------- |
| `webhookSecret`    | Secret configured on the GitHub webhook.                  |
| `bodyLimit`        | Maximum request body in bytes. Default: 25 MiB.           |
| `handlerTimeoutMs` | Handler deadline. Default and maximum: 9000 milliseconds. |
| `webhook`          | Receives every verified non-ping delivery.                |

Returning nothing produces an empty `200`. A JSON-compatible value becomes a
JSON response. An ordinary Hono or Fetch `Response` passes through unchanged.
Thrown and timed-out callbacks produce a server error. A timed-out callback
cannot be forcibly stopped and may continue running after the response.

## `GitHubChannel`

```ts
interface GitHubChannel<E extends Env = Env> {
  readonly routes: readonly ChannelRoute<E>[];
  conversationKey(ref: GitHubIssueRef): string;
  parseConversationKey(id: string): GitHubIssueRef;
}
```

`routes` contains one `POST /webhook` declaration used by discovered channel
routing. A file named `channels/github.ts` is served at
`/channels/github/webhook` relative to the `flue()` mount.

Conversation keys are canonical identifiers, not authorization capabilities.
Pull requests use their issue number.

## Events

```ts
type GitHubEvent = GitHubEvents[keyof GitHubEvents] | GitHubUnknownEvent;
```

Known variants:

- `issues.opened`
- `issue_comment.created`
- `pull_request.opened`
- `pull_request_review_comment.created`

```ts
interface GitHubWebhookEvent<TType extends string, TPayload> {
  type: TType;
  deliveryId: string;
  hookId?: string;
  installationTarget?: { id: string; type: string };
  installationId?: number;
  repository: GitHubRepositoryRef;
  sender: GitHubUserRef;
  payload: TPayload;
  raw: unknown;
}
```

`issue_comment.created` identifies whether the containing conversation is an
issue or pull request. `pull_request_review_comment.created` includes the
comment id, top-level thread id, review id, path, and line.

```ts
interface GitHubIssueCommentCreatedPayload {
  issue: {
    number: number;
    title: string;
    kind: 'issue' | 'pull_request';
  };
  comment: { id: number; body: string };
}

interface GitHubPullRequestReviewCommentCreatedPayload {
  pullRequest: { number: number; title: string };
  comment: GitHubPullRequestReviewCommentRef;
}

interface GitHubPullRequestReviewCommentRef {
  id: number;
  // Top-level review comment id used when replying to this thread.
  threadId: number;
  reviewId: number;
  body: string;
  path: string;
  line: number | null;
}
```

Unsupported verified event/action combinations use:

```ts
interface GitHubUnknownEvent {
  type: 'unknown';
  event: string;
  action?: string;
  deliveryId: string;
  hookId?: string;
  installationTarget?: { id: string; type: string };
  installationId?: number;
  raw: unknown;
}
```

GitHub `ping` is acknowledged internally and does not invoke `webhook`.
Signatures are checked against exact request bytes before form or JSON parsing.
The package does not deduplicate `deliveryId`. Header-derived delivery, hook,
and installation-target metadata must not be treated as an authorization
capability.

## Identity

```ts
interface GitHubIssueRef {
  owner: string;
  repo: string;
  issueNumber: number;
}

interface GitHubRepositoryRef {
  id: number;
  owner: string;
  name: string;
}

interface GitHubUserRef {
  id: number;
  login: string;
  type: 'Bot' | 'User' | 'Organization';
}
```

## Errors

- `InvalidGitHubConversationKeyError`
- `InvalidGitHubInputError`, with structured `field`

See [GitHub setup](/docs/guide/channels/github/) for composition with Octokit
and application-owned tools.
