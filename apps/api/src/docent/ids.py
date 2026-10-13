"""Identifiers, opaque tokens, and keyed hashes."""

import hashlib
import hmac
import secrets
import uuid


def new_id() -> uuid.UUID:
    """Time-ordered UUIDv7, generated in the app so the database stays portable."""
    return uuid.uuid7()


def new_token() -> str:
    """256-bit random token, URL safe. Only its hash is ever stored."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def keyed_hash(secret: str, value: str, length: int = 16) -> str:
    """Stable pseudonymous key for IPs and emails in logs and rate limit keys."""
    digest = hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()
    return digest[:length]
