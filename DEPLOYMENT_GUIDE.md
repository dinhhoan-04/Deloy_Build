# Research Kit Deployment Guide

The repository is now prepared for an `AWS ECS/Fargate` deployment driven from `GitHub`.

## Target stack

- Backend: `Amazon ECS` using the `Fargate` launch type
- Public API entrypoint: `Application Load Balancer`
- Database: `Amazon RDS for PostgreSQL`
- Redis: `Amazon ElastiCache for Redis OSS` or an external Redis URL
- Landing page: `S3 website` by default, optional `CloudFront`
- Secrets: `AWS Secrets Manager`
- Registry: `Amazon ECR`
- Optional DNS: `Amazon Route 53`

## Free Tier reality

As of `May 17, 2026`, this design is only `free-tier friendly`, not fully free:

- `Fargate` uses credits or pay-as-you-go pricing.
- `ALB` uses credits or pay-as-you-go pricing.
- `RDS` can fit AWS Free Tier eligibility or credits depending on your account type.
- `ElastiCache` is the easiest part to cut if you want to preserve credits.
- Leaving `DOMAIN_NAME` empty avoids domain purchase and custom DNS setup.
- Leaving `CREATE_CLOUDFRONT=false` avoids the account-verification blocker on new AWS accounts.

References:

- AWS Free Tier overview: https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html
- ECS pricing: https://aws.amazon.com/ecs/pricing/
- RDS free tier: https://aws.amazon.com/rds/free/
- ElastiCache pricing: https://aws.amazon.com/elasticache/pricing/
- ELB pricing: https://aws.amazon.com/elasticloadbalancing/pricing/

## End-to-end GitHub flow

1. Push the repo to GitHub.
2. Add GitHub repository secrets for AWS credentials and app secrets.
3. Add the basic GitHub repository variables such as `AWS_REGION`.
4. Leave `DOMAIN_NAME` empty if you want test mode without buying a domain.
5. Run `.github/workflows/bootstrap-aws.yml`.
6. Read the `terraform-outputs` artifact from that workflow.
7. Copy the `github_actions_repository_variables` output into GitHub Repository Variables.
8. Run `.github/workflows/deploy-backend.yml`.
9. Run `.github/workflows/deploy-landing.yml`.
10. Run `.github/workflows/build-extension.yml`.

## Required GitHub secrets

- `AWS_GITHUB_DEPLOY_ROLE_ARN` or `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`
- `GOOGLE_CLIENT_ID`
- `GEMINI_API_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_API_KEY`
- `ZAI_API_KEY`
- `EXTERNAL_REDIS_URL` if you keep Redis outside AWS
- `SESSION_SECRET`
- `RK_MCP_TOKEN`

## Required GitHub variables before bootstrap

- `AWS_REGION`
- `PROJECT_NAME`
- `DOMAIN_NAME`
- `DB_BACKUP_RETENTION_PERIOD`
- `CREATE_ELASTICACHE`
- `CREATE_CLOUDFRONT`
- `ECS_TASK_CPU`
- `ECS_TASK_MEMORY`
- `ECS_DESIRED_COUNT`
- `LLM_PRIMARY_PROVIDER`
- `LLM_GEMINI_MODEL`
- `LLM_ZAI_MODEL`
- `LLM_OPENAI_MODEL`
- `LOG_LEVEL`

## No-domain test mode

If `DOMAIN_NAME` is empty:

- Backend uses `api_base_url = http://<alb-dns-name>`
- Landing uses `landing_base_url = http://<s3-website-endpoint>` by default
- If you later enable `CREATE_CLOUDFRONT=true`, landing can move to a CloudFront URL
- Terraform skips custom Route 53 records and ACM certificates
- Backend logic does not change

## What changed in this repo

- The backend container no longer runs migrations during normal startup.
- Migration is now a separate command: `/app/scripts/run-migrations.sh`.
- Extension API calls now use a shared env-driven config module instead of hardcoded Render URLs.
- Extension host permissions now inject the API origin from `VITE_API_URL` at build time.
- AWS infrastructure and deployment scripts live under `research-kit/infra/aws/`.
- GitHub Actions workflows now cover bootstrap, backend deploy, landing deploy, and extension build.
- The Terraform stack now supports both `custom domain` and `no-domain test mode`.

## Main local fallback commands

```bash
cd research-kit/infra/aws/terraform
terraform init
terraform apply

cd ..
AWS_REGION=ap-southeast-1 IMAGE_TAG=prod-001 ./run-backend-migrations.sh
AWS_REGION=ap-southeast-1 IMAGE_TAG=prod-001 ./deploy-ecs-service.sh
AWS_REGION=ap-southeast-1 ./sync-landing.sh
VITE_API_URL=<api_base_url>/v1 VITE_GOOGLE_CLIENT_ID=<google-client-id> ./build-extension.sh
```

## Files to use

- [research-kit/infra/aws/README.md](./research-kit/infra/aws/README.md)
- [research-kit/infra/aws/terraform/terraform.tfvars.example](./research-kit/infra/aws/terraform/terraform.tfvars.example)
- [research-kit/infra/aws/terraform/outputs.tf](./research-kit/infra/aws/terraform/outputs.tf)
- [research-kit/infra/aws/deploy-ecs-service.sh](./research-kit/infra/aws/deploy-ecs-service.sh)
- [research-kit/infra/aws/run-backend-migrations.sh](./research-kit/infra/aws/run-backend-migrations.sh)
- [research-kit/infra/aws/sync-landing.sh](./research-kit/infra/aws/sync-landing.sh)
- [.github/workflows/bootstrap-aws.yml](./.github/workflows/bootstrap-aws.yml)
- [.github/workflows/deploy-backend.yml](./.github/workflows/deploy-backend.yml)
- [.github/workflows/deploy-landing.yml](./.github/workflows/deploy-landing.yml)
- [.github/workflows/build-extension.yml](./.github/workflows/build-extension.yml)
