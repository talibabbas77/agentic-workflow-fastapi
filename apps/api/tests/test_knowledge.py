"""Knowledge pipeline and API: ingest, re-sync, delete, audience, isolation, crashes, search."""

from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from docent.db.pool import Pool
from docent.jobs.worker import Worker
from tests.conftest import PASSWORD, ClientFactory, Drain, token_from, unique_email, verified_owner
from tests.fakes import FakeEmbedder

GUIDE = b"""# Billing guide

## Refunds

Annual plans can be refunded within 30 days of renewal. Contact billing to start a refund.

## Invoices

Invoices are emailed on the first day of each month and list every seat.
"""


async def _upload(
    client: httpx.AsyncClient, name: str, body: bytes, audience: str = "public"
) -> dict[str, Any]:
    response = await client.post(
        "/v1/knowledge/uploads", files={"file": (name, body)}, data={"audience": audience}
    )
    assert response.status_code == 201, response.text
    source: dict[str, Any] = response.json()
    return source


async def _source(client: httpx.AsyncClient, source_id: str) -> dict[str, Any]:
    response = await client.get(f"/v1/knowledge/sources/{source_id}")
    assert response.status_code == 200, response.text
    detail: dict[str, Any] = response.json()
    return detail


async def _search(
    client: httpx.AsyncClient, query: str, audience: str = "public"
) -> dict[str, Any]:
    response = await client.post(
        "/v1/knowledge/search", json={"query": query, "audience": audience}
    )
    assert response.status_code == 200, response.text
    result: dict[str, Any] = response.json()
    return result


@pytest.fixture
async def owner(client_factory: ClientFactory, drain: Drain) -> httpx.AsyncClient:
    client = client_factory()
    await verified_owner(client, drain)
    return client


async def test_upload_is_parsed_chunked_embedded_and_searchable(
    owner: httpx.AsyncClient, drain: Drain
) -> None:
    source = await _upload(owner, "billing.md", GUIDE)
    assert source["status"] == "queued"
    assert source["title"] == "billing"
    await drain()
    detail = await _source(owner, source["id"])
    assert detail["source"]["status"] == "ready"
    assert detail["source"]["chunk_count"] == 2
    [document] = detail["documents"]
    assert document["status"] == "ready"
    assert document["title"] == "Billing guide"

    result = await _search(owner, "how do I get a refund for an annual plan")
    assert result["mode"] == "hybrid"
    top = result["hits"][0]
    assert top["heading_path"] == "Billing guide > Refunds"
    assert "30 days" in top["content"]
    assert top["document_title"] == "Billing guide"

    steps = {s["key"]: s["status"] for s in (await owner.get("/v1/onboarding")).json()["steps"]}
    assert steps["teach_agent"] == "done"


async def test_resync_of_unchanged_document_does_not_reembed(
    owner: httpx.AsyncClient, drain: Drain, embedder: FakeEmbedder, admin_pool: Pool
) -> None:
    source = await _upload(owner, "billing.md", GUIDE)
    await drain()
    calls = embedder.calls
    async with admin_pool.acquire() as conn:
        before = await conn.fetch("select id from chunks order by ordinal")
    response = await owner.post(f"/v1/knowledge/sources/{source['id']}/sync")
    assert response.status_code == 202
    await drain()
    async with admin_pool.acquire() as conn:
        after = await conn.fetch("select id from chunks order by ordinal")
    assert embedder.calls == calls
    assert [r["id"] for r in after] == [r["id"] for r in before]
    assert (await _source(owner, source["id"]))["source"]["status"] == "ready"


async def test_delete_removes_chunks_and_files_and_is_idempotent(
    owner: httpx.AsyncClient, drain: Drain, app: FastAPI, admin_pool: Pool, worker: Worker
) -> None:
    source = await _upload(owner, "billing.md", GUIDE)
    await drain()
    store = app.state.docent.store
    async with admin_pool.acquire() as conn:
        tenant_id = await conn.fetchval("select tenant_id from knowledge_sources")
    prefix = f"{tenant_id}/{source['id']}/"
    assert await store.delete_prefix("unrelated/") == 0
    response = await owner.delete(f"/v1/knowledge/sources/{source['id']}")
    assert response.status_code == 202
    assert (await _source(owner, source["id"]))["source"]["status"] == "deleting"
    await drain()
    assert (await owner.get(f"/v1/knowledge/sources/{source['id']}")).status_code == 404
    async with admin_pool.acquire() as conn:
        assert await conn.fetchval("select count(*) from chunks") == 0
        assert await conn.fetchval("select count(*) from documents") == 0
    assert await store.delete_prefix(prefix) == 0  # files already gone
    handler = worker.handlers["delete_source"]
    from docent.jobs.queue import Job
    from docent.jobs.worker import JobContext

    job = Job(1, tenant_id, "delete_source", {"source_id": source["id"]}, 1, 5)
    await handler(JobContext(job=job, pool=worker.pool))  # second run is harmless


async def test_public_search_never_returns_identified_chunks(
    owner: httpx.AsyncClient, drain: Drain
) -> None:
    await _upload(owner, "public.md", b"# Plans\n\nThe starter plan includes three seats.")
    await _upload(
        owner,
        "internal.md",
        b"# Enterprise\n\nThe enterprise plan includes single sign on and seats.",
        audience="identified",
    )
    await drain()
    public = await _search(owner, "plan seats", "public")
    assert {h["document_title"] for h in public["hits"]} == {"Plans"}
    signed_in = await _search(owner, "plan seats", "identified")
    assert {h["document_title"] for h in signed_in["hits"]} == {"Plans", "Enterprise"}


