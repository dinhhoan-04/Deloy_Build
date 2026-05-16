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
