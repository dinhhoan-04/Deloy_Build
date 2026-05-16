locals {
  prefix         = lower(replace(var.project_name, "_", "-"))
  api_domain     = "api.${var.domain_name}"
  www_domain     = "www.${var.domain_name}"
  landing_bucket = "${local.prefix}-landing-${random_id.suffix.hex}"
  common_tags = merge({
    Project     = var.project_name
    Environment = "production"
    ManagedBy   = "terraform"
  }, var.tags)
}

locals {
  session_secret_value = length(trimspace(var.session_secret)) > 0 ? trimspace(var.session_secret) : random_password.session_secret.result
  rk_mcp_token_value   = length(trimspace(var.rk_mcp_token)) > 0 ? trimspace(var.rk_mcp_token) : random_password.mcp_token.result
}

resource "random_id" "suffix" {
  byte_length = 2
}

resource "random_password" "db_password" {
  length  = 24
  special = false
}

resource "random_password" "redis_auth" {
  count   = var.create_elasticache ? 1 : 0
  length  = 32
  special = false
}

resource "random_password" "session_secret" {
  length  = 48
  special = false
}

resource "random_password" "mcp_token" {
  length  = 48
  special = false
}

resource "aws_route53_zone" "main" {
  name = var.domain_name
  tags = local.common_tags
}

resource "aws_vpc" "main" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(local.common_tags, {
    Name = "${local.prefix}-vpc"
  })
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = merge(local.common_tags, {
    Name = "${local.prefix}-igw"
  })
}

resource "aws_subnet" "public" {
  count = 2

  vpc_id                  = aws_vpc.main.id
  availability_zone       = data.aws_availability_zones.available.names[count.index]
  cidr_block              = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  map_public_ip_on_launch = true

  tags = merge(local.common_tags, {
    Name = "${local.prefix}-public-${count.index + 1}"
    Tier = "public"
  })
}

resource "aws_subnet" "private" {
  count = 2

  vpc_id            = aws_vpc.main.id
  availability_zone = data.aws_availability_zones.available.names[count.index]
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index + 10)

  tags = merge(local.common_tags, {
    Name = "${local.prefix}-private-${count.index + 1}"
    Tier = "private"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = merge(local.common_tags, {
    Name = "${local.prefix}-public-rt"
  })
}

resource "aws_route_table_association" "public" {
  count = 2

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  tags = merge(local.common_tags, {
    Name = "${local.prefix}-private-rt"
  })
}

resource "aws_route_table_association" "private" {
  count = 2

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

resource "aws_security_group" "alb" {
  name        = "${local.prefix}-alb"
  description = "Public ingress for the ECS-backed API."
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.prefix}-alb"
  })
}

resource "aws_security_group" "ecs_service" {
  name        = "${local.prefix}-ecs-service"
  description = "ECS/Fargate ingress from ALB and outbound internet access."
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.prefix}-ecs-service"
  })
}

resource "aws_security_group" "postgres" {
  name        = "${local.prefix}-postgres"
  description = "Postgres ingress from ECS tasks only."
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_service.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.prefix}-postgres"
  })
}

resource "aws_security_group" "redis" {
  count = var.create_elasticache ? 1 : 0

  name        = "${local.prefix}-redis"
  description = "Redis ingress from ECS tasks only."
  vpc_id      = aws_vpc.main.id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_service.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(local.common_tags, {
    Name = "${local.prefix}-redis"
  })
}

resource "aws_db_subnet_group" "postgres" {
  name       = "${local.prefix}-postgres"
  subnet_ids = aws_subnet.private[*].id

  tags = merge(local.common_tags, {
    Name = "${local.prefix}-postgres"
  })
}

resource "aws_db_instance" "postgres" {
  identifier              = "${local.prefix}-postgres"
  engine                  = "postgres"
  engine_version          = "16"
  instance_class          = var.db_instance_class
  allocated_storage       = 20
  max_allocated_storage   = 100
  storage_type            = "gp3"
  db_name                 = "rk"
  username                = "rk_app"
  password                = random_password.db_password.result
  db_subnet_group_name    = aws_db_subnet_group.postgres.name
  vpc_security_group_ids  = [aws_security_group.postgres.id]
  storage_encrypted       = true
  publicly_accessible     = false
  multi_az                = false
  backup_retention_period = 7
  deletion_protection     = false
  skip_final_snapshot     = true
  apply_immediately       = true

  tags = merge(local.common_tags, {
    Name = "${local.prefix}-postgres"
  })
}

resource "aws_elasticache_subnet_group" "redis" {
  count = var.create_elasticache ? 1 : 0

  name       = "${local.prefix}-redis"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_replication_group" "redis" {
  count = var.create_elasticache ? 1 : 0

  replication_group_id       = replace("${local.prefix}-redis", "_", "-")
  description                = "Research Kit Redis"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  num_cache_clusters         = 1
  port                       = 6379
  subnet_group_name          = aws_elasticache_subnet_group.redis[0].name
  security_group_ids         = [aws_security_group.redis[0].id]
  parameter_group_name       = "default.redis7"
  automatic_failover_enabled = false
  multi_az_enabled           = false
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis_auth[0].result
  snapshot_retention_limit   = 0
  apply_immediately          = true

  tags = local.common_tags
}

resource "aws_ecr_repository" "backend" {
  name                 = "${local.prefix}-backend"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.common_tags
}

resource "aws_iam_role" "ecs_task_execution" {
  name = "${local.prefix}-ecs-exec"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  name = "${local.prefix}-ecs-exec-secrets"
  role = aws_iam_role.ecs_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [for secret in aws_secretsmanager_secret.backend : secret.arn]
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role" "ecs_task" {
  name = "${local.prefix}-ecs-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })

  tags = local.common_tags
}

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/ecs/${local.prefix}-backend"
  retention_in_days = 7
  tags              = local.common_tags
}

