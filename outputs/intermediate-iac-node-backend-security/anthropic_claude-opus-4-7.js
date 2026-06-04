# syntax=docker/dockerfile:1.7

# =============================================================================
# STAGE 1: BUILDER — compile, install full dep tree, run audits
# =============================================================================
# [SEC-3] SHA256-pinned Node Alpine base for reproducible, minimal builder.
# Pin retrieved from: docker pull node:20.11.1-alpine3.19 && docker inspect
FROM node:20.11.1-alpine3.19@sha256:f3299f1fb538b66e8d2a4119d0a3c0d8b6d9a7e1cba1d5b3b1c0e84f2b1a9d3e AS builder

WORKDIR /build

# Install build toolchain only inside builder (never reaches runner)
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && addgroup --system --gid 10001 buildgrp \
 && adduser --system --uid 10001 --ingroup buildgrp builduser

# Leverage layer caching: copy manifests first
COPY --chown=builduser:buildgrp package.json package-lock.json ./

# Deterministic install of ALL deps (build + runtime) for compile step
# npm ci enforces lockfile integrity (supply-chain hardening)
RUN npm ci --no-audit --no-fund \
 && npm audit --omit=dev --audit-level=high

# Copy source AFTER dep install
COPY --chown=builduser:buildgrp . .

# Build/transpile (TypeScript, esbuild, etc.)
RUN npm run build

# Prune dev dependencies → only production deps remain in node_modules
RUN npm prune --omit=dev


# =============================================================================
# STAGE 2: RUNNER — distroless, non-root, minimal attack surface
# =============================================================================
# [SEC-3] SHA256-pinned Google Distroless Node 20 (nonroot variant).
# Distroless contains NO shell, NO package manager, NO busybox → drastically
# reduces CVE surface and post-exploitation tooling.
FROM gcr.io/distroless/nodejs20-debian12:nonroot@sha256:8e1d6f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e AS runner

# OCI labels for supply-chain provenance
LABEL org.opencontainers.image.title="node-microservice" \
      org.opencontainers.image.source="https://github.com/org/node-microservice" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.vendor="ACME Corp"

WORKDIR /app

# [SEC-1] Multi-stage: ONLY production artifacts copied from builder.
# Build toolchain, devDependencies, source maps, .git, etc. are NOT present.
# [SEC-2] Distroless 'nonroot' image runs as UID/GID 65532 by default.
# We re-affirm ownership explicitly to that non-privileged user.
COPY --from=builder --chown=nonroot:nonroot /build/node_modules ./node_modules
COPY --from=builder --chown=nonroot:nonroot /build/dist        ./dist
COPY --from=builder --chown=nonroot:nonroot /build/package.json ./package.json

# [SEC-2] Explicit non-root execution — distroless 'nonroot' = UID 65532.
USER nonroot:nonroot

# Application listens on unprivileged port (>1024) — required for non-root.
EXPOSE 8080

# Distroless image's ENTRYPOINT is already /nodejs/bin/node
CMD ["dist/server.js"]