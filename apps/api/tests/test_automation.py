"""Automation: routing rules, Slack channels, outgoing webhooks, and the daily digest."""

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import asyncpg
import httpx
import pytest

from docent.api.errors import AppError
from docent.api.routes.automation import _check_target
from docent.config import Settings
from docent.db.pool import Pool, transaction
from docent.inbox import events, notify
from docent.inbox.routing import Rule, claim_matches, first_match
from docent.jobs import queue
from docent.security.secretbox import SecretBox, SecretError
from tests.conftest import ClientFactory, Drain, verified_owner
from tests.fakes import FakeChat
from tests.inbox_helpers import Receiver, handoff, join, serve, tid


@pytest.fixture(scope="module")
def receiver() -> Iterator[Receiver]:
    yield from serve()


@pytest.fixture(autouse=True)
def fresh_receiver(receiver: Receiver) -> None:
    receiver.reset()


@pytest.fixture
async def owner(client_factory: ClientFactory, drain: Drain) -> httpx.AsyncClient:
    client = client_factory()
    await verified_owner(client, drain, "Lumen Notes")
    return client


async def retry_now(admin_pool: Pool, kind: str) -> None:
    async with admin_pool.acquire() as conn:
        await conn.execute(
            "update jobs set run_at = now() where kind = $1 and status = 'queued'", kind
        )


# Routing rules


def test_first_matching_rule_wins() -> None:
    billing = uuid.uuid4()
    vip = Rule(
        id=uuid.uuid4(),
        name="VIP",
        claim_conditions=[{"key": "plan", "op": "equals", "value": "enterprise"}],
    )
    billing_rule = Rule(id=uuid.uuid4(), name="Billing", ticket_type_ids=[billing])
    asked = Rule(id=uuid.uuid4(), name="Asked", reasons=["user_requested"])
    rules = [vip, billing_rule, asked]
    pick = lambda **kw: first_match(rules, **kw)  # noqa: E731
    assert pick(ticket_type_id=billing, reason="no_source", claims={"plan": "Enterprise"}) is vip
    assert pick(ticket_type_id=billing, reason="no_source", claims={"plan": "Team"}) is billing_rule
    assert pick(ticket_type_id=None, reason="user_requested", claims={}) is asked
    assert pick(ticket_type_id=None, reason="no_source", claims={}) is None
    assert claim_matches(
        {"key": "email", "op": "contains", "value": "@acme.com"}, {"email": "a@ACME.com"}
    )
    assert claim_matches({"key": "plan", "op": "not_equals", "value": "free"}, {})
    assert claim_matches({"key": "account_id", "op": "exists"}, {"account_id": "42"})
    assert not claim_matches({"key": "account_id", "op": "exists"}, {"account_id": " "})


