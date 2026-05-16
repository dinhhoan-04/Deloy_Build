output "region" {
  value = var.region
}

output "api_domain_name" {
  value = local.api_domain
}

output "route53_zone_id" {
  value = aws_route53_zone.main.zone_id
}

output "route53_name_servers" {
  value = aws_route53_zone.main.name_servers
}

output "ecr_repository_url" {
  value = aws_ecr_repository.backend.repository_url
}

output "ecr_repository_name" {
  value = aws_ecr_repository.backend.name
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.backend.name
}

output "ecs_service_name" {
  value = "${local.prefix}-backend"
}

output "ecs_task_family" {
  value = "${local.prefix}-backend"
}

output "ecs_migration_task_family" {
  value = "${local.prefix}-backend-migrate"
}

output "ecs_task_execution_role_arn" {
  value = aws_iam_role.ecs_task_execution.arn
}

output "ecs_task_role_arn" {
  value = aws_iam_role.ecs_task.arn
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "private_subnet_ids" {
  value = aws_subnet.private[*].id
}

output "ecs_service_security_group_id" {
  value = aws_security_group.ecs_service.id
}

output "alb_security_group_id" {
  value = aws_security_group.alb.id
}

output "alb_target_group_arn" {
  value = aws_lb_target_group.api.arn
}

output "alb_dns_name" {
  value = aws_lb.api.dns_name
}

output "backend_log_group_name" {
  value = aws_cloudwatch_log_group.backend.name
}

output "ecs_desired_count" {
  value = var.ecs_desired_count
}

output "ecs_task_cpu" {
  value = var.ecs_task_cpu
}

output "ecs_task_memory" {
  value = var.ecs_task_memory
}

output "landing_bucket_name" {
  value = aws_s3_bucket.landing.bucket
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.landing.id
}

output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.landing.domain_name
}

output "database_host" {
  value = aws_db_instance.postgres.address
}

output "redis_primary_endpoint" {
  value = try(aws_elasticache_replication_group.redis[0].primary_endpoint_address, "")
}

output "backend_runtime_env" {
  value = local.backend_runtime_env
}

output "backend_secret_arns" {
  value = {
    for key, secret in aws_secretsmanager_secret.backend : key => secret.arn
  }
}

output "database_url_secret_arn" {
  value = aws_secretsmanager_secret.backend["DATABASE_URL"].arn
}

output "github_actions_repository_variables" {
  value = {
    AWS_REGION                  = var.region
    ECR_REPOSITORY              = aws_ecr_repository.backend.name
    ECS_CLUSTER                 = aws_ecs_cluster.backend.name
    ECS_SERVICE                 = "${local.prefix}-backend"
    ECS_CONTAINER_NAME          = "backend"
    ECS_TASK_FAMILY             = "${local.prefix}-backend"
    ECS_TASK_EXECUTION_ROLE_ARN = aws_iam_role.ecs_task_execution.arn
    ECS_TASK_ROLE_ARN           = aws_iam_role.ecs_task.arn
    ECS_TASK_CPU                = tostring(var.ecs_task_cpu)
    ECS_TASK_MEMORY             = tostring(var.ecs_task_memory)
    ECS_DESIRED_COUNT           = tostring(var.ecs_desired_count)
    ECS_SUBNET_IDS_JSON         = jsonencode(aws_subnet.public[*].id)
    ECS_SECURITY_GROUP_ID       = aws_security_group.ecs_service.id
    ALB_TARGET_GROUP_ARN        = aws_lb_target_group.api.arn
    BACKEND_LOG_GROUP_NAME      = aws_cloudwatch_log_group.backend.name
    LANDING_BUCKET_NAME         = aws_s3_bucket.landing.bucket
    CLOUDFRONT_DISTRIBUTION_ID  = aws_cloudfront_distribution.landing.id
    DATABASE_URL_SECRET_ARN     = aws_secretsmanager_secret.backend["DATABASE_URL"].arn
    REDIS_URL_SECRET_ARN        = aws_secretsmanager_secret.backend["REDIS_URL"].arn
    SESSION_SECRET_ARN          = aws_secretsmanager_secret.backend["SESSION_SECRET"].arn
    GOOGLE_CLIENT_ID_SECRET_ARN = aws_secretsmanager_secret.backend["GOOGLE_CLIENT_ID"].arn
    GEMINI_API_KEY_SECRET_ARN   = aws_secretsmanager_secret.backend["GEMINI_API_KEY"].arn
    OPENAI_API_KEY_SECRET_ARN   = aws_secretsmanager_secret.backend["OPENAI_API_KEY"].arn
    GOOGLE_API_KEY_SECRET_ARN   = aws_secretsmanager_secret.backend["GOOGLE_API_KEY"].arn
    ZAI_API_KEY_SECRET_ARN      = aws_secretsmanager_secret.backend["ZAI_API_KEY"].arn
    RK_MCP_TOKEN_SECRET_ARN     = aws_secretsmanager_secret.backend["RK_MCP_TOKEN"].arn
    LOG_LEVEL                   = var.log_level
    LLM_PRIMARY_PROVIDER        = var.llm_primary_provider
    LLM_GEMINI_MODEL            = var.llm_gemini_model
    LLM_ZAI_MODEL               = var.llm_zai_model
    LLM_OPENAI_MODEL            = var.llm_openai_model
  }
}
