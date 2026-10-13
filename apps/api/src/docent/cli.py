"""Command line entry point: `docent api | worker | db migrate | openapi`."""

import argparse
import json
import sys
from pathlib import Path

import uvicorn

from docent.config import get_settings

API_ROOT = Path(__file__).resolve().parents[2]


def _alembic_config() -> object:
    from alembic.config import Config

    return Config(str(API_ROOT / "alembic.ini"))


def _serve(target: str, host: str, port: int, reload: bool) -> None:
    settings = get_settings()
    uvicorn.run(
        target,
        factory=True,
        host=host,
        port=port,
        reload=reload,
        reload_dirs=[str(API_ROOT / "src")] if reload else None,
        proxy_headers=True,
        forwarded_allow_ips=settings.forwarded_allow_ips,
        server_header=False,
        log_config=None,
    )


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="docent")
    sub = parser.add_subparsers(dest="command", required=True)

    for name, port in (("api", 8000), ("worker", 8001)):
        p = sub.add_parser(name)
        p.add_argument("--host", default="127.0.0.1")
        p.add_argument("--port", type=int, default=port)
        p.add_argument("--reload", action="store_true")

    db = sub.add_parser("db")
    db_sub = db.add_subparsers(dest="db_command", required=True)
    db_sub.add_parser("migrate")
    db_sub.add_parser("current")
    down = db_sub.add_parser("downgrade")
    down.add_argument("revision")

    sub.add_parser("openapi")

    args = parser.parse_args(argv)

    if args.command == "api":
        _serve("docent.api.app:create_app", args.host, args.port, args.reload)
    elif args.command == "worker":
        _serve("docent.worker_app:create_worker_app", args.host, args.port, args.reload)
    elif args.command == "db":
        from alembic import command

        cfg = _alembic_config()
        if args.db_command == "migrate":
            command.upgrade(cfg, "head")  # type: ignore[arg-type]
        elif args.db_command == "current":
            command.current(cfg)  # type: ignore[arg-type]
        else:
            command.downgrade(cfg, args.revision)  # type: ignore[arg-type]
    elif args.command == "openapi":
        from docent.api.app import create_app

        json.dump(create_app().openapi(), sys.stdout, indent=2)
        sys.stdout.write("\n")


if __name__ == "__main__":
    main()