async def test_changing_audience_updates_existing_chunks(
    owner: httpx.AsyncClient, drain: Drain
) -> None:
    source = await _upload(owner, "public.md", b"# Plans\n\nThe starter plan includes seats.")
    await drain()
    response = await owner.patch(
        f"/v1/knowledge/sources/{source['id']}", json={"audience": "identified"}
    )
    assert response.status_code == 200
    assert (await _search(owner, "starter plan seats", "public"))["hits"] == []


async def test_tenant_search_never_sees_another_tenant(
    client_factory: ClientFactory, drain: Drain
) -> None:
    a = client_factory()
    b = client_factory()
    await verified_owner(a, drain, "Tenant A")
    await verified_owner(b, drain, "Tenant B")
    text = b"# Shared\n\nIdentical words appear in both workspaces."
    source_a = await _upload(a, "same.md", text)
    source_b = await _upload(b, "same.md", text)
    await drain()
    hits_a = (await _search(a, "identical words"))["hits"]
    assert hits_a
    assert {h["source_id"] for h in hits_a} == {source_a["id"]}
    assert (await a.get(f"/v1/knowledge/sources/{source_b['id']}")).status_code == 404


async def test_embedding_crash_resumes_without_duplicates(
    owner: httpx.AsyncClient,
    drain: Drain,
    embedder: FakeEmbedder,
    admin_pool: Pool,
) -> None:
    sections = "\n\n".join(f"## Topic {i}\n\nDetails about topic number {i}." for i in range(40))
    source = await _upload(owner, "big.md", f"# Big\n\n{sections}".encode())
    embedder.fail_after = embedder.calls + 1  # the first batch succeeds, the second fails
    try:
        await drain()
    finally:
        embedder.fail_after = None
    async with admin_pool.acquire() as conn:
        assert await conn.fetchval("select count(*) from chunks where embedding is null") > 0
        await conn.execute("update jobs set run_at = now() where status = 'queued'")
    await drain()
    async with admin_pool.acquire() as conn:
        total, missing, distinct = await conn.fetchrow(
            "select count(*), count(*) filter (where embedding is null), count(distinct ordinal)"
            " from chunks"
        )
    assert total == 40
    assert missing == 0
    assert distinct == total
    assert (await _source(owner, source["id"]))["source"]["status"] == "ready"


async def test_unreadable_documents_fail_without_retries(
    owner: httpx.AsyncClient, drain: Drain, admin_pool: Pool
) -> None:
    source = await _upload(owner, "empty.md", b"   \n\n  ")
    await drain()
    detail = await _source(owner, source["id"])
    assert detail["source"]["status"] == "failed"
    assert detail["documents"][0]["last_error"] == "No readable text found in this document."
    async with admin_pool.acquire() as conn:
        assert (
            await conn.fetchval("select status from jobs where kind = 'parse_document'") == "dead"
        )


async def test_rejects_unsupported_files(owner: httpx.AsyncClient) -> None:
    binary = await owner.post("/v1/knowledge/uploads", files={"file": ("app.exe", b"MZ\x00\x01")})
    assert binary.status_code == 415
    assert binary.json()["error"]["code"] == "unsupported_file"
    fake_pdf = await owner.post("/v1/knowledge/uploads", files={"file": ("x.pdf", b"not a pdf")})
    assert fake_pdf.status_code == 415


async def test_agents_read_but_cannot_change_knowledge(
    owner: httpx.AsyncClient, client_factory: ClientFactory, drain: Drain
) -> None:
    await owner.post("/v1/invitations", json={"email": unique_email(), "role": "agent"})
    token = token_from((await drain())[0])
    agent = client_factory()
    accepted = await agent.post(
        "/v1/invitations/accept", json={"token": token, "name": "Ana", "password": PASSWORD}
    )
    assert accepted.status_code == 200
    assert (await agent.get("/v1/knowledge/sources")).status_code == 200
    assert (await agent.post("/v1/knowledge/search", json={"query": "x"})).status_code == 200
    upload = await agent.post("/v1/knowledge/uploads", files={"file": ("a.md", b"# A\n\nB")})
    assert upload.status_code == 403
    page = await agent.post(
        "/v1/knowledge/sources", json={"kind": "url", "url": "https://example.com/docs"}
    )
    assert page.status_code == 403


async def test_search_falls_back_to_keywords_when_embeddings_are_down(
    owner: httpx.AsyncClient, drain: Drain, embedder: FakeEmbedder
) -> None:
    await _upload(owner, "billing.md", GUIDE)
    await drain()
    embedder.fail_queries = True
    try:
        result = await _search(owner, "refund")
    finally:
        embedder.fail_queries = False
    assert result["mode"] == "keyword"
    assert result["hits"][0]["heading_path"] == "Billing guide > Refunds"


async def test_source_url_validation(owner: httpx.AsyncClient) -> None:
    for url in ("ftp://example.com/x", "https://user:pw@example.com/", "javascript:alert(1)"):
        response = await owner.post("/v1/knowledge/sources", json={"kind": "url", "url": url})
        assert response.status_code == 422, url
        assert "url" in response.json()["error"]["fields"]
