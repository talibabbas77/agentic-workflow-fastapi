"""The inbox: lists, unread markers, status times, replies by email, notes, roles, isolation."""

import uuid
from typing import Any

import asyncpg
import httpx
import pytest

from docent.db.pool import Pool, transaction
from docent.email.sender import MemoryEmailSender, OutgoingEmail, sender_address
from docent.inbox import metrics
from docent.jobs.handlers import make_handlers
from docent.jobs.worker import Worker
from tests.conftest import ClientFactory, Drain, verified_owner
from tests.inbox_helpers import handoff, join, tid


@pytest.fixture
async def owner(client_factory: ClientFactory, drain: Drain) -> httpx.AsyncClient:
    client = client_factory()
    await verified_owner(client, drain, "Lumen Notes")
    return client


async def items(client: httpx.AsyncClient, **params: Any) -> list[dict[str, Any]]:
    response = await client.get("/v1/inbox", params=params)
    assert response.status_code == 200, response.text
    found: list[dict[str, Any]] = response.json()["items"]
    return found


async def detail(client: httpx.AsyncClient, escalation_id: str) -> dict[str, Any]:
    response = await client.get(f"/v1/inbox/{escalation_id}")
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()
    return data


async def test_list_filters_sorts_and_pages(owner: httpx.AsyncClient, drain: Drain) -> None:
    a = await handoff(owner, "a refund for my order")
    b = await handoff(owner, "my invoice")
    c = await handoff(owner, "exporting notes", email=None)
    await drain()

    listed = (await owner.get("/v1/inbox")).json()
    assert [i["id"] for i in listed["items"]] == [c["id"], b["id"], a["id"]]  # newest first
    assert listed["counts"] == {
        "open": 3,
        "assigned": 0,
        "waiting": 0,
        "resolved": 0,
        "unread": 3,
        "mine": 0,
        "unassigned": 3,
    }
    first = listed["items"][2]
    assert first["issue"] == "Customer asked for a person."  # from the summary
    assert (first["contact_email"], first["mode"], first["channel"]) == (
        "ana@example.com",
        "anonymous",
        "preview",
    )
    assert first["summary_ready"]
    assert first["unread"]

    page = (await owner.get("/v1/inbox", params={"limit": 2})).json()
    assert [i["id"] for i in page["items"]] == [c["id"], b["id"]]
    rest = (await owner.get("/v1/inbox", params={"limit": 2, "cursor": page["next_cursor"]})).json()
    assert [i["id"] for i in rest["items"]] == [a["id"]]
    assert rest["next_cursor"] is None
    oldest = await items(owner, sort="oldest")
    assert [i["id"] for i in oldest] == [a["id"], b["id"], c["id"]]
    bad = await owner.get("/v1/inbox", params={"cursor": "not-a-cursor"})
    assert bad.status_code == 422

    assert (
        await owner.patch(f"/v1/inbox/{b['id']}", json={"status": "waiting"})
    ).status_code == 200
    assert (
        await owner.patch(f"/v1/inbox/{c['id']}", json={"status": "assigned", "priority": "urgent"})
    ).status_code == 200
    assert [i["id"] for i in await items(owner, status="waiting")] == [b["id"]]
    assert [i["id"] for i in await items(owner, status=["open", "waiting"])] == [b["id"], a["id"]]
    assert [i["id"] for i in await items(owner, assignee="me")] == [c["id"]]
    assert {i["id"] for i in await items(owner, assignee="unassigned")} == {a["id"], b["id"]}
    assert len(await items(owner, reason="user_requested")) == 3
    assert await items(owner, reason="no_source") == []
    assert [i["id"] for i in await items(owner, q="refund")] == [a["id"]]
    assert [i["id"] for i in await items(owner, q="100%_")] == []  # wildcards are literal
    assert (await items(owner, sort="priority"))[0]["id"] == c["id"]

    board = (await owner.get("/v1/inbox/board")).json()
    columns = {col["status"]: [i["id"] for i in col["items"]] for col in board["columns"]}
    assert columns == {
        "open": [a["id"]],
        "assigned": [c["id"]],
        "waiting": [b["id"]],
        "resolved": [],
    }
    filtered = (await owner.get("/v1/inbox/board", params={"q": "invoice"})).json()
    assert sum(col["total"] for col in filtered["columns"]) == 1


