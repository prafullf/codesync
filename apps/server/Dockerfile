# Build from the repo root: docker build -f apps/server/Dockerfile .
FROM node:20-alpine AS build
# Prisma needs OpenSSL to pick the right query engine.
RUN apk add --no-cache openssl
RUN npm install -g pnpm@9.15.9
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter @codesync/server... \
 && pnpm --filter @codesync/server build

FROM node:20-alpine
RUN apk add --no-cache openssl
RUN npm install -g pnpm@9.15.9
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 4000
# Apply pending migrations, then start. (Migrations are idempotent.)
CMD ["sh", "-c", "pnpm --filter @codesync/db migrate:deploy:prod && exec node apps/server/dist/index.js"]
