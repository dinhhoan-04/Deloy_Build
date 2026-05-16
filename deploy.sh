#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AWS_DIR="$SCRIPT_DIR/research-kit/infra/aws"
TF_DIR="$AWS_DIR/terraform"

echo "Research Kit AWS deployment helper"
echo "=================================="
echo
echo "Target compute: ECS/Fargate"
echo "Cost-aware default: no NAT Gateway, optional external Redis"
echo

for cmd in terraform aws; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
done

echo "1. Bootstrap infrastructure"
echo "   cd \"$TF_DIR\""
echo "   terraform init"
echo "   terraform apply"
echo
echo "2. Build and push backend image"
echo "   cd \"$AWS_DIR\""
echo "   AWS_REGION=\${AWS_REGION:-ap-southeast-1} IMAGE_TAG=prod-001 ./build-and-push-backend.sh"
echo
echo "3. Run DB migrations"
echo "   AWS_REGION=\${AWS_REGION:-ap-southeast-1} IMAGE_TAG=prod-001 ./run-backend-migrations.sh"
echo
echo "4. Deploy ECS service"
echo "   AWS_REGION=\${AWS_REGION:-ap-southeast-1} IMAGE_TAG=prod-001 ./deploy-ecs-service.sh"
echo
echo "5. Publish landing page"
echo "   AWS_REGION=\${AWS_REGION:-ap-southeast-1} ./sync-landing.sh"
echo
echo "6. Build the extension"
echo "   VITE_API_URL=https://api.<your-domain>/v1 \\"
echo "   VITE_GOOGLE_CLIENT_ID=<google-client-id> \\"
echo "   ./build-extension.sh"
echo
echo "Detailed instructions: $AWS_DIR/README.md"
