Act as a Principal DevSecOps Engineer. Write a production-ready Dockerfile and matching Terraform configuration for a Node.js microservice with strict security hardening requirements.

Constraints for Dockerfile:
1. Multi-Stage Build: The final runner image must only contain production dependencies and compiled artifacts.
2. Non-Root Execution: The application must run under an explicit, non-privileged system user/group created during the build.
3. Minimal Base Image: Use an explicit, SHA256-pinned distroless or minimal alpine base image.

Constraints for Terraform:
1. Configure an AWS ECS Task Definition (or Kubernetes deployment spec if preferred) for this container.
2. Enforce a read-only root filesystem for the container.
3. Configure a secure, encrypted volume mount explicitly allocated for temporary scratch space (`/tmp`).
4. Ensure no sensitive credentials or environment variables are hardcoded in the plain text configuration.

Output: Provide the Dockerfile and the Terraform snippet. Explicitly highlight or comment on the lines where the security constraints are satisfied.