"""Alembic environment. Migrations are plain SQL and run as docent_owner.

psycopg (sync) is used here because migrations contain many statements per
call, which asyncpg's prepared-statement protocol does not allow.
"""

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

from docent.config import get_settings

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def _url() -> str:
    url = os.environ.get("DOCENT_MIGRATION_URL_OVERRIDE") or get_settings().migration_database_url
    return url.replace("postgresql://", "postgresql+psycopg://", 1)


if context.is_offline_mode():
    context.configure(url=_url(), literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    engine = create_engine(_url())
    with engine.connect() as connection:
        context.configure(
            connection=connection, target_metadata=None, transaction_per_migration=True
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()
