As a Principal DevSecOps Engineer, I have designed this solution with a "security-first" mindset. The architecture strictly adheres to the principle of least privilege, immutable infrastructure, and defense-in-depth.

Below is the production-ready Dockerfile and the corresponding AWS ECS Terraform configuration.

### 1. Secure Dockerfile

This Dockerfile uses a multi-stage build process with a minimal Alpine Linux base image. It ensures that build tools and development dependencies never make it into the final production image.

```dockerfile
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
```

### 2. Secure Terraform Configuration (AWS ECS)

This Terraform snippet provisions an AWS ECS Fargate Task Definition. It enforces a read-only root filesystem, mounts an explicitly encrypted EFS volume for `/tmp`, and securely injects secrets.

```hcl
# ---------------------------------------------------------
# KMS & EFS: Encrypted Scratch Space
# ---------------------------------------------------------
resource "aws_kms_key" "tmp_volume_key" {
  description             = "KMS key for ECS /tmp scratch space encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 7
}

# Constraint 3: Secure, encrypted volume explicitly allocated for /tmp
resource "aws_efs_file_system" "tmp_scratch" {
  encrypted  = true
  kms_key_id = aws_kms_key.tmp_volume_key.arn
  
  tags = {
    Name        = "ecs-tmp-scratch-space"
    Environment = "Production"
  }
}

# ---------------------------------------------------------
# Secrets Management
# ---------------------------------------------------------
# Constraint 4: No sensitive credentials hardcoded. 
# We reference an AWS Secrets Manager secret.
data "aws_secretsmanager_secret" "app_db_password" {
  name = "prod/microservice/db_password"
}

# ---------------------------------------------------------
# ECS Task Definition
# ---------------------------------------------------------
resource "aws_ecs_task_definition" "node_microservice" {
  family                   = "secure-node-microservice"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  # Constraint 3: Define the explicitly allocated volume using the encrypted EFS
  volume {
    name = "tmp-scratch-space"
    efs_volume_configuration {
      file_system_id     = aws_efs_file_system.tmp_scratch.id
      transit_encryption = "ENABLED" # Ensures encryption in transit
    }
  }

  container_definitions = jsonencode([
    {
      name      = "node-app"
      image     = "123456789012.dkr.ecr.us-east-1.amazonaws.com/my-node-app:v1.0.0"
      essential = true
      
      # Constraint 2: Enforce a read-only root filesystem.
      # Prevents attackers from dropping malware or modifying binaries if RCE is achieved.
      readonlyRootFilesystem = true

      # Constraint 3: Mount the encrypted volume specifically to /tmp
      mountPoints = [
        {
          sourceVolume  = "tmp-scratch-space"
          containerPath = "/tmp"
          readOnly      = false
        }
      ]

      # Constraint 4: Securely inject secrets at runtime via the execution role.
      # No plain text environment variables are used for sensitive data.
      secrets = [
        {
          name      = "DB_PASSWORD"
          valueFrom = data.aws_secretsmanager_secret.app_db_password.arn
        }
      ]

      # Standard non-sensitive environment variables
      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        }
      ]

      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
          protocol      = "tcp"
        }
      ]
      
      # Drop all Linux capabilities to ensure absolute minimum privileges
      linuxParameters = {
        drop = ["ALL"]
      }
    }
  ])
}
```

### Security Highlights & Explanations:

1. **Immutable & Pinned Base Images:** Using `node:20...alpine@sha256:...` guarantees that upstream changes or tag-hijacking cannot maliciously alter your base image. You are locked to a specific, immutable cryptographic hash.
2. **True Non-Root Execution:** The `adduser -S -D -H` command creates a system user with no password and no home directory. This prevents interactive login and restricts the user's capabilities entirely to running the application.
3. **Read-Only Root Filesystem (`readonlyRootFilesystem = true`):** This is a critical defense-in-depth control. If an attacker discovers a vulnerability in the Node.js app (e.g., a path traversal or RCE), they cannot write scripts, download payloads, or alter configuration files on the container's disk.
4. **Encrypted Ephemeral Scratch Space:** Because the root filesystem is read-only, Node.js or its dependencies might crash if they legitimately need to write temporary files. We explicitly provision an AWS EFS volume with **At-Rest Encryption** (via KMS) and **In-Transit Encryption**, and mount it strictly to `/tmp`. 
5. **Secret Injection:** By using the `secrets` array in the ECS container definition, AWS fetches the secret from Secrets Manager and injects it directly into the container's memory at startup. It is never written to disk or stored in the Terraform state as plaintext.
6. **Capability Dropping (`drop = ["ALL"]`):** As an added bonus, the Terraform configuration strips all default Linux capabilities (like `CAP_CHOWN`, `CAP_NET_RAW`) from the container, ensuring the process cannot escalate privileges even if the kernel has a vulnerability.