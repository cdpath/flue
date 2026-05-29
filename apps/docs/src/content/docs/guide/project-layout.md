---
title: Project Layout
description: Understand the source files and generated output in a Flue project.
lastReviewedAt: 2026-05-29
---

Flue uses file-based conventions to structure your application. Where you place an agent, workflow, or application entrypoint determines how Flue discovers and builds it. This guide introduces the recommended project layout and the directories you can customize as your application grows.

## Example project layout

```text
my-project/
├─ package.json
├─ flue.config.ts
├─ src/
│  ├─ app.ts
│  ├─ agents/
│  │  └─ support-assistant.ts
│  └─ workflows/
│     └─ summarize-ticket.ts
└─ dist/
```

You can organize your application code however you prefer inside the source directory. However, be aware that certain files and folders have special meaning and are reserved by Flue for certain purposes, as covered below.

## Important files and directories

| Path | Purpose | Learn more |
| --- | --- | --- |
| `app.ts` | Optional entrypoint for composing Flue with your application's routes and middleware. | [Routing](/docs/guide/routing/) |
| `agents/` | Addressable agents that can receive continuing interactions over time. | [Agents](/docs/guide/building-agents/) |
| `workflows/` | Finite operations that receive input and return a result. | [Workflows](/docs/guide/workflows/) |

### `app.ts`

`app.ts` is an optional custom application entrypoint. Add it when your server needs to compose Flue routes with application behavior such as authentication, webhooks, health endpoints, or a route prefix. A project without `app.ts` uses Flue's generated application directly.

For more information, see [Routing](/docs/guide/routing/).

### `agents/`

The `agents/` directory contains agents that Flue can address by name. Each immediate file defines one discovered agent, and its filename becomes the agent name: `src/agents/support-assistant.ts` is discovered as `support-assistant`.

Keep agent files flat inside `agents/`; nested files are not discovered as additional agents. Prefer lower-kebab-case filenames such as `support-assistant.ts` so names remain portable across deployment targets.

For more information, see [Agents](/docs/guide/building-agents/).

### `workflows/`

The `workflows/` directory contains finite operations that Flue can invoke by name. Each immediate file defines one discovered workflow, and its filename becomes the workflow name: `src/workflows/summarize-ticket.ts` is discovered as `summarize-ticket`.

Keep workflow files flat inside `workflows/`; nested files are not discovered as additional workflows. Prefer lower-kebab-case filenames such as `summarize-ticket.ts` so names remain portable across deployment targets.

For more information, see [Workflows](/docs/guide/workflows/).

## Customizing the `src/` directory

Flue uses `src/` as its recommended source directory. If your project needs a different layout, Flue supports authored source files in three locations, checked in the following priority order:

1. `.flue/` — Use this when adding Flue to a larger existing application, such as for GitHub or GitLab CI automation.
2. `src/` **(Recommended)** — This is the recommended layout for new projects and keeps all source files in the familiar `src/` directory.
3. The project root — Use this when you prefer a small, focused project without a source directory. Although we recommend either of the directories above, this layout is supported for developers who prefer it.

The first matching directory wins. For example, if  `.flue/` exists, modules in `src/` and the project root are ignored and not discovered (unless imported from within the `.flue` directory, however reaching outside of the source directory like this is not recommended).

The source directory is always discovered relative to your project root. To configure the project root, see [Configuration](/docs/guide/configuration/).

## Customizing the `dist/` directory

`dist/` is the default output directory for generated build artifacts. It is created at the project root when you build the application; it is not part of authored source discovery.

To change where generated artifacts are written, set `output` in `flue.config.ts`:

```ts title="flue.config.ts"
import { defineConfig } from '@flue/cli/config';

export default defineConfig({
  output: './build',
});
```

For more information about project and output configuration, see [Configuration](/docs/guide/configuration/).
