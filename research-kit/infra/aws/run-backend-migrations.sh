#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
TF_DIR=${TF_DIR:-"$SCRIPT_DIR/terraform"}
AWS_REGION=${AWS_REGION:-ap-southeast-1}
IMAGE_TAG=${IMAGE_TAG:-latest}
TMP_JSON=${TMP_JSON:-"$SCRIPT_DIR/.ecs-migrate-taskdef.json"}
trap 'rm -f "$TMP_JSON"' EXIT

for cmd in aws terraform jq; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Missing required command: $cmd" >&2
    exit 1
  }
done

CLUSTER_NAME=$(terraform -chdir="$TF_DIR" output -raw ecs_cluster_name)
TASK_FAMILY=$(terraform -chdir="$TF_DIR" output -raw ecs_migration_task_family)
ECR_REPOSITORY_URL=$(terraform -chdir="$TF_DIR" output -raw ecr_repository_url)
EXECUTION_ROLE_ARN=$(terraform -chdir="$TF_DIR" output -raw ecs_task_execution_role_arn)
TASK_ROLE_ARN=$(terraform -chdir="$TF_DIR" output -raw ecs_task_role_arn)
PUBLIC_SUBNET_IDS=$(terraform -chdir="$TF_DIR" output -json public_subnet_ids)
SERVICE_SECURITY_GROUP_ID=$(terraform -chdir="$TF_DIR" output -raw ecs_service_security_group_id)
SECRET_ARNS=$(terraform -chdir="$TF_DIR" output -json backend_secret_arns)
RUNTIME_ENV=$(terraform -chdir="$TF_DIR" output -json backend_runtime_env)
LOG_GROUP_NAME=$(terraform -chdir="$TF_DIR" output -raw backend_log_group_name)
TASK_CPU=$(terraform -chdir="$TF_DIR" output -raw ecs_task_cpu)
TASK_MEMORY=$(terraform -chdir="$TF_DIR" output -raw ecs_task_memory)

ENV_ARRAY=$(printf '%s' "$RUNTIME_ENV" | jq -c 'to_entries | map({name: .key, value: (.value | tostring)})')
SECRET_ARRAY=$(printf '%s' "$SECRET_ARNS" | jq -c 'to_entries | map({name: .key, valueFrom: .value})')

jq -n \
  --arg family "$TASK_FAMILY" \
  --arg image "$ECR_REPOSITORY_URL:$IMAGE_TAG" \
  --arg executionRoleArn "$EXECUTION_ROLE_ARN" \
  --arg taskRoleArn "$TASK_ROLE_ARN" \
  --arg cpu "$TASK_CPU" \
  --arg memory "$TASK_MEMORY" \
  --arg logGroupName "$LOG_GROUP_NAME" \
  --arg awsRegion "$AWS_REGION" \
  --argjson envArray "$ENV_ARRAY" \
  --argjson secretArray "$SECRET_ARRAY" \
  '{
    family: $family,
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    cpu: $cpu,
    memory: $memory,
    executionRoleArn: $executionRoleArn,
    taskRoleArn: $taskRoleArn,
    containerDefinitions: [
      {
        name: "backend",
        image: $image,
        essential: true,
        command: ["/app/scripts/run-migrations.sh"],
        environment: $envArray,
        secrets: $secretArray,
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": $logGroupName,
            "awslogs-region": $awsRegion,
            "awslogs-stream-prefix": "migration"
          }
        }
      }
    ]
  }' > "$TMP_JSON"

TASK_DEFINITION_ARN=$(aws ecs register-task-definition \
  --region "$AWS_REGION" \
  --cli-input-json "file://$TMP_JSON" \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)

TASK_ARN=$(aws ecs run-task \
  --region "$AWS_REGION" \
  --cluster "$CLUSTER_NAME" \
  --launch-type FARGATE \
  --task-definition "$TASK_DEFINITION_ARN" \
  --network-configuration "$(jq -cn --argjson subnets "$PUBLIC_SUBNET_IDS" --arg sg "$SERVICE_SECURITY_GROUP_ID" '{awsvpcConfiguration:{subnets:$subnets,securityGroups:[$sg],assignPublicIp:"ENABLED"}}')" \
  --query 'tasks[0].taskArn' \
  --output text)

if [ -z "$TASK_ARN" ] || [ "$TASK_ARN" = "None" ]; then
  echo "Failed to start migration task." >&2
  exit 1
fi

aws ecs wait tasks-stopped \
  --region "$AWS_REGION" \
  --cluster "$CLUSTER_NAME" \
  --tasks "$TASK_ARN"

EXIT_CODE=$(aws ecs describe-tasks \
  --region "$AWS_REGION" \
  --cluster "$CLUSTER_NAME" \
  --tasks "$TASK_ARN" \
  --query 'tasks[0].containers[0].exitCode' \
  --output text)

STOPPED_REASON=$(aws ecs describe-tasks \
  --region "$AWS_REGION" \
  --cluster "$CLUSTER_NAME" \
  --tasks "$TASK_ARN" \
  --query 'tasks[0].stoppedReason' \
  --output text)

if [ "$EXIT_CODE" = "0" ]; then
  echo "Migration task completed successfully: $TASK_ARN"
  exit 0
fi

echo "Migration task failed: $TASK_ARN" >&2
echo "Stopped reason: $STOPPED_REASON" >&2
echo "Container exit code: $EXIT_CODE" >&2
exit 1
