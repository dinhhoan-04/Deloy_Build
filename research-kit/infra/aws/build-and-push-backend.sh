#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)
TF_DIR=${TF_DIR:-"$SCRIPT_DIR/terraform"}
AWS_REGION=${AWS_REGION:-ap-southeast-1}
IMAGE_TAG=${IMAGE_TAG:-latest}

for cmd in aws docker terraform; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Missing required command: $cmd" >&2
    exit 1
  }
done

ECR_REPOSITORY_URL=$(terraform -chdir="$TF_DIR" output -raw ecr_repository_url)
ECR_REGISTRY=$(printf '%s' "$ECR_REPOSITORY_URL" | cut -d/ -f1)

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$ECR_REGISTRY"

docker build \
  -f "$REPO_ROOT/research-kit/infra/Dockerfile.backend" \
  -t "$ECR_REPOSITORY_URL:$IMAGE_TAG" \
  "$REPO_ROOT/research-kit"

docker push "$ECR_REPOSITORY_URL:$IMAGE_TAG"

echo "Pushed backend image: $ECR_REPOSITORY_URL:$IMAGE_TAG"
