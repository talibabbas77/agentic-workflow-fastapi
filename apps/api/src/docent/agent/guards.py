"""Deterministic checks around the model: before it runs, and on what it returns.

Requests for a person and restricted topics are caught by rules first, so they
escalate instantly and cost nothing. The model is the second line, not the only one.
"""

import re
from collections.abc import Iterable

# "Let me talk to a person" in the languages customers most often write in.
_HUMAN = re.compile(
    "|".join(
        [
            # English
            r"\b(talk|speak|chat|connect me)\s+(to|with)\s+(a\s+|an\s+|some\s*one|the\s+)?"
            r"(human|person|people|agent|representative|rep|operator|someone|real\s+person|"
            r"staff|support\s+team|manager)\b",
            r"\b(real|live|actual)\s+(human|person|agent|support)\b",
            r"\bhuman\s+(agent|support|being|please)\b",
            r"\b(customer\s+service|support)\s+(agent|representative|person)\b",
            r"^\s*(agent|human|representative|operator|a\s+human|a\s+person)\s*[.!?]*\s*$",
            r"\bnot\s+a\s+(bot|robot)\b",
            # Spanish
            r"\bhablar\s+con\s+(una\s+persona|un\s+humano|un\s+agente|alguien|un\s+asesor)\b",
            r"\b(persona|agente)\s+real\b",
            # Portuguese
            r"\bfalar\s+com\s+(uma\s+pessoa|um\s+humano|um\s+atendente|algu[eé]m)\b",
            # French
            r"\bparler\s+(à|a|avec)\s+(un\s+humain|une\s+personne|un\s+agent|quelqu'un|un\s+conseiller)\b",
            # German
            r"\b(mit\s+einem\s+(menschen|mitarbeiter|berater)|echten\s+person)\b",
            # Italian
            r"\bparlare\s+con\s+(una\s+persona|un\s+operatore|un\s+umano)\b",
            # Urdu and Hindi, romanized
            r"\b(insaan|insan|banday|bande|kisi\s+insaan)\s+se\s+baat\b",
            # Arabic
            r"(موظف|شخص\s+حقيقي|التحدث\s+مع\s+شخص|انسان)",
        ]
    ),
    re.IGNORECASE,
)

# Platform defaults. Tenants add their own topics in the agent settings.
DEFAULT_RESTRICTED = (
    "lawyer",
    "attorney",
    "lawsuit",
    "sue you",
    "legal action",
    "chargeback",
    "dispute the charge",
    "fraudulent charge",
    "was hacked",
    "been hacked",
    "data breach",
    "data leak",
    "stolen card",
    "delete my account",
    "close my account",
    "erase my data",
    "gdpr request",
    "kill myself",
    "suicide",
    "self harm",
)

_URL = re.compile(r"https?://[^\s<>()\[\]\"']+", re.IGNORECASE)
_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_MARKER = re.compile(r"\[(\d{1,2})\]")


def asks_for_human(text: str) -> bool:
    return bool(_HUMAN.search(text))


def restricted_topic(text: str, tenant_topics: Iterable[str]) -> str | None:
    lowered = f" {text.lower()} "
    for topic in (*DEFAULT_RESTRICTED, *tenant_topics):
        needle = topic.strip().lower()
        if needle and re.search(rf"(?<!\w){re.escape(needle)}(?!\w)", lowered):
            return needle
    return None


def markers(text: str) -> set[int]:
    return {int(m) for m in _MARKER.findall(text)}


def strip_untrusted_links(text: str, allowed: Iterable[str]) -> str:
    """Remove images and any link that is not one of the cited sources' own URLs."""
    allowed_urls = {u.rstrip("/") for u in allowed if u}
    text = _IMAGE.sub("", text)

    def keep(match: re.Match[str]) -> str:
        url = match.group(0).rstrip(".,;:")
        trailing = match.group(0)[len(url) :]
        return match.group(0) if url.rstrip("/") in allowed_urls else trailing

    return re.sub(r"[ \t]{2,}", " ", _URL.sub(keep, text)).strip()
