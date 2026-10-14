"""Shared helpers for the inbox and automation tests."""

import json
import threading
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import httpx

from tests.conftest import PASSWORD, ClientFactory, Drain, token_from, unique_email


async def handoff(
    client: httpx.AsyncClient,
    topic: str = "my invoice",
    *,
    email: str | None = "ana@example.com",
    claims: dict[str, str] | None = None,
) -> dict[str, Any]:
    """A preview conversation where the customer asks for a person: a handoff, no model call."""
    body: dict[str, Any] = {"mode": "identified", "claims": claims} if claims else {}
    conversation = (await client.post("/v1/agent/conversations", json=body)).json()
    text = f"Please let me talk to a person about {topic}"
    if email:
        text += f", my email is {email}"
    sent = await client.post(
        f"/v1/agent/conversations/{conversation['id']}/messages", json={"content": text}
    )
    assert "event: message" in sent.text, sent.text
    escalation = (await client.get(f"/v1/agent/conversations/{conversation['id']}")).json()[
        "escalation"
    ]
    assert escalation is not None
    return {"id": escalation["id"], "conversation_id": conversation["id"]}


async def join(
    owner: httpx.AsyncClient,
    client_factory: ClientFactory,
    drain: Drain,
    role: str = "agent",
    name: str = "Robin Park",
) -> tuple[httpx.AsyncClient, dict[str, Any]]:
    email = unique_email(role)
    invited = await owner.post("/v1/invitations", json={"email": email, "role": role})
    assert invited.status_code == 201, invited.text
    token = token_from((await drain())[-1])
    member = client_factory()
    accepted = await member.post(
        "/v1/invitations/accept", json={"token": token, "name": name, "password": PASSWORD}
    )
    assert accepted.status_code == 200, accepted.text
    me: dict[str, Any] = accepted.json()
    return member, me


@dataclass
class Receiver:
    """A local HTTP endpoint standing in for Slack, n8n, or Zapier."""

    base: str
    requests: list[dict[str, Any]] = field(default_factory=list)
    replies: list[tuple[int, str]] = field(default_factory=list)  # queued (status, body)
    default: tuple[int, str] = (200, "ok")

    def reset(self) -> None:
        self.requests.clear()
        self.replies.clear()
        self.default = (200, "ok")

    def bodies(self) -> list[dict[str, Any]]:
        return [json.loads(r["body"]) for r in self.requests]


def serve() -> Iterator[Receiver]:
    receiver: Receiver | None = None

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            assert receiver is not None
            length = int(self.headers.get("content-length", "0"))
            body = self.rfile.read(length)
            receiver.requests.append(
                {
                    "path": self.path,
                    "headers": {k.lower(): v for k, v in self.headers.items()},
                    "body": body,
                }
            )
            status, text = receiver.replies.pop(0) if receiver.replies else receiver.default
            data = text.encode()
            self.send_response(status)
            self.send_header("content-type", "text/plain")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_: Any) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    receiver = Receiver(base=f"http://127.0.0.1:{server.server_port}")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield receiver
    server.shutdown()


def tid(client_me: dict[str, Any]) -> uuid.UUID:
    return uuid.UUID(str(client_me["active_tenant"]["id"]))
