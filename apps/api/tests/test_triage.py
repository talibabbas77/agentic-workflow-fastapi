"""Rule-based triage: conversation is recognized without a model, real questions never are."""

import pytest

from docent.agent.prompts import AgentProfile
from docent.agent.triage import Detected, detect, reply

PROFILE = AgentProfile(
    company="Lumen Notes", agent_name="Lumen helper", tone="friendly", restricted_topics=()
)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("hi", Detected("greeting", "en")),
        ("Hello there!", Detected("greeting", "en")),
        ("hey Lumen Notes", Detected("greeting", "en")),
        ("Good morning! What can you do?", Detected("about", "en")),
        ("who are you", Detected("about", "en")),
        ("Are you a real person?", Detected("about", "en")),
        ("Assalam o Alaikum", Detected("greeting", "en")),
        ("Buenos días", Detected("greeting", "es")),
        ("Olá", Detected("greeting", "pt")),
        ("مرحبا", Detected("greeting", "ar")),
        ("Thanks a lot!", Detected("thanks", "en")),
        ("great, thank you", Detected("thanks", "en")),
        ("Danke schön", Detected("thanks", "de")),
        ("that's all", Detected("goodbye", "en")),
        ("ok", Detected("ack", "en")),
    ],
)
def test_conversation_is_recognized(text: str, expected: Detected) -> None:
    assert detect(text, PROFILE) == expected


@pytest.mark.parametrize(
    "text",
    [
        "hi, how do I export my notes?",
        "hello I was charged twice",
        "thanks but the export still fails",
        "who are your competitors",
        "ok so how many devices on free",
        "hi " * 40,
        "",
    ],
)
def test_real_questions_are_never_small_talk(text: str) -> None:
    assert detect(text, PROFILE) is None


def test_replies_use_the_agent_name_language_and_tone() -> None:
    assert reply("about", "fr", PROFILE).startswith("Je suis Lumen helper, un assistant IA")
    assert reply("greeting", "xx", PROFILE).startswith("Hi! I'm Lumen helper")
    formal = AgentProfile(
        company="Lumen Notes", agent_name="Lumen helper", tone="formal", restricted_topics=()
    )
    assert reply("greeting", "en", formal).startswith("Hello. I'm Lumen helper")


def test_the_default_agent_name_is_not_repeated() -> None:
    unnamed = AgentProfile(
        company="Lumen Notes",
        agent_name="Lumen Notes assistant",
        tone="friendly",
        restricted_topics=(),
    )
    assert reply("greeting", "en", unnamed).startswith("Hi! I'm the Lumen Notes assistant. Ask")
    assert reply("about", "en", unnamed).startswith("I'm an AI assistant for Lumen Notes.")
    assert reply("greeting", "fr", unnamed).startswith(
        "Bonjour ! Je suis l'assistant de Lumen Notes."
    )
    for lang in ("es", "de", "pt", "it", "ar"):
        for kind in ("greeting", "about"):
            assert "Lumen Notes assistant" not in reply(kind, lang, unnamed)