async def test_unread_is_per_member(
    owner: httpx.AsyncClient, client_factory: ClientFactory, drain: Drain
) -> None:
    agent, _ = await join(owner, client_factory, drain)
    made = await handoff(owner)
    await drain()
    assert (await items(owner))[0]["unread"] is True
    assert (await owner.post(f"/v1/inbox/{made['id']}/read")).status_code == 204
    assert (await items(owner))[0]["unread"] is False
    assert (await items(agent))[0]["unread"] is True

    # A teammate's note is news to the owner, not to the teammate who wrote it.
    note = await agent.post(f"/v1/inbox/{made['id']}/notes", json={"body": "Checking billing."})
    assert note.status_code == 201
    assert (await items(owner))[0]["unread"] is True
    assert (await items(agent))[0]["unread"] is False
    assert (await owner.get("/v1/inbox")).json()["counts"]["unread"] == 1

    # The customer writing again makes it unread for everyone.
    await owner.post(f"/v1/inbox/{made['id']}/read")
    await owner.post(
        f"/v1/agent/conversations/{made['conversation_id']}/messages",
        json={"content": "Any news on this?"},
    )
    assert (await items(owner))[0]["unread"] is True
    assert (await items(agent))[0]["unread"] is True


async def test_status_changes_set_resolved_at_and_history(
    owner: httpx.AsyncClient, drain: Drain, admin_pool: Pool
) -> None:
    made = await handoff(owner)
    await drain()
    resolved = (await owner.patch(f"/v1/inbox/{made['id']}", json={"status": "resolved"})).json()
    assert resolved["item"]["resolved_at"] is not None
    assert resolved["item"]["first_response_at"] is None  # nobody answered the customer
    async with admin_pool.acquire() as conn:
        conversation = uuid.UUID(made["conversation_id"])
        state = await conn.fetchval("select status from conversations where id = $1", conversation)
        assert state == "closed"

    reopened = (await owner.patch(f"/v1/inbox/{made['id']}", json={"status": "open"})).json()
    assert reopened["item"]["resolved_at"] is None
    async with admin_pool.acquire() as conn:
        state = await conn.fetchval("select status from conversations where id = $1", conversation)
        assert state == "escalated"

    me = (await owner.get("/v1/auth/me")).json()["user"]
    taken = (
        await owner.patch(f"/v1/inbox/{made['id']}", json={"assignee_user_id": me["id"]})
    ).json()
    assert taken["item"]["status"] == "assigned"  # an open handoff with an owner is assigned
    assert taken["item"]["assignee"]["name"] == "Sam Ortiz"
    released = (
        await owner.patch(f"/v1/inbox/{made['id']}", json={"assignee_user_id": None})
    ).json()
    assert (released["item"]["status"], released["item"]["assignee"]) == ("open", None)
    texts = [h["text"] for h in released["history"]]
    assert texts == [
        "Moved from Open to Resolved",
        "Moved from Resolved to Open",
        "Assigned to Sam Ortiz",
        "Moved from Open to Assigned",
        "Unassigned",
        "Moved from Assigned to Open",
    ]
    assert {h["actor"] for h in released["history"]} == {"Sam Ortiz"}


