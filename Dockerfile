# CRDT Canvas — one container serving the offline-first app and the signaling relay.
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
RUN pnpm --filter @crdt-canvas/client build && pnpm --filter @crdt-canvas/server build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/public
RUN corepack enable
COPY --from=build /app/apps/server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/client/dist ./public
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "dist/index.js"]
