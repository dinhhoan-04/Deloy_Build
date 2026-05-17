import os
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
from rk_shared.models import Base

config = context.config
if config.config_file_name:
    fileConfig(config.config_file_name)

# Allow override from env (sync URL for alembic)
db_url = os.environ.get("DATABASE_URL_SYNC") or os.environ.get("DATABASE_URL", "")
# Normalize: strip asyncpg driver, fix Render's "postgres://" shorthand
db_url = db_url.replace("+asyncpg", "")
if db_url.startswith("postgres://"):
    db_url = "postgresql://" + db_url[len("postgres://") :]
if db_url:
    config.set_main_option("sqlalchemy.url", db_url)

target_metadata = Base.metadata


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
