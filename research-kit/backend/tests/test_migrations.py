import os
from sqlalchemy import create_engine, inspect
from testcontainers.postgres import PostgresContainer
from alembic import command
from alembic.config import Config


def test_migration_creates_all_tables():
    with PostgresContainer("postgres:16-alpine") as pg:
        sync_url = pg.get_connection_url()
        cfg = Config("alembic.ini")
        cfg.set_main_option("sqlalchemy.url", sync_url)
        os.environ["DATABASE_URL_SYNC"] = sync_url
        command.upgrade(cfg, "head")

        eng = create_engine(sync_url)
        insp = inspect(eng)
        tables = set(insp.get_table_names())
        expected = {"users","sessions","projects","claims","inbox_items",
                    "conflicts","runs","run_events","verify_cache",
                    "paper_content","paper_content_cache","verify_result_cache",
                    "alembic_version"}
        assert expected.issubset(tables)
