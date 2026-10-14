"""Read a PDF or Word file in a separate process with CPU, memory, and time limits.

Parsers for these formats run arbitrary amounts of work on hostile input (a zip
that expands to gigabytes, a PDF with pathological streams). Running them in a
child process means a bad file fails that one document, never the worker that
also sends email and runs the other jobs. Text, Markdown, and HTML are cheap and
bounded by the upload size, so they stay in process.

The parent writes a 4 byte header length, a JSON header (mime, title, limits),
then the file bytes to the child's stdin, and reads one JSON result back.
"""

import asyncio
import contextlib
import json
import logging
import resource
import sys
from typing import Any

from docent.knowledge.extract import DOCX, Extracted, Section, UnsupportedDocument, extract

log = logging.getLogger(__name__)

ISOLATED_MIMES = frozenset({"application/pdf", DOCX})


async def extract_isolated(
    data: bytes, mime: str, title: str, *, seconds: float, memory_mb: int
) -> Extracted:
    """extract(), in a child process for the formats whose parsers can be abused."""
    if mime not in ISOLATED_MIMES:
        return await asyncio.to_thread(extract, data, mime, title)
    header = json.dumps(
        {"mime": mime, "title": title, "memory_mb": memory_mb, "cpu_seconds": int(seconds)}
    ).encode()
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "docent.knowledge.isolated",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(
            process.communicate(len(header).to_bytes(4, "big") + header + data), seconds
        )
    except TimeoutError:
        process.kill()
        await process.wait()
        raise UnsupportedDocument(
            "This file took too long to read. Split it into smaller files."
        ) from None
    if process.returncode != 0 or not out:
        log.warning(
            "document extraction process failed",
            extra={"returncode": process.returncode, "stderr": err.decode(errors="replace")[-500:]},
        )
        raise UnsupportedDocument("This file is too large or complex to read. Split it into parts.")
    result: dict[str, Any] = json.loads(out)
    if "error" in result:
        raise UnsupportedDocument(str(result["error"]))
    return Extracted(
        title=result["title"],
        sections=[
            Section(tuple(s["headings"]), s["text"], page=s["page"]) for s in result["sections"]
        ],
        page_count=result["page_count"],
    )


def _limit(memory_mb: int, cpu_seconds: int) -> None:
    """Best effort: Linux honors the address space limit; every platform honors CPU time."""
    for kind, value in (
        (resource.RLIMIT_AS, memory_mb * 1024 * 1024),
        (resource.RLIMIT_CPU, max(cpu_seconds, 1)),
    ):
        with contextlib.suppress(ValueError, OSError):
            resource.setrlimit(kind, (value, value))


def main() -> None:
    stdin = sys.stdin.buffer
    header = json.loads(stdin.read(int.from_bytes(stdin.read(4), "big")))
    _limit(int(header["memory_mb"]), int(header["cpu_seconds"]))
    data = stdin.read()
    try:
        extracted = extract(data, header["mime"], header["title"])
    except UnsupportedDocument as exc:
        result: dict[str, Any] = {"error": str(exc)}
    else:
        result = {
            "title": extracted.title,
            "page_count": extracted.page_count,
            "sections": [
                {"headings": list(s.headings), "text": s.text, "page": s.page}
                for s in extracted.sections
            ],
        }
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
