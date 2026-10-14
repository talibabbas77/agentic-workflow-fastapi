"""Agent memory: team answers, knowledge gaps, and customer memory."""

import json
import uuid
from typing import Any

import httpx
import pytest

from docent.db.pool import Pool
from docent.memory import customers
from docent.memory.customers import REMEMBER_CUSTOMER, CustomerFacts, Fact
from tests.conftest import ClientFactory, Drain, verified_owner
from tests.fakes import FakeChat


@pytest.fixture
async def owner(client_factory: ClientFactory, drain: Drain) -> httpx.AsyncClient:
    client = client_factory()
    await verified_owner(client, drain, "Lumen Notes")
    return client


async def say(client: httpx.AsyncClient, conversation_id: str, text: str) -> dict[str, Any]:
    response = await client.post(
        f"/v1/agent/conversations/{conversation_id}/messages", json={"content": text}
    )
    block = response.text.strip().split("\n\n")[-1]
    message: dict[str, Any] = json.loads(block.split("data: ", 1)[1])
    return message


async def conversation(client: httpx.AsyncClient, **body: Any) -> str:
    cid: str = (await client.post("/v1/agent/conversations", json=body)).json()["id"]
    return cid


async def test_a_team_answer_is_indexed_cited_edited_and_deleted(
    owner: httpx.AsyncClient, drain: Drain, chat: FakeChat
) -> None:
    created = await owner.post(
        "/v1/memory/answers",
        json={
            "question": "Can I pay by bank transfer?",
            "answer": "Yes. Annual plans can be paid by bank transfer; write to billing.",
        },
    )
    assert created.status_code == 201, created.text
    answer = created.json()
    assert answer["status"] == "queued"
    await drain()

    listed = (await owner.get("/v1/memory/answers")).json()
    assert [(a["question"], a["status"]) for a in listed] == [
        ("Can I pay by bank transfer?", "ready")
    ]
    sources = (await owner.get("/v1/knowledge/sources")).json()["sources"]
    assert sources == []  # team answers live in memory, not in the knowledge list

    message = await say(owner, await conversation(owner), "can I pay by bank transfer")
    assert message["decision"]["type"] == "answer"
    assert message["citations"][0]["document_title"] == "Can I pay by bank transfer?"
    overview = (await owner.get("/v1/memory")).json()
    assert overview["team_answers"] == 1
    assert overview["answers_30d"] == 1
    version = overview["knowledge_version"]

    edited = await owner.put(
        f"/v1/memory/answers/{answer['id']}",
        json={"question": "Can I pay by bank transfer?", "answer": "Only on annual plans."},
    )
    assert edited.json()["answer"] == "Only on annual plans."
    await drain()
    assert (await owner.get("/v1/memory")).json()["knowledge_version"] > version

    assert (await owner.delete(f"/v1/memory/answers/{answer['id']}")).status_code == 204
    await drain()
    assert (await owner.get("/v1/memory/answers")).json() == []
    chat.replies.append(
        {"intent": "product_question", "language": "en", "clarifying_question": None}
    )
    after = await say(owner, await conversation(owner), "can I pay by bank transfer")
    assert after["decision"]["reason"] == "no_source"


async def test_unanswered_questions_become_grouped_gaps(
    owner: httpx.AsyncClient, drain: Drain
) -> None:
    for text in (
        "is there a dark mode in the app",
        "is there a dark mode in the mobile app",
        "can I export my notes to a kindle",
    ):
        await say(owner, await conversation(owner), text)
    groups = (await owner.get("/v1/memory/gaps")).json()
    assert sorted(g["count"] for g in groups) == [1, 2]
    dark = next(g for g in groups if g["count"] == 2)
    assert "dark mode" in dark["question"]

    answered = await owner.post(
        "/v1/memory/answers",
        json={
            "question": "Is there a dark mode?",
            "answer": "Dark mode is on the roadmap.",
            "gap_ids": dark["ids"],
        },
    )
    assert answered.status_code == 201
    kindle = next(g for g in groups if g["count"] == 1)
    assert (
        await owner.post("/v1/memory/gaps/dismiss", json={"ids": kindle["ids"]})
    ).status_code == 204
    assert (await owner.get("/v1/memory/gaps")).json() == []


async def test_greetings_and_off_topic_messages_are_not_gaps(
    owner: httpx.AsyncClient, chat: FakeChat
) -> None:
    await say(owner, await conversation(owner), "hello there")
    chat.replies.append({"intent": "off_topic", "language": "en", "clarifying_question": None})
    await say(owner, await conversation(owner), "what is the capital of France")
    assert (await owner.get("/v1/memory/gaps")).json() == []


