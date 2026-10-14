"""Links that carry a one-time token are sealed while they wait in the job queue.

Verify, password reset, and invitation emails are sent by the worker from a
`send_email` job. The jobs table has no row-level security and is kept in
backups, so a link in plain text there would undo storing only the token's
hash. The API seals the link with the secret box; the worker opens it just
before sending. Someone who can read the database but not SECRET_KEY gets
nothing they can use.
"""

import base64
import uuid
from typing import Any

from docent.security.secretbox import SecretBox

_PURPOSE = "email-link"
_NO_TENANT = uuid.UUID(int=0)


def seal_link(secret_key: str, url: str) -> dict[str, str]:
    """Fields for a job payload in place of {"url": url}."""
    seal_id = uuid.uuid4()
    blob = SecretBox(secret_key).seal(url, purpose=_PURPOSE, tenant_id=_NO_TENANT, row_id=seal_id)
    return {"sealed_url": base64.b64encode(blob).decode(), "seal_id": str(seal_id)}


def open_link(secret_key: str, data: dict[str, Any]) -> dict[str, Any]:
    """The template data with its link opened again; data without a sealed link is unchanged."""
    if "sealed_url" not in data:
        return data
    opened = dict(data)
    blob = base64.b64decode(opened.pop("sealed_url"))
    seal_id = uuid.UUID(opened.pop("seal_id"))
    opened["url"] = SecretBox(secret_key).open(
        blob, purpose=_PURPOSE, tenant_id=_NO_TENANT, row_id=seal_id
    )
    return opened