async def test_routing_rules_assign_prioritize_and_notify_in_order(
    owner: httpx.AsyncClient, client_factory: ClientFactory, drain: Drain
) -> None:
    _, teammate_me = await join(owner, client_factory, drain, role="admin", name="Ana Lima")
    billing = (
        await owner.post(
            "/v1/ticket-types",
            json={
                "name": "Billing",
                "description": "Payments and refunds.",
                "notify_emails": ["billing@example.com"],
            },
        )
    ).json()
    vip = await owner.post(
        "/v1/automation/rules",
        json={
            "name": "Enterprise to Ana",
            "claim_conditions": [{"key": "plan", "op": "equals", "value": "Enterprise"}],
            "assign_user_id": teammate_me["user"]["id"],
            "set_priority": "urgent",
            "notify_emails": ["vip@example.com"],
        },
    )
    assert vip.status_code == 201, vip.text
    billing_rule = await owner.post(
        "/v1/automation/rules",
        json={
            "name": "Billing is high",
            "ticket_type_ids": [billing["id"]],
            "set_priority": "high",
        },
    )
    assert [r["position"] for r in (await owner.get("/v1/automation/rules")).json()] == [1, 2]

    first = await handoff(owner, claims={"plan": "Enterprise", "email": "cto@acme.example"})
    sent = await drain()
    routed = (await owner.get(f"/v1/inbox/{first['id']}")).json()
    assert routed["routed_by_rule"] == "Enterprise to Ana"
    assert (routed["item"]["priority"], routed["item"]["status"]) == ("urgent", "assigned")
    assert routed["item"]["assignee"]["name"] == "Ana Lima"
    assert routed["item"]["contact_email"] == "cto@acme.example"
    assert sorted(e.to for e in sent) == sorted(
        ["billing@example.com", "vip@example.com", teammate_me["user"]["email"]]
    )
    to_ana = next(e for e in sent if e.to == teammate_me["user"]["email"])
    assert to_ana.subject.startswith("[Lumen Notes] Assigned to you")
    assert "Routed by: Enterprise to Ana" in to_ana.text
    texts = [h["text"] for h in routed["history"]]
    assert texts == [
        "Routed by the rule Enterprise to Ana",
        "Assigned to Ana Lima by the rule Enterprise to Ana",
    ]
    assert {d["status"] for d in routed["deliveries"]} == {"sent"}

    second = await handoff(owner, claims={"plan": "Team"})
    await drain()
    item = (await owner.get(f"/v1/inbox/{second['id']}")).json()
    assert (item["routed_by_rule"], item["item"]["priority"], item["item"]["assignee"]) == (
        "Billing is high",
        "high",
        None,
    )

    reordered = await owner.put(
        "/v1/automation/rules/order", json={"ids": [billing_rule.json()["id"], vip.json()["id"]]}
    )
    assert [r["name"] for r in reordered.json()] == ["Billing is high", "Enterprise to Ana"]
    third = await handoff(owner, claims={"plan": "Enterprise"})
    await drain()
    assert (await owner.get(f"/v1/inbox/{third['id']}")).json()[
        "routed_by_rule"
    ] == "Billing is high"


async def test_rule_validation(
    owner: httpx.AsyncClient, client_factory: ClientFactory, drain: Drain
) -> None:
    nothing = await owner.post("/v1/automation/rules", json={"name": "Does nothing"})
    assert nothing.status_code == 422
    assert "actions" in nothing.json()["error"]["fields"]
    stranger = await verified_owner(client_factory(), drain, "Elsewhere")
    bad = await owner.post(
        "/v1/automation/rules",
        json={
            "name": "Bad refs",
            "ticket_type_ids": [str(uuid.uuid4())],
            "assign_user_id": stranger["user"]["id"],  # not a member here
            "notify_channel_id": str(uuid.uuid4()),
        },
    )
    assert bad.status_code == 422
    assert set(bad.json()["error"]["fields"]) == {
        "ticket_type_ids",
        "assign_user_id",
        "notify_channel_id",
    }
    no_value = await owner.post(
        "/v1/automation/rules",
        json={"name": "x", "set_priority": "high", "claim_conditions": [{"key": "plan"}]},
    )
    assert no_value.status_code == 422
    order = await owner.put("/v1/automation/rules/order", json={"ids": [str(uuid.uuid4())]})
    assert order.status_code == 422


async def test_customer_handoff_with_no_recipients_emails_owners_and_admins(
    owner: httpx.AsyncClient, drain: Drain, admin_pool: Pool
) -> None:
    preview = await handoff(owner)
    assert await drain() == []  # the team's own preview: nobody else to tell
    made = await handoff(owner, "a broken export")
    async with admin_pool.acquire() as conn:
        await conn.execute(
            "update conversations set channel = 'widget' where id = $1",
            uuid.UUID(made["conversation_id"]),
        )
    sent = await drain()
    me = (await owner.get("/v1/auth/me")).json()["user"]
    assert [(e.to, e.from_name) for e in sent] == [(me["email"], "Lumen Notes via Docent")]
    assert sent[0].subject == "[Lumen Notes] New handoff: Customer asked for a person."
    assert f"/app/inbox/{made['id']}" in sent[0].text
    assert preview["id"] != made["id"]


