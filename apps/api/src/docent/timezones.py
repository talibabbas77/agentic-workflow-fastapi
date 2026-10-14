"""Time zones a workspace can pick: IANA names from the system's time zone database.

The list keeps the canonical "Area/City" names (Europe/Berlin, America/New_York)
plus UTC, and leaves out legacy aliases such as US/Eastern or Etc/GMT+5. A zone
that no longer loads (the database changed under a stored name) falls back to
UTC rather than failing the caller.
"""

from datetime import UTC, tzinfo
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

DEFAULT = "UTC"
_AREAS = (
    "Africa/",
    "America/",
    "Antarctica/",
    "Arctic/",
    "Asia/",
    "Atlantic/",
    "Australia/",
    "Europe/",
    "Indian/",
    "Pacific/",
)


@lru_cache(maxsize=1)
def known_timezones() -> frozenset[str]:
    return frozenset({DEFAULT, *(z for z in available_timezones() if z.startswith(_AREAS))})


def timezone_names() -> list[str]:
    """UTC first, then every other zone in alphabetical order."""
    return [DEFAULT, *sorted(known_timezones() - {DEFAULT})]


def zone(name: str | None) -> tzinfo:
    if not name or name == DEFAULT:
        return UTC
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError, ValueError:
        return UTC
