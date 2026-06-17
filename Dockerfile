# syntax=docker/dockerfile:1

############################
# Build stage: compile the Flue Node server + React UI for examples/react-chat.
#
# Unlike the standalone Dockerfile in the docs, react-chat is a pnpm workspace
# package (workspace:* deps), so it is built inside the full monorepo: Turbo
# builds the @flue/* dependencies first (^build), then the example's UI (vite)
# and Node server (flue build -> dist/server/server.mjs).
############################
FROM node:24-bookworm-slim AS build

# China network optimization: route apt, npm/pnpm, corepack, and node-gyp
# header downloads through domestic mirrors. (Docker Hub base-image pulls are
# handled by the host daemon's registry-mirrors.)
#
# corepack's pnpm download and node-gyp headers go through domestic mirrors.
# The npm registry itself is configured per-project via .npmrc below.
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com \
	npm_config_disturl=https://registry.npmmirror.com/-/binary/node

# Toolchain for native optional deps (e.g. msgpackr-extract) allowed by
# pnpm-workspace.yaml#allowBuilds. Point apt at the Aliyun mirror first.
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' \
		/etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
	sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com|g' \
		/etc/apt/sources.list 2>/dev/null || true; \
	apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# Pin pnpm to the version the repo declares (packageManager field).
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.1.1 --activate

WORKDIR /app

# Copy the whole workspace (build context). .dockerignore strips the heavy stuff.
COPY . .

ENV CI=1
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH

# Registry for pnpm: the Tencent npm mirror is China-fast and, unlike npmmirror,
# serves large platform binaries intact (npmmirror returns a truncated tarball
# for @cloudflare/workerd-*, which @flue/cli's build pulls in eagerly via
# @cloudflare/vite-plugin).
RUN echo 'registry=https://mirrors.cloud.tencent.com/npm/' >> /app/.npmrc

# Install with the lockfile as-is, caching the pnpm store across builds.
RUN --mount=type=cache,id=pnpm-store-v4,target=/pnpm/store \
	pnpm config set store-dir /pnpm/store \
	&& pnpm install --frozen-lockfile

# Build the example. Turbo resolves and builds workspace dependencies first.
RUN pnpm exec turbo run build --filter=react-chat-example

# Produce a self-contained, production-only deployment. pnpm copies the
# workspace dependencies into a standalone node_modules so the runtime image
# needs neither the rest of the monorepo nor dev dependencies.
RUN --mount=type=cache,id=pnpm-store-v4,target=/pnpm/store \
	pnpm --filter=react-chat-example --legacy deploy --prod /prod

############################
# Runtime stage: lean Node image with production deps + build artifacts only.
############################
FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
# The generated server binds PORT (default 3000); the docs image uses 8080.
ENV PORT=8080

COPY --from=build /prod/node_modules ./node_modules
COPY --from=build /app/examples/react-chat/package.json ./package.json
# server.mjs serves the static UI from ./dist/client relative to the cwd.
COPY --from=build /app/examples/react-chat/dist ./dist

# Drop superuser privileges (the node image ships a non-root `node` user).
USER node

EXPOSE 8080

# Exec form so SIGTERM reaches Node directly; run the container with an init
# (compose `init: true`) for clean PID-1 signal handling and child reaping.
CMD ["node", "dist/server/server.mjs"]
