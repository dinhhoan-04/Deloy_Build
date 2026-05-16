#!/bin/bash
# Script để import các resource đã tồn tại trên AWS vào Terraform state
# Chạy script này trong thư mục terraform trước khi chạy terraform apply

set -e

echo "=== Importing existing AWS resources into Terraform state ==="

# 1. DB Subnet Group
echo "[1/7] Importing DB Subnet Group..."
terraform import aws_db_subnet_group.postgres research-kit-postgres || echo "  -> Skipped (may already be in state)"

# 2. ECR Repository
echo "[2/7] Importing ECR Repository..."
terraform import aws_ecr_repository.backend research-kit-backend || echo "  -> Skipped (may already be in state)"

# 3. IAM Role - ECS Task Execution
echo "[3/7] Importing IAM Role (ecs-exec)..."
terraform import aws_iam_role.ecs_task_execution research-kit-ecs-exec || echo "  -> Skipped (may already be in state)"

# 4. IAM Role - ECS Task
echo "[4/7] Importing IAM Role (ecs-task)..."
terraform import aws_iam_role.ecs_task research-kit-ecs-task || echo "  -> Skipped (may already be in state)"

# 5. CloudWatch Log Group
echo "[5/7] Importing CloudWatch Log Group..."
terraform import aws_cloudwatch_log_group.backend /ecs/research-kit-backend || echo "  -> Skipped (may already be in state)"

# 6. ALB - cần lấy ARN
echo "[6/7] Importing ALB..."
ALB_ARN=$(aws elbv2 describe-load-balancers --names research-kit-api --query "LoadBalancers[0].LoadBalancerArn" --output text 2>/dev/null)
if [ -n "$ALB_ARN" ] && [ "$ALB_ARN" != "None" ]; then
  terraform import aws_lb.api "$ALB_ARN" || echo "  -> Skipped (may already be in state)"
else
  echo "  -> ALB not found, skipping"
fi

# 7. Target Group - cần lấy ARN
echo "[7/7] Importing Target Group..."
TG_ARN=$(aws elbv2 describe-target-groups --names research-kit-api --query "TargetGroups[0].TargetGroupArn" --output text 2>/dev/null)
if [ -n "$TG_ARN" ] && [ "$TG_ARN" != "None" ]; then
  terraform import aws_lb_target_group.api "$TG_ARN" || echo "  -> Skipped (may already be in state)"
else
  echo "  -> Target Group not found, skipping"
fi

echo ""
echo "=== Import complete! ==="
echo "Now run: terraform plan"
echo "Then:    terraform apply"