async def remembered_customer(owner: httpx.AsyncClient, admin_pool: Pool) -> tuple[str, uuid.UUID]:
    """A signed-in customer's conversation, as the widget would create it."""
    cid = await conversation(owner, mode="identified", claims={"name": "Ana", "plan": "Team"})
    tenant_id = uuid.UUID((await owner.get("/v1/tenant")).json()["id"])
    end_user_id = uuid.uuid4()
    async with admin_pool.acquire() as conn:
        await conn.execute(
            """
            insert into end_users (id, tenant_id, external_id, email, name, claims)
            values ($1, $2, 'ana-1', 'ana@example.com', 'Ana Souza', '{}')
            """,
            end_user_id,
            tenant_id,
        )
        await conn.execute(
            "update conversations set end_user_id = $2 where id = $1", uuid.UUID(cid), end_user_id
        )
    return cid, end_user_id


async def test_customer_memory_is_written_when_quiet_and_used_next_time(
    owner: httpx.AsyncClient, chat: FakeChat, drain: Drain, admin_pool: Pool
) -> None:
    cid, end_user_id = await remembered_customer(owner, admin_pool)
    await say(owner, cid, "my sync stopped working on the Windows desktop app")
    await drain()  # the handoff summary runs now; the memory job waits for quiet
    async with admin_pool.acquire() as conn:
        job = await conn.fetchrow(
            "select run_at > now() as later from jobs where kind = $1", REMEMBER_CUSTOMER
        )
        assert job is not None
        assert job["later"]  # waits until the conversation is quiet
        await conn.execute("update jobs set run_at = now() where kind = $1", REMEMBER_CUSTOMER)
        await conn.execute(
            "update conversations set last_message_at = now() - interval '1 hour' where id = $1",
            uuid.UUID(cid),
        )
    chat.replies.append(
        CustomerFacts(
            facts=[
                Fact(fact="Uses the Windows desktop app.", kind="context"),
                Fact(fact="Sync stopped working on 2026-10-14; not resolved yet.", kind="issue"),
                Fact(fact="Their password is hunter22.", kind="context"),
                Fact(fact="Card ending 4242 4242 4242 4242 on file.", kind="context"),
            ]
        )
    )
    await drain()
    detail = (await owner.get(f"/v1/memory/customers/{end_user_id}")).json()
    assert [f["fact"] for f in detail["facts"]] == [
        "Uses the Windows desktop app.",
        "Sync stopped working on 2026-10-14; not resolved yet.",
    ]  # anything that looks like a secret or card number is never kept
    assert detail["customer"]["name"] == "Ana Souza"

    guide = b"# Sync\n\n## Fix sync on Windows\n\nSign out and back in to reset sync on Windows.\n"
    upload = await owner.post("/v1/knowledge/uploads", files={"file": ("sync.md", guide)})
    assert upload.status_code == 201
    await drain()
    later = await conversation(owner, mode="identified", claims={"name": "Ana"})
    async with admin_pool.acquire() as conn:
        await conn.execute(
            "update conversations set end_user_id = $2 where id = $1", uuid.UUID(later), end_user_id
        )
    await say(owner, later, "how do I fix sync on windows")
    prompt = chat.calls[-1][-1]["content"]
    block = prompt.split("<customer_memory>\n", 1)[1].split("\n</customer_memory>", 1)[0]
    assert sorted(block.splitlines()) == [
        "- Sync stopped working on 2026-10-14; not resolved yet.",
        "- Uses the Windows desktop app.",
    ]

    assert (await owner.delete(f"/v1/memory/customers/{end_user_id}")).status_code == 204
    assert (await owner.get("/v1/memory/customers")).json() == []


async def test_recall_skips_expired_facts(owner: httpx.AsyncClient, admin_pool: Pool) -> None:
    _, end_user_id = await remembered_customer(owner, admin_pool)
    tenant_id = uuid.UUID((await owner.get("/v1/tenant")).json()["id"])
    async with admin_pool.acquire() as conn:
        for fact, expires in (("Prefers short answers.", 1), ("Old fact.", -1)):
            await conn.execute(
                """
                insert into customer_memories (id, tenant_id, end_user_id, fact, kind, expires_at)
                values ($1, $2, $3, $4, 'preference', now() + make_interval(days => $5))
                """,
                uuid.uuid4(),
                tenant_id,
                end_user_id,
                fact,
                expires,
            )
    async with admin_pool.acquire() as conn:
        assert await customers.recall(conn, end_user_id) == ["Prefers short answers."]
