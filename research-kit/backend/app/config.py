from functools import lru_cache
from pathlib import Path
from typing import Literal
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Single source of truth = research-kit/infra/.env (read by docker-compose `env_file: .env`
# in infra/docker-compose.yml). For local dev (uvicorn outside docker) we point pydantic
# at the same file via a relative path from this module.
_INFRA_ENV = Path(__file__).resolve().parents[2] / "infra" / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_INFRA_ENV) if _INFRA_ENV.exists() else None,
        case_sensitive=False,
        extra="ignore",
    )

    env: str = "development"
    log_level: str = "INFO"

    database_url: str
    redis_url: str

    @property
    def async_database_url(self) -> str:
        # Render injects "postgres://" — asyncpg needs "postgresql+asyncpg://"
        url = self.database_url
        if url.startswith("postgres://"):
            url = "postgresql+asyncpg://" + url[len("postgres://"):]
        elif url.startswith("postgresql://") and "+asyncpg" not in url:
            url = "postgresql+asyncpg://" + url[len("postgresql://"):]
        return url

    google_client_id: str
    session_secret: str = Field(min_length=32)

    dev_auth_bypass: bool = False

    # LLM extract service
    gemini_api_key: str = ""
    zai_api_key: str = ""
    openai_api_key: str = ""
    llm_primary_provider: Literal["gemini", "zai", "openai"] = "openai"
    llm_gemini_model: str = "gemini-2.5-flash"
    llm_zai_model: str = "glm-4.7"
    llm_openai_model: str = "gpt-4o-mini"
    verify_cache_ttl_days: int = 7
    paper_cache_ttl_days: int = 30
    verify_max_chars_zai: int = 28000
    verify_max_chars_gemini: int = 36000
    verify_max_chars_openai: int = 28000


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