async def test_a_failing_summary_still_routes_on_its_last_attempt(
    owner: httpx.AsyncClient, drain: Drain, admin_pool: Pool, chat: FakeChat
) -> None:
    made = await handoff(owner, "my missing invoices")
    async with admin_pool.acquire() as conn:
        await conn.execute(
            "update conversations set channel = 'widget' where id = $1",
            uuid.UUID(made["conversation_id"]),
        )
        await conn.execute(
            "update jobs set attempts = max_attempts - 1 where kind = 'summarize_escalation'"
        )
    chat.replies.append(RuntimeError("model unavailable"))
    sent = await drain()
    me = (await owner.get("/v1/auth/me")).json()["user"]
    assert [e.to for e in sent] == [me["email"]]  # the team still hears about it
    assert "Please let me talk to a person about my missing invoices" in sent[0].subject
    detail = (await owner.get(f"/v1/inbox/{made['id']}")).json()
    assert detail["summary"] is None
    async with admin_pool.acquire() as conn:
        job = await conn.fetchval("select status from jobs where kind = 'summarize_escalation'")
    assert job == "dead"


# Webhooks


async def create_webhook(
    owner: httpx.AsyncClient, receiver: Receiver, **body: Any
) -> dict[str, Any]:
    response = await owner.post(
        "/v1/automation/webhooks", json={"url": f"{receiver.base}/hooks/docent-1234", **body}
    )
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


async def test_webhook_events_are_signed_retried_and_logged(
    owner: httpx.AsyncClient, drain: Drain, receiver: Receiver, admin_pool: Pool
) -> None:
    created = await create_webhook(owner, receiver, description="n8n")
    webhook, secret = created["webhook"], created["secret"]
    assert secret.startswith("whsec_")
    assert webhook["secret_hint"] == f"whsec_…{secret[-4:]}"
    assert webhook["url_hint"] == f"{receiver.base}/…1234"
    listed = (await owner.get("/v1/automation/webhooks")).text
    assert secret not in listed  # never shown again
    assert "docent-1234" not in listed

    made = await handoff(owner)
    await drain()
    [request] = receiver.requests
    body = request["body"]
    assert events.verify(secret, request["headers"]["docent-signature"], body)
    assert not events.verify("whsec_wrong", request["headers"]["docent-signature"], body)
    old = int(request["headers"]["docent-signature"].split(",")[0][2:]) - 600
    assert not events.verify(secret, events.sign(secret, old, body), body)  # too old
    event = receiver.bodies()[0]
    assert event["type"] == "escalation.created"
    assert request["headers"]["docent-event"] == "escalation.created"
    assert event["test"] is False
    assert event["workspace"]["name"] == "Lumen Notes"
    escalation = event["data"]["escalation"]
    assert (escalation["id"], escalation["status"], escalation["contact_email"]) == (
        made["id"],
        "open",
        "ana@example.com",
    )
    assert escalation["summary"]["issue"] == "Customer asked for a person."
    deliveries = (await owner.get(f"/v1/automation/webhooks/{webhook['id']}/deliveries")).json()
    assert [(d["status"], d["response_status"], d["attempts"]) for d in deliveries] == [
        ("succeeded", 200, 1)
    ]

    # The receiver fails: the delivery retries with backoff, then is dead with the error.
    receiver.default = (500, "boom: database is down")
    await owner.patch(f"/v1/inbox/{made['id']}", json={"status": "resolved"})
    await drain()
    latest = (await owner.get(f"/v1/automation/webhooks/{webhook['id']}/deliveries")).json()[0]
    assert (latest["event_type"], latest["status"], latest["attempts"]) == (
        "escalation.resolved",
        "retrying",
        1,
    )
    assert latest["last_error"] == "HTTP 500: boom: database is down"
    assert latest["next_attempt_at"] is not None
    for _ in range(4):
        await retry_now(admin_pool, events.DELIVER_WEBHOOK)
        await drain()
    latest = (await owner.get(f"/v1/automation/webhooks/{webhook['id']}/deliveries")).json()[0]
    assert (latest["status"], latest["attempts"], latest["next_attempt_at"]) == ("dead", 5, None)
    assert latest["last_error"] == "HTTP 500: boom: database is down"
    resolved = [b for b in receiver.bodies() if b["type"] == "escalation.resolved"]
    assert len(resolved) == 5
    assert len({b["id"] for b in resolved}) == 1  # one event id, every attempt
    assert (await owner.get("/v1/automation/webhooks")).json()[0]["last_delivery"][
        "status"
    ] == "dead"

    # Sent again by hand, once, with the same event id.
    receiver.default = (204, "")
    retried = await owner.post(
        f"/v1/automation/webhooks/{webhook['id']}/deliveries/{latest['id']}/retry"
    )
    assert retried.status_code == 202
    await drain()
    latest = (await owner.get(f"/v1/automation/webhooks/{webhook['id']}/deliveries")).json()[0]
    assert latest["status"] == "succeeded"
    assert receiver.bodies()[-1]["id"] == resolved[0]["id"]


