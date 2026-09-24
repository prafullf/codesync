# Build from the repo root: docker build -f apps/worker/Dockerfile .
FROM node:20-alpine AS build
# Prisma needs OpenSSL to pick the right query engine.
RUN apk add --no-cache openssl
RUN npm install -g pnpm@9.15.9
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter @codesync/worker... \
 && pnpm --filter @codesync/worker build

FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
# Runs as root only to reach /var/run/docker.sock. Note: access to the Docker
# socket is root-equivalent on the host; see README "Security" for hardening.
CMD ["node", "apps/worker/dist/index.js"]
