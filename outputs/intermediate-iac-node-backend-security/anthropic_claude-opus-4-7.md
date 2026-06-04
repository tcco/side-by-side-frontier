# Production-Ready Node.js Microservice: Secure Dockerfile + Terraform

Below is a hardened, production-grade implementation. Every security constraint is explicitly called out via inline comments prefixed with `# [SEC-x]` or `// [SEC-x]`.

---

## 1. Dockerfile (Multi-Stage, Distroless, Non-Root)

```dockerfile
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
```

### Dockerfile Security Highlights

| Constraint | Satisfied By |
|---|---|
| **Multi-stage** | `builder` produces artifacts; `runner` only `COPY --from=builder` of `node_modules`, `dist`, `package.json`. No source, no toolchain. |
| **Non-root** | Distroless `nonroot` tag → UID 65532; reinforced with `USER nonroot:nonroot`. |
| **Minimal base + SHA256 pin** | `gcr.io/distroless/nodejs20-debian12:nonroot@sha256:…` — no shell, no apt, no busybox. |
| **Supply-chain** | `npm ci` (lockfile integrity), `npm audit --audit-level=high`, `npm prune --omit=dev`. |

> ⚠️ **Replace the SHA256 digests** with current values from `docker buildx imagetools inspect <image>` before production use. Placeholders shown.

---

## 2. Terraform — AWS ECS Fargate Task Definition

```hcl
# =============================================================================
# variables.tf
# =============================================================================
variable "aws_region"      { type = string; default = "us-east-1" }
variable "service_name"    { type = string; default = "node-microservice" }
variable "image_uri"       { type = string } # e.g. <acct>.dkr.ecr.us-east-1.amazonaws.com/node-svc@sha256:...
variable "kms_key_arn"     { type = string } # Customer-Managed KMS for EFS + Secrets
variable "vpc_subnet_ids"  { type = list(string) }


# =============================================================================
# providers.tf
# =============================================================================
terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.40" }
  }
}

provider "aws" {
  region = var.aws_region
}


# =============================================================================
# secrets.tf — [SEC-T4] No plaintext credentials in TF state/source.
# Secrets live in AWS Secrets Manager; only ARNs referenced.
# =============================================================================
data "aws_secretsmanager_secret" "db_url" {
  name = "${var.service_name}/db_url"
}

data "aws_secretsmanager_secret" "api_key" {
  name = "${var.service_name}/api_key"
}


# =============================================================================
# iam.tf — Task execution & task roles (least privilege)
# =============================================================================
data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_execution" {
  name               = "${var.service_name}-exec-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "exec_managed" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Allow execution role to fetch the specific secrets + decrypt with CMK
data "aws_iam_policy_document" "secrets_access" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [data.aws_secretsmanager_secret.db_url.arn,
                 data.aws_secretsmanager_secret.api_key.arn]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [var.kms_key_arn]
  }
}

resource "aws_iam_role_policy" "secrets_access" {
  role   = aws_iam_role.task_execution.id
  policy = data.aws_iam_policy_document.secrets_access.json
}

resource "aws_iam_role" "task_role" {
  name               = "${var.service_name}-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}


# =============================================================================
# efs.tf — [SEC-T3] Encrypted EFS volume for /tmp scratch space.
# Encryption at rest (CMK) + encryption in transit (TLS) enforced.
# =============================================================================
resource "aws_efs_file_system" "scratch" {
  creation_token   = "${var.service_name}-scratch"
  encrypted        = true              # [SEC-T3] Encryption at rest
  kms_key_id       = var.kms_key_arn   # [SEC-T3] Customer-managed key
  performance_mode = "generalPurpose"
  throughput_mode  = "bursting"

  lifecycle_policy {
    transition_to_ia = "AFTER_7_DAYS"
  }

  tags = { Name = "${var.service_name}-scratch", Sensitivity = "ephemeral" }
}

resource "aws_efs_access_point" "scratch" {
  file_system_id = aws_efs_file_system.scratch.id

  # Force ownership to distroless nonroot UID/GID (65532)
  posix_user {
    uid = 65532
    gid = 65532
  }

  root_directory {
    path = "/scratch"
    creation_info {
      owner_uid   = 65532
      owner_gid   = 65532
      permissions = "0700"
    }
  }
}


# =============================================================================
# logs.tf
# =============================================================================
resource "aws_cloudwatch_log_group" "svc" {
  name              = "/ecs/${var.service_name}"
  retention_in_days = 30
  kms_key_id        = var.kms_key_arn   # Encrypted log group
}


# =============================================================================
# ecs.tf — Task Definition with hardened container
# =============================================================================
resource "aws_ecs_task_definition" "svc" {
  family                   = var.service_name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task_role.arn

  # [SEC-T3] EFS volume declaration with in-transit encryption
  volume {
    name = "scratch-tmp"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.scratch.id
      transit_encryption = "ENABLED"                              # [SEC-T3] TLS
      authorization_config {
        access_point_id = aws_efs_access_point.scratch.id
        iam             = "ENABLED"
      }
    }
  }

  container_definitions = jsonencode([
    {
      name      = var.service_name
      image     = var.image_uri          # Should be a SHA256-digest reference
      essential = true

      # [SEC-T2] Read-only root filesystem — container cannot write anywhere
      # except explicitly mounted volumes (the EFS scratch mount below).
      readonlyRootFilesystem = true

      # Additional hardening
      user       = "65532:65532"          # Reinforce non-root at task layer
      privileged = false
      linuxParameters = {
        initProcessEnabled = true
        capabilities = {
          drop = ["ALL"]                  # Drop all Linux capabilities
        }
      }

      # [SEC-T3] Mount encrypted EFS at /tmp for scratch writes
      mountPoints = [
        {
          sourceVolume  = "scratch-tmp"
          containerPath = "/tmp"
          readOnly      = false
        }
      ]

      portMappings = [
        { containerPort = 8080, protocol = "tcp" }
      ]

      # [SEC-T4] Secrets injected at runtime from Secrets Manager.
      # Values NEVER appear in Terraform code, plan, or state in plaintext.
      secrets = [
        { name = "DATABASE_URL", valueFrom = data.aws_secretsmanager_secret.db_url.arn },
        { name = "API_KEY",      valueFrom = data.aws_secretsmanager_secret.api_key.arn }
      ]

      # Only non-sensitive config in plain env
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT",     value = "8080" },
        { name = "TMPDIR",   value = "/tmp" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.svc.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD", "/nodejs/bin/node", "-e", "require('http').get('http://localhost:8080/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 10
      }
    }
  ])

  tags = {
    Service    = var.service_name
    ManagedBy  = "terraform"
    Hardened   = "true"
  }
}
```

