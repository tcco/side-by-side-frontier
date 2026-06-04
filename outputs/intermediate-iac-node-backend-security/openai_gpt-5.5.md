Below is a hardened, production-oriented example using:

- **Docker multi-stage build**
- **Distroless Node.js runtime**
- **Explicit non-root UID/GID**
- **Digest-pinned base images**
- **AWS ECS Fargate task definition**
- **Read-only root filesystem**
- **Writable `/tmp` backed by encrypted Fargate ephemeral storage**
- **Secrets injected from AWS Secrets Manager / SSM Parameter Store, not plaintext env vars**

> Replace the example SHA256 digests with the verified current digests from your registry before use:
>
> ```bash
> docker buildx imagetools inspect node:20.18.1-bookworm-slim
> docker buildx imagetools inspect gcr.io/distroless/nodejs20-debian12:nonroot
> ```

---

## Dockerfile

```dockerfile
# syntax=docker/dockerfile:1.7

################################################################################
# SECURITY: Base images are explicitly SHA256-pinned.
# Replace these example digests with verified digests from your artifact registry.
################################################################################

ARG NODE_BUILDER_IMAGE=node:20.18.1-bookworm-slim@sha256:REPLACE_WITH_VERIFIED_NODE_BUILDER_DIGEST
ARG DISTROLESS_RUNNER_IMAGE=gcr.io/distroless/nodejs20-debian12@sha256:REPLACE_WITH_VERIFIED_DISTROLESS_DIGEST

################################################################################
# Stage 1: Install full dependency graph for build
################################################################################
FROM ${NODE_BUILDER_IMAGE} AS deps

WORKDIR /app

COPY package.json package-lock.json ./

# SECURITY: npm ci provides reproducible installs from package-lock.json.
RUN --mount=type=cache,target=/root/.npm \
    npm ci

################################################################################
# Stage 2: Build compiled artifacts
################################################################################
FROM deps AS build

WORKDIR /app

COPY tsconfig*.json ./
COPY src ./src

# Assumes your service compiles into /app/dist, for example TypeScript.
RUN npm run build

################################################################################
# Stage 3: Install production dependencies only
################################################################################
FROM ${NODE_BUILDER_IMAGE} AS prod-deps

WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./

################################################################################
# SECURITY: Production dependencies only; devDependencies are omitted.
################################################################################
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev && \
    npm cache clean --force

################################################################################
# Stage 4: Create explicit non-root user/group metadata
################################################################################
FROM ${NODE_BUILDER_IMAGE} AS user-builder

################################################################################
# SECURITY: Explicit non-privileged system user/group created during build.
# UID/GID 10001 avoids common host/system IDs.
################################################################################
RUN groupadd \
      --system \
      --gid 10001 \
      appgroup && \
    useradd \
      --system \
      --uid 10001 \
      --gid appgroup \
      --home-dir /nonexistent \
      --no-create-home \
      --shell /usr/sbin/nologin \
      appuser && \
    mkdir -p /out/tmp && \
    chown 10001:10001 /out/tmp

################################################################################
# Stage 5: Final runtime image
################################################################################
FROM ${DISTROLESS_RUNNER_IMAGE} AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV TMPDIR=/tmp

################################################################################
# SECURITY: Copy explicit passwd/group entries into distroless image.
################################################################################
COPY --from=user-builder /etc/passwd /etc/passwd
COPY --from=user-builder /etc/group /etc/group

################################################################################
# SECURITY: Final image contains only production dependencies and compiled output.
################################################################################
COPY --from=prod-deps --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/dist ./dist
COPY --from=prod-deps --chown=10001:10001 /app/package.json ./package.json

# Provides the /tmp mount point. ECS will mount encrypted scratch storage here.
COPY --from=user-builder --chown=10001:10001 /out/tmp /tmp

################################################################################
# SECURITY: Application runs as explicit non-root UID/GID.
################################################################################
USER 10001:10001

EXPOSE 3000

################################################################################
# Distroless Node.js runtime has no shell.
################################################################################
ENTRYPOINT ["/nodejs/bin/node"]
CMD ["dist/server.js"]
```

---

## Terraform: ECS Fargate Task Definition

