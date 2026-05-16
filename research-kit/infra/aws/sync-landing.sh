#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)
TF_DIR=${TF_DIR:-"$SCRIPT_DIR/terraform"}
AWS_REGION=${AWS_REGION:-ap-southeast-1}

for cmd in aws terraform; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "Missing required command: $cmd" >&2
    exit 1
  }
done

LANDING_BUCKET=$(terraform -chdir="$TF_DIR" output -raw landing_bucket_name)
CLOUDFRONT_DISTRIBUTION_ID=$(terraform -chdir="$TF_DIR" output -raw cloudfront_distribution_id)

aws s3 sync \
  "$REPO_ROOT/research-kit/landing/" \
  "s3://$LANDING_BUCKET/" \
  --delete \
  --region "$AWS_REGION"

aws cloudfront create-invalidation \
  --distribution-id "$CLOUDFRONT_DISTRIBUTION_ID" \
  --paths "/*"
