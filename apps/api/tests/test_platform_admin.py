"""The platform admin console: who can open it, what it reads, what its actions change."""

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from docent.cli import main
from docent.config import Settings
from docent.console.access import set_access
from docent.db.pool import Pool
from docent.ids import new_id
from docent.seed import DEMO_PASSWORD, seed
from tests.conftest import ClientFactory, Drain, signup, verified_owner
from tests.fakes import FakeBilling
from tests.test_billing import deliver, start_checkout, subscription_event

ADMIN = "/v1/admin"


@pytest.fixture
async def billing(app: FastAPI) -> AsyncIterator[FakeBilling]:
    fake = FakeBilling()
    app.state.docent.billing = fake
    yield fake
    app.state.docent.billing = None


async def make_admin(
    client: httpx.AsyncClient, drain: Drain, settings: Settings, workspace: str = "Docent HQ"
) -> dict[str, Any]:
    """A verified owner of their own workspace, granted the flag the way the CLI does it."""
    me = await verified_owner(client, drain, workspace)
    await set_access(settings, me["user"]["email"], grant=True)
    return me


@pytest.fixture
async def admin(
    client_factory: ClientFactory, drain: Drain, settings: Settings
) -> httpx.AsyncClient:
    client = client_factory()
    await make_admin(client, drain, settings)
    return client


def tid(me: dict[str, Any]) -> uuid.UUID:
    return uuid.UUID(me["active_tenant"]["id"])


async def put_plan(
    admin_pool: Pool,
    tenant_id: uuid.UUID,
    plan_id: str,
    status: str,
    *,
    provider: str = "manual",
    comped_until: datetime | None = None,
) -> None:
    async with admin_pool.acquire() as conn:
        await conn.execute(
            """
            update subscriptions
            set plan_id = $2, status = $3, provider = $4, comped_until = $5,
                provider_customer_id = case when $4 = 'stripe' then 'cus_' || $1::text end,
                provider_subscription_id = case when $4 = 'stripe' then 'sub_' || $1::text end
            where tenant_id = $1
            """,
            tenant_id,
            plan_id,
            status,
            provider,
            comped_until,
        )


async def put_usage(
    admin_pool: Pool, tenant_id: uuid.UUID, replies: int, cost_micros: int, months_ago: int = 0
) -> None:
    """Billed replies on the month's usage row, and their model cost as one usage event."""
    async with admin_pool.acquire() as conn:
        await conn.execute(
            """
            insert into usage_periods (tenant_id, period_start, period_end, replies_cap,
                                       replies_used)
            values ($1, (date_trunc('month', now()) - make_interval(months => $3))::date,
                    (date_trunc('month', now()) - make_interval(months => $3 - 1))::date, 1000, $2)
            on conflict (tenant_id, period_start) do update set replies_used = excluded.replies_used
            """,
            tenant_id,
            replies,
            months_ago,
        )
        await conn.execute(
            """
            insert into usage_events (id, tenant_id, kind, model, tokens_in, tokens_out,
                                      cost_micros, idempotency_key, occurred_at)
            values ($1, $2, 'llm_call', 'gemma4:cloud', 4000, 300, $3, $4,
                    date_trunc('month', now()) - make_interval(months => $5) + interval '1 hour')
            """,
            new_id(),
            tenant_id,
            cost_micros,
            f"test:{uuid.uuid4()}",
            months_ago,
        )


