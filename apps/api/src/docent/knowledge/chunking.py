"""Split sections into passages of about 400 tokens for retrieval.

Passages never cross a section boundary, prefer paragraph then sentence breaks,
and carry a short overlap so a sentence near a break keeps its context. Token
counts are estimated at four characters per token, which is close enough for
budgeting prompts and avoids shipping a tokenizer.
"""

import math
import re
from dataclasses import dataclass

from docent.knowledge.extract import Section

TARGET_CHARS = 1600
MAX_CHARS = 2400
OVERLAP_CHARS = 240

_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


@dataclass(frozen=True, slots=True)
class Passage:
    ordinal: int
    heading_path: str
    content: str
    page: int | None

    @property
    def token_count(self) -> int:
        return math.ceil(len(self.content) / 4)


def chunk(sections: list[Section]) -> list[Passage]:
    passages: list[Passage] = []
    for section in sections:
        path = " > ".join(section.headings)
        for content in _pack(_units(section.text)):
            passages.append(Passage(len(passages), path, content, section.page))
    return passages


def _units(text: str) -> list[str]:
    """Paragraphs, with any oversized paragraph broken into sentences or hard slices."""
    units: list[str] = []
    for paragraph in (p.strip() for p in text.split("\n\n")):
        if not paragraph:
            continue
        if len(paragraph) <= MAX_CHARS:
            units.append(paragraph)
            continue
        for sentence in _SENTENCE_END.split(paragraph):
            units.extend(_slices(sentence) if len(sentence) > MAX_CHARS else [sentence])
    return units


def _slices(text: str) -> list[str]:
    out: list[str] = []
    while len(text) > MAX_CHARS:
        cut = text.rfind(" ", 0, MAX_CHARS)
        cut = cut if cut > MAX_CHARS // 2 else MAX_CHARS
        out.append(text[:cut].strip())
        text = text[cut:].strip()
    if text:
        out.append(text)
    return out


def _pack(units: list[str]) -> list[str]:
    chunks: list[str] = []
    current = ""
    for unit in units:
        candidate = f"{current}\n\n{unit}" if current else unit
        if len(candidate) <= TARGET_CHARS or not current:
            current = candidate
            continue
        chunks.append(current)
        current = f"{_tail(current)}\n\n{unit}"
        if len(current) > MAX_CHARS:
            current = unit
    if current:
        chunks.append(current)
    return chunks


def _tail(text: str) -> str:
    """The last few sentences of a chunk, up to OVERLAP_CHARS, cut at a word boundary."""
    if len(text) <= OVERLAP_CHARS:
        return text
    tail = text[-OVERLAP_CHARS:]
    sentence = _SENTENCE_END.search(tail)
    if sentence:
        return tail[sentence.end() :]
    space = tail.find(" ")
    return tail[space + 1 :] if space != -1 else tail
