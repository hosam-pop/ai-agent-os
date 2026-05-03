# syntax=docker/dockerfile:1.7

# =============================================================================
# Stage 1: deps+build with Bun (fast install, TSX handling).
# =============================================================================
FROM oven/bun:1.1 AS builder
WORKDIR /app

# Native modules (better-sqlite3) need python3 + a C++ toolchain to compile.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Install dependencies first (leverage layer cache).
COPY package.json ./
RUN bun install --no-save

# Copy source and compile TypeScript via tsc (uses devDependency typescript).
COPY tsconfig.json ./
COPY src ./src
RUN bun x tsc -p tsconfig.json

# =============================================================================
# Stage 2: minimal runtime on Node.js 20.
# =============================================================================
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV DOGE_HOME=/home/node/.doge
ENV DOGE_WORKSPACE=/workspace

# Toolchain for native modules in the prod install (better-sqlite3 et al).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Copy built artifacts and production node_modules layout.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=builder /app/dist ./dist

RUN useradd -m -u 1001 agentos \
  && mkdir -p /workspace /home/node/.doge \
  && chown -R agentos /workspace /home/node/.doge /app

USER agentos

VOLUME ["/workspace"]

ENTRYPOINT ["node", "/app/dist/cli/commands.js"]
CMD ["--help"]
