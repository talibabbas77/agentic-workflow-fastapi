"""Runtime settings, read from environment variables and the repo root .env file."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def repo_root() -> Path | None:
    """The monorepo root when running from a checkout; None inside a container image."""
    for parent in Path(__file__).resolve().parents:
        if (parent / "pnpm-workspace.yaml").is_file():
            return parent
    return None


def _repo_env_file() -> Path | None:
    root = repo_root()
    return root / ".env" if root else None


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
    # Docent's public website, linked from "Powered by Docent" in the widget.
    # Unset means the web origin, which serves the marketing pages too.
    site_url: str | None = None
    extra_allowed_origins: list[str] = Field(default_factory=list)
    session_cookie_name: str = "docent_session"
    session_ttl_days: int = 14
    cookie_secure: bool | None = None
    forwarded_allow_ips: str = "127.0.0.1"
    max_body_bytes: int = 1_000_000

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
    job_io_slots: int = 4  # emails and summaries
    job_ingest_slots: int = 2  # crawling, parsing, embedding

    # Auth policy
    password_min_length: int = 10
    password_max_length: int = 128
    verify_token_ttl_hours: int = 24
    reset_token_ttl_minutes: int = 60
    invite_ttl_days: int = 7

    # Knowledge: storage, crawling, embeddings
    object_store_url: str | None = None  # file:///path or memory://; default .data/objects
    max_upload_bytes: int = 20_000_000
    # PDF and Word files are read in a child process with these limits.
    extract_timeout_seconds: int = 60
    extract_memory_mb: int = 1024
    crawl_max_pages: int = 200
    crawl_max_page_bytes: int = 5_000_000
    crawl_delay_seconds: float = 0.5
    crawl_timeout_seconds: float = 20.0
    crawl_user_agent: str = "DocentBot/0.1 (+https://docent.example/bot)"
    crawl_allow_private: bool = False  # tests only: allow fetching loopback addresses
    ollama_base_url: str = "http://127.0.0.1:11434"
    embedding_model: str = "embeddinggemma"
    embedding_dims: int = 768
    embedding_batch_size: int = 16
    embedding_timeout_seconds: float = 300.0
    search_rate_per_minute: int = 60
    # Calibrated on the golden corpus (docs/ARCHITECTURE.md change log, 2026-10-14).
    retrieval_min_similarity: float = 0.45

    # Language model: any OpenAI-compatible endpoint. Local Ollama by default;
    # gemma4:cloud through the same local server after `ollama signin`.
    llm_base_url: str = "http://127.0.0.1:11434/v1"
    llm_api_key: SecretStr | None = None
    llm_model: str = "gemma4:cloud"
    llm_summary_model: str | None = None  # defaults to llm_model
    llm_structured_output: Literal["auto", "json_schema", "tool", "prompt"] = "auto"
    llm_reasoning_effort: str | None = "none"  # sent to models that think by default
    llm_timeout_seconds: float = 120.0
    llm_max_concurrency: int = 2
    agent_max_answer_tokens: int = 500
    agent_history_turns: int = 6
    agent_sources: int = 6
    agent_turns_per_minute: int = 20

    # Evals. Runs and draft writing are jobs that run one at a time per workspace.
    eval_judge_model: str | None = None  # defaults to llm_model; a different model in production
    eval_max_cases: int = 300  # cases per set, drafts included
    eval_runs_per_day: int = 20  # per workspace
    # Handoff notification emails one workspace may send in a day; the rest are skipped.
    notification_emails_per_day: int = 300
    eval_drafts_per_request: int = 50

    # Widget. Served from the API origin, never from the admin app's origin.
    widget_origin: str = "http://localhost:8000"
    widget_dist_dir: Path | None = None  # default apps/widget/dist in a checkout
    widget_session_minutes: int = 30
    widget_token_max_lifetime_seconds: int = 900
    widget_clock_skew_seconds: int = 60
    widget_anonymous_per_hour: int = 10
    widget_identified_per_hour: int = 30
    # Conversations a visitor or customer may start in an hour ("New chat" included).
    widget_new_conversations_per_hour: int = 20

    # Billing (Stripe). Without a secret key the API runs with trials and manual
    # plans only, and checkout answers 503. STRIPE_API_BASE points at stripe-mock
    # in tests and local development.
    stripe_secret_key: SecretStr | None = None
    stripe_webhook_secret: SecretStr | None = None
    stripe_api_base: str | None = None
    stripe_automatic_tax: bool = False

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
    def redis_prefix(self) -> str:
        """Every Redis key starts with this, so environments can share one Redis."""
        return f"docent:{self.env}"

    @property
    def object_store(self) -> str:
        if self.object_store_url:
            return self.object_store_url
        return ((repo_root() or Path.cwd()) / ".data" / "objects").as_uri()

    @property
    def public_site_url(self) -> str:
        return (self.site_url or self.web_origin).rstrip("/")

    @property
    def widget_dist(self) -> Path:
        if self.widget_dist_dir:
            return self.widget_dist_dir
        return (repo_root() or Path("/app")) / "apps" / "widget" / "dist"

    @property
    def allowed_origins(self) -> set[str]:
        return {self.web_origin.rstrip("/"), *(o.rstrip("/") for o in self.extra_allowed_origins)}


@lru_cache
def get_settings() -> Settings:
    return Settings()