async def test_edit_ticket_type_fields_and_priority(owner: httpx.AsyncClient, drain: Drain) -> None:
    billing = (
        await owner.post(
            "/v1/ticket-types",
            json={
                "name": "Billing",
                "description": "Payments and refunds.",
                "fields": [{"key": "order_id", "label": "Order number"}],
                "priority": "high",
            },
        )
    ).json()
    made = await handoff(owner)
    await drain()  # the fake summary picks Billing and fills order_id
    data = await detail(owner, made["id"])
    assert data["item"]["ticket_type"]["name"] == "Billing"
    assert data["item"]["priority"] == "high"  # from the ticket type, when routed
    assert data["fields"] == {"order_id": "A-1001"}
    assert data["ticket_type_fields"][0]["label"] == "Order number"

    edited = await owner.patch(
        f"/v1/inbox/{made['id']}", json={"fields": {"order_id": "B-7"}, "priority": "low"}
    )
    assert edited.json()["fields"] == {"order_id": "B-7"}
    unknown = await owner.patch(f"/v1/inbox/{made['id']}", json={"fields": {"color": "red"}})
    assert unknown.status_code == 422
    cleared = await owner.patch(f"/v1/inbox/{made['id']}", json={"ticket_type_id": None})
    assert (cleared.json()["item"]["ticket_type"], cleared.json()["fields"]) == (None, {})
    restored = await owner.patch(f"/v1/inbox/{made['id']}", json={"ticket_type_id": billing["id"]})
    assert restored.json()["item"]["ticket_type"]["id"] == billing["id"]
    texts = [h["text"] for h in restored.json()["history"]]
    assert "Details edited" in texts
    assert "Priority set to Low" in texts
    assert "Ticket type removed" in texts
    assert "Ticket type set to Billing" in texts


async def test_reply_by_email(
    owner: httpx.AsyncClient, drain: Drain, mailbox: MemoryEmailSender
) -> None:
    made = await handoff(owner)
    await drain()
    me = (await owner.get("/v1/auth/me")).json()["user"]

    sent = await owner.post(
        f"/v1/inbox/{made['id']}/replies",
        json={"body": "Hi Ana,\n\nWe refunded the duplicate charge today."},
    )
    assert sent.status_code == 201, sent.text
    reply = sent.json()
    assert reply["message"]["role"] == "human"
    assert reply["message"]["author"]["name"] == "Sam Ortiz"
    assert reply["message"]["delivery"]["status"] == "queued"
    assert reply["message"]["delivery"]["to_hint"] == "a***@example.com"
    assert reply["item"]["status"] == "waiting"
    assert reply["item"]["assignee"]["name"] == "Sam Ortiz"  # replying takes the handoff
    first_response = reply["item"]["first_response_at"]
    assert first_response is not None

    emails = [e for e in await drain() if e.to == "ana@example.com"]
    assert len(emails) == 1
    email = emails[0]
    assert email.subject == "Your question to Lumen Notes"
    assert email.from_name == "Lumen Notes via Docent"
    assert email.reply_to == me["email"]  # no support address yet: the replying member
    assert "We refunded the duplicate charge today." in email.text
    assert email.headers["References"] == f"<handoff-{made['id']}@docent>"

    data = await detail(owner, made["id"])
    reply_message = next(m for m in data["messages"] if m["role"] == "human")
    assert reply_message["delivery"]["status"] == "sent"
    assert [d["kind"] for d in data["deliveries"]] == ["reply"]
    assert "Replied by email to a***@example.com" in [h["text"] for h in data["history"]]

    # With a support address, replies go there; a second reply keeps the first response time.
    saved = await owner.patch("/v1/inbox/settings", json={"support_email": "Help@Lumen.example"})
    assert saved.json() == {
        "support_email": "help@lumen.example",
        "reply_from": "Lumen Notes via Docent <hello@docent.local>",
    }
    second = await owner.post(
        f"/v1/inbox/{made['id']}/replies", json={"body": "All done.", "then": "resolved"}
    )
    assert second.json()["item"]["status"] == "resolved"
    assert second.json()["item"]["first_response_at"] == first_response
    assert second.json()["item"]["resolved_at"] is not None
    [last] = [e for e in await drain() if e.to == "ana@example.com"]
    assert last.reply_to == "help@lumen.example"


