"""Widget files: the loader that customer sites embed, and the framed chat page.

The frame page is rendered per widget with `frame-ancestors` set to that
widget's allowed origins, so browsers refuse to show it anywhere else. Its CSP
allows no inline code and only same-origin requests.
"""

import json
from html import escape
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response

from docent.api.deps import State
from docent.db.pool import transaction
from docent.widget import repo

router = APIRouter(prefix="/widget/v1", include_in_schema=False)

STATIC = {
    "loader.js": "application/javascript",
    "frame.js": "application/javascript",
    "frame.css": "text/css",
}

FRAME_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="docent-widget" content="{config}">
<title>Support chat</title>
<link rel="stylesheet" href="/widget/v1/frame.css">
</head>
<body><div id="docent"></div><script src="/widget/v1/frame.js"></script></body>
</html>
"""


@router.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@router.get("/{name}")
def static_file(name: str, state: State) -> Response:
    """Sync on purpose: FastAPI runs it in a thread, so the file check never blocks the loop."""
    media_type = STATIC.get(name)
    path: Path = state.settings.widget_dist / name
    if media_type is None or not path.is_file():
        return JSONResponse({"error": {"code": "not_found", "message": "Not found."}}, 404)
    return FileResponse(
        path,
        media_type=media_type,
        headers={
            "cache-control": "public, max-age=300",
            "cross-origin-resource-policy": "cross-origin",
        },
    )


@router.get("/frame/{public_id}")
async def frame(public_id: str, state: State) -> HTMLResponse:
    widget = None
    if public_id.startswith("wid_") and len(public_id) == 20 and public_id[4:].isalnum():
        async with transaction(state.pool, widget_public_id=public_id) as conn:
            widget = await repo.widget_by_public_id(conn)
    if widget is None:
        return HTMLResponse("Widget not found.", status_code=404)
    origins = list(widget["allowed_origins"])
    config = json.dumps(
        {
            "publicId": public_id,
            "name": widget["name"],
            "greeting": widget["greeting"],
            "suggestions": list(widget["suggestions"]),
            "allowedOrigins": origins,
            "anonymous": widget["anonymous_enabled"],
            "apiBase": "/v1/widget",
            "siteUrl": state.settings.public_site_url,
        }
    )
    csp = "; ".join(
        [
            "default-src 'none'",
            "script-src 'self'",
            "style-src 'self'",
            "connect-src 'self'",
            "img-src 'self' data:",
            "font-src 'self'",
            f"frame-ancestors {' '.join(origins) or chr(39) + 'none' + chr(39)}",
            "base-uri 'none'",
            "form-action 'none'",
        ]
    )
    return HTMLResponse(
        FRAME_HTML.format(config=escape(config, quote=True)),
        headers={"content-security-policy": csp, "cache-control": "no-store"},
    )
