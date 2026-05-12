# Hocuspocus Yjs server — production Docker image.
#
# Multi-stage build:
#   1. deps   — install full deps (cần dev deps để build TS)
#   2. build  — compile TS → dist/
#   3. runner — copy dist + production deps + run
FROM node:20-alpine AS deps
WORKDIR /app
RUN npm install -g pnpm@9.15.0
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm install -g pnpm@9.15.0
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S hocus -u 1001
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
USER hocus
EXPOSE 1234
CMD ["node", "dist/server.js"]
