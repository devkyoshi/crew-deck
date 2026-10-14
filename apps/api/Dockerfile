FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @crew-deck/api...

FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /repo/packages/shared/node_modules ./packages/shared/node_modules
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
# Attachments (STORAGE_DIR); mount a volume here so files survive new containers.
RUN mkdir -p /data/files && chown node:node /data/files
USER node
WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["node_modules/.bin/tsx", "src/server.ts"]
