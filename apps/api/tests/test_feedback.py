"""Was this helpful? Votes from the widget and where they count: ownership and limits,
the inbox transcript, production metrics, the weekly review, and Add to eval set."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from docent.db.pool import Pool
from docent.ids import new_id
from tests.conftest import ClientFactory, Drain, verified_owner
from tests.inbox_helpers import tid
from tests.test_evals import VISITOR, answer, insert_conversation, made
from tests.test_widget import (
    WIDGET_ORIGIN,
    Tenant,
    anonymous,
    ask,
    identified,
    make_tenant,
    start,
)

QUESTION = "how are annual plans refunded"


@pytest.fixture
async def tenant(client_factory: ClientFactory, drain: Drain) -> Tenant:
    return await make_tenant(client_factory, drain)


@pytest.fixture
def frame(client_factory: ClientFactory) -> httpx.AsyncClient:
    return client_factory(origin=WIDGET_ORIGIN)


def vote_url(conversation_id: str, message_id: str) -> str:
    return f"/v1/widget/conversations/{conversation_id}/messages/{message_id}/feedback"


async def read(
    frame: httpx.AsyncClient, headers: dict[str, str], conversation_id: str
) -> dict[str, Any]:
    response = await frame.get(f"/v1/widget/conversations/{conversation_id}", headers=headers)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


async def answered(
    frame: httpx.AsyncClient, headers: dict[str, str], text: str = QUESTION
) -> tuple[dict[str, Any], dict[str, Any]]:
    """A conversation with one answer from the agent. Returns it and the answer."""
    conversation = await start(frame, headers)
    await ask(frame, headers, conversation, text)
    body = await read(frame, headers, conversation["id"])
    reply = body["messages"][-1]
    assert (reply["role"], reply["decision"]["type"]) == ("agent", "answer"), reply
    return body, reply


async def test_one_vote_per_answer_that_can_change_and_comes_back(
    frame: httpx.AsyncClient, tenant: Tenant, admin_pool: Pool
) -> None:
    sam = await identified(frame, tenant)
    conversation, reply = await answered(frame, sam)
    assert reply["feedback"] is None
    url = vote_url(conversation["id"], reply["id"])

    up = await frame.put(
        url, json={"vote": "up", "comment": "kept only with a thumbs down"}, headers=sam
    )
    assert up.status_code == 200, up.text
    assert (up.json()["vote"], up.json()["comment"]) == ("up", "")
    down = await frame.put(
        url, json={"vote": "down", "comment": "  The refund window is wrong. "}, headers=sam
    )
    assert (down.json()["vote"], down.json()["comment"]) == ("down", "The refund window is wrong.")
    async with admin_pool.acquire() as conn:
        rows = await conn.fetch(
            "select vote, comment, end_user_id, visitor_id from message_feedback"
        )
    assert len(rows) == 1  # changed, never a second vote
    assert (rows[0]["vote"], rows[0]["end_user_id"] is not None, rows[0]["visitor_id"]) == (
        "down",
        True,
        None,
    )

    # The widget gets the vote back with the conversation, for history and recent chats.
    again = await read(frame, sam, conversation["id"])
    assert again["messages"][-1]["feedback"]["vote"] == "down"
    assert again["messages"][-1]["feedback"]["comment"] == "The refund window is wrong."

    too_long = await frame.put(url, json={"vote": "down", "comment": "x" * 501}, headers=sam)
    assert too_long.status_code == 422
    assert (await frame.put(url, json={"vote": "meh"}, headers=sam)).status_code == 422
    assert (await frame.put(url, json={"vote": "up", "extra": 1}, headers=sam)).status_code == 422

    assert (await frame.delete(url, headers=sam)).status_code == 204
    assert (await read(frame, sam, conversation["id"]))["messages"][-1]["feedback"] is None
    assert (await frame.delete(url, headers=sam)).status_code == 204  # nothing left: still fine


async def test_only_answers_in_your_own_conversations_can_be_rated(
    frame: httpx.AsyncClient, tenant: Tenant
) -> None:
    sam = await identified(frame, tenant)
    conversation, reply = await answered(frame, sam)
    url = vote_url(conversation["id"], reply["id"])
    vote = {"vote": "down"}

    # Another customer, and an anonymous visitor, of the same widget: not theirs.
    ana = await identified(frame, tenant, sub="user_ana")
    visitor = await anonymous(frame, tenant)
    for headers in (ana, visitor):
        stolen = await frame.put(url, json=vote, headers=headers)
        assert stolen.status_code == 404
        assert (await frame.delete(url, headers=headers)).status_code == 404
    # Ana's own conversation with Sam's answer in the path: the answer is not in it.
    hers = await start(frame, ana)
    mixed = await frame.put(vote_url(hers["id"], reply["id"]), json=vote, headers=ana)
    assert mixed.status_code == 404

    # Only answers: not the visitor's own message, a handoff, or a message that does not exist.
    asked = next(m for m in conversation["messages"] if m["role"] == "visitor")
    mine = await frame.put(vote_url(conversation["id"], asked["id"]), json=vote, headers=sam)
    assert (mine.status_code, mine.json()["error"]["code"]) == (422, "not_an_answer")
    await ask(frame, sam, conversation, "talk to a human please")
    handed = (await read(frame, sam, conversation["id"]))["messages"][-1]
    assert handed["decision"]["type"] == "escalate"
    escalate = await frame.put(vote_url(conversation["id"], handed["id"]), json=vote, headers=sam)
    assert escalate.status_code == 422
    missing = await frame.put(
        vote_url(conversation["id"], str(uuid.uuid4())), json=vote, headers=sam
    )
    assert missing.status_code == 404
    assert (await frame.put(url, json=vote)).status_code == 401  # no session at all


async def test_votes_never_cross_workspaces(
    frame: httpx.AsyncClient, tenant: Tenant, client_factory: ClientFactory, drain: Drain
) -> None:
    sam = await identified(frame, tenant)
    conversation, reply = await answered(frame, sam)
    other = await make_tenant(client_factory, drain, "Parcelwise")
    theirs = await identified(frame, other)  # same customer id, another company
    response = await frame.put(
        vote_url(conversation["id"], reply["id"]), json={"vote": "up"}, headers=theirs
    )
    assert response.status_code == 404
    assert (await read(frame, sam, conversation["id"]))["messages"][-1]["feedback"] is None


async def test_votes_are_rate_limited_like_messages(
    frame: httpx.AsyncClient, tenant: Tenant, app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(app.state.docent.settings, "widget_feedback_per_hour", 3)
    sam = await identified(frame, tenant)
    conversation, reply = await answered(frame, sam)
    url = vote_url(conversation["id"], reply["id"])
    codes = [
        (await frame.put(url, json={"vote": v}, headers=sam)).status_code
        for v in ("up", "down", "up", "down")
    ]
    assert codes == [200, 200, 200, 429]  # per customer
    # Anonymous visitors share a limit per address, across their sessions.
    first, second = await anonymous(frame, tenant), await anonymous(frame, tenant)
    a_conversation, a_reply = await answered(frame, first)
    b_conversation, b_reply = await answered(frame, second)
    a_url = vote_url(a_conversation["id"], a_reply["id"])
    b_url = vote_url(b_conversation["id"], b_reply["id"])
    assert (await frame.put(a_url, json={"vote": "up"}, headers=first)).status_code == 200
    assert (await frame.put(a_url, json={"vote": "down"}, headers=first)).status_code == 200
    assert (await frame.put(b_url, json={"vote": "up"}, headers=second)).status_code == 200
    limited = await frame.put(b_url, json={"vote": "down"}, headers=second)
    assert limited.status_code == 429
    assert limited.headers.get("retry-after")


async def test_the_inbox_transcript_shows_the_customers_vote(
    frame: httpx.AsyncClient, tenant: Tenant, drain: Drain
) -> None:
    visitor = await anonymous(frame, tenant)
    conversation, reply = await answered(frame, visitor)
    comment = "It says 30 days but my plan is monthly."
    voted = await frame.put(
        vote_url(conversation["id"], reply["id"]),
        json={"vote": "down", "comment": comment},
        headers=visitor,
    )
    assert voted.status_code == 200
    await ask(frame, visitor, conversation, "talk to a human")
    await drain()
    item = (await tenant.admin.get("/v1/inbox")).json()["items"][0]
    detail = (await tenant.admin.get(f"/v1/inbox/{item['id']}")).json()
    rated = next(m for m in detail["messages"] if m["id"] == reply["id"])
    assert (rated["feedback"]["vote"], rated["feedback"]["comment"]) == ("down", comment)
    assert all(m["feedback"] is None for m in detail["messages"] if m["id"] != reply["id"])
    # A thumbs down counts as a wrong answer in the inbox numbers too.
    stats = (await tenant.admin.get("/v1/inbox/stats")).json()
    assert (stats["answers_30d"], stats["wrong_answers_30d"]) == (1, 1)

    # Add to eval set from that answer: tagged, and the visitor's note is not copied in.
    filled = await tenant.admin.get(
        "/v1/evals/prefill",
        params={"conversation_id": conversation["id"], "message_id": reply["id"]},
    )
    assert filled.status_code == 200, filled.text
    assert (filled.json()["tags"], filled.json()["reference_answer"]) == (["thumbs down"], "")
    assert filled.json()["question"] == QUESTION


async def insert_vote(
    conn: Any, tenant_id: uuid.UUID, conversation_id: uuid.UUID, message_id: uuid.UUID, vote: str
) -> None:
    await conn.execute(
        """
        insert into message_feedback (id, tenant_id, conversation_id, message_id, vote, comment)
        values ($1, $2, $3, $4, $5, $6)
        """,
        new_id(),
        tenant_id,
        conversation_id,
        message_id,
        vote,
        "Not what I asked." if vote == "down" else "",
    )


async def test_votes_count_in_production_metrics(
    client_factory: ClientFactory, drain: Drain, admin_pool: Pool
) -> None:
    owner = client_factory()
    tenant_id = tid(await verified_owner(owner, drain, "Lumen Notes"))
    now = datetime.now(UTC)
    day = timedelta(days=1)
    async with admin_pool.acquire() as conn:
        # Thumbs up, quiet, no handoff: resolved automatically and confirmed.
        c1, m1 = await insert_conversation(conn, tenant_id, now - day, [VISITOR, answer()])
        await insert_vote(conn, tenant_id, c1, m1[1], "up")
        # Thumbs down: a wrong answer, and not resolved.
        c2, m2 = await insert_conversation(conn, tenant_id, now - day, [VISITOR, answer()])
        await insert_vote(conn, tenant_id, c2, m2[1], "down")
        # Marked wrong by the team and voted down: one wrong answer, not two.
        c3, m3 = await insert_conversation(
            conn, tenant_id, now - 2 * day, [VISITOR, answer(flagged_wrong=True)]
        )
        await insert_vote(conn, tenant_id, c3, m3[1], "down")
        # Up on the first answer, down on the second: not confirmed.
        c4, m4 = await insert_conversation(
            conn, tenant_id, now - 2 * day, [VISITOR, answer(), VISITOR, answer()]
        )
        await insert_vote(conn, tenant_id, c4, m4[1], "up")
        await insert_vote(conn, tenant_id, c4, m4[3], "down")
        # Up, then a handoff: not confirmed.
        c5, m5 = await insert_conversation(
            conn,
            tenant_id,
            now - 3 * day,
            [VISITOR, answer(), VISITOR, ("agent", made("escalate", reason="user_requested"), {})],
            escalation="user_requested",
        )
        await insert_vote(conn, tenant_id, c5, m5[1], "up")
        # No votes, graded right in the weekly review: confirmed.
        c6, m6 = await insert_conversation(conn, tenant_id, now - 3 * day, [VISITOR, answer()])
        await conn.execute(
            """
            insert into review_items (id, tenant_id, week_start, conversation_id, message_id,
                                      grade, graded_at)
            values ($1, $2, current_date, $3, $4, 'right', now())
            """,
            new_id(),
            tenant_id,
            c6,
            m6[1],
        )
        hand = await conn.fetchrow(
            """
            with traffic as (
              select c.id from conversations c
              where c.tenant_id = $1 and c.channel = 'widget' and c.started_at >= $2
            ), answers as (
              select m.id, m.flagged_wrong, f.vote from messages m
              left join message_feedback f on f.message_id = m.id
              where m.conversation_id in (select id from traffic)
                and m.role = 'agent' and m.decision ->> 'type' = 'answer'
            )
            select
              (select count(*) from answers) as answers,
              (select count(*) from answers where vote = 'up') as voted_up,
              (select count(*) from answers where vote = 'down') as voted_down,
              (select count(*) from answers where flagged_wrong) as marked_wrong,
              (select count(*) from answers where flagged_wrong or vote = 'down') as wrong,
              (select count(*) from traffic t where
                 exists (select 1 from review_items r
                         where r.conversation_id = t.id and r.grade = 'right')
                 or (exists (select 1 from message_feedback f
                             where f.conversation_id = t.id and f.vote = 'up')
                     and not exists (select 1 from message_feedback f
                                     where f.conversation_id = t.id and f.vote = 'down')
                     and not exists (select 1 from escalations e
                                     where e.conversation_id = t.id))) as confirmed
            """,
            tenant_id,
            now - 30 * day,
        )
    assert hand is not None
    m = (await owner.get("/v1/evals/metrics", params={"days": 30})).json()
    assert m["conversations"] == 6
    assert m["answers"] == hand["answers"] == 7
    assert (m["voted_up"], m["voted_down"]) == (hand["voted_up"], hand["voted_down"]) == (3, 3)
    assert m["marked_wrong"] == hand["marked_wrong"] == 1
    assert m["wrong_answers"] == hand["wrong"] == 3
    assert m["wrong_answer_rate"] == round(3 / 7, 4)
    assert m["confirmed_resolved"] == hand["confirmed"] == 2  # c1 by thumbs up, c6 by review
    assert m["auto_resolved"] == 2  # c1 and c6: the thumbs down and the flag keep the rest out
    assert m["confirmed_resolution_rate"] == round(2 / 6, 4)


async def test_the_weekly_review_samples_rated_answers_first(
    client_factory: ClientFactory, drain: Drain, admin_pool: Pool
) -> None:
    owner = client_factory()
    tenant_id = tid(await verified_owner(owner, drain, "Lumen Notes"))
    now = datetime.now(UTC)
    rated: dict[uuid.UUID, uuid.UUID] = {}
    async with admin_pool.acquire() as conn:
        for i in range(25):  # more unrated answers than the sample holds
            await insert_conversation(
                conn, tenant_id, now - timedelta(minutes=i + 10), [VISITOR, answer()]
            )
        for i, vote in enumerate(("down", "down", "up")):
            # Two answers; the earlier one is rated, so it is the one graded.
            conversation_id, ids = await insert_conversation(
                conn,
                tenant_id,
                now - timedelta(hours=i + 1),
                [VISITOR, answer(), VISITOR, answer()],
            )
            await insert_vote(conn, tenant_id, conversation_id, ids[1], vote)
            rated[conversation_id] = ids[1]
    queue = (await owner.get("/v1/evals/review")).json()
    assert len(queue["items"]) == 20
    sampled = {uuid.UUID(i["conversation_id"]): i for i in queue["items"]}
    assert rated.keys() <= sampled.keys()
    for conversation_id, message_id in rated.items():
        item = sampled[conversation_id]
        assert item["message_id"] == str(message_id)
        assert item["feedback"]["vote"] in ("up", "down")
    downs = [i for i in queue["items"] if i["feedback"] and i["feedback"]["vote"] == "down"]
    assert downs[0]["feedback"]["comment"] == "Not what I asked."
