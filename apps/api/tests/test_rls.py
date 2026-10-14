"""Tenant isolation enforced by the database itself."""

import time
import uuid

import asyncpg
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from jwt.algorithms import ECAlgorithm

from docent.db.pool import Pool, transaction
from docent.ids import new_id
from tests.conftest import (
    CONSOLE_TABLES,
    TENANT_TABLES,
    ClientFactory,
    Drain,
    signup,
    verified_owner,
)

# Tables with tenant_id that are deliberately outside RLS, with the reason.
RLS_EXEMPT = {
    "jobs": "system queue; worker sets tenant context per job",
    "billing_events": "provider event ids and types, written before the tenant is known",
}
SITE = "http://localhost:5173"


async def test_every_tenant_table_has_forced_rls_and_a_policy(owner_pool: Pool) -> None:
    async with owner_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            select c.relname, c.relrowsecurity, c.relforcerowsecurity,
                   (select count(*) from pg_policies p
                    where p.schemaname = 'public' and p.tablename = c.relname) as policies
            from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
              and (c.relname = 'tenants' or exists (
                    select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped))
            """
        )
    checked = {r["relname"] for r in rows} - RLS_EXEMPT.keys()
    assert {"tenants", *TENANT_TABLES} <= checked
    failures = [
        r["relname"]
        for r in rows
        if r["relname"] not in RLS_EXEMPT
        and not (r["relrowsecurity"] and r["relforcerowsecurity"] and r["policies"] > 0)
    ]
    assert failures == [], f"tables missing forced RLS or policies: {failures}"


async def test_app_roles_cannot_bypass_rls_or_change_schema(owner_pool: Pool) -> None:
    async with owner_pool.acquire() as conn:
        for role in ("docent_app", "docent_worker"):
            row = await conn.fetchrow(
                """
                select rolsuper, rolbypassrls, rolcreaterole, rolcreatedb,
                       has_schema_privilege($1, 'public', 'CREATE') as can_create
                from pg_roles where rolname = $1
                """,
                role,
            )
            assert row is not None
            assert not any(row.values()), f"{role} has elevated rights: {dict(row)}"
        assert not await conn.fetchval("select has_table_privilege('docent_app', 'jobs', 'DELETE')")
        assert not await conn.fetchval(
            "select has_table_privilege('docent_app', 'audit_log', 'UPDATE')"
        )
        assert not await conn.fetchval(
            "select has_table_privilege('docent_worker', 'tenants', 'SELECT')"
        )


@pytest.fixture
async def two_tenants(
    client_factory: ClientFactory, drain: Drain
) -> tuple[dict[str, object], dict[str, object]]:
    a_client = client_factory()
    b_client = client_factory()
    a = await verified_owner(a_client, drain, "Tenant A")
    b = await verified_owner(b_client, drain, "Tenant B")
    # Give each tenant rows in every tenant table: invitations, audit, and knowledge.
    for c in (a_client, b_client):
        r = await c.post("/v1/invitations", json={"email": "x@example.com", "role": "agent"})
        assert r.status_code == 201
        upload = await c.post(
            "/v1/knowledge/uploads",
            files={"file": ("guide.md", b"# Guide\n\nShared text in both tenants.")},
        )
        assert upload.status_code == 201, upload.text
    await drain()
    for c in (a_client, b_client):
        ticket = await c.post(
            "/v1/ticket-types",
            json={
                "name": "Billing",
                "description": "Payments and refunds.",
                "notify_emails": ["billing@example.com"],
            },
        )
        assert ticket.status_code == 201, ticket.text
        conversation = (await c.post("/v1/agent/conversations", json={})).json()
        for text in ("shared text in both tenants", "talk to a human please"):
            sent = await c.post(
                f"/v1/agent/conversations/{conversation['id']}/messages", json={"content": text}
            )
            assert "event: message" in sent.text, sent.text
        widget = (
            await c.post("/v1/widgets", json={"name": "Help", "allowed_origins": [SITE]})
        ).json()
        private = ec.generate_private_key(ec.SECP256R1())
        key = await c.post(
            f"/v1/widgets/{widget['id']}/keys",
            json={"public_jwk": ECAlgorithm.to_jwk(private.public_key(), as_dict=True)},
        )
        now = int(time.time())
        token = jwt.encode(
            {
                "iss": widget["public_id"],
                "aud": "docent",
                "sub": "u1",
                "iat": now,
                "exp": now + 300,
                "jti": uuid.uuid4().hex,
            },
            private,
            algorithm="ES256",
            headers={"kid": key.json()["kid"]},
        )
        created = await client_factory(origin="http://localhost:8000").post(
            "/v1/widget/sessions",
            json={"widget": widget["public_id"], "parent_origin": SITE, "token": token},
        )
        assert created.status_code == 201, created.text
        # Inbox: a read marker, a note, preferences, a channel, a webhook, a rule.
        handoff = (await c.get("/v1/inbox")).json()["items"][0]["id"]
        assert (await c.post(f"/v1/inbox/{handoff}/read")).status_code == 204
        note = await c.post(f"/v1/inbox/{handoff}/notes", json={"body": "Looking into it."})
        assert note.status_code == 201, note.text
        prefs = {"daily_digest": True, "assigned_email": False}
        assert (await c.put("/v1/inbox/preferences", json=prefs)).status_code == 200
        channel = await c.post(
            "/v1/automation/channels", json={"name": "Support", "url": "http://127.0.0.1:9/slack"}
        )
        assert channel.status_code == 201, channel.text
        webhook = await c.post("/v1/automation/webhooks", json={"url": "http://127.0.0.1:9/hook"})
        assert webhook.status_code == 201, webhook.text
        rule = await c.post("/v1/automation/rules", json={"name": "All", "set_priority": "high"})
        assert rule.status_code == 201, rule.text
        test = await c.post(f"/v1/automation/webhooks/{webhook.json()['webhook']['id']}/test")
        assert test.status_code == 202, test.text
    await drain()  # summaries and routing: notifications, email deliveries, webhook events
    return a, b


def _tid(me: dict[str, object]) -> uuid.UUID:
    return uuid.UUID(str(me["active_tenant"]["id"]))  # type: ignore[index]


async def test_no_tenant_context_sees_nothing(app_pool: Pool, two_tenants: object) -> None:
    async with transaction(app_pool) as conn:
        for table in ["tenants", *TENANT_TABLES]:
            assert await conn.fetchval(f"select count(*) from {table}") == 0, table  # noqa: S608


async def test_tenant_context_only_sees_its_rows(
    app_pool: Pool, two_tenants: tuple[dict[str, object], dict[str, object]]
) -> None:
    a, b = two_tenants
    ta, tb = _tid(a), _tid(b)
    async with transaction(app_pool, tenant_id=ta) as conn:
        assert await conn.fetchval("select array_agg(id) from tenants") == [ta]
        for table in TENANT_TABLES:
            ids = await conn.fetchval(f"select array_agg(distinct tenant_id) from {table}")  # noqa: S608
            assert ids == [ta], table
        # Explicitly asking for B's rows returns nothing.
        assert await conn.fetchval("select count(*) from memberships where tenant_id = $1", tb) == 0
        updated = await conn.execute("update tenants set name = 'pwned' where id = $1", tb)
        assert updated == "UPDATE 0"


@pytest.mark.parametrize(
    ("table", "sql"),
    [
        (
            "memberships",
            "insert into memberships (tenant_id, user_id, role) values ($1, $2, 'owner')",
        ),
        (
            "invitations",
            "insert into invitations (id, tenant_id, email, role, token_hash, invited_by,"
            " expires_at) values (gen_random_uuid(), $1, 'e@example.com', 'agent',"
            " '\\x00'::bytea, $2, now())",
        ),
        (
            "audit_log",
            "insert into audit_log (id, tenant_id, actor_user_id, action)"
            " values (gen_random_uuid(), $1, $2, 'x')",
        ),
    ],
)
async def test_cannot_write_into_another_tenant(
    app_pool: Pool,
    two_tenants: tuple[dict[str, object], dict[str, object]],
    table: str,
    sql: str,
) -> None:
    a, b = two_tenants
    user_a = uuid.UUID(str(a["user"]["id"]))  # type: ignore[index]
    with pytest.raises(asyncpg.InsufficientPrivilegeError, match="row-level security"):
        async with transaction(app_pool, tenant_id=_tid(a)) as conn:
            await conn.execute(sql, _tid(b), user_a)


async def test_cannot_create_tenant_outside_context(app_pool: Pool) -> None:
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        async with transaction(app_pool, tenant_id=new_id()) as conn:
            await conn.execute(
                "insert into tenants (id, name, slug) values ($1, 'x', 'x-slug')", new_id()
            )


async def test_user_context_sees_only_own_memberships(
    app_pool: Pool, client_factory: ClientFactory
) -> None:
    me = await signup(client_factory())
    other = await signup(client_factory())
    user_id = uuid.UUID(me["user"]["id"])
    async with transaction(app_pool, user_id=user_id) as conn:
        tenants = await conn.fetch("select id from tenants")
        assert [r["id"] for r in tenants] == [uuid.UUID(me["active_tenant"]["id"])]
        assert other["active_tenant"]["id"] not in {str(r["id"]) for r in tenants}


# The platform admin console's capability (migration 0011).


async def test_console_policies_are_select_only_on_exactly_the_console_tables(
    owner_pool: Pool,
) -> None:
    async with owner_pool.acquire() as conn:
        rows = await conn.fetch(
            """
            select tablename, policyname, cmd, permissive
            from pg_policies
            where schemaname = 'public'
              and (policyname = 'platform_admin_read' or qual like '%app_platform_admin%'
                   or with_check like '%app_platform_admin%')
            """
        )
    assert sorted(r["tablename"] for r in rows) == sorted(CONSOLE_TABLES)
    for row in rows:
        assert (row["policyname"], row["cmd"], row["permissive"]) == (
            "platform_admin_read",
            "SELECT",
            "PERMISSIVE",
        ), dict(row)


async def test_console_capability_reads_console_tables_and_nothing_else(
    app_pool: Pool, two_tenants: tuple[dict[str, object], dict[str, object]]
) -> None:
    a, b = two_tenants
    both = {_tid(a), _tid(b)}
    async with transaction(app_pool, platform_admin=True) as conn:
        assert set(await conn.fetchval("select array_agg(id) from tenants")) == both
        for table in CONSOLE_TABLES[1:]:
            ids = await conn.fetchval(f"select array_agg(distinct tenant_id) from {table}")  # noqa: S608
            assert set(ids or []) == both, table
        for table in set(TENANT_TABLES) - set(CONSOLE_TABLES):
            assert await conn.fetchval(f"select count(*) from {table}") == 0, table  # noqa: S608
    # Without the setting, the same reads see nothing at all.
    async with transaction(app_pool) as conn:
        for table in CONSOLE_TABLES:
            assert await conn.fetchval(f"select count(*) from {table}") == 0, table  # noqa: S608


async def test_console_capability_grants_no_writes(
    app_pool: Pool, two_tenants: tuple[dict[str, object], dict[str, object]]
) -> None:
    a, b = two_tenants
    ta, tb = _tid(a), _tid(b)
    user_a = uuid.UUID(str(a["user"]["id"]))  # type: ignore[index]
    async with transaction(app_pool, platform_admin=True) as conn:
        assert await conn.execute("update tenants set name = 'pwned'") == "UPDATE 0"
        assert await conn.execute("update subscriptions set plan_id = 'scale'") == "UPDATE 0"
        assert await conn.execute("delete from widgets") == "DELETE 0"
        assert await conn.execute("delete from memberships") == "DELETE 0"
    # Even beside a tenant context, it writes only into that tenant.
    async with transaction(app_pool, tenant_id=ta, platform_admin=True) as conn:
        updated = await conn.execute("update tenants set name = 'pwned' where id = $1", tb)
        assert updated == "UPDATE 0"
    for tenant_id in (None, ta):
        with pytest.raises(asyncpg.InsufficientPrivilegeError, match="row-level security"):
            async with transaction(app_pool, tenant_id=tenant_id, platform_admin=True) as conn:
                await conn.execute(
                    "insert into audit_log (id, tenant_id, actor_user_id, action)"
                    " values (gen_random_uuid(), $1, $2, 'x')",
                    tb,
                    user_a,
                )
    async with transaction(app_pool, platform_admin=True) as conn:
        names = await conn.fetchval("select array_agg(name order by name) from tenants")
    assert names == ["Tenant A", "Tenant B"]
