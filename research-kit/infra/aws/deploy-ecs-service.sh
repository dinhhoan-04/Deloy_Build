#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
TF_DIR=${TF_DIR:-"$SCRIPT_DIR/terraform"}
AWS_REGION=${AWS_REGION:-ap-southeast-1}
IMAGE_TAG=${IMAGE_TAG:-latest}
TMP_JSON=${TMP_JSON:-"$SCRIPT_DIR/.ecs-service-taskdef.json"}
trap 'rm -f "$TMP_JSON"' EXIT

for cmd in aws terraform jq; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Missing required command: $cmd" >&2
    exit 1
  }
done

CLUSTER_NAME=$(terraform -chdir="$TF_DIR" output -raw ecs_cluster_name)
SERVICE_NAME=$(terraform -chdir="$TF_DIR" output -raw ecs_service_name)
TASK_FAMILY=$(terraform -chdir="$TF_DIR" output -raw ecs_task_family)
ECR_REPOSITORY_URL=$(terraform -chdir="$TF_DIR" output -raw ecr_repository_url)
EXECUTION_ROLE_ARN=$(terraform -chdir="$TF_DIR" output -raw ecs_task_execution_role_arn)
TASK_ROLE_ARN=$(terraform -chdir="$TF_DIR" output -raw ecs_task_role_arn)
PUBLIC_SUBNET_IDS=$(terraform -chdir="$TF_DIR" output -json public_subnet_ids)
SERVICE_SECURITY_GROUP_ID=$(terraform -chdir="$TF_DIR" output -raw ecs_service_security_group_id)
TARGET_GROUP_ARN=$(terraform -chdir="$TF_DIR" output -raw alb_target_group_arn)
SECRET_ARNS=$(terraform -chdir="$TF_DIR" output -json backend_secret_arns)
RUNTIME_ENV=$(terraform -chdir="$TF_DIR" output -json backend_runtime_env)
LOG_GROUP_NAME=$(terraform -chdir="$TF_DIR" output -raw backend_log_group_name)
DESIRED_COUNT=$(terraform -chdir="$TF_DIR" output -raw ecs_desired_count)
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
        portMappings: [
          {
            containerPort: 8000,
            hostPort: 8000,
            protocol: "tcp"
          }
        ],
        environment: $envArray,
        secrets: $secretArray,
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": $logGroupName,
            "awslogs-region": $awsRegion,
            "awslogs-stream-prefix": "backend"
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

NETWORK_CONFIGURATION=$(jq -cn --argjson subnets "$PUBLIC_SUBNET_IDS" --arg sg "$SERVICE_SECURITY_GROUP_ID" '{awsvpcConfiguration:{subnets:$subnets,securityGroups:[$sg],assignPublicIp:"ENABLED"}}')

SERVICE_STATUS=$(aws ecs describe-services \
  --region "$AWS_REGION" \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME" \
  --query 'services[0].status' \
  --output text 2>/dev/null || true)

if [ "$SERVICE_STATUS" = "ACTIVE" ]; then
  aws ecs update-service \
    --region "$AWS_REGION" \
    --cluster "$CLUSTER_NAME" \
    --service "$SERVICE_NAME" \
    --task-definition "$TASK_DEFINITION_ARN" \
    --desired-count "$DESIRED_COUNT" \
    --force-new-deployment >/dev/null
else
  aws ecs create-service \
    --region "$AWS_REGION" \
    --cluster "$CLUSTER_NAME" \
    --service-name "$SERVICE_NAME" \
    --task-definition "$TASK_DEFINITION_ARN" \
    --desired-count "$DESIRED_COUNT" \
    --launch-type FARGATE \
    --health-check-grace-period-seconds 30 \
    --network-configuration "$NETWORK_CONFIGURATION" \
    --load-balancers "targetGroupArn=$TARGET_GROUP_ARN,containerName=backend,containerPort=8000" >/dev/null
fi

aws ecs wait services-stable \
  --region "$AWS_REGION" \
  --cluster "$CLUSTER_NAME" \
  --services "$SERVICE_NAME"

echo "ECS service is deployed and stable: $SERVICE_NAME"
