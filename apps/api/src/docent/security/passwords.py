"""Password hashing with argon2id. Hashing runs off the event loop."""

import asyncio

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

_hasher = PasswordHasher()

# Verifying against this keeps login timing similar when the email is unknown.
_DUMMY_HASH = _hasher.hash("docent-timing-equalizer")


async def hash_password(password: str) -> str:
    return await asyncio.to_thread(_hasher.hash, password)


async def verify_password(password_hash: str | None, password: str) -> bool:
    target = password_hash or _DUMMY_HASH

    def _verify() -> bool:
        try:
            return _hasher.verify(target, password)
        except VerifyMismatchError, VerificationError, InvalidHashError:
            return False

    ok = await asyncio.to_thread(_verify)
    return ok and password_hash is not None


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)
