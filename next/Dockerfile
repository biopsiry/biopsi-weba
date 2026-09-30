# syntax=docker/dockerfile:1

# =============================================================================
# Base
# =============================================================================

FROM node:24-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Prisma requires OpenSSL to detect the correct query-engine target.
# ca-certificates is also useful for HTTPS connections from Node/Playwright.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        openssl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app


# =============================================================================
# Dependencies
# =============================================================================

FROM base AS deps

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile


# =============================================================================
# Builder
# =============================================================================

FROM base AS builder

ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules

COPY . .

# Verify Prisma will see OpenSSL 3.
RUN echo "OpenSSL version during build:" \
    && openssl version

# package.json build command already runs:
#
#   prisma generate && next build
#
RUN pnpm build


# =============================================================================
# Production runtime
# =============================================================================

FROM base AS runner

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Keep Playwright browsers in a shared location instead of root's home/cache.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright


# -----------------------------------------------------------------------------
# Next.js standalone build
# -----------------------------------------------------------------------------

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public


# -----------------------------------------------------------------------------
# Install complete runtime dependency tree
# -----------------------------------------------------------------------------

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma

RUN pnpm install --frozen-lockfile


# -----------------------------------------------------------------------------
# Prisma
# -----------------------------------------------------------------------------

RUN echo "OpenSSL version during runtime build:" \
    && openssl version

# Generate Prisma Client directly on Debian Bookworm/OpenSSL 3.
RUN pnpm exec prisma generate

# Fail the Docker build immediately if the correct Prisma engine wasn't
# generated.
RUN echo "Checking Prisma OpenSSL 3 engine..." \
    && find node_modules \
        -type f \
        -name '*debian-openssl-3.0.x*' \
        -print \
    && find node_modules \
        -type f \
        -name '*debian-openssl-3.0.x*' \
        | grep -q .


# -----------------------------------------------------------------------------
# Playwright
# -----------------------------------------------------------------------------

# Make sure the complete playwright-core package exists.
RUN node -e "\
    const fs = require('fs'); \
    const path = require('path'); \
    const pkg = require.resolve('playwright-core/package.json'); \
    const browsers = path.join(path.dirname(pkg), 'browsers.json'); \
    console.log('playwright-core package:', pkg); \
    console.log('browsers.json:', browsers); \
    if (!fs.existsSync(browsers)) { \
      throw new Error('playwright-core/browsers.json is missing'); \
    } \
    console.log('Playwright package check OK'); \
    "

# Install Chromium and all required Debian system packages.
RUN pnpm exec playwright install --with-deps chromium


# -----------------------------------------------------------------------------
# Production environment
# -----------------------------------------------------------------------------

ENV NODE_ENV=production


# -----------------------------------------------------------------------------
# Non-root user
# -----------------------------------------------------------------------------

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system \
        --uid 1001 \
        --gid nodejs \
        nextjs

# Allow the Next.js process to access application files and Playwright browser.
RUN chown -R nextjs:nodejs /app \
    && chown -R nextjs:nodejs /ms-playwright \
    && chmod -R a+rX /ms-playwright

USER nextjs


# =============================================================================
# Start
# =============================================================================

EXPOSE 3000

CMD ["node", "server.js"]
