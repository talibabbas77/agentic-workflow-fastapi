"""Fetching customer URLs: private addresses blocked, robots.txt and site boundaries respected."""

import threading
import uuid
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import httpx
import pytest

from docent.db.pool import Pool
from docent.knowledge.fetch import FetchError, fetch, guarded_client, is_public_address
from tests.conftest import ClientFactory, Drain, verified_owner

ARTICLE = (
    "<html><head><title>{title}</title></head><body><nav>Home Docs Pricing</nav>"
    "<article><h1>{title}</h1>"
    "<p>{body} This paragraph explains the topic in plain words for customers.</p>"
    "<h2>Details</h2><p>More detail about {title} that a support agent can cite.</p>"
    "</article><footer>Copyright</footer></body></html>"
)


def _pages(base: str) -> dict[str, tuple[str, bytes]]:
    return {
        "/robots.txt": ("text/plain", b"User-agent: *\nDisallow: /private/\n"),
        "/sitemap.xml": (
            "application/xml",
            f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{base}/docs/refunds</loc></url>
  <url><loc>{base}/docs/invoices</loc></url>
  <url><loc>{base}/private/salaries</loc></url>
  <url><loc>https://elsewhere.example/docs/x</loc></url>
</urlset>""".encode(),
        ),
        "/docs/refunds": (
            "text/html",
            ARTICLE.format(title="Refunds", body="Annual plans are refundable.").encode(),
        ),
        "/docs/invoices": (
            "text/html",
            ARTICLE.format(title="Invoices", body="Invoices arrive monthly.").encode(),
        ),
    }


@pytest.fixture(scope="module")
def site() -> Iterator[str]:
    pages: dict[str, tuple[str, bytes]] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            if self.path not in pages:
                self.send_response(404)
                self.end_headers()
                return
            content_type, body = pages[self.path]
            self.send_response(200)
            self.send_header("content-type", content_type)
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_: Any) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    base = f"http://127.0.0.1:{server.server_port}"
    pages.update(_pages(base))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield base
    server.shutdown()


@pytest.mark.parametrize(
    ("address", "public"),
    [
        ("8.8.8.8", True),
        ("2606:4700:4700::1111", True),
        ("127.0.0.1", False),
        ("10.1.2.3", False),
        ("172.16.0.1", False),
        ("192.168.1.1", False),
        ("169.254.169.254", False),  # cloud metadata
        ("100.64.0.1", False),
        ("0.0.0.0", False),  # noqa: S104
        ("::1", False),
        ("fd00::1", False),
        ("fe80::1", False),
        ("::ffff:127.0.0.1", False),
        ("224.0.0.1", False),
    ],
)
def test_public_address_check(address: str, public: bool) -> None:
    assert is_public_address(address) is public


async def test_private_addresses_are_blocked_at_connect_time(site: str) -> None:
    async with guarded_client(user_agent="t", timeout=5, allow_private=False) as client:
        for url in (f"{site}/docs/refunds", site.replace("127.0.0.1", "localhost") + "/docs/x"):
            with pytest.raises(FetchError, match="not reachable"):
                await fetch(client, url, max_bytes=100_000)


async def test_fetch_enforces_size_limit(site: str) -> None:
    async with guarded_client(user_agent="t", timeout=5, allow_private=True) as client:
        with pytest.raises(FetchError, match="larger than"):
            await fetch(client, f"{site}/docs/refunds", max_bytes=100)
        with pytest.raises(FetchError, match="not found"):
            await fetch(client, f"{site}/missing", max_bytes=100_000)


async def test_sitemap_crawl_respects_robots_and_site(
    site: str, client_factory: ClientFactory, drain: Drain
) -> None:
    owner: httpx.AsyncClient = client_factory()
    await verified_owner(owner, drain)
    response = await owner.post(
        "/v1/knowledge/sources",
        json={"kind": "sitemap", "url": f"{site}/sitemap.xml", "page_limit": 10},
    )
    assert response.status_code == 201, response.text
    source = response.json()
    assert source["title"] == "127.0.0.1"
    await drain()
    detail = (await owner.get(f"/v1/knowledge/sources/{source['id']}")).json()
    assert detail["source"]["status"] == "ready"
    assert sorted(d["url"] for d in detail["documents"]) == [
        f"{site}/docs/invoices",
        f"{site}/docs/refunds",
    ]
    assert {d["title"] for d in detail["documents"]} == {"Refunds", "Invoices"}
    hits = (
        await owner.post("/v1/knowledge/search", json={"query": "annual plans refundable"})
    ).json()["hits"]
    assert hits[0]["url"] == f"{site}/docs/refunds"
    assert "Copyright" not in hits[0]["content"]  # boilerplate stripped


async def test_single_page_that_does_not_exist_fails_cleanly(
    site: str, client_factory: ClientFactory, drain: Drain
) -> None:
    owner: httpx.AsyncClient = client_factory()
    await verified_owner(owner, drain)
    source = (
        await owner.post("/v1/knowledge/sources", json={"kind": "url", "url": f"{site}/gone"})
    ).json()
    await drain()
    detail = (await owner.get(f"/v1/knowledge/sources/{source['id']}")).json()
    assert detail["source"]["status"] == "failed"
    assert "not found" in detail["documents"][0]["last_error"].lower()


async def test_a_sitemap_resync_stays_within_the_plans_page_limit(
    site: str, client_factory: ClientFactory, drain: Drain, admin_pool: Pool
) -> None:
    """A sitemap can grow after it was added; re-syncing must stay within the plan."""
    owner: httpx.AsyncClient = client_factory()
    me = await verified_owner(owner, drain)
    tenant_id = uuid.UUID(me["active_tenant"]["id"])
    response = await owner.post(
        "/v1/knowledge/sources",
        json={"kind": "sitemap", "url": f"{site}/sitemap.xml", "page_limit": 10},
    )
    source = response.json()
    await drain()

    other = uuid.uuid4()
    async with admin_pool.acquire() as conn:  # other pages fill all but one of the trial's 200
        await conn.execute(
            "insert into knowledge_sources (id, tenant_id, kind, title)"
            " values ($1, $2, 'upload', 'x')",
            other,
            tenant_id,
        )
        await conn.executemany(
            """
            insert into documents (id, tenant_id, source_id, locator, mime, status)
            values ($1, $2, $3, $4, 'text/markdown', 'ready')
            """,
            [(uuid.uuid4(), tenant_id, other, f"page-{n}.md") for n in range(199)],
        )
    assert (await owner.post(f"/v1/knowledge/sources/{source['id']}/sync")).status_code == 202
    await drain()
    detail = (await owner.get(f"/v1/knowledge/sources/{source['id']}")).json()
    assert len(detail["documents"]) == 1
