# AWS Deployment for Research Kit

This directory now targets `ECS/Fargate`, not App Runner.

## Cost-aware defaults

This stack is adjusted for a short-lived AWS `Free Tier / credit` setup:

- No `NAT Gateway`
- Backend tasks run in `public subnets` with a security group that only accepts traffic from the ALB
- `RDS PostgreSQL` stays private in private subnets
- `Redis` is optional on AWS because `ElastiCache` can burn credits quickly
- Custom domains are optional; you can run entirely on AWS-generated URLs

Important:

- `ECS/Fargate` is not permanently free. It consumes AWS credits or pay-as-you-go budget.
- `ALB` also consumes credits or billable usage.
- If you want the cheapest path, keep `create_elasticache = false` and use an external Redis such as Upstash.

## What Terraform provisions

- VPC with 2 public and 2 private subnets
- 1 internet gateway
- Public `Application Load Balancer` for the backend API
- `ECS cluster` plus IAM roles and CloudWatch log group
- Private PostgreSQL 16 on `RDS`
- Optional private Redis OSS on `ElastiCache`
- `ECR` repository for the backend image
- `Secrets Manager` entries for backend runtime secrets
- `S3 + CloudFront` for the landing page
- Optional `Route 53 + ACM` only when `domain_name` is set

## GitHub workflows

- `.github/workflows/bootstrap-aws.yml`: run Terraform from GitHub Actions
- `.github/workflows/deploy-backend.yml`: build backend image, run migrations, create or update ECS
- `.github/workflows/deploy-landing.yml`: sync landing page to S3 and invalidate CloudFront
- `.github/workflows/build-extension.yml`: build the Chrome extension and upload it as an artifact

## End-to-end plan

1. Push this repo to GitHub.
2. Add GitHub repository secrets:
   - `AWS_GITHUB_DEPLOY_ROLE_ARN` or `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`
   - `GOOGLE_CLIENT_ID`
   - `GEMINI_API_KEY`
   - `OPENAI_API_KEY`
   - `GOOGLE_API_KEY`
   - `ZAI_API_KEY`
   - `EXTERNAL_REDIS_URL` if `create_elasticache = false`
   - `SESSION_SECRET`
   - `RK_MCP_TOKEN`
3. Add GitHub repository variables before bootstrap:
   - `AWS_REGION=ap-southeast-1`
   - `PROJECT_NAME=research-kit`
   - `DOMAIN_NAME=` leave empty for test mode, or set your real domain later
   - `CREATE_ELASTICACHE=false`
   - `ECS_TASK_CPU=512`
   - `ECS_TASK_MEMORY=1024`
   - `ECS_DESIRED_COUNT=1`
   - `LLM_PRIMARY_PROVIDER=openai`
   - `LLM_GEMINI_MODEL=gemini-2.5-flash`
   - `LLM_ZAI_MODEL=glm-4.7`
   - `LLM_OPENAI_MODEL=gpt-4o-mini`
   - `LOG_LEVEL=INFO`
4. Run the `Bootstrap AWS Infrastructure` workflow.
5. Open the `terraform-outputs` artifact from that workflow and copy the `github_actions_repository_variables` map into GitHub Repository Variables.
6. Run the `Deploy Backend to ECS` workflow.
7. Run the `Deploy Landing to S3 and CloudFront` workflow.
8. Run the `Build Chrome Extension` workflow and download the artifact.

## What happens when `domain_name` is empty

- The backend API uses the AWS ALB DNS name:
  - `http://<alb-name>.<region>.elb.amazonaws.com`
- The landing page uses the AWS CloudFront domain:
  - `https://<distribution>.cloudfront.net`
- The extension build uses `API_BASE_URL` from Terraform outputs, so no custom domain is required

## Manual fallback

If you prefer to bootstrap from AWS CloudShell instead of GitHub Actions:

```bash
cd research-kit/infra/aws/terraform
terraform init
terraform apply

cd ..
AWS_REGION=ap-southeast-1 IMAGE_TAG=prod-001 ./run-backend-migrations.sh
AWS_REGION=ap-southeast-1 IMAGE_TAG=prod-001 ./deploy-ecs-service.sh
AWS_REGION=ap-southeast-1 ./sync-landing.sh
```

## Terraform outputs you will use

The most important outputs after `terraform apply` are:

- `github_actions_repository_variables`
- `api_base_url`
- `landing_base_url`

Those outputs contain the exact GitHub Variables required by the backend and landing deploy workflows.

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

The ECS task receives plain runtime values for:

- `ENV=production`
- `LOG_LEVEL`
- `LLM_PRIMARY_PROVIDER`
- `LLM_GEMINI_MODEL`
- `LLM_ZAI_MODEL`
- `LLM_OPENAI_MODEL`

## Notes

- The backend image no longer runs migrations on startup. Runtime uses `/app/scripts/run-backend.sh`, and migrations use `/app/scripts/run-migrations.sh`.
- The deploy workflow can create the ECS service on the first run; it no longer assumes the service already exists.
- The extension build injects the API host permission from `VITE_API_URL` at build time.
- If you set `domain_name` later, the same Terraform stack can add custom DNS and HTTPS without changing your backend logic.