async def test_webhook_test_event_rotation_and_rule_only_hooks(
    owner: httpx.AsyncClient, drain: Drain, receiver: Receiver, admin_pool: Pool
) -> None:
    created = await create_webhook(owner, receiver, events=[])  # only rules send to it
    webhook_id = created["webhook"]["id"]
    tested = await owner.post(f"/v1/automation/webhooks/{webhook_id}/test")
    assert tested.status_code == 202
    await drain()
    test_event = receiver.bodies()[-1]
    assert (test_event["test"], test_event["type"]) == (True, "escalation.created")
    assert test_event["data"]["escalation"]["ticket_type"]["name"] == "Billing"
    assert events.verify(
        created["secret"],
        receiver.requests[-1]["headers"]["docent-signature"],
        receiver.requests[-1]["body"],
    )

    rotated = (await owner.post(f"/v1/automation/webhooks/{webhook_id}/secret")).json()["secret"]
    assert rotated != created["secret"]
    await handoff(owner)  # not subscribed and no rule: nothing is sent
    await drain()
    assert len(receiver.requests) == 1
    rule = await owner.post(
        "/v1/automation/rules",
        json={"name": "Everything to n8n", "webhook_id": webhook_id},
    )
    assert rule.status_code == 201
    await handoff(owner)
    await drain()
    assert len(receiver.requests) == 2
    assert events.verify(
        rotated, receiver.requests[-1]["headers"]["docent-signature"], receiver.requests[-1]["body"]
    )
    # The URL and secret are encrypted at rest.
    async with admin_pool.acquire() as conn:
        row = await conn.fetchrow("select url_encrypted, secret_encrypted from webhooks")
    assert row is not None
    assert b"docent-1234" not in row["url_encrypted"]
    assert rotated.encode() not in row["secret_encrypted"]

    # A receiver that refuses with a redirect is a failure, not a hop.
    receiver.default = (302, "")
    await owner.patch(
        f"/v1/automation/webhooks/{webhook_id}", json={"events": ["escalation.updated"]}
    )
    made = await handoff(owner)
    await drain()
    await owner.patch(f"/v1/inbox/{made['id']}", json={"priority": "high"})
    await drain()
    latest = (await owner.get(f"/v1/automation/webhooks/{webhook_id}/deliveries")).json()[0]
    assert latest["event_type"] == "escalation.updated"
    assert latest["last_error"] == "HTTP 302 (redirects are not followed)"
    assert receiver.bodies()[-1]["data"]["changes"] == ["priority"]


def test_webhook_and_slack_urls_are_checked(settings: Settings) -> None:
    strict = settings.model_copy(update={"crawl_allow_private": False})
    for url in ("ftp://example.com/x", "http://user:pw@example.com/x", "http://10.0.0.5/hook"):
        with pytest.raises(AppError):
            _check_target(url, strict, slack=False)
    production = settings.model_copy(update={"env": "production", "crawl_allow_private": False})
    with pytest.raises(AppError, match="https"):
        _check_target("http://example.com/hook", production, slack=False)
    with pytest.raises(AppError, match=r"hooks\.slack\.com"):
        _check_target("https://example.com/services/x", production, slack=True)
    assert _check_target("https://hooks.slack.com/services/T/B/x", production, slack=True)


# Slack


