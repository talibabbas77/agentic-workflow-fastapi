"""Runtime settings, read from environment variables and the repo root .env file."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

def _repo_env_file() -> Path | None:
    """The monorepo's root .env, if running from a checkout. Containers use real env vars."""
    for parent in Path(__file__).resolve().parents:
        if (parent / "pnpm-workspace.yaml").is_file():
            return parent / ".env"
    return None


Environment = Literal["local", "test", "staging", "production"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_repo_env_file(),
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    env: Environment = Field(default="local", alias="DOCENT_ENV")
    version: str = "0.1.0"
    log_level: str = "INFO"
    log_json: bool = False

    # Database. The app and worker connect with roles that cannot bypass RLS.
    database_url: str = "postgresql://docent_app:docent_app@127.0.0.1:5432/docent"
    worker_database_url: str = "postgresql://docent_worker:docent_worker@127.0.0.1:5432/docent"
    migration_database_url: str = "postgresql://docent_owner:docent_owner@127.0.0.1:5432/docent"
    db_pool_min: int = 1
    db_pool_max: int = 10

    # Redis is optional. Unset means local-only mode.
    redis_url: str | None = None
    redis_timeout_seconds: float = 0.1

    # Secrets
    secret_key: SecretStr = SecretStr("local-dev-secret-change-me")
    internal_token: SecretStr = SecretStr("local-internal-token-change-me")

    # Admin web app
    web_origin: str = "http://localhost:3000"
    extra_allowed_origins: list[str] = Field(default_factory=list)
    session_cookie_name: str = "docent_session"
    session_ttl_days: int = 14
    cookie_secure: bool | None = None
    forwarded_allow_ips: str = "127.0.0.1"

    # Email
    smtp_host: str = "127.0.0.1"
    smtp_port: int = 1025
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    smtp_starttls: bool = False
    smtp_use_tls: bool = False
    email_from: str = "Docent <hello@docent.local>"

    # Jobs
    worker_url: str | None = "http://127.0.0.1:8001"
    job_idle_poll_seconds: float = 60.0
    job_lease_seconds: int = 300

    # Auth policy
    password_min_length: int = 10
    password_max_length: int = 128
    verify_token_ttl_hours: int = 24
    reset_token_ttl_minutes: int = 60
    invite_ttl_days: int = 7

    # Ollama (used from Phase 2)
    ollama_base_url: str = "http://127.0.0.1:11434"

    @model_validator(mode="after")
    def _check_production_secrets(self) -> Settings:
        if self.env in ("staging", "production"):
            weak = {"local-dev-secret-change-me", "local-internal-token-change-me"}
            if self.secret_key.get_secret_value() in weak:
                raise ValueError("SECRET_KEY must be set outside local and test")
            if self.internal_token.get_secret_value() in weak:
                raise ValueError("INTERNAL_TOKEN must be set outside local and test")
        return self

    @property
    def secure_cookies(self) -> bool:
        if self.cookie_secure is not None:
            return self.cookie_secure
        return self.env in ("staging", "production")

    @property
    def allowed_origins(self) -> set[str]:
        return {self.web_origin.rstrip("/"), *(o.rstrip("/") for o in self.extra_allowed_origins)}


@lru_cache
def get_settings() -> Settings:
    return Settings()
