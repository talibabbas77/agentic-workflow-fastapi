"""Identity for the widget: tenant signing keys, the tokens they sign, and allowed origins.

Tenants sign a short-lived ES256 JWT for their logged-in user with a private key
Docent never sees. Docent stores only the public key and checks every claim that
matters: algorithm, key id, signature, audience, issuer, lifetime, and replay.
"""

import json
import secrets
import string
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.algorithms import ECAlgorithm

AUDIENCE = "docent"
_ALPHABET = string.ascii_letters + string.digits
LOCAL_HOSTS = {"localhost", "127.0.0.1", "[::1]"}


class IdentityError(Exception):
    """A key, token, or origin was rejected. The message is safe to show the tenant."""


def new_public_id() -> str:
    return "wid_" + "".join(secrets.choice(_ALPHABET) for _ in range(16))


def new_kid() -> str:
    return "key_" + "".join(secrets.choice(_ALPHABET) for _ in range(12))


def normalize_origin(value: str, *, allow_http: bool) -> str:
    """scheme://host[:port] in lower case. No paths, wildcards, or credentials."""
    parts = urlsplit(value.strip())
    if parts.scheme not in ("https", "http") or not parts.hostname:
        raise IdentityError(f"{value} is not an origin like https://app.example.com.")
    if parts.path not in ("", "/") or parts.query or parts.fragment or "*" in value:
        raise IdentityError(f"{value} must be an origin only: no path, query, or wildcard.")
    if parts.username or parts.password:
        raise IdentityError(f"{value} must not contain a user name or password.")
    host = parts.hostname.lower()
    if parts.scheme == "http" and not (allow_http or host in LOCAL_HOSTS):
        raise IdentityError(f"{value} must use https.")
    port = f":{parts.port}" if parts.port else ""
    return f"{parts.scheme}://{host}{port}"


def public_jwk(raw: dict[str, Any]) -> dict[str, str]:
    """Validate an uploaded P-256 public key and return its canonical JWK."""
    if "d" in raw:
        raise IdentityError("That is a private key. Upload the public key only.")
    if raw.get("kty") != "EC" or raw.get("crv") != "P-256":
        raise IdentityError("Use an EC P-256 public key (ES256).")
    try:
        key = ECAlgorithm.from_jwk(json.dumps({k: raw[k] for k in ("kty", "crv", "x", "y")}))
    except (KeyError, ValueError, jwt.InvalidKeyError) as exc:
        raise IdentityError("The key could not be read as a P-256 public key.") from exc
    if not isinstance(key, ec.EllipticCurvePublicKey):
        raise IdentityError("Upload a public key.")
    return {"kty": "EC", "crv": "P-256", "x": raw["x"], "y": raw["y"]}


@dataclass(frozen=True, slots=True)
class Identity:
    external_id: str
    name: str | None
    email: str | None
    claims: dict[str, str]
    jti: str
    expires_at: int


def verify_token(
    token: str,
    *,
    widget_public_id: str,
    keys: dict[str, dict[str, Any]],
    allowed_claims: list[str],
    max_lifetime: int,
    skew: int,
) -> Identity:
    """Check a tenant-signed token. Every failure is the same IdentityError to the caller."""
    if len(token) > 8192:
        raise IdentityError("token too large")
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError as exc:
        raise IdentityError("token malformed") from exc
    if header.get("alg") != "ES256":
        raise IdentityError("only ES256 tokens are accepted")
    jwk = keys.get(str(header.get("kid")))
    if jwk is None:
        raise IdentityError("unknown or retired key id")
    key = ECAlgorithm.from_jwk(json.dumps(jwk))
    if not isinstance(key, ec.EllipticCurvePublicKey):
        raise IdentityError("unknown or retired key id")
    try:
        claims = jwt.decode(
            token,
            key,
            algorithms=["ES256"],
            audience=AUDIENCE,
            issuer=widget_public_id,
            leeway=skew,
            options={"require": ["iss", "aud", "sub", "iat", "exp", "jti"]},
        )
    except jwt.InvalidTokenError as exc:
        raise IdentityError(f"token rejected: {type(exc).__name__}") from exc
    now = time.time()
    if claims["iat"] > now + skew:
        raise IdentityError("token issued in the future")
    if claims["exp"] - claims["iat"] > max_lifetime:
        raise IdentityError("token lifetime too long")
    subject, jti = claims["sub"], claims["jti"]
    if not isinstance(subject, str) or not 1 <= len(subject) <= 255:
        raise IdentityError("sub must be a string of 1 to 255 characters")
    if not isinstance(jti, str) or not 8 <= len(jti) <= 128:
        raise IdentityError("jti must be a string of 8 to 128 characters")
    raw_context = claims.get("ctx")
    context: dict[str, Any] = raw_context if isinstance(raw_context, dict) else {}
    kept = {
        key: str(value)[:200]
        for key, value in context.items()
        if key in allowed_claims and isinstance(value, (str, int, float, bool))
    }
    return Identity(
        external_id=subject,
        name=_text(claims.get("name")),
        email=_text(claims.get("email")),
        claims=kept,
        jti=jti,
        expires_at=int(claims["exp"]),
    )


def _text(value: object) -> str | None:
    return value[:200] if isinstance(value, str) and value.strip() else None