async def test_slack_url_is_encrypted_and_test_messages_report_back(
    owner: httpx.AsyncClient, drain: Drain, receiver: Receiver, admin_pool: Pool, settings: Settings
) -> None:
    url = f"{receiver.base}/services/T000/B000/s3cretSlackToken"
    created = await owner.post(
        "/v1/automation/channels", json={"name": "#support", "url": url, "post_all": True}
    )
    assert created.status_code == 201, created.text
    channel = created.json()
    assert channel["url_hint"] == f"{receiver.base}/…oken"
    assert "s3cretSlackToken" not in (await owner.get("/v1/automation/channels")).text

    tenant_id = uuid.UUID((await owner.get("/v1/tenant")).json()["id"])
    async with admin_pool.acquire() as conn:
        raw = await conn.fetchval("select target_encrypted from notification_channels")
    assert url.encode() not in raw
    assert b"s3cretSlackToken" not in raw
    box = SecretBox(settings.secret_key.get_secret_value())
    opened = box.open(raw, purpose="slack", tenant_id=tenant_id, row_id=uuid.UUID(channel["id"]))
    assert opened == url
    with pytest.raises(SecretError):  # bound to its row: useless anywhere else
        box.open(raw, purpose="slack", tenant_id=tenant_id, row_id=uuid.uuid4())
    with pytest.raises(SecretError):
        SecretBox("another-key").open(
            raw, purpose="slack", tenant_id=tenant_id, row_id=uuid.UUID(channel["id"])
        )

    assert (await owner.post(f"/v1/automation/channels/{channel['id']}/test")).status_code == 202
    await drain()
    assert receiver.requests[-1]["path"] == "/services/T000/B000/s3cretSlackToken"
    assert receiver.bodies()[-1]["text"].startswith("Test message from Docent for Lumen Notes.")
    last = (await owner.get("/v1/automation/channels")).json()[0]["last_delivery"]
    assert (last["kind"], last["status"]) == ("test", "sent")

    made = await handoff(owner, "a <weird> & title")
    await drain()
    text = receiver.bodies()[-1]["text"]
    assert text.startswith("*New handoff in Lumen Notes*: <http://localhost:3000/app/inbox/")
    assert made["id"] in text

    receiver.default = (404, "no_service")
    await owner.post(f"/v1/automation/channels/{channel['id']}/test")
    await drain()
    last = (await owner.get("/v1/automation/channels")).json()[0]["last_delivery"]
    assert (last["status"], last["last_error"]) == ("dead", "HTTP 404: no_service")

    # A failing handoff message retries, then shows as dead with its error.
    await handoff(owner, "another one")
    await drain()
    last = (await owner.get("/v1/automation/channels")).json()[0]["last_delivery"]
    assert (last["kind"], last["status"], last["attempts"]) == ("new_handoff", "retrying", 1)
    for _ in range(4):
        await retry_now(admin_pool, notify.SEND_SLACK)
        await drain()
    last = (await owner.get("/v1/automation/channels")).json()[0]["last_delivery"]
    assert (last["status"], last["attempts"], last["last_error"]) == (
        "dead",
        5,
        "HTTP 404: no_service",
    )

    off = await owner.patch(f"/v1/automation/channels/{channel['id']}", json={"active": False})
    assert off.json()["active"] is False
    assert (await owner.delete(f"/v1/automation/channels/{channel['id']}")).status_code == 204


# Daily digest


