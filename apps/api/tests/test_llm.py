"""The provider-neutral chat client: strategies, validation, repair, concurrency."""

import asyncio
import json
from typing import Any

import httpx
import pytest

from docent.agent.prompts import AgentDecision
from docent.llm.client import LLMError, OpenAICompatibleChat, choose_strategy

VALID = {
    "type": "answer",
    "answer": "Yes [1].",
    "citations": [1],
    "account_facts": [],
    "confidence": "high",
    "escalation_reason": None,
}


def client_for(
    replies: list[dict[str, Any]],
    seen: list[dict[str, Any]],
    strategy: str = "json_schema",
    concurrency: int = 2,
) -> OpenAICompatibleChat:
    async def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body)
        return httpx.Response(200, json=replies.pop(0))

    return OpenAICompatibleChat(
        httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        base_url="http://llm.test/v1",
        model="m",
        api_key="secret",
        strategy=strategy,  # type: ignore[arg-type]
        reasoning_effort="none",
        timeout=5,
        max_concurrency=concurrency,
    )


def content(text: str, prompt: int = 50, completion: int = 10) -> dict[str, Any]:
    return {
        "choices": [{"message": {"content": text}}],
        "usage": {"prompt_tokens": prompt, "completion_tokens": completion},
    }


async def test_json_schema_strategy_sends_strict_schema() -> None:
    seen: list[dict[str, Any]] = []
    client = client_for([content(json.dumps(VALID))], seen)
    result = await client.structured(
        [{"role": "user", "content": "q"}], AgentDecision, name="d", max_tokens=100
    )
    assert result.value.citations == [1]
    assert result.tokens_in == 50
    assert result.attempts == 1
    sent = seen[0]
    assert sent["response_format"]["json_schema"]["strict"] is True
    assert sent["reasoning_effort"] == "none"
    assert "tools" not in sent


async def test_tool_strategy_reads_function_arguments() -> None:
    seen: list[dict[str, Any]] = []
    reply = {
        "choices": [
            {
                "message": {
                    "content": "",
                    "tool_calls": [{"function": {"name": "d", "arguments": json.dumps(VALID)}}],
                }
            }
        ],
        "usage": {},
    }
    client = client_for([reply], seen, strategy="tool")
    result = await client.structured(
        [{"role": "user", "content": "q"}], AgentDecision, name="d", max_tokens=100
    )
    assert result.value.type == "answer"
    assert seen[0]["tools"][0]["function"]["name"] == "d"
    assert "response_format" not in seen[0]


async def test_prompt_strategy_extracts_json_from_fenced_text() -> None:
    seen: list[dict[str, Any]] = []
    fenced = "Sure.\n```json\n" + json.dumps(VALID) + "\n```"
    client = client_for([content(fenced)], seen, strategy="prompt")
    result = await client.structured(
        [{"role": "user", "content": "q"}], AgentDecision, name="d", max_tokens=100
    )
    assert result.value.answer == "Yes [1]."
    assert seen[0]["messages"][0]["role"] == "system"
    assert "JSON schema" in seen[0]["messages"][0]["content"]


async def test_invalid_reply_gets_one_repair_with_the_error() -> None:
    seen: list[dict[str, Any]] = []
    bad = {**VALID, "confidence": "certain"}
    client = client_for([content(json.dumps(bad)), content(json.dumps(VALID))], seen)
    result = await client.structured(
        [{"role": "user", "content": "q"}], AgentDecision, name="d", max_tokens=100
    )
    assert result.attempts == 2
    assert result.tokens_in == 100  # both attempts are billed
    repair = seen[1]["messages"][-1]["content"]
    assert "confidence" in repair
    assert seen[1]["messages"][-2]["role"] == "assistant"


async def test_two_invalid_replies_raise() -> None:
    client = client_for([content("not json"), content("{}")], [])
    with pytest.raises(LLMError, match="did not match"):
        await client.structured(
            [{"role": "user", "content": "q"}], AgentDecision, name="d", max_tokens=100
        )


async def test_transport_errors_become_llm_errors() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"error": "busy"})

    client = OpenAICompatibleChat(
        httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        base_url="http://llm.test/v1",
        model="m",
        api_key=None,
        strategy="json_schema",
        reasoning_effort=None,
        timeout=5,
        max_concurrency=1,
    )
    with pytest.raises(LLMError, match="chat request failed"):
        await client.structured(
            [{"role": "user", "content": "q"}], AgentDecision, name="d", max_tokens=10
        )


async def test_concurrency_is_capped() -> None:
    active = peak = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.02)
        active -= 1
        return httpx.Response(200, json=content(json.dumps(VALID)))

    client = OpenAICompatibleChat(
        httpx.AsyncClient(transport=httpx.MockTransport(handler)),
        base_url="http://llm.test/v1",
        model="m",
        api_key=None,
        strategy="json_schema",
        reasoning_effort=None,
        timeout=5,
        max_concurrency=2,
    )
    await asyncio.gather(
        *(
            client.structured(
                [{"role": "user", "content": "q"}], AgentDecision, name="d", max_tokens=10
            )
            for _ in range(6)
        )
    )
    assert peak == 2


def test_strategy_auto_selection() -> None:
    assert choose_strategy("auto", "qwen3:1.7b", "http://127.0.0.1:11434/v1") == "json_schema"
    assert choose_strategy("auto", "gemma4:cloud", "http://127.0.0.1:11434/v1") == "tool"
    assert choose_strategy("auto", "gemma4:31b", "https://ollama.com/v1") == "tool"
    assert choose_strategy("prompt", "anything", "http://x") == "prompt"
