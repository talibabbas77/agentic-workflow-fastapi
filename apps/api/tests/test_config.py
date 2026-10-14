"""Settings refuse to run a deployment with laptop defaults (security review, 2026-10-14)."""

import pytest
from pydantic import ValidationError

from docent.config import Settings

STRONG = {"SECRET_KEY": "s" * 48, "INTERNAL_TOKEN": "t" * 48}


def build(monkeypatch: pytest.MonkeyPatch, **env: str) -> Settings:
    for name in ("DOCENT_ENV", "SECRET_KEY", "INTERNAL_TOKEN", "FORWARDED_ALLOW_IPS"):
        monkeypatch.delenv(name, raising=False)
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    return Settings()


def test_production_refuses_the_default_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValidationError, match="SECRET_KEY must be set"):
        build(monkeypatch, DOCENT_ENV="production")
    settings = build(monkeypatch, DOCENT_ENV="production", **STRONG)
    assert settings.secure_cookies is True


def test_production_refuses_trusting_every_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValidationError, match="FORWARDED_ALLOW_IPS"):
        build(monkeypatch, DOCENT_ENV="production", FORWARDED_ALLOW_IPS="*", **STRONG)
    assert build(monkeypatch, DOCENT_ENV="production", FORWARDED_ALLOW_IPS="10.0.0.5", **STRONG)
    assert build(monkeypatch, DOCENT_ENV="local", FORWARDED_ALLOW_IPS="*").env == "local"


def test_the_image_defaults_to_production() -> None:
    from docent.config import repo_root

    root = repo_root()
    assert root is not None
    dockerfile = (root / "infra" / "docker" / "api.Dockerfile").read_text()
    assert "DOCENT_ENV=production" in dockerfile