resource "aws_ecs_cluster" "backend" {
  name = "${local.prefix}-backend"

  setting {
    name  = "containerInsights"
    value = "disabled"
  }

  tags = local.common_tags
}

resource "aws_acm_certificate" "api" {
  domain_name       = local.api_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = local.common_tags
}

resource "aws_route53_record" "api_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.api.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "api" {
  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = [for record in aws_route53_record.api_cert_validation : record.fqdn]
}

resource "aws_lb" "api" {
  name               = substr("${local.prefix}-api", 0, 32)
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  tags = local.common_tags
}

resource "aws_lb_target_group" "api" {
  name        = substr("${local.prefix}-api", 0, 32)
  port        = 8000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  health_check {
    enabled             = true
    path                = "/health"
    healthy_threshold   = 2
    unhealthy_threshold = 5
    interval            = 30
    timeout             = 5
    matcher             = "200-399"
  }

  tags = local.common_tags
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.api.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_route53_record" "api" {
  zone_id = aws_route53_zone.main.zone_id
  name    = local.api_domain
  type    = "A"

  alias {
    name                   = aws_lb.api.dns_name
    zone_id                = aws_lb.api.zone_id
    evaluate_target_health = true
  }
}

locals {
  redis_url = var.create_elasticache ? format(
    "rediss://:%s@%s:6379/0",
    random_password.redis_auth[0].result,
    aws_elasticache_replication_group.redis[0].primary_endpoint_address
  ) : trimspace(var.external_redis_url)

  backend_secret_values = {
    DATABASE_URL     = format("postgresql://%s:%s@%s:5432/rk?sslmode=require", aws_db_instance.postgres.username, random_password.db_password.result, aws_db_instance.postgres.address)
    REDIS_URL        = local.redis_url
    SESSION_SECRET   = local.session_secret_value
    GOOGLE_CLIENT_ID = var.google_client_id
    GEMINI_API_KEY   = var.gemini_api_key
    OPENAI_API_KEY   = var.openai_api_key
    GOOGLE_API_KEY   = var.google_api_key
    ZAI_API_KEY      = var.zai_api_key
    RK_MCP_TOKEN     = local.rk_mcp_token_value
  }

  backend_runtime_env = {
    ENV                  = "production"
    LOG_LEVEL            = var.log_level
    LLM_PRIMARY_PROVIDER = var.llm_primary_provider
    LLM_GEMINI_MODEL     = var.llm_gemini_model
    LLM_ZAI_MODEL        = var.llm_zai_model
    LLM_OPENAI_MODEL     = var.llm_openai_model
  }
}

resource "aws_secretsmanager_secret" "backend" {
  for_each = local.backend_secret_values

  name                    = "/${local.prefix}/${lower(replace(each.key, "_", "-"))}"
  recovery_window_in_days = 0
  tags                    = local.common_tags
}

resource "aws_secretsmanager_secret_version" "backend" {
  for_each = local.backend_secret_values

  secret_id     = aws_secretsmanager_secret.backend[each.key].id
  secret_string = each.value

  lifecycle {
    precondition {
      condition     = each.key != "REDIS_URL" || length(trimspace(each.value)) > 0
      error_message = "Set create_elasticache=true or provide external_redis_url so REDIS_URL is not empty."
    }
  }
}

resource "aws_s3_bucket" "landing" {
  bucket = local.landing_bucket
  tags   = local.common_tags
}

resource "aws_s3_bucket_public_access_block" "landing" {
  bucket                  = aws_s3_bucket.landing.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "landing" {
  bucket = aws_s3_bucket.landing.id

  rule {
    object_ownership = "BucketOwnerPreferred"
  }
}

resource "aws_cloudfront_origin_access_control" "landing" {
  name                              = "${local.prefix}-landing"
  description                       = "CloudFront access for landing bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_acm_certificate" "landing" {
  provider                  = aws.us_east_1
  domain_name               = var.domain_name
  validation_method         = "DNS"
  subject_alternative_names = [local.www_domain]

  lifecycle {
    create_before_destroy = true
  }

  tags = local.common_tags
}

resource "aws_route53_record" "landing_cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.landing.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id = aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]
}

resource "aws_acm_certificate_validation" "landing" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.landing.arn
  validation_record_fqdns = [for record in aws_route53_record.landing_cert_validation : record.fqdn]
}

resource "aws_cloudfront_distribution" "landing" {
  enabled             = true
  default_root_object = "index.html"
  aliases             = [var.domain_name, local.www_domain]

  origin {
    domain_name              = aws_s3_bucket.landing.bucket_regional_domain_name
    origin_id                = "landing-s3"
    origin_access_control_id = aws_cloudfront_origin_access_control.landing.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "landing-s3"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.landing.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  tags = local.common_tags
}

data "aws_iam_policy_document" "landing_bucket" {
  statement {
    sid    = "AllowCloudFrontReadOnly"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.landing.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.landing.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "landing" {
  bucket = aws_s3_bucket.landing.id
  policy = data.aws_iam_policy_document.landing_bucket.json
}

resource "aws_route53_record" "landing_root" {
  zone_id = aws_route53_zone.main.zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.landing.domain_name
    zone_id                = aws_cloudfront_distribution.landing.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "landing_www" {
  zone_id = aws_route53_zone.main.zone_id
  name    = local.www_domain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.landing.domain_name
    zone_id                = aws_cloudfront_distribution.landing.hosted_zone_id
    evaluate_target_health = false
  }
}
