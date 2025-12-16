# Build stage: Build SDK and prepare dependencies
FROM node:20-alpine AS builder

# Install pnpm and turbo
RUN npm install -g pnpm@8.6.10 turbo@^2.0.6

WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY turbo.json ./

# Copy SDK package source (including index.js files for Deno imports)
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/sdk/tsconfig.json ./packages/sdk/
COPY packages/sdk/rollup.config.js ./packages/sdk/
COPY packages/sdk/index.js ./packages/sdk/
COPY packages/sdk/api/index.js ./packages/sdk/api/
COPY packages/sdk/mongoose/index.js ./packages/sdk/mongoose/
COPY packages/sdk/src ./packages/sdk/src

# Copy rollup-config package (dependency of SDK)
COPY packages/rollup-config/package.json ./packages/rollup-config/
COPY packages/rollup-config/*.js ./packages/rollup-config/

# Install dependencies and build SDK
RUN pnpm install --frozen-lockfile && \
    pnpm --filter @kpk/gnosis-pay-rewards-sdk build

# Runtime stage: Use Deno to run the application
# Using Deno 2.3.5+ to support lockfile version 5
FROM denoland/deno:2.3.5 AS runner

# Set up cache directory for the existing deno user
# The Deno image already includes a deno user, so we just need to set up the cache dir
RUN mkdir -p /home/deno/.cache/deno && \
    chown -R deno:deno /home/deno

# Set DENO_DIR before caching
ENV DENO_DIR=/home/deno/.cache/deno

WORKDIR /app

# Copy built SDK from builder stage (including dist directory and index.js files)
COPY --from=builder --chown=deno:deno /app/packages/sdk ./packages/sdk

# Copy the indexer app
COPY --chown=deno:deno apps/gnosis-pay-rewards-indexer ./apps/gnosis-pay-rewards-indexer

# Set working directory to the app
WORKDIR /app/apps/gnosis-pay-rewards-indexer

# Cache Deno dependencies as deno user (this will download and cache all imports)
# Cache all entry points that will be executed
# Node.js globals are polyfilled via polyfill-node-globals.ts
USER deno
RUN deno cache --lock=deno.lock \
    src/start-all.ts \
    src/start-http-server.ts \
    src/start-indexer.ts \
    src/index.ts

# Set environment variables
ENV NODE_ENV=production
ENV IS_DOCKER=true

# Expose default HTTP server port (can be overridden via env)
EXPOSE 8000

# Run the application (Node.js globals polyfilled via polyfill-node-globals.ts)
CMD ["deno", "run", "-A", "src/start-all.ts"]
