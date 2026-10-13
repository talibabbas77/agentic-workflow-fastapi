"""Object storage for uploaded files.

One small interface over obstore. Local development and Docker use a directory
(a Docker volume in containers); tests use memory. A Cloudinary or S3 adapter
plugs in here later without touching callers.
"""

from pathlib import Path
from urllib.parse import unquote, urlsplit

import obstore
from obstore.store import LocalStore, MemoryStore
from obstore.store import ObjectStore as Backend


class ObjectStore:
    def __init__(self, backend: Backend) -> None:
        self._backend = backend

    @classmethod
    def from_url(cls, url: str) -> ObjectStore:
        parts = urlsplit(url)
        if parts.scheme == "file":
            root = Path(unquote(parts.path))
            root.mkdir(parents=True, exist_ok=True)
            return cls(LocalStore(prefix=root))
        if parts.scheme == "memory":
            return cls(MemoryStore())
        raise ValueError(f"unsupported object store url scheme: {parts.scheme!r}")

    async def put(self, key: str, data: bytes) -> None:
        await obstore.put_async(self._backend, key, data)

    async def get(self, key: str) -> bytes:
        result = await obstore.get_async(self._backend, key)
        return bytes(await result.bytes_async())

    async def delete_prefix(self, prefix: str) -> int:
        """Delete every object under a prefix. Safe to call again."""
        paths: list[str] = []
        async for batch in obstore.list(self._backend, prefix=prefix):
            paths.extend(item["path"] for item in batch)
        if paths:
            await obstore.delete_async(self._backend, paths)
        return len(paths)
