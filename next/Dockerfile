# syntax=docker/dockerfile:1

# -----------------------------------------------------------------------------
# Base
# -----------------------------------------------------------------------------

FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN corepack enable

WORKDIR /app


# -----------------------------------------------------------------------------
# Dependencies
# -----------------------------------------------------------------------------

FROM base AS deps

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile


# -----------------------------------------------------------------------------
# Build
# -----------------------------------------------------------------------------

FROM base AS builder

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm build


# -----------------------------------------------------------------------------
# Production
# -----------------------------------------------------------------------------

FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Important:
# Use a fixed shared location instead of ~/.cache/ms-playwright.
# Otherwise installing the browsers as root and running Next.js as another
# user can cause Playwright to look in a different browser directory.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright


# -----------------------------------------------------------------------------
# Copy Next.js standalone output
# -----------------------------------------------------------------------------

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public


# -----------------------------------------------------------------------------
# Fix standalone dependencies
# -----------------------------------------------------------------------------
#
# Next.js standalone output contains a traced subset of node_modules.
#
# Playwright dynamically reads files such as:
#
#   playwright-core/browsers.json
#
# Next.js output tracing can miss such files. Installing production
# dependencies here guarantees that the complete Playwright package exists.
#
# IMPORTANT: this must happen AFTER copying .next/standalone.
# -----------------------------------------------------------------------------

COPY package.json pnpm-lock.yaml ./

RUN pnpm install \
    --prod \
    --frozen-lockfile


# -----------------------------------------------------------------------------
# Install Chromium + Linux dependencies
# -----------------------------------------------------------------------------

RUN pnpm exec playwright install --with-deps chromium


# Verify during image build instead of discovering missing files in production.
RUN node -e "\
    const fs = require('fs'); \
    const path = require('path'); \
    const pkg = require.resolve('playwright-core/package.json'); \
    const browsers = path.join(path.dirname(pkg), 'browsers.json'); \
    console.log('playwright-core:', pkg); \
    console.log('browsers.json:', browsers); \
    if (!fs.existsSync(browsers)) { \
      throw new Error('playwright-core/browsers.json is missing'); \
    } \
    console.log('Playwright installation OK'); \
    "


# -----------------------------------------------------------------------------
# Non-root user
# -----------------------------------------------------------------------------

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs \
    && chown -R nextjs:nodejs /app \
    && chmod -R a+rX /ms-playwright

USER nextjs


# -----------------------------------------------------------------------------
# Start Next.js standalone server
# -----------------------------------------------------------------------------

EXPOSE 3000

CMD ["node", "server.js"]
