# syntax=docker/dockerfile:1

ARG NODE_VERSION=24
ARG PNPM_VERSION=12.6.0

# Build the frontend. The output is platform independent, so it is built only
# once on the build platform, even for multi-arch builds.
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS build
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @inventur/web build

# Production dependencies of the server for the target platform.
FROM node:${NODE_VERSION}-alpine AS prod-deps
ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@inventur/server..."

FROM node:${NODE_VERSION}-alpine
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    HOST=0.0.0.0 \
    PORT=3000 \
    STATIC_DIR=/app/web
WORKDIR /app
COPY --from=prod-deps /app ./
COPY packages/shared/src packages/shared/src
COPY apps/server/src apps/server/src
# Commands for `docker compose run --rm app <command>`
COPY --chmod=755 apps/server/bin/ /usr/local/bin/
COPY --from=build /app/apps/web/dist web
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "apps/server/src/index.ts"]
