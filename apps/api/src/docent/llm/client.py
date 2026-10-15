"""Structured completions from any OpenAI-compatible chat endpoint.

Providers differ in how they enforce a JSON shape, so the client has three
strategies and every one ends in the same Pydantic validation:

  json_schema  response_format with a strict JSON schema (local Ollama, most APIs)
  tool         a single function whose parameters are the schema (Ollama Cloud)
  prompt       the schema in the system prompt, for anything else

A reply that fails validation gets one repair attempt with the error shown to
the model. A second failure raises, and callers fail toward a human.
"""

import asyncio
import json
import re
import time
from dataclasses import dataclass
from typing import Any, Literal, Protocol

import httpx
from pydantic import BaseModel, ValidationError

from docent.config import Settings

Strategy = Literal["json_schema", "tool", "prompt"]
Message = dict[str, str]

_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)


class LLMError(Exception):
    """The model could not be reached or did not return a usable reply."""


@dataclass(frozen=True, slots=True)
class Structured[T: BaseModel]:
    value: T
    model: str
    tokens_in: int
    tokens_out: int
    latency_ms: int
    attempts: int


class ChatModel(Protocol):
    model: str

    async def structured[T: BaseModel](
        self, messages: list[Message], schema: type[T], *, name: str, max_tokens: int
    ) -> Structured[T]: ...


def choose_strategy(configured: str, model: str, base_url: str) -> Strategy:
    if configured != "auto":
        return configured  # type: ignore[return-value]
    if model.endswith(":cloud") or "ollama.com" in base_url:
        return "tool"  # Ollama Cloud supports tools but not structured outputs
    if "groq.com" in base_url:
        return "tool"  # strict JSON schema there rejects optional fields; tools do not
    return "json_schema"


class OpenAICompatibleChat:
    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        base_url: str,
        model: str,
        api_key: str | None,
        strategy: Strategy,
        reasoning_effort: str | None,
        timeout: float,
        max_concurrency: int,
        temperature: float = 0.1,
    ) -> None:
        self._client = client
        self._url = f"{base_url.rstrip('/')}/chat/completions"
        self._headers = {"authorization": f"Bearer {api_key}"} if api_key else {}
        self.model = model
        self._strategy = strategy
        # Most providers honor a forced tool call. Ollama answers through the tool on its
        # own and its OpenAI layer may not accept the field, so it is left out there.
        self._force_tool = not (
            model.endswith(":cloud") or "11434" in base_url or "ollama" in base_url
        )
        self._reasoning_effort = reasoning_effort
        self._timeout = timeout
        self._temperature = temperature
        self._slots = asyncio.Semaphore(max_concurrency)

    async def structured[T: BaseModel](
        self, messages: list[Message], schema: type[T], *, name: str, max_tokens: int
    ) -> Structured[T]:
        conversation = list(messages)
        tokens_in = tokens_out = 0
        started = time.perf_counter()
        for attempt in (1, 2):
            raw, used_in, used_out = await self._call(conversation, schema, name, max_tokens)
            tokens_in, tokens_out = tokens_in + used_in, tokens_out + used_out
            try:
                value = schema.model_validate_json(_json_text(raw))
            except ValidationError as exc:
                if attempt == 2:
                    raise LLMError(
                        f"reply did not match {name}: {exc.error_count()} errors"
                    ) from exc
                conversation += [
                    {"role": "assistant", "content": raw[:4000]},
                    {
                        "role": "user",
                        "content": "That reply did not match the required JSON shape: "
                        f"{_brief(exc)}. Reply again with only the corrected JSON object.",
                    },
                ]
                continue
            return Structured(
                value=value,
                model=self.model,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                latency_ms=round((time.perf_counter() - started) * 1000),
                attempts=attempt,
            )
        raise AssertionError("unreachable")

    async def _call(
        self, messages: list[Message], schema: type[BaseModel], name: str, max_tokens: int
    ) -> tuple[str, int, int]:
        json_schema = schema.model_json_schema()
        body: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": self._temperature,
            "max_tokens": max_tokens,
        }
        if self._reasoning_effort:
            body["reasoning_effort"] = self._reasoning_effort
        if self._strategy == "json_schema":
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": name, "schema": json_schema, "strict": True},
            }
        elif self._strategy == "tool":
            body["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": name,
                        "description": "Return the result.",
                        "parameters": json_schema,
                    },
                }
            ]
            if self._force_tool:
                body["tool_choice"] = {"type": "function", "function": {"name": name}}
        else:
            body["messages"] = [
                {
                    "role": "system",
                    "content": "Reply with only a JSON object matching this JSON schema: "
                    + json.dumps(json_schema),
                },
                *messages,
            ]
        try:
            async with self._slots:
                response = await self._client.post(
                    self._url, json=body, headers=self._headers, timeout=self._timeout
                )
            response.raise_for_status()
            data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise LLMError(f"chat request failed: {type(exc).__name__}: {exc}") from exc
        message = data["choices"][0]["message"]
        calls = message.get("tool_calls") or []
        raw = calls[0]["function"]["arguments"] if calls else (message.get("content") or "")
        usage = data.get("usage") or {}
        return (
            raw if isinstance(raw, str) else json.dumps(raw),
            int(usage.get("prompt_tokens", 0)),
            int(usage.get("completion_tokens", 0)),
        )


def _json_text(raw: str) -> str:
    """The JSON object in a reply, without code fences or text around it."""
    text = _FENCE.sub("", raw.strip())
    start, end = text.find("{"), text.rfind("}")
    return text[start : end + 1] if start != -1 and end > start else text


def _brief(exc: ValidationError) -> str:
    return "; ".join(
        f"{'.'.join(str(p) for p in e['loc']) or 'root'}: {e['msg']}" for e in exc.errors()[:5]
    )


def chat_model(
    settings: Settings, http: httpx.AsyncClient, model: str, *, temperature: float = 0.1
) -> OpenAICompatibleChat:
    """A client for one model. The eval judge passes temperature 0."""
    return OpenAICompatibleChat(
        http,
        base_url=settings.llm_base_url,
        model=model,
        api_key=settings.llm_api_key.get_secret_value() if settings.llm_api_key else None,
        strategy=choose_strategy(settings.llm_structured_output, model, settings.llm_base_url),
        reasoning_effort=settings.llm_reasoning_effort,
        timeout=settings.llm_timeout_seconds,
        max_concurrency=settings.llm_max_concurrency,
        temperature=temperature,
    )
