variable "project_name" {
  description = "Base name for AWS resources."
  type        = string
  default     = "research-kit"
}

variable "domain_name" {
  description = "Root domain hosted in Route 53."
  type        = string
}

variable "region" {
  description = "Primary AWS region for backend, data, and landing resources."
  type        = string
  default     = "ap-southeast-1"
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "ecs_task_cpu" {
  description = "Fargate task CPU units. 512 = 0.5 vCPU."
  type        = number
  default     = 512
}

variable "ecs_task_memory" {
  description = "Fargate task memory in MiB. 1024 = 1 GB."
  type        = number
  default     = 1024
}

variable "ecs_desired_count" {
  description = "Desired backend task count."
  type        = number
  default     = 1
}

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.micro"
}

variable "create_elasticache" {
  description = "Create Redis on AWS. Disable this and set external_redis_url to reduce spend."
  type        = bool
  default     = false
}

variable "external_redis_url" {
  description = "External Redis URL used when create_elasticache is false."
  type        = string
  default     = ""
  sensitive   = true
}

variable "google_client_id" {
  description = "Google OAuth client ID used by the Chrome extension."
  type        = string
  sensitive   = true
}

variable "gemini_api_key" {
  description = "Gemini API key used by the main backend config."
  type        = string
  default     = ""
  sensitive   = true
}

variable "openai_api_key" {
  description = "OpenAI API key."
  type        = string
  default     = ""
  sensitive   = true
}

variable "google_api_key" {
  description = "Google API key."
  type        = string
  default     = ""
  sensitive   = true
}

variable "zai_api_key" {
  description = "Z.ai API key."
  type        = string
  default     = ""
  sensitive   = true
}

variable "session_secret" {
  description = "Optional fixed session secret. Leave empty to auto-generate."
  type        = string
  default     = ""
  sensitive   = true
}

variable "rk_mcp_token" {
  description = "Optional fixed MCP bearer token. Leave empty to auto-generate."
  type        = string
  default     = ""
  sensitive   = true
}

variable "llm_primary_provider" {
  description = "Primary LLM provider."
  type        = string
  default     = "zai"
}

variable "llm_gemini_model" {
  description = "Gemini model name."
  type        = string
  default     = "gemini-2.5-flash"
}

variable "llm_zai_model" {
  description = "Z.ai model name."
  type        = string
  default     = "glm-4.7"
}

variable "llm_openai_model" {
  description = "OpenAI model name."
  type        = string
  default     = "gpt-4o-mini"
}

variable "log_level" {
  description = "Backend log level."
  type        = string
  default     = "INFO"
}

variable "tags" {
  description = "Extra tags to merge into all resources."
  type        = map(string)
  default     = {}
}