async def test_reply_needs_a_contact_email(owner: httpx.AsyncClient, drain: Drain) -> None:
    made = await handoff(owner, email=None)
    response = await owner.post(f"/v1/inbox/{made['id']}/replies", json={"body": "Hello"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "no_contact"


def test_from_line_uses_the_platform_address() -> None:
    assert (
        sender_address("Docent <hello@docent.local>", "Lumen Notes via Docent")
        == "Lumen Notes via Docent <hello@docent.local>"
    )
    # A workspace name cannot add header lines.
    injected = sender_address("Docent <hello@docent.local>", "Evil\r\nBcc: x@example.com")
    assert "\n" not in injected
    assert injected.endswith("<hello@docent.local>")


class FailingSender:
    def __init__(self) -> None:
        self.calls = 0

    async def send(self, email: OutgoingEmail) -> str:
        self.calls += 1
        raise ConnectionError("SMTP server refused the connection")


async def test_failing_email_retries_then_shows_dead_with_its_error(
    owner: httpx.AsyncClient, drain: Drain, worker_pool: Pool, admin_pool: Pool
) -> None:
    made = await handoff(owner)
    await drain()
    await owner.post(f"/v1/inbox/{made['id']}/replies", json={"body": "Hello"})
    failing = FailingSender()
    worker = Worker(worker_pool, make_handlers(failing), idle_poll_seconds=60, lease_seconds=30)
    await worker.drain()
    delivery = (await detail(owner, made["id"]))["deliveries"][0]
    assert (delivery["status"], delivery["attempts"]) == ("retrying", 1)
    assert "SMTP server refused" in delivery["last_error"]
    for _ in range(4):
        async with admin_pool.acquire() as conn:
            await conn.execute("update jobs set run_at = now() where status = 'queued'")
        await worker.drain()
    delivery = (await detail(owner, made["id"]))["deliveries"][0]
    assert (delivery["status"], delivery["attempts"]) == ("dead", 5)
    assert delivery["last_error"] == "ConnectionError: SMTP server refused the connection"
    assert failing.calls == 5
    async with admin_pool.acquire() as conn:
        job = await conn.fetchval(
            "select status from jobs where kind = 'send_email' and payload ? 'delivery_id'"
        )
        assert job == "dead"


async def test_mark_answer_as_wrong_is_counted(owner: httpx.AsyncClient, drain: Drain) -> None:
    guide = b"# Billing\n\n## Refunds\n\nAnnual plans are refundable within 30 days.\n"
    assert (
        await owner.post("/v1/knowledge/uploads", files={"file": ("billing.md", guide)})
    ).status_code == 201
    await drain()
    conversation = (await owner.post("/v1/agent/conversations", json={})).json()
    await owner.post(
        f"/v1/agent/conversations/{conversation['id']}/messages",
        json={"content": "are annual plans refundable"},
    )
    messages = (await owner.get(f"/v1/agent/conversations/{conversation['id']}")).json()["messages"]
    answer = next(m for m in messages if m["role"] == "agent")
    visitor = next(m for m in messages if m["role"] == "visitor")
    assert answer["decision"]["type"] == "answer"
    stats = (await owner.get("/v1/inbox/stats")).json()
    assert (stats["answers_30d"], stats["wrong_answers_30d"]) == (1, 0)

    flagged = await owner.post(
        f"/v1/messages/{answer['id']}/flag", json={"reason": "Refunds take 14 days, not 30."}
    )
    assert flagged.status_code == 200, flagged.text
    assert flagged.json()["flag"]["reason"] == "Refunds take 14 days, not 30."
    assert flagged.json()["flag"]["by"] == "Sam Ortiz"
    stats = (await owner.get("/v1/inbox/stats")).json()
    assert (stats["wrong_answers_30d"], stats["wrong_answer_rate_30d"]) == (1, 1.0)

    not_answer = await owner.post(f"/v1/messages/{visitor['id']}/flag", json={"reason": "Nope."})
    assert not_answer.status_code == 422
    missing = await owner.post(f"/v1/messages/{uuid.uuid4()}/flag", json={"reason": "Nope."})
    assert missing.status_code == 404
    assert (await owner.delete(f"/v1/messages/{answer['id']}/flag")).json()["flag"] is None
    assert (await owner.get("/v1/inbox/stats")).json()["wrong_answers_30d"] == 0


async def test_answer_quality_query(owner: httpx.AsyncClient, admin_pool: Pool) -> None:
    """The metrics query counts answers and the ones marked wrong, by hand-written rows."""
    tenant_id = uuid.UUID((await owner.get("/v1/tenant")).json()["id"])
    conversation_id = uuid.uuid4()
    async with admin_pool.acquire() as conn:
        await conn.execute(
            """
            insert into conversations (id, tenant_id, channel, mode)
            values ($1, $2, 'widget', 'anonymous')
            """,
            conversation_id,
            tenant_id,
        )
        for decision, wrong in (("answer", True), ("answer", False), ("escalate", True)):
            await conn.execute(
                """
                insert into messages (id, tenant_id, conversation_id, role, content, decision,
                                      flagged_wrong)
                values ($1, $2, $3, 'agent', 'x', $4, $5)
                """,
                uuid.uuid4(),
                tenant_id,
                conversation_id,
                {"type": decision},
                wrong,
            )
    async with admin_pool.acquire() as conn, conn.transaction():
        quality = await metrics.answer_quality(conn, 30)
    assert (quality.answers, quality.flagged_wrong, quality.wrong_rate) == (2, 1, 0.5)


async def test_agent_role_works_the_inbox_but_not_settings(
    owner: httpx.AsyncClient,
    client_factory: ClientFactory,
    drain: Drain,
    mailbox: MemoryEmailSender,
) -> None:
    agent, agent_me = await join(owner, client_factory, drain)
    agent_id = agent_me["user"]["id"]
    owner_id = (await owner.get("/v1/auth/me")).json()["user"]["id"]
    made = await handoff(owner)
    await drain()
    path = f"/v1/inbox/{made['id']}"

    assert (await agent.get("/v1/inbox")).status_code == 200
    assert (await agent.get("/v1/inbox/board")).status_code == 200
    assert (await agent.get(path)).status_code == 200
    assert (await agent.post(f"{path}/read")).status_code == 204
    assert (await agent.post(f"{path}/notes", json={"body": "Mine."})).status_code == 201
    assert (await agent.patch(path, json={"status": "waiting"})).status_code == 200
    assert (await agent.patch(path, json={"assignee_user_id": agent_id})).status_code == 200
    reply = await agent.post(f"{path}/replies", json={"body": "On it."})
    assert reply.status_code == 201
    prefs = {"daily_digest": False, "assigned_email": True}
    assert (await agent.put("/v1/inbox/preferences", json=prefs)).json() == prefs
    assert (await agent.get("/v1/automation/rules")).status_code == 200
    assert (await agent.get("/v1/automation/webhooks")).status_code == 200
    assert (await agent.get("/v1/inbox/assignees")).status_code == 200
    detail_view = await detail(agent, made["id"])
    assert detail_view["can_assign_others"] is False

    # Assigning someone else needs an owner or admin.
    other = await agent.patch(path, json={"assignee_user_id": owner_id})
    assert other.status_code == 403
    assert (await owner.patch(path, json={"assignee_user_id": owner_id})).status_code == 200
    assert (await agent.patch(path, json={"assignee_user_id": None})).status_code == 403
    assert (await agent.patch(path, json={"status": "open"})).status_code == 403

    forbidden = [
        ("POST", "/v1/automation/rules", {"name": "Mine", "set_priority": "high"}),
        ("PUT", "/v1/automation/rules/order", {"ids": [str(uuid.uuid4())]}),
        ("POST", "/v1/automation/channels", {"name": "S", "url": "http://127.0.0.1:9/x"}),
        ("POST", "/v1/automation/webhooks", {"url": "http://127.0.0.1:9/x"}),
        ("PATCH", "/v1/inbox/settings", {"support_email": "me@example.com"}),
        ("PATCH", "/v1/tenant", {"name": "Mine now"}),
        ("PATCH", "/v1/agent/settings", {"tone": "formal"}),
        ("POST", "/v1/billing/checkout", {"plan_id": "growth"}),
        ("POST", "/v1/billing/cancel", None),
    ]
    for method, url, body in forbidden:
        response = await agent.request(method, url, json=body)
        assert response.status_code == 403, (method, url, response.text)

    # The owner assigns the agent: the agent is told by email.
    await owner.patch(path, json={"assignee_user_id": agent_id})
    sent = await drain()
    assert any(e.to == agent_me["user"]["email"] and "Assigned to you" in e.subject for e in sent)


async def test_tenant_a_never_sees_tenant_b_handoffs(
    client_factory: ClientFactory, drain: Drain
) -> None:
    a = client_factory()
    b = client_factory()
    await verified_owner(a, drain, "Tenant A")
    await verified_owner(b, drain, "Tenant B")
    mine = await handoff(a, "tenant a question")
    theirs = await handoff(b, "tenant b question")
    await drain()
    assert [i["id"] for i in await items(a)] == [mine["id"]]
    assert [i["id"] for i in await items(a, q="tenant b")] == []
    board = (await a.get("/v1/inbox/board")).json()
    assert sum(col["total"] for col in board["columns"]) == 1
    messages = (await b.get(f"/v1/agent/conversations/{theirs['conversation_id']}")).json()
    agent_message = next(m for m in messages["messages"] if m["role"] == "agent")
    path = f"/v1/inbox/{theirs['id']}"
    checks = [
        ("GET", path, None),
        ("PATCH", path, {"status": "resolved"}),
        ("POST", f"{path}/read", None),
        ("POST", f"{path}/replies", {"body": "Hello"}),
        ("POST", f"{path}/notes", {"body": "Hello"}),
        ("POST", f"/v1/messages/{agent_message['id']}/flag", {"reason": "Wrong one."}),
    ]
    for method, url, body in checks:
        response = await a.request(method, url, json=body)
        assert response.status_code == 404, (method, url, response.text)
    assert (await b.get(path)).json()["item"]["status"] == "open"


# Each new table, with an insert that names tenant B ($1) and, where needed, a user ($2).
NEW_TABLE_INSERTS = {
    "escalation_reads": "insert into escalation_reads (tenant_id, user_id, escalation_id)"
    " values ($1, $2, gen_random_uuid())",
    "escalation_notes": "insert into escalation_notes (id, tenant_id, escalation_id, body)"
    " values (gen_random_uuid(), $1, gen_random_uuid(), 'x')",
    "notification_channels": "insert into notification_channels (id, tenant_id, name,"
    " target_encrypted, target_hint) values (gen_random_uuid(), $1, 'x', '\\x00', 'x')",
    "notifications": "insert into notifications (id, tenant_id, kind, channel, dedupe_key)"
    " values (gen_random_uuid(), $1, 'test', 'email', 'x')",
    "email_deliveries": "insert into email_deliveries (id, tenant_id, kind, to_hash, to_hint,"
    " subject) values (gen_random_uuid(), $1, 'reply', 'x', 'x', 'x')",
    "routing_rules": "insert into routing_rules (id, tenant_id, name, position)"
    " values (gen_random_uuid(), $1, 'x', 1)",
    "webhooks": "insert into webhooks (id, tenant_id, url_encrypted, url_hint, secret_encrypted,"
    " secret_hint) values (gen_random_uuid(), $1, '\\x00', 'x', '\\x00', 'x')",
    "webhook_deliveries": "insert into webhook_deliveries (id, tenant_id, webhook_id, event_id,"
    " event_type, payload) values (gen_random_uuid(), $1, gen_random_uuid(), 'e', 't', '{}')",
    "notification_preferences": "insert into notification_preferences (tenant_id, user_id)"
    " values ($1, $2)",
}


@pytest.mark.parametrize("table", sorted(NEW_TABLE_INSERTS))
async def test_new_tables_refuse_rows_for_another_tenant(
    app_pool: Pool, client_factory: ClientFactory, drain: Drain, table: str
) -> None:
    a = await verified_owner(client_factory(), drain, "Tenant A")
    b = await verified_owner(client_factory(), drain, "Tenant B")
    sql = NEW_TABLE_INSERTS[table]
    args: list[object] = [tid(b)] + ([uuid.UUID(a["user"]["id"])] if "$2" in sql else [])
    with pytest.raises(asyncpg.InsufficientPrivilegeError, match="row-level security"):
        async with transaction(app_pool, tenant_id=tid(a)) as conn:
            await conn.execute(sql, *args)