async def test_daily_digest_is_sent_once_per_member_per_day(
    owner: httpx.AsyncClient,
    client_factory: ClientFactory,
    drain: Drain,
    worker_pool: Pool,
    admin_pool: Pool,
) -> None:
    teammate, teammate_me = await join(owner, client_factory, drain, name="Ana Lima")
    me = (await owner.get("/v1/auth/me")).json()["user"]
    first = await handoff(owner)
    await handoff(owner, "a second thing")
    await drain()
    await owner.patch(f"/v1/inbox/{first['id']}", json={"assignee_user_id": me["id"]})
    await drain()

    morning = datetime.now(UTC).replace(hour=9, minute=0, second=0, microsecond=0)
    assert await notify.schedule_digests(worker_pool, morning) == 1
    sent = await drain()
    assert sorted(e.to for e in sent) == sorted([me["email"], teammate_me["user"]["email"]])
    mine = next(e for e in sent if e.to == me["email"])
    assert mine.subject == "[Lumen Notes] 2 open handoffs, 1 for you"
    assert "Assigned to you" in mine.text
    assert "Nobody assigned" in mine.text

    # The scheduler runs again, and the job itself runs twice: no second email.
    assert await notify.schedule_digests(worker_pool, morning + timedelta(hours=3)) == 0
    async with transaction(worker_pool) as conn:
        await queue.enqueue(
            conn,
            notify.SEND_DIGEST,
            {"day": morning.date().isoformat()},
            tenant_id=uuid.UUID((await owner.get("/v1/tenant")).json()["id"]),
        )
    assert await drain() == []

    # Opted out: the next day only the owner hears.
    await teammate.put(
        "/v1/inbox/preferences", json={"daily_digest": False, "assigned_email": True}
    )
    tomorrow = morning + timedelta(days=1)
    assert await notify.schedule_digests(worker_pool, tomorrow) == 1
    async with admin_pool.acquire() as conn:
        await conn.execute("update jobs set run_at = now() where kind = $1", notify.SEND_DIGEST)
    assert [e.to for e in await drain()] == [me["email"]]

    # Nothing open and nothing new: no digest at all.
    for item in (await owner.get("/v1/inbox")).json()["items"]:
        await owner.patch(f"/v1/inbox/{item['id']}", json={"status": "resolved"})
    async with admin_pool.acquire() as conn:
        await conn.execute("update escalations set created_at = now() - interval '2 days'")
    assert await notify.schedule_digests(worker_pool, tomorrow + timedelta(days=1)) == 1
    async with admin_pool.acquire() as conn:
        await conn.execute("update jobs set run_at = now() where kind = $1", notify.SEND_DIGEST)
    assert await drain() == []


def test_digest_runs_at_eight_utc() -> None:
    early = datetime(2026, 10, 14, 6, 30, tzinfo=UTC)
    late = datetime(2026, 10, 14, 15, 0, tzinfo=UTC)
    assert notify.digest_run_at(early) == datetime(2026, 10, 14, 8, 0, tzinfo=UTC)
    assert notify.digest_run_at(late) == late


async def test_worker_reads_tenants_and_users_only_through_narrow_views(
    owner: httpx.AsyncClient,
    client_factory: ClientFactory,
    drain: Drain,
    worker_pool: Pool,
    app_pool: Pool,
) -> None:
    other = client_factory()
    other_me = await verified_owner(other, drain, "Parcelwise")
    mine = uuid.UUID((await owner.get("/v1/tenant")).json()["id"])
    theirs = tid(other_me)
    async with transaction(worker_pool, tenant_id=mine) as conn:
        assert [r["name"] for r in await conn.fetch("select name from tenant_profiles")] == [
            "Lumen Notes"
        ]
        contacts = await conn.fetch("select tenant_id, email from member_contacts")
        assert {r["tenant_id"] for r in contacts} == {mine}
        for table in ("tenants", "users", "memberships"):
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                async with conn.transaction():
                    await conn.fetch(f"select * from {table}")  # noqa: S608
    async with transaction(worker_pool) as conn:
        assert await conn.fetch("select id from tenant_profiles") == []
        assert await conn.fetch("select user_id from member_contacts") == []
    # The scheduler capability lists every workspace, and nothing else.
    async with transaction(worker_pool, scheduler=True) as conn:
        assert {r["id"] for r in await conn.fetch("select id from tenant_profiles")} == {
            mine,
            theirs,
        }
        assert await conn.fetch("select user_id from member_contacts") == []
    # The capability works only through the view: reading tenants directly shows nothing.
    async with transaction(app_pool, scheduler=True) as conn:
        assert await conn.fetch("select id from tenants") == []
    async with worker_pool.acquire() as conn:
        granted = await conn.fetchval(
            """
            select has_any_column_privilege('docent_worker', 'tenants', 'SELECT')
                or has_any_column_privilege('docent_worker', 'users', 'SELECT')
            """
        )
    assert not granted