async def audit_actions(admin_pool: Pool, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
    async with admin_pool.acquire() as conn:
        rows = await conn.fetch(
            "select action, actor_user_id, metadata from audit_log"
            " where tenant_id = $1 and action like 'platform_admin.%' order by created_at, id",
            tenant_id,
        )
    return [dict(r) for r in rows]


# Who can open the console


def admin_routes(app: FastAPI) -> list[tuple[str, str]]:
    """Every console route, from the API schema, with made-up ids in its path."""
    found = []
    for path, operations in app.openapi()["paths"].items():
        if path.startswith(ADMIN):
            concrete = path.replace("{tenant_id}", str(uuid.uuid4())).replace("{job_id}", "1")
            found += [(method.upper(), concrete) for method in operations]
    return found


async def assert_hidden(client: httpx.AsyncClient, app: FastAPI) -> None:
    """Every console route answers exactly as a path that does not exist."""
    unknown = (await client.get("/v1/no-such-thing")).json()["error"]
    probes = [
        *admin_routes(app),
        ("GET", ADMIN),
        ("GET", f"{ADMIN}/no-such-thing"),
        ("GET", f"{ADMIN}/workspaces/{uuid.uuid4()}/trial"),  # wrong method: no 405
        ("DELETE", f"{ADMIN}/overview"),
    ]
    assert len(probes) > 12
    for method, path in probes:
        response = await client.request(method, path, json={} if method == "POST" else None)
        assert response.status_code == 404, (method, path, response.text)
        body = response.json()["error"]
        assert (body["code"], body["message"]) == (unknown["code"], unknown["message"])
    # A body that is not even JSON is not parsed either: no 422.
    broken = await client.post(
        f"{ADMIN}/workspaces/{uuid.uuid4()}/trial",
        content=b"{not json",
        headers={"content-type": "application/json"},
    )
    assert broken.status_code == 404


async def test_owners_and_visitors_get_not_found_everywhere(
    app: FastAPI, client_factory: ClientFactory, drain: Drain
) -> None:
    owner = client_factory()
    me = await verified_owner(owner, drain, "Ordinary Co")
    assert me["platform_admin"] is False
    await assert_hidden(owner, app)
    await assert_hidden(client_factory(), app)  # signed out


async def test_unverified_platform_admin_gets_not_found_until_verified(
    app: FastAPI,
    client_factory: ClientFactory,
    drain: Drain,
    settings: Settings,
    admin_pool: Pool,
) -> None:
    client = client_factory()
    me = await signup(client, workspace="Not Yet")
    message = await set_access(settings, me["user"]["email"], grant=True)
    assert "not verified yet" in message
    assert (await client.get("/v1/auth/me")).json()["platform_admin"] is False
    await assert_hidden(client, app)

    async with admin_pool.acquire() as conn:
        await conn.execute(
            "update users set email_verified_at = now() where id = $1", uuid.UUID(me["user"]["id"])
        )
    assert (await client.get("/v1/auth/me")).json()["platform_admin"] is True
    assert (await client.get(f"{ADMIN}/overview")).status_code == 200


async def test_cli_grants_and_revokes(
    client_factory: ClientFactory,
    drain: Drain,
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    client = client_factory()
    me = await verified_owner(client, drain, "Founder Co")
    email = me["user"]["email"]
    monkeypatch.setattr("docent.cli.get_settings", lambda: settings)

    await asyncio.to_thread(main, ["admin", "grant", email.upper()])
    assert f"{email} is a platform admin" in capsys.readouterr().out
    assert (await client.get("/v1/auth/me")).json()["platform_admin"] is True
    assert (await client.get(f"{ADMIN}/overview")).status_code == 200

    # Revoking closes the console on the very next request; the session stays.
    await asyncio.to_thread(main, ["admin", "revoke", email])
    assert "no longer a platform admin" in capsys.readouterr().out
    assert (await client.get(f"{ADMIN}/overview")).status_code == 404
    assert (await client.get("/v1/auth/me")).status_code == 200

    with pytest.raises(SystemExit, match="No account uses"):
        await asyncio.to_thread(main, ["admin", "grant", "nobody@example.com"])


# Reading across tenants


async def test_platform_admin_reads_every_workspace(
    admin: httpx.AsyncClient, client_factory: ClientFactory, drain: Drain, admin_pool: Pool
) -> None:
    other = client_factory()
    acme = await verified_owner(other, drain, "Acme Support")
    widget = await other.post(
        "/v1/widgets", json={"name": "Help", "allowed_origins": ["https://acme.test"]}
    )
    assert widget.status_code == 201, widget.text
    await other.post("/v1/knowledge/uploads", files={"file": ("guide.md", b"# Guide\n\nHello.")})
    await drain()

    listing = (await admin.get(f"{ADMIN}/workspaces")).json()
    assert {w["name"] for w in listing["items"]} == {"Docent HQ", "Acme Support"}
    assert listing["total"] == 2
    row = next(w for w in listing["items"] if w["name"] == "Acme Support")
    assert (row["plan"]["id"], row["state"], row["members"]) == ("trial", "trial", 1)
    assert row["figures"]["replies_cap"] == 100

    detail = await admin.get(f"{ADMIN}/workspaces/{tid(acme)}")
    assert detail.status_code == 200, detail.text
    data = detail.json()
    assert data["name"] == "Acme Support"
    assert [m["email"] for m in data["members"]] == [acme["user"]["email"]]
    assert data["members"][0]["last_active_at"] is not None
    assert data["widgets"][0]["allowed_origins"] == 1
    assert data["knowledge"]["sources"] == 1
    assert data["knowledge"]["documents"] == 1
    assert data["knowledge"]["documents_cap"] == 200
    assert len(data["usage"]) == 6
    assert data["actions"] == {
        "extend_trial": True,
        "give_comp": True,
        "end_comp": False,
        "refusal": None,
    }
    # Opening a workspace is on its audit log, with the admin as actor.
    assert data["audit"][0]["action"] == "platform_admin.workspace_viewed"
    assert data["audit"][0]["actor_email"] != acme["user"]["email"]

    people = (await admin.get(f"{ADMIN}/people", params={"q": acme["user"]["email"]})).json()
    assert people["total"] == 1
    person = people["items"][0]
    assert person["workspaces"] == [
        {"tenant_id": str(tid(acme)), "name": "Acme Support", "role": "owner"}
    ]
    assert (person["email_verified"], person["is_platform_admin"]) == (True, False)
    everyone = (await admin.get(f"{ADMIN}/people")).json()
    assert sum(p["is_platform_admin"] for p in everyone["items"]) == 1

    missing = await admin.get(f"{ADMIN}/workspaces/{uuid.uuid4()}")
    assert (missing.status_code, missing.json()["error"]["message"]) == (
        404,
        "Workspace not found.",
    )


async def test_workspace_list_filters_searches_and_pages(
    admin: httpx.AsyncClient, client_factory: ClientFactory, admin_pool: Pool
) -> None:
    paying = await signup(client_factory(), workspace="Paying Co")
    await signup(client_factory(), workspace="Trial Co")
    await put_plan(admin_pool, tid(paying), "growth", "active", provider="stripe")

    async def names(**params: object) -> list[str]:
        body = (await admin.get(f"{ADMIN}/workspaces", params=params)).json()
        return [w["name"] for w in body["items"]]

    assert await names(status="paying") == ["Paying Co"]
    assert await names(plan="trial", sort="name") == ["Docent HQ", "Trial Co"]
    assert await names(q="PAYING") == ["Paying Co"]
    assert await names(q=paying["user"]["email"]) == ["Paying Co"]
    assert await names(sort="newest") == ["Trial Co", "Paying Co", "Docent HQ"]
    second = (await admin.get(f"{ADMIN}/workspaces", params={"page": 2})).json()
    assert (second["items"], second["total"], second["per_page"]) == ([], 3, 25)
    assert (await admin.get(f"{ADMIN}/workspaces", params={"status": "bogus"})).status_code == 422


# The figures, on a known fixture


async def test_overview_figures(
    admin: httpx.AsyncClient, client_factory: ClientFactory, admin_pool: Pool
) -> None:
    growth = tid(await signup(client_factory(), workspace="Growth Co"))
    starter = tid(await signup(client_factory(), workspace="Starter Co"))
    trial = tid(await signup(client_factory(), workspace="Trial Co"))
    runaway = tid(await signup(client_factory(), workspace="Runaway Co"))
    await put_plan(admin_pool, growth, "growth", "active", provider="stripe")
    await put_plan(admin_pool, starter, "starter", "active", provider="stripe")
    soon = datetime.now(UTC) + timedelta(days=20)
    await put_plan(admin_pool, runaway, "scale", "active", comped_until=soon)
    # Cost per reply: 1,000, 1,200, 900, and 5,000 micro dollars. The median is 1,100.
    await put_usage(admin_pool, growth, 100, 100_000)
    await put_usage(admin_pool, starter, 50, 60_000)
    await put_usage(admin_pool, trial, 10, 9_000)
    await put_usage(admin_pool, runaway, 20, 100_000)
    await put_usage(admin_pool, growth, 400, 7_000_000, months_ago=1)  # last month: not counted

    data = (await admin.get(f"{ADMIN}/overview")).json()
    assert data["workspaces"] == 5
    assert data["paying_workspaces"] == 2
    assert data["mrr_micros"] == (99 + 29) * 1_000_000
    assert data["replies_this_month"] == 180
    assert data["cost_this_month_micros"] == 269_000
    assert data["gross_margin"] == pytest.approx((128_000_000 - 269_000) / 128_000_000)
    assert data["new_workspaces_30d"] == 5
    assert data["new_accounts_30d"] == 5
    assert data["median_cost_per_reply_micros"] == pytest.approx(1_100)
    counts = {(c["plan_id"], c["state"]): c["count"] for c in data["by_plan_state"]}
    assert counts == {
        ("growth", "paying"): 1,
        ("starter", "paying"): 1,
        ("scale", "comped"): 1,
        ("trial", "trial"): 2,
    }
    (anomaly,) = data["anomalies"]
    assert (anomaly["name"], anomaly["cost_per_reply_micros"]) == ("Runaway Co", 5_000)
    assert anomaly["times_median"] == pytest.approx(5_000 / 1_100)

    rows = {w["name"]: w for w in (await admin.get(f"{ADMIN}/workspaces")).json()["items"]}
    assert rows["Growth Co"]["figures"] == {
        "replies_used": 100,
        "replies_cap": 5_000,
        "cost_micros": 100_000,
        "revenue_micros": 99_000_000,
        "margin_micros": 99_000_000 - 100_000,
        "cost_per_reply_micros": 1_000,
        "anomaly": False,
    }
    assert rows["Runaway Co"]["figures"]["revenue_micros"] == 0  # comped: nothing comes in
    assert rows["Runaway Co"]["figures"]["margin_micros"] == -100_000
    assert rows["Runaway Co"]["figures"]["anomaly"] is True
    assert rows["Docent HQ"]["figures"]["cost_per_reply_micros"] is None

    by_cost = (await admin.get(f"{ADMIN}/workspaces", params={"sort": "margin"})).json()
    assert by_cost["items"][0]["name"] == "Runaway Co"

    detail = (await admin.get(f"{ADMIN}/workspaces/{growth}")).json()
    months = {m["month"]: m for m in detail["usage"]}
    this_month = date.today().replace(day=1)
    last_month = (this_month - timedelta(days=1)).replace(day=1)
    assert months[this_month.isoformat()]["cost_micros"] == 100_000
    assert months[last_month.isoformat()]["replies_used"] == 400
    assert months[last_month.isoformat()]["cost_micros"] == 7_000_000
    assert detail["this_month"]["anomaly"] is False


async def test_overview_counts_top_ups_and_shows_the_redis_budget(
    admin: httpx.AsyncClient, client_factory: ClientFactory, admin_pool: Pool
) -> None:
    starter = tid(await signup(client_factory(), workspace="Starter Co"))
    await put_plan(admin_pool, starter, "starter", "active", provider="stripe")
    await put_usage(admin_pool, starter, 1_200, 120_000)
    async with admin_pool.acquire() as conn:
        for months_ago, order in ((0, "cs_now"), (1, "cs_last_month")):
            await conn.execute(
                """
                insert into topups (id, tenant_id, pack_id, replies, amount_cents,
                                    provider_order_id, period_start)
                values ($1, $2, 'starter_500', 500, 1450, $3,
                        (date_trunc('month', now()) - make_interval(months => $4))::date)
                """,
                new_id(),
                starter,
                order,
                months_ago,
            )
        await conn.execute(
            "update usage_periods set replies_topup = 500 where tenant_id = $1", starter
        )

    data = (await admin.get(f"{ADMIN}/overview")).json()
    assert data["mrr_micros"] == 29_000_000  # a top-up does not recur
    assert data["topups_this_month_micros"] == 14_500_000  # last month's pack is not counted
    revenue = 29_000_000 + 14_500_000
    assert data["gross_margin"] == pytest.approx((revenue - 120_000) / revenue)
    assert data["redis"] == {
        "status": "disabled",  # the test app runs without Redis
        "month": date.today().replace(day=1).isoformat(),
        "commands": 0,
        "budget": 500_000,
        "alert_percents": [80, 90],
        "local_only_percent": 90,
        "alerted_80_at": None,
        "alerted_90_at": None,
        "local_only_since": None,
        "counted_at": None,
    }
    rows = {w["name"]: w for w in (await admin.get(f"{ADMIN}/workspaces")).json()["items"]}
    figures = rows["Starter Co"]["figures"]
    assert (figures["replies_used"], figures["replies_cap"]) == (1_200, 1_500)
    assert figures["revenue_micros"] == revenue

    async with admin_pool.acquire() as conn:
        await conn.execute(
            """
            insert into redis_usage (month, commands, budget, alerted_80_at)
            values (date_trunc('month', now() at time zone 'utc')::date, 412000, 500000, now())
            """
        )
    redis = (await admin.get(f"{ADMIN}/overview")).json()["redis"]
    assert (redis["commands"], redis["budget"]) == (412_000, 500_000)
    assert redis["alerted_80_at"] is not None
    assert redis["counted_at"] is not None


async def test_no_anomalies_while_the_median_is_zero(
    admin: httpx.AsyncClient, client_factory: ClientFactory, admin_pool: Pool
) -> None:
    free = tid(await signup(client_factory(), workspace="Free Model Co"))
    await put_usage(admin_pool, free, 30, 0)
    data = (await admin.get(f"{ADMIN}/overview")).json()
    assert (data["median_cost_per_reply_micros"], data["anomalies"]) == (0, [])
    assert data["gross_margin"] is None  # no revenue, so no margin to speak of


# Actions


async def test_extend_trial(
    admin: httpx.AsyncClient, client_factory: ClientFactory, admin_pool: Pool
) -> None:
    owner = client_factory()
    tenant = tid(await signup(owner, workspace="Trial Co"))
    before = datetime.fromisoformat((await owner.get("/v1/billing")).json()["trial_ends_at"])

    response = await admin.post(
        f"{ADMIN}/workspaces/{tenant}/trial", json={"days": 7, "reason": "Asked for a week more"}
    )
    assert response.status_code == 200, response.text
    after = datetime.fromisoformat(response.json()["subscription"]["trial_ends_at"])
    assert after - before == pytest.approx(timedelta(days=7), abs=timedelta(seconds=5))
    billing = (await owner.get("/v1/billing")).json()
    assert datetime.fromisoformat(billing["trial_ends_at"]) == after

    # A trial that already ended restarts from today.
    async with admin_pool.acquire() as conn:
        await conn.execute(
            "update subscriptions set trial_ends_at = now() - interval '3 days'"
            " where tenant_id = $1",
            tenant,
        )
    assert (await owner.get("/v1/billing")).json()["active"] is False
    restarted = await admin.post(
        f"{ADMIN}/workspaces/{tenant}/trial", json={"days": 2, "reason": "Back from holiday"}
    )
    ends = datetime.fromisoformat(restarted.json()["subscription"]["trial_ends_at"])
    assert ends - datetime.now(UTC) == pytest.approx(timedelta(days=2), abs=timedelta(minutes=1))
    assert (await owner.get("/v1/billing")).json()["active"] is True

    log = await audit_actions(admin_pool, tenant)
    extended = [e for e in log if e["action"] == "platform_admin.trial_extended"]
    assert [e["metadata"]["days"] for e in extended] == ["7", "2"]
    assert extended[0]["metadata"]["reason"] == "Asked for a week more"
    assert extended[0]["metadata"]["by"] == "platform_admin"

    for body in (
        {"days": 0, "reason": "Too few"},
        {"days": 31, "reason": "Too many"},
        {"days": 3},
        {"days": 3, "reason": "  "},
    ):
        refused = await admin.post(f"{ADMIN}/workspaces/{tenant}/trial", json=body)
        assert refused.status_code == 422, body


async def test_give_and_end_a_comp(
    admin: httpx.AsyncClient, client_factory: ClientFactory, admin_pool: Pool
) -> None:
    owner = client_factory()
    tenant = tid(await signup(owner, workspace="Friends Co"))
    until = date.today() + timedelta(days=30)

    response = await admin.post(
        f"{ADMIN}/workspaces/{tenant}/comp",
        json={"plan_id": "growth", "until": until.isoformat(), "reason": "Design partner"},
    )
    assert response.status_code == 200, response.text
    sub = response.json()["subscription"]
    assert (sub["plan"]["id"], sub["state"], sub["provider"], sub["active"]) == (
        "growth",
        "comped",
        "manual",
        True,
    )
    assert sub["comped_until"].startswith(until.isoformat())
    assert response.json()["actions"]["end_comp"] is True
    billing = (await owner.get("/v1/billing")).json()
    assert (billing["plan"]["id"], billing["active"]) == ("growth", True)
    assert billing["usage"]["replies"]["limit"] == 5_000
    assert billing["comped_until"].startswith(until.isoformat())

    ended = await admin.post(
        f"{ADMIN}/workspaces/{tenant}/comp/end", json={"reason": "Partnership over"}
    )
    assert ended.status_code == 200, ended.text
    assert ended.json()["subscription"]["state"] == "canceled"
    billing = (await owner.get("/v1/billing")).json()
    assert (billing["status"], billing["active"], billing["comped_until"]) == (
        "canceled",
        False,
        None,
    )
    again = await admin.post(f"{ADMIN}/workspaces/{tenant}/comp/end", json={"reason": "Twice"})
    assert (again.status_code, again.json()["error"]["code"]) == (409, "no_comp")
    not_trial = await admin.post(
        f"{ADMIN}/workspaces/{tenant}/trial", json={"days": 3, "reason": "Try"}
    )
    assert (not_trial.status_code, not_trial.json()["error"]["code"]) == (409, "not_on_trial")

    log = await audit_actions(admin_pool, tenant)
    assert [e["action"] for e in log] == ["platform_admin.plan_comped", "platform_admin.comp_ended"]
    assert log[0]["metadata"]["plan_id"] == "growth"
    assert log[0]["metadata"]["from_plan_id"] == "trial"
    assert log[1]["metadata"]["reason"] == "Partnership over"

    for day in (date.today(), date.today() + timedelta(days=400)):
        refused = await admin.post(
            f"{ADMIN}/workspaces/{tenant}/comp",
            json={"plan_id": "scale", "until": day.isoformat(), "reason": "Bad date"},
        )
        assert (refused.status_code, refused.json()["error"]["code"]) == (409, "invalid_until")
    trial_plan = await admin.post(
        f"{ADMIN}/workspaces/{tenant}/comp",
        json={"plan_id": "trial", "until": until.isoformat(), "reason": "Not paid"},
    )
    assert trial_plan.status_code == 422


async def test_a_comp_ends_by_itself(
    admin: httpx.AsyncClient, client_factory: ClientFactory, admin_pool: Pool
) -> None:
    owner = client_factory()
    tenant = tid(await signup(owner, workspace="Lapsed Co"))
    await put_plan(
        admin_pool, tenant, "scale", "active", comped_until=datetime.now(UTC) - timedelta(hours=1)
    )
    billing = (await owner.get("/v1/billing")).json()
    assert (billing["plan"]["id"], billing["active"]) == ("scale", False)
    assert billing["usage"]["replies"]["limit"] == 0
    detail = (await admin.get(f"{ADMIN}/workspaces/{tenant}")).json()
    assert detail["subscription"]["state"] == "comp_ended"
    lapsed = await admin.get(f"{ADMIN}/workspaces", params={"status": "comp_ended"})
    assert [w["name"] for w in lapsed.json()["items"]] == ["Lapsed Co"]


async def test_actions_refuse_a_stripe_workspace(
    admin: httpx.AsyncClient, client_factory: ClientFactory, admin_pool: Pool
) -> None:
    owner = client_factory()
    tenant = tid(await signup(owner, workspace="Stripe Co"))
    await put_plan(admin_pool, tenant, "growth", "active", provider="stripe")
    detail = (await admin.get(f"{ADMIN}/workspaces/{tenant}")).json()
    assert detail["actions"]["give_comp"] is False
    assert "pays through Stripe" in detail["actions"]["refusal"]

    attempts = [
        ("trial", {"days": 5, "reason": "Please"}),
        ("comp", {"plan_id": "scale", "until": "2099-01-01", "reason": "Please"}),
        ("comp/end", {"reason": "Please"}),
    ]
    for action, body in attempts:
        response = await admin.post(f"{ADMIN}/workspaces/{tenant}/{action}", json=body)
        assert response.status_code == 409, action
        error = response.json()["error"]
        assert error["code"] == "stripe_managed"
        assert "Stripe dashboard" in error["message"]
    # Stripe trials are Stripe's too.
    await put_plan(admin_pool, tenant, "growth", "trialing", provider="stripe")
    trial = await admin.post(
        f"{ADMIN}/workspaces/{tenant}/trial", json={"days": 5, "reason": "Please"}
    )
    assert trial.json()["error"]["code"] == "stripe_managed"

    billing = (await owner.get("/v1/billing")).json()
    assert (billing["plan"]["id"], billing["provider"], billing["comped_until"]) == (
        "growth",
        "stripe",
        None,
    )
    # Only the opening of the page was recorded; nothing was changed.
    log = await audit_actions(admin_pool, tenant)
    assert [e["action"] for e in log] == ["platform_admin.workspace_viewed"]


async def test_paying_through_stripe_replaces_a_comp_and_events_keep_their_outcome(
    admin: httpx.AsyncClient,
    client_factory: ClientFactory,
    drain: Drain,
    billing: FakeBilling,
) -> None:
    owner = client_factory()
    me = await verified_owner(owner, drain, "Upgrading Co")
    tenant = tid(me)
    until = (date.today() + timedelta(days=10)).isoformat()
    await admin.post(
        f"{ADMIN}/workspaces/{tenant}/comp",
        json={"plan_id": "starter", "until": until, "reason": "Pilot"},
    )
    customer = await start_checkout(owner, billing)
    stripe = client_factory(origin=None)
    created = subscription_event(customer, kind="customer.subscription.created")
    assert (await deliver(stripe, created)).json() == {"outcome": "applied"}
    assert (await deliver(stripe, created)).json() == {"outcome": "duplicate"}
    unknown = subscription_event("cus_nobody")
    assert (await deliver(stripe, unknown)).json() == {"outcome": "unknown_customer"}

    data = (await owner.get("/v1/billing")).json()
    assert (data["plan"]["id"], data["provider"], data["comped_until"]) == (
        "growth",
        "stripe",
        None,
    )

    events = (await admin.get(f"{ADMIN}/billing-events")).json()
    assert events["total"] == 2
    outcomes = {e["id"]: (e["outcome"], e["workspace_name"]) for e in events["items"]}
    assert outcomes == {
        created["id"]: ("applied", "Upgrading Co"),
        unknown["id"]: ("unknown_customer", None),
    }
    detail = (await admin.get(f"{ADMIN}/workspaces/{tenant}")).json()
    assert [e["id"] for e in detail["billing_events"]] == [created["id"]]
    assert detail["subscription"]["state"] == "paying"
    assert detail["actions"]["refusal"] is not None


# Jobs


async def test_job_queue_health_and_retrying_a_dead_job(
    admin: httpx.AsyncClient, client_factory: ClientFactory, admin_pool: Pool, owner_pool: Pool
) -> None:
    tenant = tid(await signup(client_factory(), workspace="Jobs Co"))
    async with owner_pool.acquire() as conn:
        dead = await conn.fetchval(
            """
            insert into jobs (tenant_id, kind, payload, status, attempts, last_error,
                              finished_at, dedupe_key)
            values ($1, 'embed_document', '{}', 'dead', 5, 'model timed out', now(), 'embed:1')
            returning id
            """,
            tenant,
        )
        system = await conn.fetchval(
            "insert into jobs (kind, payload, status, attempts, last_error, finished_at)"
            " values ('send_email', '{}', 'dead', 5, 'smtp down', now()) returning id"
        )
        await conn.execute(
            "insert into jobs (kind, payload, run_at) values ('rollup_usage', '{}',"
            " now() - interval '90 seconds'), ('rollup_usage', '{}', now() + interval '1 hour')"
        )

    health = (await admin.get(f"{ADMIN}/jobs")).json()
    assert (health["ready"], health["scheduled"], health["dead"]) == (2, 1, 2)
    # The signup's verification email is queued too, so the oldest is the one from 90 s ago.
    assert 85 <= health["oldest_ready_seconds"] <= 120
    by_id = {j["id"]: j for j in health["dead_jobs"]}
    assert by_id[dead]["workspace_name"] == "Jobs Co"
    assert by_id[dead]["last_error"] == "model timed out"
    assert {"kind": "embed_document", "status": "dead", "count": 1} in health["counts"]

    retried = await admin.post(f"{ADMIN}/jobs/{dead}/retry")
    assert retried.status_code == 200, retried.text
    assert retried.json()["dead"] == 1
    async with owner_pool.acquire() as conn:
        row = await conn.fetchrow(
            "select status, attempts, finished_at from jobs where id = $1", dead
        )
    assert dict(row) == {"status": "queued", "attempts": 0, "finished_at": None}
    log = await audit_actions(admin_pool, tenant)
    assert [(e["action"], e["metadata"]["kind"]) for e in log] == [
        ("platform_admin.job_retried", "embed_document")
    ]

    again = await admin.post(f"{ADMIN}/jobs/{dead}/retry")
    assert (again.status_code, again.json()["error"]["code"]) == (409, "not_dead")
    assert (await admin.post(f"{ADMIN}/jobs/999999/retry")).status_code == 404
    assert (await admin.post(f"{ADMIN}/jobs/{system}/retry")).status_code == 200

    # Another live job with the same dedupe key means the retry would run it twice.
    async with owner_pool.acquire() as conn:
        await conn.execute("update jobs set status = 'dead' where id = $1", dead)
        await conn.execute(
            "insert into jobs (tenant_id, kind, payload, dedupe_key)"
            " values ($1, 'embed_document', '{}', 'embed:1')",
            tenant,
        )
    clash = await admin.post(f"{ADMIN}/jobs/{dead}/retry")
    assert (clash.status_code, clash.json()["error"]["code"]) == (409, "already_queued")


async def test_seeded_owner_is_a_platform_admin(
    settings: Settings, client_factory: ClientFactory, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SEED_OWNER_PASSWORD", "an owner password")
    lines = await seed(settings, "founder.demo@example.com", "Demo Founder")
    assert "founder.demo@example.com is also a platform admin: the console is at /admin." in lines
    await seed(settings, "founder.demo@example.com", "Demo Founder")  # idempotent
    client = client_factory()
    login = await client.post(
        "/v1/auth/login",
        json={"email": "founder.demo@example.com", "password": "an owner password"},
    )
    assert login.json()["platform_admin"] is True
    overview = (await client.get(f"{ADMIN}/overview")).json()
    assert overview["workspaces"] == 4
    teammate = await client_factory().post(
        "/v1/auth/login",
        json={"email": "docent-omar.haddad@mailinator.com", "password": DEMO_PASSWORD},
    )
    assert teammate.json()["platform_admin"] is False
