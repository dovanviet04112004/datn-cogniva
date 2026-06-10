# Socket.IO gateway (@cogniva/realtime) — chạy bằng tsx (transpile on-the-fly, dùng
# chung TS source của @cogniva/shared mà không cần bước build/bundle riêng).
#
# Build context = REPO ROOT (xem docker-compose: context ../.., dockerfile apps/realtime/Dockerfile)
# để truy cập được workspace deps (packages/shared, tooling/tsconfig).
FROM node:20-alpine
RUN corepack enable
WORKDIR /app

# Copy manifest trước để tận dụng layer cache khi cài deps.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY tooling/ tooling/
COPY packages/shared/ packages/shared/
COPY apps/realtime/ apps/realtime/

# Cài deps cho gateway + workspace deps của nó (… = include dependencies).
RUN pnpm install --filter @cogniva/realtime...

EXPOSE 6002
CMD ["pnpm", "--filter", "@cogniva/realtime", "start"]
