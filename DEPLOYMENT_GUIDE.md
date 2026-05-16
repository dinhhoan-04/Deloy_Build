# Research Kit Deployment Guide

The repository is now prepared for an `AWS ECS/Fargate` deployment.

## Target stack

- Backend: `Amazon ECS` using the `Fargate` launch type
- Public API entrypoint: `Application Load Balancer`
- Database: `Amazon RDS for PostgreSQL`
- Redis: `Amazon ElastiCache for Redis OSS` or an `external Redis URL`
- Landing page: `S3 + CloudFront`
- Secrets: `AWS Secrets Manager`
- Registry: `Amazon ECR`
- DNS: `Amazon Route 53`

## Free Tier reality

As of `May 17, 2026`, this design is only `free-tier friendly`, not fully free:

- `Fargate` uses credits or pay-as-you-go pricing.
- `ALB` uses credits or pay-as-you-go pricing.
- `RDS` can fit AWS Free Tier eligibility or credits depending on your account type.
- `ElastiCache` is the easiest part to cut if you want to preserve credits.

For the cheapest setup, keep:

- `create_elasticache = false`
- `external_redis_url = rediss://...`

References:

- AWS Free Tier overview: https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html
- ECS pricing: https://aws.amazon.com/ecs/pricing/
- RDS free tier: https://aws.amazon.com/rds/free/
- ElastiCache pricing: https://aws.amazon.com/elasticache/pricing/
- ELB pricing: https://aws.amazon.com/elasticloadbalancing/pricing/

## What changed in this repo

- The backend container no longer runs migrations during normal startup.
- Migration is now a separate command: `/app/scripts/run-migrations.sh`.
- Extension API calls now use a shared env-driven config module instead of hardcoded Render URLs.
- Extension host permissions now inject the API origin from `VITE_API_URL` at build time.
- AWS infrastructure and deployment scripts live under `research-kit/infra/aws/`.
- The AWS compute path now targets `ECS/Fargate`, not App Runner.

## Main commands

```bash
cd research-kit/infra/aws/terraform
terraform init
terraform apply

cd ..
AWS_REGION=ap-southeast-1 IMAGE_TAG=prod-001 ./build-and-push-backend.sh
AWS_REGION=ap-southeast-1 IMAGE_TAG=prod-001 ./run-backend-migrations.sh
AWS_REGION=ap-southeast-1 IMAGE_TAG=prod-001 ./deploy-ecs-service.sh
AWS_REGION=ap-southeast-1 ./sync-landing.sh
VITE_API_URL=https://api.<your-domain>/v1 VITE_GOOGLE_CLIENT_ID=<google-client-id> ./build-extension.sh
```

## Git-first deploy path

If your laptop does not have Docker, use the GitHub Actions workflow in `.github/workflows/deploy-backend.yml`.

The intended flow is:

1. Run Terraform once to create AWS infrastructure.
2. Run the first ECS deployment once so the ECS service and task definition exist.
3. Push code to `main`.
4. GitHub Actions builds the backend image, pushes it to ECR, and updates ECS.

## Files to use

- [research-kit/infra/aws/README.md](./research-kit/infra/aws/README.md)
- [research-kit/infra/aws/terraform/terraform.tfvars.example](./research-kit/infra/aws/terraform/terraform.tfvars.example)
- [research-kit/infra/aws/build-and-push-backend.sh](./research-kit/infra/aws/build-and-push-backend.sh)
- [research-kit/infra/aws/run-backend-migrations.sh](./research-kit/infra/aws/run-backend-migrations.sh)
- [research-kit/infra/aws/deploy-ecs-service.sh](./research-kit/infra/aws/deploy-ecs-service.sh)
- [research-kit/infra/aws/sync-landing.sh](./research-kit/infra/aws/sync-landing.sh)
