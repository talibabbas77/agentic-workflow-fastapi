"""Encryption at rest for secrets tenants give us: Slack URLs, webhook URLs and signing secrets.

AES-256-GCM with a key derived from SECRET_KEY by HKDF-SHA256, so the database
alone never reveals them. A stored value is one version byte, a random 12 byte
nonce, and the ciphertext with its tag. The associated data names the purpose,
tenant, and row, so a value copied into another row or tenant fails to open.

Changing SECRET_KEY makes stored secrets unreadable; tenants then enter them
again. The version byte leaves room to add key rotation later.
"""

import os
import uuid

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

VERSION = 1
NONCE_BYTES = 12


class SecretError(Exception):
    """A stored secret could not be opened: wrong key, wrong row, or tampered."""


class SecretBox:
    def __init__(self, secret_key: str) -> None:
        key = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b"docent-secretbox",
            info=b"docent tenant secrets v1",
        ).derive(secret_key.encode())
        self._aead = AESGCM(key)

    def seal(
        self, plaintext: str, *, purpose: str, tenant_id: uuid.UUID, row_id: uuid.UUID
    ) -> bytes:
        nonce = os.urandom(NONCE_BYTES)
        sealed = self._aead.encrypt(nonce, plaintext.encode(), _aad(purpose, tenant_id, row_id))
        return bytes([VERSION]) + nonce + sealed

    def open(self, blob: bytes, *, purpose: str, tenant_id: uuid.UUID, row_id: uuid.UUID) -> str:
        if len(blob) < 1 + NONCE_BYTES + 16 or blob[0] != VERSION:
            raise SecretError("unknown secret format")
        nonce, sealed = blob[1 : 1 + NONCE_BYTES], blob[1 + NONCE_BYTES :]
        try:
            return self._aead.decrypt(nonce, sealed, _aad(purpose, tenant_id, row_id)).decode()
        except InvalidTag:
            raise SecretError("secret does not open with this key") from None


def _aad(purpose: str, tenant_id: uuid.UUID, row_id: uuid.UUID) -> bytes:
    return f"{purpose}:{tenant_id}:{row_id}".encode()
