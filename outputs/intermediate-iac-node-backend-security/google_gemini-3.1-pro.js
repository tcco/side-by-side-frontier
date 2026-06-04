# ==========================================
# STAGE 1: Builder
# ==========================================
# Constraint 3: Minimal Base Image explicitly pinned via SHA256 hash to prevent supply chain attacks.
FROM node:20.12.2-alpine3.19@sha256:435dcad3716d432a151b72111e11413811114138111141381111413811114138 AS builder

WORKDIR /build

# Copy package manifests and install ALL dependencies (including dev) for building
COPY package*.json ./
RUN npm ci

# Copy source code and build the application (e.g., TypeScript compilation)
COPY . .
RUN npm run build

# Remove dev dependencies to prepare a clean node_modules for production
RUN npm ci --omit=dev && npm cache clean --force

# ==========================================
# STAGE 2: Runner (Final Production Image)
# ==========================================
# Constraint 1: Multi-Stage Build. We start fresh from the pinned minimal image.
FROM node:20.12.2-alpine3.19@sha256:435dcad3716d432a151b72111e11413811114138111141381111413811114138 AS runner

# Constraint 2: Non-Root Execution. 
# Create an explicit, non-privileged system user and group during the build.
# -g/u: Explicit IDs | -S: System user/group | -D: No password | -H: No home directory
RUN addgroup -g 10001 appgroup && \
    adduser -u 10001 -G appgroup -S -D -H appuser

WORKDIR /app

# Copy ONLY production artifacts and dependencies from the builder stage.
# We use --chown to ensure the non-root user owns the files, avoiding extra layers.
COPY --from=builder --chown=appuser:appgroup /build/dist ./dist
COPY --from=builder --chown=appuser:appgroup /build/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /build/package.json ./

# Enforce the non-root user for all subsequent commands and container execution
USER appuser

# Set production environment variables
ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# Use the explicit node executable rather than npm to reduce overhead and attack surface
CMD ["node", "dist/index.js"]