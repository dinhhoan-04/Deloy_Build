# AWS Deployment for Research Kit

This directory now targets `ECS/Fargate`, not App Runner.

## Cost-aware defaults

This stack is adjusted for a short-lived AWS `Free Tier / credit` setup:

- No `NAT Gateway`
- Backend tasks run in `public subnets` with a security group that only accepts traffic from the ALB
- `RDS PostgreSQL` stays private in private subnets
- `Redis` is optional on AWS because `ElastiCache` can burn credits quickly

Important:

- `ECS/Fargate` is not permanently free. It consumes AWS credits or pay-as-you-go budget.
- `ALB` also consumes credits or billable usage.
- If you want the cheapest path, keep `create_elasticache = false` and use an external Redis such as Upstash.

## What Terraform provisions

- Route 53 hosted zone for the root domain
- VPC with 2 public and 2 private subnets
- 1 internet gateway
- Public `Application Load Balancer` for `api.<domain>`
- `ECS cluster` plus IAM roles and CloudWatch log group
- Private PostgreSQL 16 on `RDS`
- Optional private Redis OSS on `ElastiCache`
- `ECR` repository for the backend image
- `Secrets Manager` entries for backend runtime secrets
- `S3 + ACM + CloudFront + Route 53` for the landing page

## Files

- `terraform/`: base AWS infrastructure
- `build-and-push-backend.sh`: build and push the backend image to ECR
- `run-backend-migrations.sh`: run `alembic upgrade head` as a one-off ECS task
- `deploy-ecs-service.sh`: register the task definition and create or update the ECS service
- `sync-landing.sh`: upload the landing page to S3 and invalidate CloudFront
- `build-extension.sh`: build the Chrome extension against the AWS API domain
- `../../.github/workflows/deploy-backend.yml`: GitHub Actions workflow for backend deploys without local Docker

## Bootstrap sequence

1. Copy `terraform/terraform.tfvars.example` to `terraform.tfvars` or export `TF_VAR_*` variables.
2. Set Redis mode:
   - Cheapest: keep `create_elasticache = false` and provide `external_redis_url`
   - Full AWS: set `create_elasticache = true`
3. Run:

```bash
cd research-kit/infra/aws/terraform
terraform init
terraform apply
```

4. Build and push the backend image:

```bash
cd ..
AWS_REGION=ap-southeast-1 IMAGE_TAG=prod-001 ./build-and-push-backend.sh
```

5. Run DB migrations:

```bash
AWS_REGION=ap-southeast-1 IMAGE_TAG=prod-001 ./run-backend-migrations.sh
```

6. Deploy the ECS service:

```bash
AWS_REGION=ap-southeast-1 IMAGE_TAG=prod-001 ./deploy-ecs-service.sh
```

7. Publish the landing page:

```bash
AWS_REGION=ap-southeast-1 ./sync-landing.sh
```

8. Build the extension:

```bash
VITE_API_URL=https://api.example.com/v1 \
VITE_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com \
./build-extension.sh
```

## GitHub Actions deploys

After the first manual bootstrap, backend deploys can run from GitHub instead of your laptop.

Required GitHub secret:

- `AWS_GITHUB_DEPLOY_ROLE_ARN`

Required GitHub repository variables:

- `AWS_REGION`
- `ECR_REPOSITORY`
- `ECS_CLUSTER`
- `ECS_SERVICE`
- `ECS_CONTAINER_NAME`

The workflow is in `.github/workflows/deploy-backend.yml` and does this:

1. Build the backend image on a GitHub runner
2. Push the image to ECR
3. Read the current ECS task definition
4. Replace only the image tag
5. Deploy the new revision to ECS

## Secrets and environment values

Terraform creates Secrets Manager entries for:

- `DATABASE_URL`
- `REDIS_URL`
- `SESSION_SECRET`
- `GOOGLE_CLIENT_ID`
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_API_KEY`
- `ZAI_API_KEY`
- `RK_MCP_TOKEN`

The ECS task also receives plain runtime values:

- `ENV=production`
- `LOG_LEVEL`
- `LLM_PRIMARY_PROVIDER`
- `LLM_GEMINI_MODEL`
- `LLM_ZAI_MODEL`
- `LLM_OPENAI_MODEL`

## Notes

- The backend image no longer runs migrations on startup. Runtime uses `/app/scripts/run-backend.sh`, and migrations use `/app/scripts/run-migrations.sh`.
- The extension build injects the API host permission from `VITE_API_URL` at build time.
- The API certificate is created in the same region as the ALB.
- The landing page certificate is issued in `us-east-1` because CloudFront requires ACM certificates from that region.