---

## 3. Security Constraint Mapping

| # | Constraint | Implementation Location |
|---|---|---|
| **D1** | Multi-stage build | Dockerfile `builder` → `runner`; only `node_modules`, `dist`, `package.json` copied. `npm prune --omit=dev` removes dev deps. |
| **D2** | Non-root execution | Dockerfile `USER nonroot:nonroot` (UID 65532) + ECS `user = "65532:65532"`. |
| **D3** | Minimal, SHA256-pinned base | `gcr.io/distroless/nodejs20-debian12:nonroot@sha256:…` — no shell, no pkg manager. |
| **T1** | ECS Task Definition | `aws_ecs_task_definition.svc` on Fargate. |
| **T2** | Read-only root FS | `readonlyRootFilesystem = true` in container definition. |
| **T3** | Encrypted scratch volume at `/tmp` | EFS with `encrypted=true` + CMK + `transit_encryption=ENABLED` + access point pinned to UID 65532, mounted at `/tmp`. |
| **T4** | No hardcoded secrets | `secrets` block references Secrets Manager ARNs only; `data.aws_secretsmanager_secret` lookups. No plaintext in TF. |

---

## 4. Additional Hardening Recommendations (Beyond Requirements)

1. **Image signing**: Sign images with **Cosign**; verify in ECS via Sigstore policy controller or AWS Signer.
2. **Terraform state**: Store state in S3 with SSE-KMS + DynamoDB lock; never commit `.tfstate`.
3. **Drift detection**: Run `tfsec`, `checkov`, and `trivy config` in CI on this Terraform.
4. **Image scanning**: `trivy image --severity HIGH,CRITICAL --exit-code 1 <image>` in CI gate.
5. **Network**: Place tasks in private subnets; egress via NAT/VPC endpoints only; security group restricted to ALB SG.
6. **Runtime**: Enable **GuardDuty ECS Runtime Monitoring** for syscall-level threat detection.
7. **SBOM**: Generate with `syft` at build time and attach as image attestation.