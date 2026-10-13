"""Fetching customer-supplied URLs without opening a path into our own network.

Every TCP connection, including each redirect hop, resolves the host itself and
connects only if every address is public. Connecting to the vetted IP closes
the gap between checking DNS and connecting (DNS rebinding). TLS still verifies
the certificate against the original hostname.
"""

import ipaddress
import socket
import urllib.robotparser
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin, urlsplit

import anyio
import httpcore
import httpx

ALLOWED_SCHEMES = {"http", "https"}


class FetchError(Exception):
    """A URL could not be fetched for a reason retrying will not fix."""


def is_public_address(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def check_url(url: str) -> str:
    """Validate the shape of a URL a user typed. Address checks happen at connect time."""
    parts = urlsplit(url.strip())
    if parts.scheme not in ALLOWED_SCHEMES:
        raise FetchError("Use an http or https URL.")
    if not parts.hostname:
        raise FetchError("The URL has no host.")
    if parts.username or parts.password:
        raise FetchError("URLs with a user name or password are not allowed.")
    if len(url) > 2048:
        raise FetchError("The URL is too long.")
    return parts.geturl()


class _GuardedBackend(httpcore.AsyncNetworkBackend):
    def __init__(self, allow_private: bool) -> None:
        self._inner = httpcore.AnyIOBackend()
        self._allow_private = allow_private

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Iterable[Any] | None = None,
    ) -> httpcore.AsyncNetworkStream:
        try:
            infos = await anyio.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except OSError as exc:
            raise httpcore.ConnectError(f"could not resolve {host}") from exc
        addresses = list(dict.fromkeys(str(info[4][0]) for info in infos))
        if not self._allow_private and not all(is_public_address(a) for a in addresses):
            raise httpcore.ConnectError(f"{host} resolves to a private address")
        last_error: Exception | None = None
        for address in addresses:
            try:
                return await self._inner.connect_tcp(
                    address, port, timeout, local_address, socket_options
                )
            except httpcore.ConnectError as exc:
                last_error = exc
        raise httpcore.ConnectError(f"could not connect to {host}") from last_error

    async def connect_unix_socket(
        self, path: str, timeout: float | None = None, socket_options: Iterable[Any] | None = None
    ) -> httpcore.AsyncNetworkStream:
        raise httpcore.ConnectError("unix sockets are not allowed")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


def guarded_client(
    *, user_agent: str, timeout: float, allow_private: bool = False
) -> httpx.AsyncClient:
    transport = httpx.AsyncHTTPTransport(retries=0)
    # httpx does not expose the network backend, so swap the pool for one that
    # uses the guarded backend. Covered by tests in test_fetch.py.
    transport._pool = httpcore.AsyncConnectionPool(
        ssl_context=httpx.create_ssl_context(),
        max_connections=10,
        keepalive_expiry=5.0,
        network_backend=_GuardedBackend(allow_private),
    )
    return httpx.AsyncClient(
        transport=transport,
        timeout=timeout,
        follow_redirects=True,
        max_redirects=5,
        trust_env=False,  # never route through environment proxies
        headers={"user-agent": user_agent},
    )


@dataclass(frozen=True, slots=True)
class Fetched:
    url: str  # final URL after redirects
    content_type: str
    body: bytes


async def fetch(client: httpx.AsyncClient, url: str, *, max_bytes: int) -> Fetched:
    try:
        async with client.stream("GET", check_url(url)) as response:
            if response.status_code in (404, 410):
                raise FetchError(f"Page not found ({response.status_code}).")
            if response.status_code >= 400:
                raise httpx.HTTPStatusError(
                    f"HTTP {response.status_code}", request=response.request, response=response
                )
            body = bytearray()
            async for part in response.aiter_bytes():
                body.extend(part)
                if len(body) > max_bytes:
                    raise FetchError(f"Page is larger than {max_bytes // 1_000_000} MB.")
            content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
            return Fetched(str(response.url), content_type, bytes(body))
    except httpx.ConnectError as exc:
        if "private address" in str(exc):
            raise FetchError("That address is not reachable from Docent.") from exc
        raise


class RobotsRules:
    """robots.txt rules per host, fetched once per crawl."""

    def __init__(self, client: httpx.AsyncClient, user_agent: str) -> None:
        self._client = client
        self._agent = user_agent.split("/")[0]
        self._parsers: dict[str, urllib.robotparser.RobotFileParser] = {}

    async def allowed(self, url: str) -> bool:
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        parser = self._parsers.get(origin)
        if parser is None:
            parser = urllib.robotparser.RobotFileParser()
            try:
                robots = await fetch(
                    self._client, urljoin(origin, "/robots.txt"), max_bytes=500_000
                )
                parser.parse(robots.body.decode("utf-8", "replace").splitlines())
            except FetchError, httpx.HTTPError:
                parser.parse([])  # no robots.txt means everything is allowed
            self._parsers[origin] = parser
        return parser.can_fetch(self._agent, url)


def same_site(a: str, b: str) -> bool:
    def host(url: str) -> str:
        name = (urlsplit(url).hostname or "").lower()
        return name.removeprefix("www.")

    return host(a) == host(b)