```hcl
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.60.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

################################################################################
# Variables
################################################################################

variable "aws_region" {
  type        = string
  description = "AWS region."
}

variable "app_name" {
  type        = string
  description = "Application name."
  default     = "node-microservice"
}

variable "container_image" {
  type        = string
  description = "Fully qualified immutable image URI, preferably pinned by digest."

  validation {
    condition     = can(regex("@sha256:[a-fA-F0-9]{64}$", var.container_image))
    error_message = "container_image must be pinned by digest, for example: 123456789012.dkr.ecr.us-east-1.amazonaws.com/app@sha256:..."
  }
}

variable "container_port" {
  type        = number
  description = "Container listen port."
  default     = 3000
}

variable "cpu" {
  type        = number
  description = "Fargate CPU units."
  default     = 512
}

variable "memory" {
  type        = number
  description = "Fargate memory in MiB."
  default     = 1024
}

variable "tmp_ephemeral_storage_gib" {
  type        = number
  description = "Explicit Fargate ephemeral storage allocation backing writable scratch volumes."
  default     = 21

  validation {
    condition     = var.tmp_ephemeral_storage_gib >= 21 && var.tmp_ephemeral_storage_gib <= 200
    error_message = "Fargate ephemeral storage must be between 21 and 200 GiB when explicitly configured."
  }
}

variable "secret_arns" {
  type        = map(string)
  description = "Map of container environment variable names to Secrets Manager or SSM Parameter ARNs. No secret values are stored in Terraform."
  default     = {}
}

variable "secret_kms_key_arns" {
  type        = list(string)
  description = "Optional KMS key ARNs used to encrypt secrets."
  default     = []
}

################################################################################
# KMS key for ECS-managed Fargate ephemeral storage encryption
################################################################################

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "ecs_ephemeral_kms" {
  statement {
    sid = "AllowAccountAdministration"

    principals {
      type = "AWS"
      identifiers = [
        "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
      ]
    }

    actions = [
      "kms:*"
    ]

    resources = ["*"]
  }

  statement {
    sid = "AllowFargateEphemeralStorageUse"

    principals {
      type = "Service"
      identifiers = [
        "fargate.amazonaws.com"
      ]
    }

    actions = [
      "kms:CreateGrant",
      "kms:DescribeKey",
      "kms:GenerateDataKeyWithoutPlaintext",
      "kms:Decrypt"
    ]

    resources = ["*"]
  }
}

resource "aws_kms_key" "ecs_ephemeral" {
  description             = "KMS key for encrypted ECS Fargate ephemeral scratch storage"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.ecs_ephemeral_kms.json
}

resource "aws_kms_alias" "ecs_ephemeral" {
  name          = "alias/${var.app_name}-ecs-ephemeral"
  target_key_id = aws_kms_key.ecs_ephemeral.key_id
}

################################################################################
# ECS Cluster
################################################################################

resource "aws_ecs_cluster" "this" {
  name = var.app_name

  configuration {
    managed_storage_configuration {
      ############################################################################
      # SECURITY: Fargate ephemeral storage, including task bind volumes, is
      # encrypted using this customer-managed KMS key.
      ############################################################################
      fargate_ephemeral_storage_kms_key_id = aws_kms_key.ecs_ephemeral.arn
    }
  }

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

################################################################################
# CloudWatch Logs
################################################################################

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${var.app_name}"
  retention_in_days = 30
}

################################################################################
# IAM: ECS Task Execution Role
################################################################################

data "aws_iam_policy_document" "ecs_task_execution_assume_role" {
  statement {
    actions = [
      "sts:AssumeRole"
    ]

    principals {
      type = "Service"
      identifiers = [
        "ecs-tasks.amazonaws.com"
      ]
    }
  }
}

resource "aws_iam_role" "ecs_task_execution" {
  name               = "${var.app_name}-ecs-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_execution_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

################################################################################
# Optional permissions for secret injection.
# SECURITY: Secret values are not hardcoded. ECS pulls them at runtime from ARNs.
################################################################################

data "aws_iam_policy_document" "ecs_secret_access" {
  count = length(var.secret_arns) > 0 ? 1 : 0

  statement {
    sid = "AllowRuntimeSecretFetch"

    actions = [
      "secretsmanager:GetSecretValue",
      "ssm:GetParameter",
      "ssm:GetParameters"
    ]

    resources = values(var.secret_arns)
  }

  dynamic "statement" {
    for_each = length(var.secret_kms_key_arns) > 0 ? [1] : []

    content {
      sid = "AllowDecryptSecrets"

      actions = [
        "kms:Decrypt"
      ]

      resources = var.secret_kms_key_arns
    }
  }
}

resource "aws_iam_role_policy" "ecs_secret_access" {
  count = length(var.secret_arns) > 0 ? 1 : 0

  name   = "${var.app_name}-secret-access"
  role   = aws_iam_role.ecs_task_execution.id
  policy = data.aws_iam_policy_document.ecs_secret_access[0].json
}

################################################################################
# IAM: Application Task Role
# Add least-privilege application AWS permissions here if needed.
################################################################################

resource "aws_iam_role" "task_role" {
  name               = "${var.app_name}-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_execution_assume_role.json
}

################################################################################
# ECS Task Definition
################################################################################

resource "aws_ecs_task_definition" "app" {
  family                   = var.app_name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"

  cpu    = var.cpu
  memory = var.memory

  execution_role_arn = aws_iam_role.ecs_task_execution.arn
  task_role_arn      = aws_iam_role.task_role.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  ##############################################################################
  # SECURITY: Explicit encrypted ephemeral storage allocation.
  # The cluster KMS setting above encrypts this Fargate ephemeral storage.
  # The /tmp bind volume below is backed by this encrypted storage.
  ##############################################################################
  ephemeral_storage {
    size_in_gib = var.tmp_ephemeral_storage_gib
  }

  ##############################################################################
  # SECURITY: Explicit scratch volume for /tmp.
  # For Fargate, an unnamed host bind volume is task-scoped ephemeral storage.
  ##############################################################################
  volume {
    name = "tmp-scratch"
  }

  container_definitions = jsonencode([
    {
      name      = var.app_name
      image     = var.container_image
      essential = true

      ############################################################################
      # SECURITY: Reinforces non-root execution at orchestrator level.
      ############################################################################
      user = "10001:10001"

      portMappings = [
        {
          containerPort = var.container_port
          hostPort      = var.container_port
          protocol      = "tcp"
        }
      ]

      ############################################################################
      # SECURITY: Root filesystem is immutable/read-only.
      ############################################################################
      readonlyRootFilesystem = true

      ############################################################################
      # SECURITY: Writable /tmp is isolated to the encrypted scratch volume.
      ############################################################################
      mountPoints = [
        {
          sourceVolume  = "tmp-scratch"
          containerPath = "/tmp"
          readOnly      = false
        }
      ]

      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "TMPDIR"
          value = "/tmp"
        }
      ]

      ############################################################################
      # SECURITY: Secrets are referenced by ARN, not hardcoded plaintext values.
      ############################################################################
      secrets = [
        for env_name, secret_arn in var.secret_arns : {
          name      = env_name
          valueFrom = secret_arn
        }
      ]

      ############################################################################
      # SECURITY: Drop Linux capabilities. Distroless + non-root should not need any.
      ############################################################################
      linuxParameters = {
        initProcessEnabled = true

        capabilities = {
          drop = [
            "ALL"
          ]
        }
      }

      logConfiguration = {
        logDriver = "awslogs"

        options = {
          awslogs-group         = aws_cloudwatch_log_group.app.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = var.app_name
        }
      }
    }
  ])
}
```

---

## Security Constraints Mapping

| Requirement | Satisfied By |
|---|---|
| Docker multi-stage build | `deps`, `build`, `prod-deps`, `user-builder`, `runner` stages |
| Final image only has production deps/artifacts | Final stage copies only `node_modules` from `prod-deps` and `dist` from `build` |
| Non-root execution | Docker `USER 10001:10001` and ECS `user = "10001:10001"` |
| Explicit non-privileged user/group created during build | `groupadd` / `useradd` in `user-builder` stage |
| Minimal pinned base image | Distroless final image with `@sha256:` digest |
| ECS task definition | `aws_ecs_task_definition.app` |
| Read-only root filesystem | `readonlyRootFilesystem = true` |
| Secure encrypted `/tmp` scratch | ECS `volume "tmp-scratch"` mounted to `/tmp`, backed by explicitly allocated Fargate ephemeral storage encrypted with KMS |
| No hardcoded secrets | `secrets` populated from `var.secret_arns`; only ARNs are referenced |